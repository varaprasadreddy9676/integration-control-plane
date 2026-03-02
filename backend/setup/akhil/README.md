# Akhil LIS Integration — Setup Guide

Outbound integration for **org 783 (GUT GI)** and all child entities.
Fires on every `LAB_ORDER_SENT_TO_EXTERNAL` event and pushes the order to **Akhil LIS**.

---

## Files in This Directory

| File | Purpose |
|---|---|
| `integration_config.json` | MongoDB document — import into `integration_configs` collection |
| `lookup_data.json` | MongoDB documents — import into `lookups` collection (our service code → Akhil service code) |
| `README.md` | This file |

---

## How It Works

```
LAB_ORDER_SENT_TO_EXTERNAL event fires
        ↓
Step 1 — Get Bearer Token
  POST http://192.168.3.78:1015/api/Token/GetToken
  Body: { "userName": "<username>", "password": "<password>" }
  → Returns access_token (expires in ~24 hours)
        ↓
Step 2 — Transformation script runs
  - Splits patient.fullName → firstName / middleName / lastName
  - Maps gender: "Male" → "M", "Female" → "F"
  - Maps patientTitle → titleId (numeric, confirm with Akhil)
  - Resolves DOB from patientDOBISO or converts patient.dob
  - Sets integrationServiceCode = our serviceCode (pre-lookup)
        ↓
Step 3 — Lookup (AKHIL_SERVICE_CODE) runs on each array item
  - Translates orderServiceDetails[].integrationServiceCode:
    our serviceCode → Akhil-assigned integrationServiceCode
  - unmappedBehavior: FAIL — blocks delivery if any test has no mapping
        ↓
Step 4 — POST to Akhil API with Bearer token
  http://192.168.3.78:1015/api/VCP/SaveLabOrders
```

---

## Field Mapping Reference

| Akhil Field | Source | Notes |
|---|---|---|
| `titleId` | `payload.patientTitle` → map | Numeric — confirm IDs with Akhil (see table below) |
| `firstName` | `patient.fullName` (split) | First word of fullName |
| `middleName` | `patient.fullName` (split) | Words between first and last; empty if only two parts |
| `lastName` | `patient.fullName` (split) | Last word of fullName |
| `gender` | `visit.gender.name` | "Male" → "M", "Female" → "F" |
| `dob` | `payload.patientDOBISO` → `patient.dob` | ISO format (YYYY-MM-DD); DD/MM/YYYY auto-converted |
| `mobileNo` | `patient.phone` | |
| `address` | `patient.address` | Optional; empty string if absent |
| `locationSource` | Static (hardcoded) | Get from Akhil — replace in script |
| `cityId` | Static `0` | Akhil resolves from their side |
| `stateId` | Static `0` | Akhil resolves from their side |
| `countryId` | Static `0` | Akhil resolves from their side |
| `integrationOrderId` | `order.orderId` | Plain order ID as string |
| `integrationPatientId` | `patient.mrn.documentNumber` | Patient's MRN/UHID |
| `orderServiceDetails[].integrationServiceCode` | `order.labTests[].serviceCode` → lookup | Translated via `AKHIL_SERVICE_CODE` lookup |
| `orderServiceDetails[].stat` | Static `""` | Leave empty unless Akhil requires it |
| `orderServiceDetails[].remarks` | Static `""` | Leave empty unless Akhil requires it |

### Title ID Map (confirm with Akhil)

| Title string | titleId used |
|---|---|
| Mr / Mr. | 1 |
| Mrs / Mrs. | 2 |
| Miss | 3 |
| Ms / Ms. | 3 |
| Dr / Dr. | 4 |
| Master / Baby | 5 |
| *(unknown)* | 1 (fallback) |

> **Action required:** Share this table with Akhil and confirm the correct numeric IDs. Update the `titleIdMap` in the transformation script if they differ.

---

## Auth Flow

Akhil uses a **custom Bearer token** endpoint (not standard OAuth2 client_credentials):

```
POST http://192.168.3.78:1015/api/Token/GetToken
Content-Type: application/json

{ "userName": "<username>", "password": "<password>" }

→ Response:
{
  "access_token": "yBVmEU...",
  "token_type": "bearer",
  "expires_in": 86399
}
```

The gateway fetches a token and caches it for the duration of `expires_in` (~24 hours), then auto-refreshes before the next delivery.

Config fields in `integration_config.json` → `outgoingAuthConfig` (auth type: `CUSTOM`):
- `tokenEndpoint` — token endpoint URL
- `tokenRequestMethod` — `"POST"`
- `tokenRequestBody` — JSON object sent as body: `{ "userName": "…", "password": "…" }`
- `tokenResponsePath` — dot-notation path to token in response: `"access_token"`
- `tokenExpiresInPath` — dot-notation path to expiry seconds in response: `"expires_in"`
- `tokenHeaderName` — header to attach token to: `"Authorization"`
- `tokenHeaderPrefix` — prefix before token value: `"Bearer"`

> Note: auth type must be `CUSTOM` (not `OAUTH2`). The standard `OAUTH2` type sends `application/x-www-form-urlencoded` with `client_credentials` grant — Akhil requires a JSON body with `userName`/`password` keys, which only `CUSTOM` supports.

---

## Deployment Steps

### Step 1 — Fill in `integration_config.json`

Replace these placeholders before importing:

