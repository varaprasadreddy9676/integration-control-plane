const fs = require('fs');
const path = require('path');
const { readFile, writeFile, mkdir } = require('fs/promises');
const { randomUUID } = require('crypto');
const seed = require('./seed');
const queue = require('./queue');

const dataDir = __dirname;
const stateFile = path.join(dataDir, 'state.json');

let state = {
  tenants: [],
  integrations: [],
  deliveryLogs: [],
  apiKeys: [],
  eventTypes: [],
  workerState: {
    lastProcessedId: 0
  }
};

async function initStore() {
  await mkdir(dataDir, { recursive: true });
  if (fs.existsSync(stateFile)) {
    const raw = await readFile(stateFile, 'utf8');
    state = JSON.parse(raw);
  } else {
    state = {
      tenants: seed.tenants,
      integrations: seed.integrations,
      deliveryLogs: seed.deliveryLogs,
      apiKeys: seed.apiKeys,
      eventTypes: seed.eventTypes,
      workerState: { lastProcessedId: 0 }
    };
    await persistState();
  }
}

async function persistState() {
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

function getTenant(orgId) {
  return state.tenants.find((tenant) => (tenant.orgId || tenant.entityParentRid) === orgId);
}

function findTenantByChildRid(childRid) {
  return state.tenants.find((tenant) => tenant.childEntities?.some((c) => c.rid === childRid));
}

function getPermittedOrgUnitRids(orgId) {
  const tenant = getTenant(orgId);
  if (!tenant) return [];
  const childIds = tenant.childEntities?.map((c) => c.rid) ?? [];
  const resolvedOrgId = tenant.orgId || tenant.entityParentRid;
  return [resolvedOrgId, ...childIds];
}

function getIntegration(id) {
  return state.integrations.find((wh) => wh.id === id);
}

function getIntegrationOrgUnitRid(integration) {
  return integration.orgUnitRid ?? integration.entityRid;
}

function isIntegrationInOrg(integration, orgId) {
  const allowed = new Set(getPermittedOrgUnitRids(orgId));
  return allowed.has(getIntegrationOrgUnitRid(integration));
}

function listIntegrations(orgId) {
  const allowed = new Set(getPermittedOrgUnitRids(orgId));
  return state.integrations.filter((wh) => allowed.has(getIntegrationOrgUnitRid(wh)));
}

async function addIntegration(orgId, payload) {
  const tenant = getTenant(orgId);
  const integration = {
    id: payload.id || `wh_${randomUUID()}`,
    name: payload.name,
    eventType: payload.eventType,
    orgId,
    orgUnitRid: payload.orgUnitRid || payload.entityRid || orgId,
    entityName: payload.entityName || tenant?.tenantName || 'Tenant',
    scope: payload.scope || 'INCLUDE_CHILDREN',
    targetUrl: payload.targetUrl,
    httpMethod: payload.httpMethod,
    authType: payload.authType,
    isActive: payload.isActive !== false,
    timeoutMs: payload.timeoutMs,
    retryCount: payload.retryCount,
    transformationMode: payload.transformationMode || 'SIMPLE',
    transformation: payload.transformation,
    isInherited: payload.isInherited || false,
    sourceEntityName: payload.sourceEntityName,
    metadata: payload.metadata || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.integrations.push(integration);
  await persistState();
  return integration;
}

async function updateIntegration(orgId, id, patch) {
  const idx = state.integrations.findIndex((wh) => wh.id === id && isIntegrationInOrg(wh, orgId));
  if (idx === -1) return undefined;
  const existing = state.integrations[idx];
  const updated = {
    ...existing,
    ...patch,
    id: existing.id,
    orgUnitRid: patch.orgUnitRid || patch.entityRid || existing.orgUnitRid || existing.entityRid,
    entityName: patch.entityName || existing.entityName,
    updatedAt: new Date().toISOString()
  };
  state.integrations[idx] = updated;
  await persistState();
  return updated;
}

async function deleteIntegration(orgId, id) {
  const before = state.integrations.length;
  state.integrations = state.integrations.filter((wh) => !(wh.id === id && isIntegrationInOrg(wh, orgId)));
  const removed = before !== state.integrations.length;
  if (removed) {
    await persistState();
  }
  return removed;
}

function listEventTypes() {
  return state.eventTypes;
}

function listLogs(orgId, filters = {}) {
  const allowed = new Set(getPermittedOrgUnitRids(orgId));
  return state.deliveryLogs.filter((log) => {
    const integration = getIntegration(log.__KEEP___KEEP_integrationConfig__Id__);
    if (!integration || !allowed.has(getIntegrationOrgUnitRid(integration))) return false;
    if (filters.status && log.status !== filters.status) return false;
    if (filters.__KEEP___KEEP_integrationConfig__Id__ && log.__KEEP___KEEP_integrationConfig__Id__ !== filters.__KEEP___KEEP_integrationConfig__Id__) return false;
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      const haystacks = [
        log.__KEEP_integrationName__,
        log.eventType,
        log.errorMessage,
        log.responseBody,
        log.targetUrl
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());

      const payloadString = log.requestPayload ? JSON.stringify(log.requestPayload).toLowerCase() : '';
      const matches = haystacks.some((h) => h.includes(needle)) || payloadString.includes(needle);
      if (!matches) return false;
    }
    return true;
  });
}

function getLogById(orgId, id) {
  return listLogs(orgId).find((log) => log.id === id);
}

async function recordLog(orgId, log) {
  const logId = log.id || `log_${randomUUID()}`;
  state.deliveryLogs.unshift({
    ...log,
    id: logId,
    createdAt: log.createdAt || new Date().toISOString()
  });
  await persistState();
  return logId;
}

function maskKey(value) {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  const prefix = value.slice(0, 4);
  const suffix = value.slice(-4);
  return `${prefix}${'*'.repeat(Math.max(0, value.length - 8))}${suffix}`;
}

function listApiKeys(orgId) {
  return state.apiKeys
    .filter((key) => (key.orgId || key.entityRid) === orgId)
    .map((key) => {
      const { key: rawKey, ...rest } = key;
      return {
        ...rest,
        maskedKey: maskKey(rawKey)
      };
    });
}

function findApiKey(rawKey) {
  return state.apiKeys.find((key) => key.key === rawKey);
}

async function touchApiKey(rawKey) {
  const idx = state.apiKeys.findIndex((key) => key.key === rawKey);
  if (idx === -1) return undefined;
  state.apiKeys[idx].lastUsedAt = new Date().toISOString();
  await persistState();
  return state.apiKeys[idx];
}

async function addApiKey(orgId, description) {
  const keyValue = `mdcs_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const newKey = {
    id: `ak_${randomUUID()}`,
    orgId,
    description,
    key: keyValue,
    isActive: true,
    createdAt: new Date().toISOString()
  };
  state.apiKeys.unshift(newKey);
  await persistState();
  const { key, ...rest } = newKey;
  return { ...rest, maskedKey: maskKey(key) };
}

async function toggleApiKey(orgId, id) {
  const idx = state.apiKeys.findIndex((key) => key.id === id && (key.orgId || key.entityRid) === orgId);
  if (idx === -1) return undefined;
  state.apiKeys[idx].isActive = !state.apiKeys[idx].isActive;
  await persistState();
  const { key, ...rest } = state.apiKeys[idx];
  return { ...rest, maskedKey: maskKey(key) };
}

function getPendingEvents(limit = 5) {
  return queue.take(limit).map((evt) => ({
    id: evt.id,
    entity_rid: evt.orgId,
    event_type: evt.event_type,
    payload: evt.payload
  }));
}

function getDashboardSummary(orgId) {
  const logs = listLogs(orgId);
  const total = logs.length;
  const successCount = logs.filter((log) => log.status === 'SUCCESS').length;
  const failedCount = logs.filter((log) => ['FAILED', 'ABANDONED', 'SKIPPED'].includes(log.status)).length;
  const avgResponseTime = logs.length
    ? Math.round(logs.reduce((sum, log) => sum + (log.responseTimeMs || 0), 0) / logs.length)
    : 0;

  const integrationHealth = listIntegrations(orgId).slice(0, 5).map((wh, idx) => ({
    id: wh.id,
    name: wh.name,
    status: ['GREEN', 'YELLOW', 'RED'][idx % 3],
    failureCount24h: logs.filter((log) => log.__KEEP___KEEP_integrationConfig__Id__ === wh.id && log.status !== 'SUCCESS').length
  }));

  return {
    totalDeliveries24h: total,
    successRate24h: total ? Number(((successCount / total) * 100).toFixed(1)) : 100,
    failedCount24h: failedCount,
    avgResponseTimeMs24h: avgResponseTime,
    integrationHealth,
    recentFailures: logs.filter((log) => log.status !== 'SUCCESS').slice(0, 5)
  };
}

function getWorkerCheckpoint() {
  return state.workerState?.lastProcessedId || 0;
}

async function setWorkerCheckpoint(lastProcessedId) {
  state.workerState = state.workerState || {};
  state.workerState.lastProcessedId = lastProcessedId;
  await persistState();
}

async function markEventComplete(eventId, status, message) {
  const logIndex = state.deliveryLogs.findIndex(log => log.id === eventId);
  if (logIndex !== -1) {
    state.deliveryLogs[logIndex].status = status;
    state.deliveryLogs[logIndex].message = message;
    state.deliveryLogs[logIndex].completed_at = new Date().toISOString();
    await persistState();
  }
}

function getFailedLogsForRetry(batchSize = 5) {
  return state.deliveryLogs
    .filter(log =>
      ['FAILED', 'RETRYING'].includes(log.status) &&
      log.attemptCount < (log.retryCount || 3)
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, batchSize)
    .map(log => ({
      ...log,
      id: log.id,
      __KEEP___KEEP_integrationConfig__Id__: log.__KEEP___KEEP_integrationConfig__Id__,
      eventType: log.eventType
    }));
}

function getIntegrationById(integrationId) {
  return state.integrations.find(integration => integration.id === integrationId);
}

async function markLogAsAbandoned(logId, reason = 'Abandoned after retry limit') {
  const logIndex = state.deliveryLogs.findIndex(log => log.id === logId);
  if (logIndex !== -1) {
    state.deliveryLogs[logIndex].status = 'ABANDONED';
    state.deliveryLogs[logIndex].errorMessage = reason;
    state.deliveryLogs[logIndex].completed_at = new Date().toISOString();
    await persistState();
  }
}

module.exports = {
  initStore,
  persistState,
  getTenant,
  findTenantByChildRid,
  getPermittedEntityRids: getPermittedOrgUnitRids,
  listIntegrations,
  getIntegration,
  addIntegration,
  updateIntegration,
  deleteIntegration,
  listEventTypes,
  listLogs,
  getLogById,
  recordLog,
  listApiKeys,
  addApiKey,
  toggleApiKey,
  findApiKey,
  touchApiKey,
  getDashboardSummary,
  getPendingEvents,
  findTenantByChildRid,
  getWorkerCheckpoint,
  setWorkerCheckpoint,
  markEventComplete,
  getFailedLogsForRetry,
  getIntegrationById,
  markLogAsAbandoned
};
