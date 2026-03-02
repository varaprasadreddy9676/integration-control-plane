# Pathkind LIS Integration — Setup Guide

Outbound integration for **org 145 (Nova IVF Fertility)** and all child entities.
Fires on every `LAB_ORDER_SENT_TO_EXTERNAL` event and pushes the order to **Pathkind LIS**.

---

## Files in This Directory

| File | Purpose |
|---|---|
| `integration_config.json` | MongoDB document — import into `integration_configs` collection |
| `lookup_data.json` | MongoDB documents — import into `lookups` collection (entity → Pathkind lab code) |
| `README.md` | This file |

---

## How It Works

```
LAB_ORDER_SENT_TO_EXTERNAL event fires
        ↓
Transformation script runs
  - Maps all patient/order/visit fields to Pathkind API format
  - Sets HISLabCode = entityRID (e.g. "147")
        ↓
Lookup (PATHKIND_LAB_CODE) runs
  - Translates HISLabCode: "147" → "NOVAKOR" (Pathkind-assigned code)
  - unmappedBehavior: FAIL — blocks delivery if no mapping found
        ↓
POST to Pathkind API with api-key header
  https://api-dev-80.pathkindlabs.com/api/v1/FuncForHISHospAppToCreatePatientOrderDetails
```

---

## Field Mapping Reference

| Pathkind Field | Source | Notes |
|---|---|---|
| `HISClientCode` | Static (hardcoded) | Get from Pathkind — replace in script |
| `HISLabCode` | `entityRID` → lookup | Translated via `PATHKIND_LAB_CODE` lookup |
| `HISOrderId` | `order.orderId` | |
| `UHIDNO` | `patient.mrn.documentNumber` | |
| `IPDNO_or_OPID_No` | `visit.id.value` | |
| `Patient_Type` | `visit.typeName` | OP→opd, IP→ipd |
| `Patient_Category` | `patient.isVIP` | VIP or Gen |
| `Ward_Category` | `visit.speciality.name` | Optional |
| `Title` | `payload.patientTitle` | |
| `Patient_Name` | `patient.fullName` | |
| `Patient_Dob` | `payload.patientDOBISO` → `patient.dob` | ISO preferred; DD/MM/YYYY auto-converted |
| `A_Age` | `visit.patientAgeInYears` | Only used if no DOB available |
| `Gender` | `visit.gender.name` | |
| `Patient_Mobile_No` | `patient.phone` | |
| `Patient_Email` | `patient.email` | Optional |
| `Doctor_Name` | `visit.consultingDoctorName` | |
| `Ref_Dr_Code` | `order.orderingDoctorCode` | |
| `Order_DateTime` | `order.orderDate` | Date only, time stripped |
| `Order_Sponsor` | `order.orderSponsor` | Optional |
| `AABHA_ID` | `payload.patientABHAId` | Optional |
| `PatientTestLists[].HISTestCode` | `order.labTests[].serviceCode` | Iterated from array |

---

## Deployment Steps

### Step 1 — Fill in `integration_config.json`

Replace these two placeholders before importing:

| Placeholder | Replace with |
|---|---|
| `REPLACE_WITH_PATHKIND_API_KEY` | API key provided by Pathkind (appears twice) |
| `REPLACE_WITH_PATHKIND_CLIENT_CODE` | Static HIS client code from Pathkind contract (e.g. `"H005"`) — inside the script string |
| `REPLACE_WITH_OUTPUT_OF_generateSigningSecret` | Run the command below and paste output (appears twice) |

**Generate signing secret:**
```bash
node -e "const c=require('crypto'); console.log('whsec_' + c.randomBytes(32).toString('base64'));"
```
Run this from `backend/` directory. Copy the output into both `signingSecret` and `signingSecrets[0]`.

### Step 2 — Fill in `lookup_data.json`

Get the Pathkind-assigned lab code for each entity and replace placeholders:

| Entity | entityRID | Placeholder | Replace with |
|---|---|---|---|
| Nova IVF Koramangala - Bangalore | 147 | `REPLACE_WITH_PATHKIND_LAB_CODE_FOR_147` | e.g. `"NOVAKOR"` |
| Nova IVF Rajajinagar - Bangalore | 261 | `REPLACE_WITH_PATHKIND_LAB_CODE_FOR_261` | e.g. `"NOVAGGN"` |

