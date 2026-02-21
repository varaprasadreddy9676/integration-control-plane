# Data Transformation

Every integration — outbound, inbound, or scheduled — can reshape the payload before it is sent. Two transformation modes are supported: a simple field-mapping mode for straightforward remapping, and a script mode for anything that requires logic.

---

## Transformation Modes

### SIMPLE Mode — Field Mapping

Define a list of mappings. Each mapping reads a field from the source payload and writes it to the target:

```json
{
  "mode": "SIMPLE",
  "mappings": [
    { "sourceField": "patient.name",   "targetField": "fullName" },
    { "sourceField": "appointment.dt", "targetField": "datetime", "transform": "date" },
    { "sourceField": "status",         "targetField": "status",   "transform": "upper" }
  ],
  "staticFields": [
    { "key": "source", "value": "integration-gateway" }
  ]
}
```

**Dot notation** is supported for nested source fields: `patient.contact.phone`, `items[0].id`, etc.

**Per-field transforms:**

| Transform | Effect |
|-----------|--------|
| `trim` | Removes leading/trailing whitespace |
| `upper` | Converts to uppercase |
| `lower` | Converts to lowercase |
| `date` | Converts to ISO date string |
| `default` | Uses source value, or `defaultValue` if source is undefined |
| `lookup` | Resolves value against a lookup table |

**Static fields** are added to the output regardless of the input — useful for adding a fixed `source`, `version`, or `environment` field.

---

### SCRIPT Mode — Custom JavaScript

Write any JavaScript you need. The script runs in a secure sandbox:

```js
const fullName = `${payload.patient.firstName} ${payload.patient.lastName}`;
const ts = epoch(payload.appointment.scheduledAt);

return {
  name: fullName,
  phone: formatPhone(payload.patient.mobile, 91),
  scheduledEpoch: ts,
  source: "gateway",
};
```

**Script timeout:** 60 seconds
**Async/await:** Supported

---

## Script Utilities

These are available globally inside any transform script:

```js
// Date/Time
epoch(dateStr)                        // Parse to Unix timestamp (seconds)
datetime(date, time, timezone)        // Compose timestamp (default tz: +05:30)

// String
uppercase(str)
lowercase(str)
trim(str)

// Phone
formatPhone(phone, countryCode)       // Normalise phone (default country: 91)

// Object
get(obj, "path.to.field", default)    // Safe dot-notation getter
```

---

## HTTP Calls Inside Scripts

Scripts can make outbound HTTP requests using the `context.http` helper:

```js
const result = await context.http.get("https://api.example.com/lookup/123");
// result: { status: 200, data: { ... }, headers: { ... } }

const created = await context.http.post("https://api.example.com/items", {
  body: { name: payload.patientName }
});
```

**Available methods:** `get`, `post`, `put`, `patch`, `delete`, `getBuffer`
**Default timeout:** 30 seconds per call
**`getBuffer`** returns base64-encoded binary data and a `contentType` — useful for PDF or image APIs.

Non-2xx responses do not throw — they return the error response as the result, letting you handle failures in script logic.

---

## Lookup Tables

Lookup tables let you map a raw value to a human-readable or system-specific value without changing the script.

**In SIMPLE mode:** Use `"transform": "lookup"` with a `lookupType`.

**In SCRIPT mode:** Use the `context.http` helper or rely on integration-level lookups configured separately.

**Fallback behaviour:** If a lookup returns null/undefined, the original source value is passed through unchanged.

---

## Response Transformation (Inbound Proxy)

For inbound integrations, a separate `responseTransformation` config reshapes what your backend returns before sending it back to the caller:

- Input: `{ data, status, headers }` from your backend
- Same SIMPLE/SCRIPT modes apply
- Lookups work identically

---

## Secure Sandbox

All scripts run inside a hardened Node.js VM:

- **No `eval`** — code generation from strings is disabled
- **No `require`** — modules cannot be loaded
- **No `process`** — the Node process object is not accessible
- **Prototype pollution prevention** — `Object.prototype`, `Array.prototype`, and others are frozen before execution
- **`setTimeout` limit** — max 30 seconds (throws if exceeded)
- **Depth limit** — transformed output must not exceed 50 nested levels
- **Strict mode** — all scripts run with `'use strict'`

---

## Validation

Before saving a transformation script, the gateway does a basic syntax parse using the Function constructor. Scripts that fail to parse are rejected immediately with an error, before any event is processed.

---

## Configuration Reference

| Field | Type | Description |
|-------|------|-------------|
| `transformation.mode` | `SIMPLE` \| `SCRIPT` | Which mode to use |
| `transformation.mappings` | array | Field mappings (SIMPLE mode) |
| `transformation.staticFields` | array | Fixed key/value pairs added to output |
| `transformation.script` | string | Custom JS code (SCRIPT mode) |
| `responseTransformation` | object | Same structure, applied to upstream response |
