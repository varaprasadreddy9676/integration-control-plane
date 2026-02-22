'use strict';

/**
 * Data layer aggregator.
 *
 * This file is intentionally thin — it wires up MongoDB/MySQL connections
 * and then re-exports every function from the domain-specific modules.
 * All callers that do `require('../data')` continue to work with zero changes.
 *
 * Domain modules:
 *   helpers.js              — shared query builders + mapper functions
 *   integrations.js         — integration CRUD + delivery matching
 *   logs.js                 — execution log CRUD + bulk ops
 *   alert-center.js         — alert center log CRUD
 *   ui-config.js            — UI config overrides + scheduler config
 *   dashboard.js            — dashboard summary + event queue + worker checkpoints
 *   delivery.js             — delivery retry + cleanup + circuit breaker
 *   scheduled-integrations.js — scheduled integration management
 *   event-audit.js          — event audit, source checkpoints, idempotency
 *   template-crud.js        — integration template CRUD
 *   lookups.js              — lookup table CRUD + resolve/reverse
 *   users.js                — user CRUD (JWT auth)
 *   organizations.js        — organization + org unit CRUD
 */

const { log, logError, setDb } = require('../logger');
const db = require('../db'); // MySQL (optional)
const mongodb = require('../mongodb');

// ─── MySQL availability state ─────────────────────────────────────────────────

let mysqlAvailable = false;
let reconnectInterval = null;

const useMysql = () => db.isConfigured();

function isMysqlAvailable() {
  return mysqlAvailable && useMysql();
}

async function attemptMysqlReconnect() {
  if (!useMysql()) {
    return false;
  }

  try {
    const ok = await db.ping();
    if (ok && !mysqlAvailable) {
      log('info', 'MySQL reconnected successfully');
      mysqlAvailable = true;
    } else if (!ok && mysqlAvailable) {
      log('warn', 'MySQL connection lost');
      mysqlAvailable = false;
    }
    return ok;
  } catch (err) {
    if (mysqlAvailable) {
      log('warn', 'MySQL connection lost', { error: err.message });
      mysqlAvailable = false;
    }
    return false;
  }
}

function startMysqlReconnection(intervalMs = 30000) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  if (reconnectInterval) {
    return;
  }

  log('info', 'Starting MySQL reconnection monitor', { intervalMs });
  reconnectInterval = setInterval(async () => {
    if (!mysqlAvailable) {
      log('debug', 'Attempting to reconnect to MySQL...');
      await attemptMysqlReconnect();
    }
  }, intervalMs);
}

