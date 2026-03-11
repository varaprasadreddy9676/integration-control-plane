/**
 * Delivery Worker Manager
 *
 * Manages one event-source adapter instance per org.
 * Each org can have a different source type (mysql, kafka, http_push)
 * configured in the event_source_configs MongoDB collection.
 *
 * For orgs with no explicit config, a global default can be applied
 * only when config.eventSource.applyGlobalDefaultToAllOrgs === true.
 *
 * Refresh cycle: every refreshIntervalMs the manager checks for new orgs
 * or config changes and starts/stops adapters accordingly.
 */

const config = require('../config');
const data = require('../data');
const db = require('../db'); // shared MySQL pool
const { log, logError } = require('../logger');
const { createEventHandler } = require('./event-handler');
const { MysqlEventSource } = require('../adapters/MysqlEventSource');
const { KafkaEventSource } = require('../adapters/KafkaEventSource');
const { HttpPushAdapter } = require('../adapters/HttpPushAdapter');
const eventSourceData = require('../data/event-sources');
const { sanitizePoolConfig, sanitizeMysqlSourceConfig } = require('../utils/mysql-safety');

const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // check for new orgs/config changes every 2 min

class DeliveryWorkerManager {
  constructor() {
    // Map<orgId, { adapter, sourceType, configHash }>
    this.adapters = new Map();
    this.desiredState = new Map();
    this.adapterErrors = new Map();
    this.refreshTimer = null;
    this.globalSourceType = config.eventSource?.type || null;
    this.applyGlobalDefaultToAllOrgs = config.eventSource?.applyGlobalDefaultToAllOrgs === true;
    this.lastSyncStartedAt = null;
    this.lastSyncFinishedAt = null;
    this.lastSyncErrorAt = null;
    this.lastSyncErrorMessage = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start() {
    log('info', 'DeliveryWorkerManager starting', {
      globalSourceType: this.globalSourceType,
      applyGlobalDefaultToAllOrgs: this.applyGlobalDefaultToAllOrgs,
    });

    await this._syncAdapters();

    // Periodically sync to pick up new orgs or config changes
    this.refreshTimer = setInterval(async () => {
      try {
        await this._syncAdapters();
      } catch (err) {
        logError(err, { scope: 'DeliveryWorkerManager.refresh' });
      }
    }, REFRESH_INTERVAL_MS);

    log('info', 'DeliveryWorkerManager started', { activeAdapters: this.adapters.size });
  }

  async stop() {
    log('info', 'DeliveryWorkerManager stopping...');

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    const stops = Array.from(this.adapters.values()).map(({ adapter }) =>
      adapter.stop().catch((err) => logError(err, { scope: 'DeliveryWorkerManager.stop' }))
    );
    await Promise.all(stops);
    this.adapters.clear();

    log('info', 'DeliveryWorkerManager stopped');
  }

  // ---------------------------------------------------------------------------
  // Sync: discover orgs and reconcile running adapters
  // ---------------------------------------------------------------------------

  async _syncAdapters() {
    this.lastSyncStartedAt = new Date();
    // 1. Load all active orgs from MongoDB
    let orgs = [];
    try {
      orgs = await data.listOrganizations();
    } catch (err) {
      this.lastSyncErrorAt = new Date();
      this.lastSyncErrorMessage = err.message;
      log('warn', 'Could not load organizations for adapter sync', { error: err.message });
      return;
    }

    if (orgs.length === 0) {
      this.desiredState.clear();
      this.adapterErrors.clear();
      log('info', 'No organizations found; no adapters to start');
      return;
    }

    // 2. Load explicit per-org source configs
    let explicitConfigs = [];
    try {
      explicitConfigs = await eventSourceData.listActiveConfigs();
    } catch (err) {
      this.lastSyncErrorAt = new Date();
      this.lastSyncErrorMessage = err.message;
      log('warn', 'Could not load event_source_configs; using global defaults', { error: err.message });
    }

    const configByOrg = new Map(explicitConfigs.map((c) => [c.orgId, c]));

    if (this.globalSourceType && !this.applyGlobalDefaultToAllOrgs) {
      log('debug', 'Global eventSource.type is configured but not auto-applied to orgs without explicit configs');
    }

    // 3. Determine desired state (orgId → effective config)
    const desired = new Map();
    for (const org of orgs) {
      const orgId = org.orgId;
      if (!orgId) continue;

      const explicit = configByOrg.get(orgId);
      if (explicit) {
        desired.set(orgId, {
          type: explicit.type,
          sourceConfig: explicit.config || {},
          configOrigin: 'explicit',
        });
      } else if (this.globalSourceType && this.applyGlobalDefaultToAllOrgs) {
        // Optional legacy behavior: auto-apply global default to orgs
        // without an explicit per-org config.
        desired.set(orgId, {
          type: this.globalSourceType,
          sourceConfig: this._globalSourceConfig(),
          configOrigin: 'global_default',
        });
      }
    }

    this.desiredState = desired;

    // 4. Stop adapters for orgs no longer desired
    for (const [orgId, entry] of this.adapters) {
      if (!desired.has(orgId)) {
        log('info', `Stopping adapter for removed org ${orgId}`);
        await entry.adapter.stop().catch((err) => logError(err, { scope: `DeliveryWorkerManager.stop[${orgId}]` }));
        this.adapters.delete(orgId);
        this.adapterErrors.delete(orgId);
      }
    }

    // 5. Start adapters for new orgs; restart on config change
    for (const [orgId, { type, sourceConfig, configOrigin }] of desired) {
      const existing = this.adapters.get(orgId);
      const usesSharedPool = type === 'mysql' && (sourceConfig?.useSharedPool !== false);
      const sharedPoolVersion = usesSharedPool ? db.getPoolVersion() : null;
      const hash = JSON.stringify({ type, sourceConfig, sharedPoolVersion });

      if (existing && existing.configHash === hash) continue; // no change

      if (existing) {
        // Config changed — stop old, start new
        log('info', `Config changed for org ${orgId}, restarting adapter`);
        await existing.adapter
          .stop()
          .catch((err) => logError(err, { scope: `DeliveryWorkerManager.restart[${orgId}]` }));
        this.adapters.delete(orgId);
      }

      await this._startAdapterForOrg(orgId, type, sourceConfig, hash, configOrigin);
    }

    this.lastSyncFinishedAt = new Date();
    this.lastSyncErrorMessage = null;
  }

  // ---------------------------------------------------------------------------
  // Adapter creation
  // ---------------------------------------------------------------------------

  async _startAdapterForOrg(orgId, type, sourceConfig, hash, configOrigin = 'explicit') {
    let adapter;

    try {
      adapter = this._createAdapter(orgId, type, sourceConfig);
    } catch (err) {
      this.adapterErrors.set(orgId, {
        orgId,
        sourceType: type,
        configOrigin,
        stage: 'create',
        errorMessage: err.message,
        updatedAt: new Date().toISOString(),
      });
      log('error', `Failed to create ${type} adapter for org ${orgId}`, { error: err.message });
      return;
    }

    const handler = createEventHandler(type);

    try {
      await adapter.start(handler);
      this.adapters.set(orgId, { adapter, sourceType: type, configHash: hash, configOrigin });
      this.adapterErrors.delete(orgId);
      log('info', `Started ${type} adapter for org ${orgId}`);
    } catch (err) {
      this.adapterErrors.set(orgId, {
        orgId,
        sourceType: type,
        configOrigin,
        stage: 'start',
        errorMessage: err.message,
        updatedAt: new Date().toISOString(),
      });
      logError(err, { scope: `DeliveryWorkerManager.start[${orgId}]` });
    }
  }

  _createAdapter(orgId, type, sourceConfig) {
    switch (type) {
      case 'mysql': {
        const safeSourceConfig = sanitizeMysqlSourceConfig(sourceConfig || {});
        const pool = safeSourceConfig.useSharedPool !== false ? db.getPool() : this._createMysqlPool(safeSourceConfig);

        if (!pool) {
          throw new Error(
            `MySQL not configured for org ${orgId}. Configure the shared pool or provide dedicated credentials.`
          );
        }

        return new MysqlEventSource({
          orgId,
          pool,
          poolProvider: safeSourceConfig.useSharedPool !== false ? () => db.getPool() : null,
          table: safeSourceConfig.table,
          columnMapping: safeSourceConfig.columnMapping, // fully declared by org via admin UI
          pollIntervalMs: safeSourceConfig.pollIntervalMs || config.worker?.intervalMs,
          batchSize: safeSourceConfig.batchSize || config.worker?.batchSize,
          dbTimeoutMs: safeSourceConfig.dbTimeoutMs || config.worker?.dbOperationTimeoutMs,
        });
      }

      case 'kafka':
        return new KafkaEventSource({
          orgId,
          brokers: sourceConfig.brokers || config.kafka?.brokers,
          topic: sourceConfig.topic || config.kafka?.topic,
          groupId: sourceConfig.groupId || `ig-org-${orgId}`,
          clientId: sourceConfig.clientId || config.kafka?.clientId,
          fromBeginning: sourceConfig.fromBeginning ?? config.kafka?.fromBeginning,
          sessionTimeout: sourceConfig.sessionTimeout || config.kafka?.sessionTimeout,
          heartbeatInterval: sourceConfig.heartbeatInterval || config.kafka?.heartbeatInterval,
        });

      case 'http_push':
        return new HttpPushAdapter({ orgId, ...sourceConfig });

      default:
        throw new Error(`Unknown event source type: "${type}"`);
    }
  }

  _globalSourceConfig() {
    // Build a config object from config.json globals for the default source type
    if (this.globalSourceType === 'mysql') {
      return { useSharedPool: true }; // Use the shared db.getPool()
    }
    if (this.globalSourceType === 'kafka') {
      return {
        brokers: config.kafka?.brokers,
        topic: config.kafka?.topic,
        clientId: config.kafka?.clientId,
        fromBeginning: config.kafka?.fromBeginning,
      };
    }
    return {};
  }

  _createMysqlPool(sourceConfig) {
    // Create a dedicated mysql2 pool for orgs with their own database credentials
    const mysql = require('mysql2/promise');
    const safePoolConfig = sanitizePoolConfig(sourceConfig, 'dedicated');

    return mysql.createPool({
      host: sourceConfig.host,
      port: sourceConfig.port || 3306,
      user: sourceConfig.user,
      password: sourceConfig.password,
      database: sourceConfig.database,
      waitForConnections: true,
      connectionLimit: safePoolConfig.connectionLimit,
      queueLimit: safePoolConfig.queueLimit,
      namedPlaceholders: true,
      connectTimeout: sourceConfig.dbTimeoutMs || config.worker?.dbOperationTimeoutMs || 30000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }

  // ---------------------------------------------------------------------------
  // Status (for health endpoint)
  // ---------------------------------------------------------------------------

  async getStatus() {
    const adapters = await Promise.all(
      Array.from(this.adapters.entries()).map(async ([orgId, { adapter, sourceType, configHash, configOrigin }]) => {
        let runtimeStatus;
        try {
          runtimeStatus =
            typeof adapter.getRuntimeStatus === 'function'
              ? await adapter.getRuntimeStatus()
              : { adapterName: adapter.getName(), connectionStatus: 'unknown' };
        } catch (error) {
          runtimeStatus = {
            adapterName: adapter.getName(),
            connectionStatus: 'error',
            statusError: error.message,
          };
        }

        return {
          orgId,
          sourceType,
          configHash,
          configOrigin,
          name: adapter.getName(),
          ...runtimeStatus,
        };
      })
    );

    const desiredConfigs = Array.from(this.desiredState.entries()).map(([orgId, desired]) => {
      const adapterError = this.adapterErrors.get(orgId) || null;
      const runningAdapter = adapters.find((adapter) => Number(adapter.orgId) === Number(orgId));
      return {
        orgId,
        sourceType: desired.type,
        configOrigin: desired.configOrigin || 'explicit',
        configured: true,
        state: runningAdapter ? 'running' : (adapterError ? 'error' : 'configured'),
        error: adapterError,
      };
    });

    return {
      count: this.adapters.size,
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      lastSyncStartedAt: this.lastSyncStartedAt ? this.lastSyncStartedAt.toISOString() : null,
      lastSyncFinishedAt: this.lastSyncFinishedAt ? this.lastSyncFinishedAt.toISOString() : null,
      lastSyncErrorAt: this.lastSyncErrorAt ? this.lastSyncErrorAt.toISOString() : null,
      lastSyncErrorMessage: this.lastSyncErrorMessage,
      desiredConfigs,
      adapters,
    };
  }
}

// Singleton
let managerInstance = null;

function getDeliveryWorkerManager() {
  if (!managerInstance) {
    managerInstance = new DeliveryWorkerManager();
  }
  return managerInstance;
}

module.exports = { DeliveryWorkerManager, getDeliveryWorkerManager };