Add more entries for any other child entities under org 145 that send orders to Pathkind
(follow the same structure — see "Adding New Entities" below).

### Step 3 — Import into MongoDB

```bash
# Import integration config (single document — no --jsonArray)
mongoimport \
  --uri "$MONGODB_URI" \
  --db integration_gateway \
  --collection integration_configs \
  --file backend/setup/pathkind/integration_config.json

# Import lookup data (array of documents)
mongoimport \
  --uri "$MONGODB_URI" \
  --db integration_gateway \
  --collection lookups \
  --file backend/setup/pathkind/lookup_data.json \
  --jsonArray
```

### Step 4 — Verify

1. Open the Integration Control Plane UI
2. Navigate to **Outbound Integrations** — confirm "Pathkind LIS - Lab Order External Push" appears
3. Navigate to **Lookups** → filter by type `PATHKIND_LAB_CODE` — confirm all entity entries are listed
4. Use the **Test** button on the integration with a sample `LAB_ORDER_SENT_TO_EXTERNAL` payload to verify the output before going live

---

## Adding New Entities (No Code Change Required)

When a new Nova IVF entity is onboarded and starts sending orders to Pathkind:

**Option A — Via UI:**
1. Go to **Settings → Lookups → Create**
2. Set Type = `PATHKIND_LAB_CODE`
3. Source ID = the entity's `entityRID` (e.g. `"352"`)
4. Source Label = entity name
5. Target ID = the Pathkind-assigned lab code for that entity
6. Target Label = description
7. Save

**Option B — Via CSV Import:**
1. Go to **Settings → Lookups → Import**
2. Download the template
3. Add a row: `PATHKIND_LAB_CODE | <entityRID> | <entityName> | <PathkindLabCode> | <description>`
4. Import

**Option C — Direct MongoDB insert:**
```json
{
  "orgId": 145,
  "orgUnitRid": null,
  "type": "PATHKIND_LAB_CODE",
  "source": { "id": "<entityRID>", "label": "<entityName>" },
  "target": { "id": "<PathkindLabCode>", "label": "<description>" },
  "isActive": true,
  "usageCount": 0,
  "lastUsedAt": null,
  "createdAt": { "$date": "<now>" },
  "updatedAt": { "$date": "<now>" }
}
```

---

## Unmapped Entity Behaviour

`unmappedBehavior` is set to **`FAIL`** in the lookup config.

This means: if a `LAB_ORDER_SENT_TO_EXTERNAL` event fires for an entity that has **no entry** in the `PATHKIND_LAB_CODE` lookup, the delivery will be **blocked** and the event will be moved to the **Dead Letter Queue (DLQ)**.

This is intentional — sending a wrong or missing lab code to Pathkind would result in a silent data error. The DLQ entry can be retried after adding the missing lookup entry.

---

## Pathkind API Response Codes

| StatusCode | Meaning |
|---|---|
| `0` | Success |
| `1` | Credit limit exceeded — settle pending receipt |
| `2` | Billing process error — contact administration |
| `3` | Duplicate record found |
| `4` | Price list not implemented |
| `5` | Lab code and client code not mapped |
| `6` | HIS client not found |
| `1062` | Unknown error — contact administration |

> **Engine behaviour:** The delivery engine marks a delivery as **success when it receives HTTP 2xx** and failure on any non-2xx response. It does not inspect the response body. The `StatusCode` table above is for your own manual investigation in delivery logs — if Pathkind returns HTTP 200 with `StatusCode: 1` (credit limit), the engine will log it as a successful delivery. Monitor the delivery logs and check the raw response body to catch business-level errors.

---

## Future Phases (Inbound from Pathkind)

Pathkind will push two types of data back to our webhook URLs. These need separate **inbound** integrations:

| Phase | Pathkind Push | Our Webhook |
|---|---|---|
| Phase 2 | Sample status updates (per test) | To be defined |
| Phase 3 | Final report (base64 PDF) | To be defined |
