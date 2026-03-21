# Outbound Lifecycle & Gated Delivery

Outbound delivery is no longer limited to "send now" versus "send later". The platform now supports two generic control layers on top of standard delivery:

- **Lifecycle invalidation** for delayed and recurring deliveries
- **Condition-based release** for payloads that should be held until a follow-up event arrives

Both models are generic. The backend does not need to know what a "patient", "booking", or "GRN" is. It only works with:

- a **resource type**
- a **subject extraction**
- a set of **rules**
- a set of **match keys**

---

## Mental Model

### 1. Subject Extraction

Every rule-driven outbound flow starts by extracting a **subject** from the event payload.

That subject is just a flat object of keys you define:

```json
{
  "mode": "PATHS",
  "paths": {
    "appointment_id": "appt.apptRID",
    "booking_ref": "appt.bookingNumber"
  }
}
```

Or, for more complex payloads:

```json
{
  "mode": "SCRIPT",
  "script": "return { grn_id: payload.grn?.id, txn_id: payload.grn?.transactionId };"
}
```

The extracted object is stored with the scheduled or held row and is reused later for matching.

### 2. Match Keys

Each rule chooses which extracted keys are strong enough to correlate rows:

- `["appointment_id"]`
- `["grn_id", "txn_id"]`
- `["booking_ref"]`

The platform matches only on those keys. It does not guess hidden domain semantics.

---

## DELAYED / RECURRING: Lifecycle Rules

For delayed and recurring integrations, `lifecycleRules` define what later events should do to pending scheduled deliveries.

Example:

```json
[
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
```

### What the actions mean

| Action | Behavior |
|--------|----------|
| `CANCEL_PENDING` | Cancel matching pending scheduled deliveries |
| `RESCHEDULE_PENDING` | Cancel matching pending scheduled deliveries, then let the current event create fresh ones through the normal scheduling path |
| `IGNORE` | Keep the current event from affecting scheduled rows |

Important:
- invalidation runs even if there is **no outbound integration configured for the follow-up event itself**
- matching is scoped to the **owning integration config**, so one integration cannot accidentally cancel another integration's rows

---

## WAIT_FOR_CONDITION: Hold And Release

Some workflows should not deliver immediately when the first event arrives.

Example:
- `GRN_CREATED` should be held
- `GRN_APPROVED` should release the held payload
- `GRN_REJECTED` should discard it

That is handled by `deliveryMode: WAIT_FOR_CONDITION`.

Example:

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

### Current behavior

1. Start event arrives
2. Transformation runs immediately
3. The transformed payload is stored in `held_outbound_deliveries`
4. A later event is checked against `releaseRules` or `discardRules`
5. Matching held rows are released or discarded

Currently supported payload strategy:

| Strategy | Meaning |
|----------|---------|
| `ORIGINAL_EVENT` | Deliver the transformed payload created from the held event |

`WAIT_FOR_EVENT` is still accepted and is normalized internally to `WAIT_FOR_CONDITION`.

---

## Preview APIs

The UI uses backend preview endpoints so users can validate configuration before saving:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/outbound-integrations/preview-subject` | Show the extracted subject for a sample payload |
| `POST /api/v1/outbound-integrations/preview-cancellation` | Dry-run which scheduled rows would be cancelled/rescheduled |
| `POST /api/v1/outbound-integrations/preview-condition` | Dry-run which held rows would be released/discarded |

These previews are especially important when using `SCRIPT` extraction mode.

---

## UI Support

The integration detail screen now includes a dedicated lifecycle section with:

- `resourceType`
- subject extraction in `PATHS` or `SCRIPT` mode
- delayed/recurring lifecycle rules
- `WAIT_FOR_CONDITION` release and discard rules
- extracted-subject preview
- scheduled-row or held-row impact preview

The panel validates:

- duplicate event types
- missing match keys
- missing resource type
- extraction keys referenced by rules but not defined in `PATHS` mode

---

## Practical Examples

### Appointment reminders

- `APPOINTMENT_CONFIRMATION` schedules reminder rows
- `APPOINTMENT_CANCELLATION` cancels them
- `APPOINTMENT_RESCHEDULED` cancels old rows and schedules new ones

### Approval-based outbound release

- `GRN_CREATED` is transformed and held
- `GRN_APPROVED` releases it
- `GRN_REJECTED` discards it

### Generic enterprise pattern

The same model works for:

- orders waiting for payment
- claims waiting for approval
- bookings waiting for confirmation
- onboarding events waiting for verification

The platform stays generic because the meaning comes from configuration, not hardcoded field names.
