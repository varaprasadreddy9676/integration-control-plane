# Lookup Tables

Lookup tables map one set of values to another at delivery time. Use them to translate internal codes to external labels, normalize status values across systems, or enrich payloads — without hardcoding mappings in transformation scripts.

---

## How It Works

A lookup table is a named set of **source → target** entry pairs evaluated during transformation, before the payload is sent.

**Example — appointment status mapping:**

| source.id | source.name | target.id | target.name |
|-----------|------------|-----------|------------|
| `APT_SCH` | Scheduled | `scheduled` | Scheduled |
| `APT_CNF` | Confirmed | `confirmed` | Confirmed |
| `APT_CAN` | Cancelled | `cancelled` | Cancelled |
| `APT_NOS` | No Show | `no_show` | No Show |

If a value is not found in the table, the original value passes through unchanged.

Lookup tables are **org-scoped** — each organization has its own isolated set of tables.

---

## Using Lookups in Transformations

### Visual (SIMPLE) Mode

In the field mapping editor, set the transformation type to **Lookup** and select the table by name.

### Script (SCRIPT) Mode

Three utility functions are available in transformation scripts:

| Function | Returns |
|----------|---------|
| `lookup('table_name', value)` | `target.id`, or original value if not found |
| `lookupName('table_name', value)` | `target.name`, or `null` if not found |
| `reverseLookup('table_name', targetId)` | `source.id`, or original value if not found |

```javascript
// Basic lookup
const status = lookup('appointment_status', payload.statusCode);

// With explicit fallback
const status = lookup('appointment_status', payload.statusCode) ?? 'unknown';

// Reverse lookup (external → internal)
const internalCode = reverseLookup('appointment_status', payload.status);
```

---

## Creating a Table

**Via UI:** Lookups → New Lookup Table → add entries manually or import from XLSX.

**Via API:**

```http
POST /api/v1/lookups
Content-Type: application/json

{
  "name": "appointment_status",
  "entries": [
    { "source": { "id": "APT_SCH", "name": "Scheduled" }, "target": { "id": "scheduled", "name": "Scheduled" } },
    { "source": { "id": "APT_CAN", "name": "Cancelled" }, "target": { "id": "cancelled", "name": "Cancelled" } }
  ]
}
```

---

## XLSX Import / Export

For tables with many entries, use the bulk XLSX workflow.

**Export** from the UI: Lookup table detail → **Export** → downloads `.xlsx` with columns `source_id`, `source_name`, `target_id`, `target_name`.

**Import behavior:**

| Case | Result |
|------|--------|
| Row not in table | Added |
| Row matches existing `source_id` | Updated |
| Row in table but absent from file | Left unchanged |

To fully replace a table, delete all entries first, then import.

---

## Statistics

Each table tracks:

| Metric | Description |
|--------|-------------|
| Total lookups | Times this table was evaluated during delivery |
| Match rate | % of evaluations that found a match |
| Miss rate | % of evaluations with no match (value passed through) |
| Top entries | Most frequently matched source values |
| Last used | Timestamp of last evaluation |

A high miss rate means your table is incomplete — values are arriving that have no mapping.

---

## API Reference

```
GET    /api/v1/lookups                   List all tables
GET    /api/v1/lookups/:id               Get table with all entries
GET    /api/v1/lookups/:id/statistics    Usage stats
POST   /api/v1/lookups                   Create table
PUT    /api/v1/lookups/:id               Update table
DELETE /api/v1/lookups/:id               Delete table
POST   /api/v1/lookups/:id/import        Bulk import from XLSX
POST   /api/v1/lookups/:id/reverse       Reverse lookup { targetId }
```
