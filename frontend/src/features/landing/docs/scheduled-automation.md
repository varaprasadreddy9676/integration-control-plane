# Scheduled Automation

Scheduled delivery lets an outbound integration transform an event now and execute it later. This is separate from scheduled batch jobs: these rows are created by normal event processing and then picked up by the scheduler worker.

---

## How It Works

1. A matching outbound event arrives.
2. The integration transformation runs immediately.
3. A **scheduling script** computes one timestamp (`DELAYED`) or a recurring plan (`RECURRING`).
4. The resulting row is written to `scheduled_integrations`.
5. At the scheduled time, the scheduler worker delivers it.
6. For recurring rows, the next occurrence is created automatically.
7. Every execution is fully traced and observable.

---

## Scheduling Script

The script runs in a secure VM with a **5-second timeout** (synchronous only — no async).

**Return a one-time timestamp (DELAYED mode):**
```js
const apptDate = event.scheduledDateTime;
return toTimestamp(parseDate(apptDate)) - (30 * 60 * 1000); // 30 min before
```

**Return a recurring configuration (RECURRING mode):**
```js
return {
  firstOccurrence: toTimestamp(now()),    // Unix ms
  intervalMs: 3600000,                    // Every 1 hour
  maxOccurrences: 24,                     // Run 24 times
};
```

Or use `endDate` instead of `maxOccurrences`:
```js
return {
  firstOccurrence: toTimestamp(now()),
  intervalMs: 86400000,                   // Daily
  endDate: toTimestamp(addDays(now(), 30)), // For 30 days
};
```

---

## Validation Rules

| Field | Rule |
|-------|------|
| `firstOccurrence` | Must not be more than **1 minute in the past** |
| `intervalMs` | Minimum **60,000 ms (1 minute)** |
| `maxOccurrences` | Between **2 and 365** |
| `endDate` | Must be after `firstOccurrence` |
| `maxOccurrences` / `endDate` | Must provide one or the other (not both optional) |

---

## Next Occurrence Formula

```
nextTimestamp = firstOccurrence + (intervalMs × (currentOccurrence − 1))
```

`currentOccurrence` is 1-based. The series stops when:
- `currentOccurrence > maxOccurrences`, or
- `nextTimestamp > endDate`

---

## Available Utilities in Script

```js
// Date parsing
parseDate("04-Feb-2026")       // Supports DD/MM/YYYY, D-Mon-YYYY, ISO, Unix
parseDate("15/03/2026 02:30 PM")

// Date arithmetic
addHours(date, n)
subtractHours(date, n)
addDays(date, n)
subtractDays(date, n)
addMinutes(date, n)
subtractMinutes(date, n)

// Utilities
now()                           // Current Date object
toTimestamp(date)               // Returns milliseconds

// Logging (appears in execution trace)
console.log("debug info")
console.error("something went wrong")
```

**Date format support:**
- `DD/MM/YYYY` (and `DD/MM/YYYY HH:MM AM/PM`)
- `D-Mon-YYYY` (e.g. `04-Feb-2026`)
- ISO strings
- Unix timestamps (auto-detected: `>10B` = ms, else seconds)

---

## Lifecycle Invalidation

Delayed and recurring rows can be invalidated by follow-up events using generic `lifecycleRules`.

Example:

```json
{
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

### What happens

- `CANCEL_PENDING` cancels matching pending scheduled rows
- `RESCHEDULE_PENDING` cancels matching pending scheduled rows and then allows the current event to schedule fresh rows through the normal processing path
- matching is scoped to the same integration config that created the scheduled rows

Use the preview endpoints in the UI to dry-run extracted subject keys and scheduled-row impact before saving.

---

## Job States

| Status | Meaning |
|--------|---------|
| `PENDING` | Scheduled for the future |
| `OVERDUE` | Past due, waiting to be picked up |
| `PROCESSING` | Currently being executed (atomic lock) |
| `COMPLETED` | Successfully delivered |
| `FAILED` | Max retries exceeded |
| `CANCELLED` | Cancelled before execution |

---

## Observability

Every scheduled execution produces a full execution trace — same as any other delivery:
- Payload sent, response received
- Response time and status code
- Retry count if delivery failed
- `triggerType: SCHEDULE` in all logs

Scheduled jobs appear in the execution logs with `direction: SCHEDULED`, making it easy to filter and inspect them separately.

Rows also retain `subject`, `subjectExtraction`, and `lifecycleRules` metadata so future invalidating events can be matched without hardcoded domain fields.

---

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Script return | object/number | — | Unix ms (DELAYED) or recurring config object |
| `firstOccurrence` | number | — | Unix ms timestamp for first run |
| `intervalMs` | number | 60000 | Milliseconds between runs (min 60000) |
| `maxOccurrences` | number | — | How many times to run (2–365) |
| `endDate` | number | — | Unix ms cutoff date (alternative to maxOccurrences) |
