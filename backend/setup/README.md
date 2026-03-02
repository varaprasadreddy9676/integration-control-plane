# Setup Configuration Files

This directory contains production-ready configuration files for the Integration Gateway.

## Files

### event-types.json
Event type definitions with field schemas for all supported healthcare events (31 types).

**Usage:**
```bash
# Import event types into MongoDB
node import-production-data.js
```

**Contents:**
- 31 event type definitions
- Field schemas describing event structure
- Event categories (Visit Management, Billing, Treatment, etc.)
- Field types and descriptions

### clevertap-webhooks.json
Pre-configured CleverTap CRM OUTBOUND integrations for all event types (31 webhooks).

**Usage:**
```bash
# Import CleverTap webhooks
node import-production-data.js
```

**Integration Type:** OUTBOUND (source system → CleverTap)

**Features:**
- Multi-action webhook configurations (profile + event uploads)
- Complex transformation scripts
- Custom header authentication
- Date parsing, phone formatting utilities
- All 31 event types mapped to CleverTap templates

### luma-qikberry-configs/
WhatsApp messaging OUTBOUND integrations for Luma Fertility using QikChat API.

**Integration Type:** OUTBOUND (source system → QikChat → WhatsApp)

**Files:**
1. `1-appt-confirmation-immediate.json` - Real-time appointment confirmation
2. `2-reminder-1-d24hrs.json` - 24-hour reminder (DELAYED delivery)
3. `3-reminder-2-t3hrs.json` - 3-hour reminder (DELAYED delivery)
4. `4-welcome-message-d5hrs.json` - Post-appointment follow-up (DELAYED delivery)

**Features:**
- Scheduled delivery modes (IMMEDIATE, DELAYED)
- WhatsApp template integration via QikChat
- Conditional message sending
- Phone number formatting
- Date/time parsing and formatting utilities

## Integration Fields

All configuration files use standardized field names:

**Core Fields:**
- `type` - Integration/event type (e.g., PATIENT_REGISTERED, APPOINTMENT_CREATED)
- `direction` - Integration direction: "OUTBOUND" or "INBOUND"
  - **OUTBOUND**: Events flow from source system → Gateway → External APIs (webhooks)
  - **INBOUND**: client app makes real-time API calls through Gateway to external systems

**Organization Scoping:**
- `orgId` - Organization ID used for scoping integrations and API requests
- `orgUnitRid` - Optional org-unit scope within an organization
- `tenantId` - Legacy field kept only for backward compatibility in older setup artifacts
- `entityParentRid` - Legacy alias for `orgId` (deprecated)
- `excludedTenantIds` - Legacy exclusion list used in older setup artifacts

## Import Script

Use `import-production-data.js` to import these configurations into MongoDB:

```bash
cd backend
node import-production-data.js
```

The script will:
1. Import event types into `event_types` collection
2. Import/update webhooks into `integration_configs` collection
3. Validate all configurations
4. Report import results

## Notes

- All configurations are production-tested
- Field names have been updated to open-source friendly naming
- Multi-action webhooks are supported (v2.0+)
- Transformation scripts run in the secure VM wrapper (`backend/src/utils/secure-vm.js`) for sandboxed execution
