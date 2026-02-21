const tenants = [
  {
    orgId: 100,
    tenantName: 'Nova IVF Group',
    tenantCode: 'ENT-100',
    region: 'US-East',
    timezone: 'America/New_York',
    childEntities: [
      { rid: 201, name: 'Nova Downtown', code: 'CLINIC-201' },
      { rid: 202, name: 'Nova Midtown', code: 'CLINIC-202' }
    ]
  },
  {
    orgId: 200,
    tenantName: 'Orion Sports Medicine',
    tenantCode: 'ENT-200',
    region: 'US-West',
    timezone: 'America/Los_Angeles',
    childEntities: [{ rid: 205, name: 'Orion SoMa', code: 'CLINIC-205' }]
  }
];

const integrations = [
  {
    id: 'wh_1',
    name: 'Bill Created → ERP',
    eventType: 'BILL_CREATED',
    orgUnitRid: 100,
    entityName: 'Nova IVF Group',
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://hooks.novaerp.io/billing',
    httpMethod: 'POST',
    authType: 'API_KEY',
    isActive: true,
    timeoutMs: 3000,
    retryCount: 3,
    transformationMode: 'SIMPLE',
    isInherited: false,
    updatedAt: '2024-02-20T10:12:00Z'
  },
  {
    id: 'wh_2',
    name: 'Patient Registration CRM',
    eventType: 'PATIENT_REGISTERED',
    orgUnitRid: 201,
    entityName: 'Nova Downtown',
    scope: 'ENTITY_ONLY',
    targetUrl: 'https://crm.novadigital.health/integrations/new-patient',
    httpMethod: 'POST',
    authType: 'BEARER',
    isActive: true,
    timeoutMs: 5000,
    retryCount: 5,
    transformationMode: 'SCRIPT',
    isInherited: false,
    updatedAt: '2024-02-18T09:00:00Z'
  },
  {
    id: 'wh_3',
    name: 'Inventory Low Alert',
    eventType: 'INVENTORY_THRESHOLD',
    orgUnitRid: 100,
    entityName: 'Nova IVF Group',
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://ops.novahq.io/hooks/inventory',
    httpMethod: 'POST',
    authType: 'NONE',
    isActive: false,
    timeoutMs: 2000,
    retryCount: 0,
    transformationMode: 'SIMPLE',
    isInherited: false,
    updatedAt: '2024-02-10T13:45:00Z'
  },
  {
    id: 'wh_4',
    name: 'Appointments to Parent',
    eventType: 'APPOINTMENT_CREATED',
    orgUnitRid: 100,
    entityName: 'Nova IVF Group',
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://parent.nova.com/hooks/appt',
    httpMethod: 'POST',
    authType: 'BASIC',
    isActive: true,
    timeoutMs: 3000,
    retryCount: 3,
    transformationMode: 'SIMPLE',
    isInherited: false,
    updatedAt: '2024-02-15T08:30:00Z'
  }
];

const deliveryLogs = Array.from({ length: 12 }).map((_, index) => {
  const statuses = ['SUCCESS', 'FAILED', 'RETRYING'];
  const status = statuses[index % statuses.length];
  const integration = integrations[index % integrations.length];
  return {
    id: `log_${index + 1}`,
    __KEEP___KEEP_integrationConfig__Id__: integration.id,
    __KEEP_integrationName__: integration.name,
    eventType: integration.eventType,
    status,
    responseStatus: status === 'SUCCESS' ? 200 : status === 'RETRYING' ? 504 : 500,
    responseTimeMs: 150 + index * 23,
    attemptCount: status === 'SUCCESS' ? 1 : 2,
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
    errorMessage: status === 'SUCCESS' ? undefined : 'Endpoint timeout after 3s',
    requestPayload: {
      patientRID: 7890 + index,
      billAmount: 120 + index * 5
    },
    responseBody: status === 'SUCCESS' ? 'OK' : undefined
  };
});

const apiKeys = [
  {
    id: 'ak_1',
    orgUnitRid: 100,
    description: 'Integration Service',
    key: 'mdcs_dev_key_1f4a',
    isActive: true,
    createdAt: '2023-12-12T10:00:00Z',
    lastUsedAt: '2024-02-21T11:22:00Z'
  },
  {
    id: 'ak_2',
    orgUnitRid: 200,
    description: 'Ops Dashboard',
    key: 'mdcs_dev_key_0bb2',
    isActive: false,
    createdAt: '2023-11-01T09:15:00Z'
  }
];

const eventTypes = [
  'APPOINTMENT_CREATED',
  'APPOINTMENT_CONFIRMATION',
  'PATIENT_REGISTERED',
  'BILL_CREATED',
  'BILL_UPDATED',
  'PAYMENT_RECEIVED',
  'INVENTORY_THRESHOLD'
];

module.exports = { tenants, integrations, deliveryLogs, apiKeys, eventTypes };
