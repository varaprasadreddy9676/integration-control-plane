# Scheduled Automation

Scheduled jobs let you run integrations on a time-based trigger — no external cron service required. Jobs are defined with a JavaScript scheduling script that returns either a one-time timestamp or a full recurring configuration.

---

## How It Works

1. You write a **scheduling script** that computes when the job should run.
2. The scheduler evaluates the script and determines the next execution time.
3. At the scheduled time, the **integration is triggered** exactly as if an event arrived.
4. For recurring jobs, the scheduler calculates the **next occurrence** after each run.
5. The series ends when `maxOccurrences` is reached or the `endDate` passes.
6. Every execution is fully traced and observable.

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

## Cancellation Support

Scheduled appointments can be cancelled before they run. The system extracts patient and appointment identifiers from the event payload automatically, checking these field names in order:

**Patient ID fields checked:**
`patientRid`, `patient_rid`, `patientId`, `patient_id`, `ridPatient`, `rid_patient`

**Scheduled date/time fields checked:**
`scheduledDateTime`, `scheduled_date_time`, `appointmentDateTime`, `appointment_date_time`, `scheduledDate`, `appointment_date`

If a matching scheduled job is found, it is cancelled atomically.

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

---

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Script return | object/number | — | Unix ms (DELAYED) or recurring config object |
| `firstOccurrence` | number | — | Unix ms timestamp for first run |
| `intervalMs` | number | 60000 | Milliseconds between runs (min 60000) |
| `maxOccurrences` | number | — | How many times to run (2–365) |
| `endDate` | number | — | Unix ms cutoff date (alternative to maxOccurrences) |