| Placeholder | Replace with |
|---|---|
| `REPLACE_WITH_AKHIL_USERNAME` | Username provided by Akhil (appears in both `outgoingAuthConfig` and `authConfig`) |
| `REPLACE_WITH_AKHIL_PASSWORD` | Password provided by Akhil (appears in both `outgoingAuthConfig` and `authConfig`) |
| `REPLACE_WITH_AKHIL_LOCATION_SOURCE` | Static location source code assigned by Akhil (e.g. `"2"`) — inside the script string |
| `REPLACE_WITH_OUTPUT_OF_generateSigningSecret` | Run the command below and paste output (appears twice) |

**Generate signing secret:**
```bash
node -e "const c=require('crypto'); console.log('whsec_' + c.randomBytes(32).toString('base64'));"
```
Run from `backend/` directory. Copy the output into both `signingSecret` and `signingSecrets[0]`.

Also verify the `titleIdMap` inside the script matches what Akhil provides (see Title ID section above).

### Step 2 — Load service code mappings into `lookup_data.json`

This is the most effort-intensive step. You need a mapping table from the GUT GI team:

| Our serviceCode | Test Name | Akhil integrationServiceCode |
|---|---|---|
| `GI_CBC` | Complete Blood Count | `123` |
| `GI_LFT` | Liver Function Test | `456` |
| … | … | … |

**Recommended: Use CSV Import (fastest for bulk loads)**
1. Go to **Settings → Lookups → Import**
2. Download the template
3. Fill in rows with format:
   `AKHIL_SERVICE_CODE | <ourServiceCode> | <testName> | <akhilServiceCode> | <description>`
4. Import

**Alternative: Direct JSON import**
Edit `lookup_data.json` replacing the placeholder entries with the actual mappings, then run `mongoimport` (Step 3).

### Step 3 — Import into MongoDB

```bash
# Import integration config
mongoimport \
  --uri "$MONGODB_URI" \
  --db integration_gateway \
  --collection integration_configs \
  --file backend/setup/akhil/integration_config.json

# Import service code lookups (only if not using CSV import via UI)
mongoimport \
  --uri "$MONGODB_URI" \
  --db integration_gateway \
  --collection lookups \
  --file backend/setup/akhil/lookup_data.json \
  --jsonArray
```

### Step 4 — Verify

1. Open the Integration Control Plane UI
2. Navigate to **Outbound Integrations** — confirm "Akhil LIS - Lab Order External Push" appears
3. Navigate to **Lookups** → filter by type `AKHIL_SERVICE_CODE` — confirm all service code entries are listed
4. Use the **Test** button on the integration with a sample `LAB_ORDER_SENT_TO_EXTERNAL` payload to verify the output before going live

---

## Adding New Service Code Mappings

When a new test type is added to GUT GI and it needs to be routed to Akhil:

**Option A — Via UI:**
1. Go to **Settings → Lookups → Create**
2. Set Type = `AKHIL_SERVICE_CODE`
3. Source ID = our `serviceCode` (e.g. `"GI_TROP"`)
4. Source Label = test name
5. Target ID = the Akhil-assigned `integrationServiceCode` for that test
6. Target Label = description
7. Save

**Option B — Via CSV Import:**
1. Go to **Settings → Lookups → Import**
2. Download the template
3. Add a row: `AKHIL_SERVICE_CODE | <ourServiceCode> | <testName> | <akhilServiceCode> | <description>`
4. Import

**Option C — Direct MongoDB insert:**
```json
{
  "orgId": 783,
  "orgUnitRid": null,
  "type": "AKHIL_SERVICE_CODE",
  "source": { "id": "<ourServiceCode>", "label": "<testName>" },
  "target": { "id": "<akhilServiceCode>", "label": "<description>" },
  "isActive": true,
  "usageCount": 0,
  "lastUsedAt": null,
  "createdAt": { "$date": "<now>" },
  "updatedAt": { "$date": "<now>" }
}
```

---

## Unmapped Service Code Behaviour

`unmappedBehavior` is set to **`FAIL`** in the lookup config.

This means: if any `labTest` in an order has a `serviceCode` with **no entry** in `AKHIL_SERVICE_CODE`, the entire delivery is **blocked** and the event moves to the **Dead Letter Queue (DLQ)**.

This is intentional — sending a wrong or missing service code would result in a silent data error at Akhil. The DLQ entry can be retried after adding the missing lookup entry.

> **Important:** The lookup operates on each item in the `orderServiceDetails` array. All tests in the order must have a mapping for delivery to succeed.

---

## Akhil API Response Format

```json
{
  "status": {
    "message": "Order Save Sucessfully!!",
    "errorCode": "200",
    "status": "Sucess"
  }
}
```

> Note: The Akhil API always returns HTTP 200. Check `status.errorCode` and `status.status` in the response body to determine success or failure. A `status` of `"Sucess"` (their spelling) with `errorCode: "200"` indicates success.

---

## Key Differences vs Pathkind Integration

| Aspect | Pathkind (org 145) | Akhil (org 783) |
|---|---|---|
| Auth | API key header | Bearer token (fetched from token endpoint) |
| Patient name | Single `Patient_Name` field | Split: `firstName` / `middleName` / `lastName` |
| Patient title | String `Title` | Numeric `titleId` |
| Gender | Full name (`Male`/`Female`) | Single char (`M`/`F`) |
| Primary lookup | Entity → lab code (2 entries) | Service code → Akhil code (potentially 100s) |
| Lookup scope | Order-level single field | Array-item field (`orderServiceDetails[]`) |
| Patient identifier | `UHIDNO` = MRN document number | `integrationPatientId` = MRN document number |
| Order identifier | `HISOrderId` = orderId | `integrationOrderId` = orderId as string |
