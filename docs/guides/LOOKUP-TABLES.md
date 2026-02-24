# Lookup Tables Guide

Lookup tables map one set of values to another. They are evaluated at delivery time during transformation — before the payload is sent to the target endpoint. Use them to translate internal codes to external labels, normalize statuses, map IDs across systems, or enrich payloads without hardcoding mappings into transformation scripts.

## Table of Contents

- [Concepts](#concepts)
- [Creating a Lookup Table](#creating-a-lookup-table)
- [Using Lookups in Transformations](#using-lookups-in-transformations)
- [Import & Export](#import--export)
- [Reverse Lookup](#reverse-lookup)
- [API Endpoints](#api-endpoints)
- [Statistics](#statistics)
- [Best Practices](#best-practices)

---

## Concepts

A lookup table is a named set of **source → target** entry pairs. Each entry has:

| Field | Description |
|-------|-------------|
| `source.id` | The value you're mapping **from** (what arrives in the payload) |
| `source.name` | Human-readable label for the source value |
| `target.id` | The value you're mapping **to** (what the target endpoint expects) |
| `target.name` | Human-readable label for the target value |

**Example — appointment status mapping:**

| source.id | source.name | target.id | target.name |
|-----------|------------|-----------|------------|
| `APT_SCH` | Scheduled | `scheduled` | Scheduled |
| `APT_CNF` | Confirmed | `confirmed` | Confirmed |
| `APT_CAN` | Cancelled | `cancelled` | Cancelled |
| `APT_NOS` | No Show | `no_show` | No Show |

Lookups are **org-scoped** — each organization has its own isolated lookup tables.

---

## Creating a Lookup Table

### Via UI

1. Navigate to **Lookups** in the sidebar
2. Click **New Lookup Table**
3. Give it a name (e.g., `appointment_status`)
4. Add entries using the table editor, or import from XLSX (see [Import & Export](#import--export))
5. Save

### Via API

```http
POST /api/v1/lookups
Content-Type: application/json
X-API-Key: your-api-key

{
  "name": "appointment_status",
  "description": "Maps internal appointment status codes to external labels",
  "entries": [
    {
      "source": { "id": "APT_SCH", "name": "Scheduled" },
      "target": { "id": "scheduled", "name": "Scheduled" }
    },
    {
      "source": { "id": "APT_CAN", "name": "Cancelled" },
      "target": { "id": "cancelled", "name": "Cancelled" }
    }
  ]
}
```

**Important:** The entry payload structure uses nested objects (`source.id`, `target.id`), **not** flat fields like `sourceCode`/`targetCode`.

---

## Using Lookups in Transformations

### SIMPLE Mode (Visual Field Mapping)

In the field mapping editor, set the source field and choose **Lookup** as the transformation type. Select the lookup table by name. At delivery time, the source value is looked up and replaced with the target value.

If no match is found, the original value is passed through unchanged.

### SCRIPT Mode (JavaScript)

In transformation scripts, use the `lookup()` utility:

```javascript
// Basic lookup — returns target.id or the original value if not found
const status = lookup('appointment_status', payload.statusCode);

// Lookup with explicit fallback
const status = lookup('appointment_status', payload.statusCode) ?? 'unknown';

// Lookup target name instead of id
const statusLabel = lookupName('appointment_status', payload.statusCode);
```

Available lookup utilities in transformation scripts:

| Function | Returns |
|----------|---------|
| `lookup(tableName, sourceId)` | `target.id` or original value if not found |
| `lookupName(tableName, sourceId)` | `target.name` or `null` if not found |
| `reverseLookup(tableName, targetId)` | `source.id` or original value if not found |

---

## Import & Export

Lookup tables support bulk import and export via **XLSX (Excel)** files.

### Export

1. Open a lookup table in the UI
2. Click **Export** → downloads as `.xlsx`
3. The spreadsheet has columns: `source_id`, `source_name`, `target_id`, `target_name`

### Import

**From the UI:**
1. Open a lookup table (or create a new empty one)
2. Click **Import** → select your `.xlsx` file
3. Review the preview showing added/updated/removed entries
4. Confirm to apply

**Import behavior:**
- Rows in the file that don't exist in the table are **added**
- Rows that exist with the same `source_id` are **updated**
- Rows in the table that are absent from the file are **left unchanged** (not deleted)
- To replace the entire table, delete all entries first then import

**XLSX format:**

| source_id | source_name | target_id | target_name |
|-----------|------------|-----------|------------|
| APT_SCH | Scheduled | scheduled | Scheduled |
| APT_CNF | Confirmed | confirmed | Confirmed |

### Via API (bulk import)

```http
POST /api/v1/lookups/:id/import
Content-Type: multipart/form-data

file=@appointment_status.xlsx
```

Response includes a progress token for large imports. Poll:

```http
GET /api/v1/lookups/import-progress/:token
```

---

## Reverse Lookup

Reverse lookup maps `target → source` (the opposite direction). Useful when a response from an external API uses external codes and you need to translate back to internal codes.

```http
POST /api/v1/lookups/:id/reverse
Content-Type: application/json

{ "targetId": "cancelled" }

→ Response: { "sourceId": "APT_CAN", "sourceName": "Cancelled" }
```

In transformation scripts, use `reverseLookup('appointment_status', payload.status)`.

---

## API Endpoints

```
GET    /api/v1/lookups                   List all lookup tables (with entry counts)
GET    /api/v1/lookups/:id               Get a single table with all entries
GET    /api/v1/lookups/:id/statistics    Usage stats (match rate, miss rate, top entries)
POST   /api/v1/lookups                   Create a new table
PUT    /api/v1/lookups/:id               Update table metadata or entries
DELETE /api/v1/lookups/:id               Delete a table
POST   /api/v1/lookups/:id/import        Bulk import from XLSX
DELETE /api/v1/lookups/:id/bulk          Delete multiple entries by source ID
POST   /api/v1/lookups/:id/reverse       Perform a reverse lookup
```

---

## Statistics

Each lookup table tracks:

| Metric | Description |
|--------|-------------|
| **Total lookups** | How many times this table was evaluated during delivery |
| **Match rate** | % of evaluations that found a matching entry |
| **Miss rate** | % of evaluations that fell through (no match found) |
| **Top entries** | Most frequently matched source values |
| **Last used** | Timestamp of last evaluation |

A high miss rate usually means the lookup table is incomplete — source values are arriving that have no corresponding entry.

View statistics via:
- **UI**: Lookup table detail → Statistics tab
- **API**: `GET /api/v1/lookups/:id/statistics`

---

## Best Practices

**Name tables clearly** — use lowercase with underscores: `appointment_status`, `department_codes`, `payment_methods`. The name is used in transformation scripts so treat it as a code identifier.

**Keep entries consistent** — both `source.id` and `target.id` should be stable identifiers (not display labels that can change).

**Document miss behavior** — decide explicitly what should happen when a lookup misses. Either configure a fallback in the script or make the table exhaustive to avoid silent pass-through of unmapped values.

**Use XLSX for bulk setup** — for tables with 50+ entries, always use the XLSX import. The UI editor is suited for small tables and individual corrections.

**One concern per table** — don't put unrelated mappings in the same table. A single table with appointment statuses and unrelated department codes is harder to maintain.

**Version your XLSX files** — keep the source `.xlsx` files in version control so you can reconstruct tables after an accidental delete.
