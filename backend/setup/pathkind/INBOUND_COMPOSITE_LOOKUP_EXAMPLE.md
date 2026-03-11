# Pathkind Inbound Composite Lookup Example

This example shows how to author an **inbound** lab-result integration using the new lookup shape:

- composite source key
- rich target object
- scalar extraction from that target object during runtime

Files:

- `inbound_lab_results_example.integration_config.json`
- `inbound_lab_results_example.lookup_data.json`

## What This Example Demonstrates

The inbound request transformation normalizes one vendor result row into a Medics `/lab` payload skeleton.

Then lookup resolution fills:

- `gridTestCode` from `target.code`
- `gridTestName` from `target.name`

using this composite lookup key:

```text
PATHKIND|<externalTestCode>
```

Example lookup row:

```json
{
  "type": "PATHKIND_TEST_TO_GRID_TEST",
  "source": {
    "id": "PATHKIND|HB",
    "key": "PATHKIND|HB",
    "rawId": "HB"
  },
  "target": {
    "id": "LAB001",
    "code": "LAB001",
    "name": "HAEMOGLOBIN"
  }
}
```

The integration lookup config uses that row like this:

```json
{
  "type": "PATHKIND_TEST_TO_GRID_TEST",
  "sourceTemplate": "{{sourceContext.vendorCode}}|{{sourceContext.externalTestCode}}",
  "targetField": "gridTestCode",
  "targetValueField": "code",
  "unmappedBehavior": "FAIL"
}
```

and again for name:

```json
{
  "type": "PATHKIND_TEST_TO_GRID_TEST",
  "sourceTemplate": "{{sourceContext.vendorCode}}|{{sourceContext.externalTestCode}}",
  "targetField": "gridTestName",
  "targetValueField": "name",
  "unmappedBehavior": "FAIL"
}
```

## Why This Matters

This is the correct split for the lab use case:

- supplier or test-code crosswalks use lookup tables
- live order-derived values like `serviceCodes` should still come from resolver/enrichment logic, not lookup tables

So this example is valid for `LabTestSupplierMap`-style mappings, but not for `LabOrder.tests[]` enrichment.

## Optional Full-Object Resolution

If a downstream payload actually needs the full mapped object, the same lookup row can be resolved in object mode:

```json
{
  "type": "PATHKIND_TEST_TO_GRID_TEST",
  "sourceTemplate": "{{sourceContext.vendorCode}}|{{sourceContext.externalTestCode}}",
  "targetField": "resolvedTest",
  "returnMode": "OBJECT",
  "unmappedBehavior": "FAIL"
}
```

That would produce:

```json
{
  "resolvedTest": {
    "id": "LAB001",
    "code": "LAB001",
    "name": "HAEMOGLOBIN"
  }
}
```

## Import Notes

This example is intentionally marked `isActive: false`.

Before using it for a real vendor:

1. Replace inbound vendor API key placeholder.
2. Replace Medics token credentials.
3. Adjust the request transformation to the actual vendor payload shape.
4. Add all real test-code lookup rows.
5. Activate only after test requests succeed.
