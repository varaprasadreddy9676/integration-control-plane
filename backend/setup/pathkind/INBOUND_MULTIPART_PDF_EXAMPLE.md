# Pathkind Inbound Multipart PDF Example

This example mirrors the legacy `accept-lab-reports` style flow:

- `multipart/form-data`
- one PDF file field named `file`
- text fields `orderId`, `LabID`, `reportStatus`

File:

- `inbound_lab_reports_example.integration_config.json`

## What It Sends Downstream

The request transformation produces a Medics `/orderAttachment` payload like this:

```json
{
  "orderNumber": "2026/113/118982",
  "labId": "PK-00991",
  "serviceCodes": [
    { "serviceCode": "LAB115" },
    { "serviceCode": "LAB027" }
  ],
  "reportData": "<base64-pdf>"
}
```

## Multipart Contract

This example accepts:

- `file`: required PDF
- `orderId`: required
- `LabID`: required
- `reportStatus`: optional, passed through only in metadata
- `serviceCodesJson`: required in this generic example

Example `serviceCodesJson` value:

```json
["LAB115", "LAB027"]
```

or:

```json
[
  { "serviceCode": "LAB115" },
  { "serviceCode": "LAB027" }
]
```

## Why `serviceCodesJson` Is Required Here

The legacy `accept-lab-reports` endpoint did not derive `serviceCodes`; it effectively forwarded the attachment without a reliable DB enrichment step.

In this gateway, we should not fake that behavior.

So until resolver support exists, the safe generic pattern is:

1. vendor uploads PDF
2. vendor also sends the target `serviceCodes`
3. gateway validates and forwards to downstream

If you want exact legacy-equivalent enrichment from `LabOrder.tests[]`, that still needs a resolver step, not a lookup table.

## Example cURL

```bash
curl --location 'http://localhost:4000/api/v1/public/integrations/PATHKIND_ACCEPT_LAB_REPORTS_EXAMPLE?orgId=145' \
  --header 'x-api-key: REPLACE_WITH_PATHKIND_VENDOR_API_KEY' \
  --form 'file=@"/tmp/report.pdf"' \
  --form 'orderId="2026/113/118982"' \
  --form 'LabID="PK-00991"' \
  --form 'reportStatus="FINAL"' \
  --form 'serviceCodesJson="[\"LAB115\",\"LAB027\"]"'
```

## Import Notes

This example is intentionally marked `isActive: false`.

Before using it:

1. Replace vendor API key placeholder.
2. Replace Medics token credentials.
3. Confirm downstream endpoint and field names.
4. Decide whether vendor-supplied `serviceCodesJson` is acceptable for this integration.
5. Activate only after a real multipart test succeeds.
