# Outbound Lifecycle & Condition Delivery Guide

This guide covers the two generic outbound control models now supported by the platform:

- **Lifecycle invalidation** for `DELAYED` and `RECURRING` integrations
- **Condition-based hold/release** for `WAIT_FOR_CONDITION` integrations

These features are intentionally domain-agnostic. The platform does not hardcode concepts like patient IDs or booking numbers. Instead, integrations declare:

- `resourceType`
- `subjectExtraction`
- rule lists (`lifecycleRules` or `conditionConfig`)
- `matchKeys`

---

## 1. Subject Extraction

`subjectExtraction` defines how to derive a flat correlation object from an event payload.

### PATHS mode

```json
{
  "subjectExtraction": {
    "mode": "PATHS",
    "paths": {
      "appointment_id": "appt.apptRID",
      "booking_ref": "appt.bookingNumber"
    }
  }
}
```

### SCRIPT mode

```json
{
  "subjectExtraction": {
    "mode": "SCRIPT",
    "script": "return { grn_id: payload.grn?.id, txn_id: payload.grn?.transactionId };"
  }
}
```

Notes:
- the extracted subject must be a **flat scalar object**
- script extraction runs in the same secure VM model used elsewhere in the platform
- previews are available before save

---

## 2. Lifecycle Rules For Scheduled Deliveries

Use lifecycle rules on `DELAYED` or `RECURRING` integrations when later events should cancel or replace pending scheduled rows.

### Example

```json
{
  "deliveryMode": "DELAYED",
  "resourceType": "APPOINTMENT",
  "subjectExtraction": {
    "mode": "PATHS",
    "paths": {
      "appointment_id": "appt.apptRID",
      "booking_ref": "appt.bookingNumber"
    }
  },
  "lifecycleRules": [
    {
      "eventTypes": ["APPOINTMENT_CANCELLATION"],
      "action": "CANCEL_PENDING",
      "matchKeys": ["appointment_id", "booking_ref"]
    },
    {
      "eventTypes": ["APPOINTMENT_RESCHEDULED"],
      "action": "RESCHEDULE_PENDING",
      "matchKeys": ["appointment_id", "booking_ref"]
    }
  ]
}
```

### Implemented actions

| Action | Behavior |
|--------|----------|
| `CANCEL_PENDING` | Cancels matching pending scheduled rows |
| `RESCHEDULE_PENDING` | Cancels matching pending scheduled rows, then lets the current event continue through normal scheduling |
| `IGNORE` | Declares that the event should not affect scheduled rows |

### Important runtime behavior

- invalidation is evaluated in `event-handler.js` before the normal "no matching integrations" skip
- matching is scoped to the owning `integrationConfigId`
- recurring rows keep the same lifecycle metadata when the next occurrence is created
- legacy rows can still be evaluated from stored `originalPayload` plus the saved extraction config

---

## 3. WAIT_FOR_CONDITION

Use `WAIT_FOR_CONDITION` when the first event should not be delivered yet.

Typical examples:
- `GRN_CREATED` -> wait for `GRN_APPROVED`
- `ORDER_CREATED` -> wait for `PAYMENT_SUCCESS`
- `BOOKING_CREATED` -> wait for `BOOKING_CONFIRMED`

### Example

```json
{
  "deliveryMode": "WAIT_FOR_CONDITION",
  "resourceType": "GRN",
  "subjectExtraction": {
    "mode": "SCRIPT",
    "script": "return { grn_id: payload.grn?.id, txn_id: payload.grn?.transactionId };"
  },
  "conditionConfig": {
    "payloadStrategy": "ORIGINAL_EVENT",
    "releaseRules": [
      {
        "eventTypes": ["GRN_APPROVED"],
        "action": "RELEASE_HELD",
        "matchKeys": ["grn_id", "txn_id"]
      }
    ],
    "discardRules": [
      {
        "eventTypes": ["GRN_REJECTED", "GRN_CANCELLED"],
        "action": "DISCARD_HELD",
        "matchKeys": ["grn_id", "txn_id"]
      }
    ],
    "expiresAfterMs": 604800000
  }
}
```

### Runtime flow

1. Start event arrives
2. Transformation runs immediately
3. The transformed payload is stored in `held_outbound_deliveries`
4. Follow-up events are checked against `releaseRules` and `discardRules`
5. Matching held rows are released or discarded

### Current payload strategy support

| Strategy | Support |
|----------|---------|
| `ORIGINAL_EVENT` | Supported |
| `LATEST_EVENT` | Not implemented yet |
| `MERGED_EVENTS` | Not implemented yet |
| `CUSTOM_SCRIPT` | Not implemented yet |

`WAIT_FOR_EVENT` is accepted as a legacy alias and normalized to `WAIT_FOR_CONDITION`.

---

## 4. Validation Rules

### Lifecycle config

- `resourceType` is required when `lifecycleRules` exist
- `subjectExtraction` is required when `lifecycleRules` exist
- rule event types must be unique across the integration
- non-`IGNORE` rules must define `matchKeys`
- in `PATHS` mode, all `matchKeys` must exist in the path map

### Condition config

- `conditionConfig` is required for `WAIT_FOR_CONDITION`
- at least one `releaseRule` is required
- release and discard event types must be unique
- every rule must define `matchKeys`
- in `PATHS` mode, all `matchKeys` must exist in the path map
- only `ORIGINAL_EVENT` payload strategy is currently valid

---

## 5. Preview APIs

### Preview extracted subject

```http
POST /api/v1/outbound-integrations/preview-subject
```

Request body:

```json
{
  "eventType": "APPOINTMENT_CANCELLATION",
  "resourceType": "APPOINTMENT",
  "subjectExtraction": {
    "mode": "PATHS",
    "paths": {
      "appointment_id": "appt.apptRID"
    }
  },
  "samplePayload": {
    "appt": {
      "apptRID": 4153193
    }
  }
}
```

### Preview scheduled-row impact

```http
POST /api/v1/outbound-integrations/preview-cancellation
```

Returns:
- extracted subject
- selected lifecycle action
- matching scheduled rows
- keys matched
- warnings

### Preview held-row impact

```http
POST /api/v1/outbound-integrations/preview-condition
```

Returns:
- extracted subject
- selected condition action
- matching held rows
- keys matched
- warnings

---

## 6. Runtime Collections

### `scheduled_integrations`

Rows now store lifecycle metadata used during invalidation:

- `subject`
- `subjectExtraction`
- `lifecycleRules`

### `held_outbound_deliveries`

Rows store hold-and-release state for `WAIT_FOR_CONDITION`:

- held transformed payload
- original payload
- `subject`
- `subjectExtraction`
- `conditionConfig`
- status: `HELD`, `RELEASED`, `DISCARDED`

---

## 7. Real Scenarios This Solves

### Appointment reminders

- schedule on confirmation
- cancel on cancellation
- cancel + recreate on reschedule

### Approval gate

- hold `GRN_CREATED`
- release on `GRN_APPROVED`
- discard on `GRN_REJECTED`

### Generic B2B gating

- hold `ORDER_CREATED`
- release on `PAYMENT_SUCCESS`
- discard on `ORDER_CANCELLED`

---

## 8. Related Files

- `backend/src/services/lifecycle-config.js`
- `backend/src/services/condition-config.js`
- `backend/src/processor/event-normalizer.js`
- `backend/src/processor/event-handler.js`
- `backend/src/processor/event-processor.js`
- `backend/src/data/scheduled-integrations.js`
- `backend/src/data/held-outbound-deliveries.js`
- `backend/src/routes/outbound-integrations.js`
