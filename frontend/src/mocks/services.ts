import { mockDashboard, mockDeliveryLogs, mockTenantByRid, mockIntegrations } from './data';
import type { DashboardSummary, DeliveryLog, TenantInfo, IntegrationConfig } from './types';
import { getCurrentOrgId } from '../services/api';

let integrationsState = [...mockIntegrations];
let deliveryLogState = [...mockDeliveryLogs];

const simulateLatency = async <T>(value: T, delay = 200): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), delay));

export const getTenantInfo = async (): Promise<TenantInfo> => {
  const orgId = getCurrentOrgId() ?? 100;
  const tenant = mockTenantByRid[orgId] ?? mockTenantByRid[100];
  return simulateLatency(tenant);
};

export const getDashboardSummary = async (): Promise<DashboardSummary> => {
  return simulateLatency({
    ...mockDashboard,
    recentFailures: deliveryLogState.filter((log) => log.status !== 'SUCCESS').slice(0, 5)
  });
};

export const getIntegrations = async (): Promise<IntegrationConfig[]> => simulateLatency(integrationsState);

export const getIntegrationById = async (id: string): Promise<IntegrationConfig | undefined> => {
  return simulateLatency(integrationsState.find((wh) => wh.id === id));
};

export const createIntegration = async (payload: IntegrationConfig): Promise<IntegrationConfig> => {
  integrationsState = [...integrationsState, payload];
  return simulateLatency(payload);
};

export const updateIntegration = async (id: string, patch: Partial<IntegrationConfig>): Promise<IntegrationConfig | undefined> => {
  integrationsState = integrationsState.map((wh) => (wh.id === id ? { ...wh, ...patch } : wh));
  return simulateLatency(integrationsState.find((wh) => wh.id === id));
};

export const deleteIntegration = async (id: string): Promise<void> => {
  integrationsState = integrationsState.filter((wh) => wh.id !== id);
  await simulateLatency(undefined);
};

export const testIntegration = async (id: string) => {
  const result = {
    id,
    status: 'queued',
    deliveredAt: new Date().toISOString(),
    responseStatus: 202,
    responseBody: '{"message":"Test delivery accepted"}'
  };
  return simulateLatency(result, 400);
};

export const getLogs = async (): Promise<DeliveryLog[]> => simulateLatency(deliveryLogState);

export const getLogById = async (id: string): Promise<DeliveryLog | undefined> => {
  return simulateLatency(deliveryLogState.find((log) => log.id === id));
};