function stopMysqlReconnection() {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
    log('info', 'MySQL reconnection monitor stopped');
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────

async function initDataLayer() {
  try {
    await mongodb.connect();
    log('info', 'MongoDB connection established for event gateway');

    setDb(mongodb.getDb());
    log('info', 'Logger database instance configured');

    // Create TTL index for error_logs collection (30 days retention)
    try {
      const mongoDb = await mongodb.getDbSafe();
      await mongoDb.collection('error_logs').createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
      log('info', 'TTL index created for error_logs collection (30 days retention)');
    } catch (indexErr) {
      log('warn', 'Failed to create TTL index for error_logs', { error: indexErr.message });
    }
  } catch (err) {
    logError(err, { scope: 'MongoDB connection' });
    throw new Error('MongoDB connection required - no fallback available');
  }

  if (useMysql()) {
    mysqlAvailable = await db.ping();
    if (mysqlAvailable) {
      log('info', 'MySQL connected for notification_queue');
      startMysqlReconnection(30000);
    } else {
      log(
        'warn',
        'Global MySQL source ping failed - shared-pool MySQL adapters will remain unavailable until connection is restored'
      );
      log('warn', 'API and UI will continue to work normally');
      startMysqlReconnection(30000);
    }
  } else {
    log('info', 'Global MySQL source not configured (expected when using per-org dynamic event sources)');
    mysqlAvailable = false;
  }
}

// ─── Domain module imports ────────────────────────────────────────────────────

const integrations = require('./integrations');
const logs = require('./logs');
const alertCenter = require('./alert-center');
const uiConfig = require('./ui-config');
const dashboard = require('./dashboard');
const delivery = require('./delivery');
const scheduledIntegrations = require('./scheduled-integrations');
const eventAudit = require('./event-audit');
const templateCrud = require('./template-crud');
const lookups = require('./lookups');
const users = require('./users');
const organizations = require('./organizations');

// ─── Legacy webhook aliases (backward compatibility) ─────────────────────────

function mapLegacyWebhook(integration) {
  if (!integration) {
    return integration;
  }
  return {
    ...integration,
    entityRid: integration.entityRid || integration.orgUnitRid || integration.orgId,
    authType: integration.authType || integration.outgoingAuthType,
    authConfig: integration.authConfig || integration.outgoingAuthConfig,
    transformMode: integration.transformMode || integration.transformationMode,
    transformConfig: integration.transformConfig || integration.transformation,
  };
}

function mapLegacyScheduledIntegration(integration) {
  if (!integration) {
    return integration;
  }
  return {
    ...integration,
    webhookConfigId:
      integration.webhookConfigId ||
      integration.integrationConfigId ||
      integration.__KEEP___KEEP_integrationConfig__Id__,
    webhookName: integration.webhookName || integration.integrationName || integration.__KEEP_integrationName__,
    entityRid: integration.entityRid || integration.orgUnitRid || integration.orgId,
  };
}

async function addWebhook(orgId, payload) {
  const integration = await integrations.addIntegration(orgId, {
    ...payload,
    orgId: payload?.orgId || orgId,
  });
  return integration?.id;
}

async function listWebhooks(orgId) {
  const list = await integrations.listIntegrations(orgId);
  return list.map(mapLegacyWebhook);
}

async function listWebhooksForDelivery(orgId, eventType) {
  const list = await integrations.listIntegrationsForDelivery(orgId, eventType);
  return list.map(mapLegacyWebhook);
}

async function getWebhook(id) {
  const integration = await integrations.getIntegration(id);
  return mapLegacyWebhook(integration);
}

async function updateWebhook(orgId, id, patch) {
  const integration = await integrations.updateIntegration(orgId, id, patch);
  return mapLegacyWebhook(integration);
}

async function deleteWebhook(orgId, id) {
  return integrations.deleteIntegration(orgId, id);
}

async function createScheduledWebhook(data) {
  const scheduled = await scheduledIntegrations.createScheduledIntegration({
    ...data,
    __KEEP___KEEP_integrationConfig__Id__:
      data.__KEEP___KEEP_integrationConfig__Id__ || data.integrationConfigId || data.webhookConfigId,
    __KEEP_integrationName__: data.__KEEP_integrationName__ || data.integrationName || data.webhookName,
    orgId: data.orgId || data.orgUnitRid || data.entityRid,
    orgUnitRid: data.orgUnitRid || data.entityRid || data.orgId,
  });
  return mapLegacyScheduledIntegration(scheduled);
}

async function listScheduledWebhooks(orgId, filters = {}) {
  const scheduled = await scheduledIntegrations.listScheduledIntegrations(orgId, {
    ...filters,
    integrationConfigId: filters.integrationConfigId || filters.webhookConfigId,
  });
  return scheduled.map(mapLegacyScheduledIntegration);
}

async function getPendingScheduledWebhooks(limit = 10) {
  const scheduled = await scheduledIntegrations.getPendingScheduledIntegrations(limit);
  return scheduled.map(mapLegacyScheduledIntegration);
}

async function updateScheduledWebhookStatus(id, status, details = {}) {
  return scheduledIntegrations.updateScheduledIntegrationStatus(id, status, details);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Initialization
  initDataLayer,
  isMysqlAvailable,
  attemptMysqlReconnect,
  startMysqlReconnection,
  stopMysqlReconnection,

  // Legacy aliases
  addWebhook,
  listWebhooks,
  listWebhooksForDelivery,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  createScheduledWebhook,
  listScheduledWebhooks,
  getPendingScheduledWebhooks,
  updateScheduledWebhookStatus,

  // Integrations
  ...integrations,

  // Logs
  ...logs,

  // Alert center
  ...alertCenter,

  // UI config
  ...uiConfig,

  // Dashboard + event queue
  ...dashboard,

  // Delivery / circuit breaker / cleanup
  ...delivery,

  // Scheduled integrations
  ...scheduledIntegrations,

  // Event audit + idempotency
  ...eventAudit,

  // Template CRUD
  ...templateCrud,

  // Lookup tables
  ...lookups,

  // Users
  ...users,

  // Organizations
  ...organizations,
};
