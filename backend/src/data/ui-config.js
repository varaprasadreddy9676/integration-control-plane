'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const {
  useMongo,
  normalizeOrgId,
  addOrgScope,
  fallbackDisabledError,
  mergeConfigs,
  stripUiConfig
} = require('./helpers');

async function getUiConfigForEntity(orgId) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const defaultDoc = await db.collection('ui_config').findOne({ _id: 'default' });
      if (!defaultDoc) {
        throw new Error('UI configuration not seeded. Run: node scripts/populate-ui-config.js');
      }
      let merged = stripUiConfig(defaultDoc);

      if (orgId) {
        const entityDoc = await db.collection('ui_config').findOne({ orgId });
        if (entityDoc) {
          merged = mergeConfigs(merged, stripUiConfig(entityDoc));
        }
      }

      return merged;
    } catch (err) {
      logError(err, { scope: 'getUiConfigForEntity', orgId });
      throw err;
    }
  }
  return fallbackDisabledError('getUiConfigForEntity:fallback');
}

async function getUiConfigOverride(orgId) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const entityDoc = await db.collection('ui_config').findOne({ orgId });
      return stripUiConfig(entityDoc);
    } catch (err) {
      logError(err, { scope: 'getUiConfigOverride', orgId });
      throw err;
    }
  }
  return fallbackDisabledError('getUiConfigOverride:fallback');
}

async function upsertUiConfigOverride(orgId, override) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      await db.collection('ui_config').updateOne(
        { orgId },
        {
          $set: {
            ...override,
            updatedAt: new Date()
          },
          $setOnInsert: {
            orgId,
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
      return true;
    } catch (err) {
      logError(err, { scope: 'upsertUiConfigOverride', orgId });
      return false;
    }
  }
  return fallbackDisabledError('upsertUiConfigOverride:fallback');
}

async function clearUiConfigOverride(orgId) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      await db.collection('ui_config').deleteOne({ orgId });
      return true;
    } catch (err) {
      logError(err, { scope: 'clearUiConfigOverride', orgId });
      return false;
    }
  }
  return fallbackDisabledError('clearUiConfigOverride:fallback');
}

async function getSchedulerIntervalMinutes() {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const configs = await db.collection('ui_config')
        .find({ 'notifications.failureEmailReports.enabled': true })
        .project({ 'notifications.failureEmailReports.intervalMinutes': 1 })
        .toArray();

      const intervals = configs
        .map((doc) => Number(doc?.notifications?.failureEmailReports?.intervalMinutes))
        .filter((val) => Number.isFinite(val) && val > 0);

      if (intervals.length > 0) {
        return Math.min(...intervals);
      }
    } catch (err) {
      logError(err, { scope: 'getSchedulerIntervalMinutes' });
    }
  }
  return 15;
}

async function getFailureReportSchedulerStatus(orgId) {
  const normalizedOrgId = normalizeOrgId(orgId);

  if (useMongo()) {
    try {
      const uiConfig = await getUiConfigForEntity(normalizedOrgId);
      const reportConfig = uiConfig?.notifications?.failureEmailReports || {};
      const enabled = reportConfig.enabled === true;
      const intervalMinutes = await getSchedulerIntervalMinutes();

      const db = await mongodb.getDbSafe();
      const state = await db.collection('scheduler_state').findOne({ _id: 'failure_email_reports' });
      const lastLog = normalizedOrgId
        ? await db.collection('alert_center_logs')
          .find(addOrgScope({ type: 'DELIVERY_FAILURE_REPORT' }, normalizedOrgId))
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray()
        : [];
      const lastRunLog = lastLog?.[0] || null;
      const lastRunAt = state?.lastRunAt || null;
      const nextRunAt = enabled
        ? new Date((lastRunAt ? new Date(lastRunAt).getTime() : Date.now()) + intervalMinutes * 60 * 1000)
        : null;

      return {
        enabled,
        intervalMinutes,
        lookbackMinutes: Number(reportConfig.lookbackMinutes ?? 60),
        minFailures: Number(reportConfig.minFailures ?? 1),
        maxItems: Number(reportConfig.maxItems ?? 25),
        lastRunAt,
        nextRunAt,
        lastRunLog: lastRunLog ? {
          status: lastRunLog.status,
          createdAt: lastRunLog.createdAt,
          totalFailures: lastRunLog.totalFailures ?? null,
          recipients: lastRunLog.recipients || [],
          errorMessage: lastRunLog.errorMessage || null
        } : null
      };
    } catch (err) {
      logError(err, { scope: 'getFailureReportSchedulerStatus' });
      throw err;
    }
  }
  return fallbackDisabledError('getFailureReportSchedulerStatus:fallback');
}

async function getUiConfigDefault() {
  if (!useMongo()) {
    return fallbackDisabledError('getUiConfigDefault:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('ui_config').findOne({ _id: 'default' });
}

async function updateUiConfigDefault(update) {
  if (!useMongo()) {
    return fallbackDisabledError('updateUiConfigDefault:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  await dbClient.collection('ui_config').updateOne(
    { _id: 'default' },
    {
      $set: {
        ...update,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );

  return dbClient.collection('ui_config').findOne({ _id: 'default' });
}

module.exports = {
  getUiConfigForEntity,
  getUiConfigOverride,
  upsertUiConfigOverride,
  clearUiConfigOverride,
  getSchedulerIntervalMinutes,
  getFailureReportSchedulerStatus,
  getUiConfigDefault,
  updateUiConfigDefault
};
