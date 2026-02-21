export const defaultScript = `// Transform the incoming event payload
// Available: payload (the event data), context (eventType, tenantId, entityName)

const transformed = {
  patient_id: payload.patientRID,
  patient_name: payload.patientName,
  source: 'source-system',
  event_type: context.eventType
};

return transformed;`;
