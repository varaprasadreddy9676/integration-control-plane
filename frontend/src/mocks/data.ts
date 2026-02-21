import type { DashboardSummary, DeliveryLog, TenantInfo, IntegrationConfig } from './types';

export const mockTenantByRid: Record<number, TenantInfo> = {
  100: {
    orgId: 100,
    tenantName: 'Acme Corporation',
    tenantCode: 'ENT-100',
    region: 'US-East',
    timezone: 'America/New_York',
    childEntities: [
      { rid: 201, name: 'Acme New York', code: 'BRANCH-201' },
      { rid: 202, name: 'Acme Boston', code: 'BRANCH-202' }
    ]
  },
  200: {
    orgId: 200,
    tenantName: 'Globex Industries',
    tenantCode: 'ENT-200',
    region: 'US-West',
    timezone: 'America/Los_Angeles',
    childEntities: [{ rid: 205, name: 'Globex San Francisco', code: 'BRANCH-205' }]
  }
};

export const mockIntegrations: IntegrationConfig[] = [
  {
    id: 'wh_1',
    name: 'Order Created → ERP',
    eventType: 'ORDER_CREATED',
    tenantId: 100,
    entityName: 'Acme Corporation',
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://erp.example.com/hooks/orders',
    httpMethod: 'POST',
    outgoingAuthType: 'API_KEY',
    isActive: true,
    timeoutMs: 3000,
    retryCount: 3,
    transformationMode: 'SIMPLE',
    isInherited: false,
    updatedAt: '2024-02-20T10:12:00Z'
  },
  {
    id: 'wh_2',
    name: 'Customer Registered → CRM',
    eventType: 'CUSTOMER_REGISTERED',
    tenantId: 201,
    entityName: 'Acme New York',
    scope: 'ENTITY_ONLY',
    targetUrl: 'https://crm.example.com/hooks/customers',
    httpMethod: 'POST',
    outgoingAuthType: 'BEARER',
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
    tenantId: 100,
    entityName: 'Acme Corporation',
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://ops.example.com/hooks/inventory',
    httpMethod: 'POST',
    outgoingAuthType: 'NONE',
    isActive: false,
    timeoutMs: 2000,
    retryCount: 0,
    transformationMode: 'SIMPLE',
    isInherited: false,
    updatedAt: '2024-02-10T13:45:00Z'
  },
  {
    id: 'wh_4',
    name: 'Appointment Booked → Parent',
    eventType: 'APPOINTMENT_CREATED',
    tenantId: 100,
    entityName: 'Acme Corporation',
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://parent.example.com/hooks/appointments',
    httpMethod: 'POST',
    outgoingAuthType: 'BASIC',
    isActive: true,
    timeoutMs: 3000,
    retryCount: 3,
    transformationMode: 'SIMPLE',
    isInherited: false,
    updatedAt: '2024-02-15T08:30:00Z'
  }
];

export const mockDeliveryLogs: DeliveryLog[] = Array.from({ length: 12 }).map((_, index) => {
  const statuses = ['SUCCESS', 'FAILED', 'RETRYING'] as const;
  const status = statuses[index % statuses.length];
  return {
    id: `log_${index + 1}`,
    __KEEP___KEEP_integrationConfig__Id__: mockIntegrations[index % mockIntegrations.length].id,
    __KEEP_integrationName__: mockIntegrations[index % mockIntegrations.length].name,
    eventType: mockIntegrations[index % mockIntegrations.length].eventType,
    status,
    responseStatus: status === 'SUCCESS' ? 200 : status === 'RETRYING' ? 504 : 500,
    responseTimeMs: 150 + index * 23,
    attemptCount: status === 'SUCCESS' ? 1 : 2,
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
    errorMessage: status === 'SUCCESS' ? undefined : 'Endpoint timeout after 3s',
    requestPayload: {
      recordId: 7890 + index,
      amount: 120 + index * 5
    },
    responseBody: status === 'SUCCESS' ? 'OK' : undefined
  };
});

export const mockDashboard: DashboardSummary = {
  totalDeliveries24h: 1248,
  successRate24h: 98.4,
  failedCount24h: 12,
  avgResponseTimeMs24h: 642,
  integrationHealth: mockIntegrations.slice(0, 3).map((wh, idx) => ({
    id: wh.id,
    name: wh.name,
    status: (['GREEN', 'YELLOW', 'RED'] as const)[idx % 3],
    failureCount24h: idx * 2
  })),
  recentFailures: mockDeliveryLogs.filter((log) => log.status !== 'SUCCESS').slice(0, 5)
};
