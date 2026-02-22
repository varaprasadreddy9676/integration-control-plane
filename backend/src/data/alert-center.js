'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const {
  useMongo,
  normalizeOrgId,
  buildOrgScopeQuery,
  addOrgScope,
  fallbackDisabledError,
  mapAlertCenterLog,
} = require('./helpers');

async function listAlertCenterLogs(orgId, filters = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = buildOrgScopeQuery(normalizedOrgId);

      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.channel) {
        query.channel = filters.channel;
      }
      if (filters.type) {
        query.type = filters.type;
      }
      if (filters.search) {
        query.$or = [
          { subject: { $regex: filters.search, $options: 'i' } },
          { errorMessage: { $regex: filters.search, $options: 'i' } },
          { recipients: { $regex: filters.search, $options: 'i' } },
        ];
      }

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) {
          query.createdAt.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query.createdAt.$lte = new Date(filters.endDate);
        }
      }

      const logs = await db
        .collection('alert_center_logs')
        .find(query)
        .sort({ createdAt: -1 })
        // Increased limit to avoid capping exports and status views
        // TODO: Implement pagination for alert center logs similar to delivery logs
        .limit(filters.limit || 10000)
        .toArray();

      return logs.map(mapAlertCenterLog);
    } catch (err) {
      logError(err, { scope: 'listAlertCenterLogs', filters });
      throw err;
    }
  }
  return fallbackDisabledError('listAlertCenterLogs:fallback');
}

async function recordAlertCenterLog(orgId, logPayload) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return false;

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const logDoc = {
        orgId: normalizedOrgId,
        type: logPayload.type,
        channel: logPayload.channel,
        status: logPayload.status,
        subject: logPayload.subject || null,
        recipients: logPayload.recipients || [],
        totalFailures: logPayload.totalFailures ?? null,
        windowStart: logPayload.windowStart || null,
        windowEnd: logPayload.windowEnd || null,
        errorMessage: logPayload.errorMessage || null,
        errorStack: logPayload.errorStack || null,
        payload: logPayload.payload || null,
        providerUrl: logPayload.providerUrl || null,
        providerResponse: logPayload.providerResponse || null,
        createdAt: logPayload.createdAt || new Date(),
      };

      await db.collection('alert_center_logs').insertOne(logDoc);
      return true;
    } catch (err) {
      logError(err, { scope: 'recordAlertCenterLog' });
      return false;
    }
  }
  return fallbackDisabledError('recordAlertCenterLog:fallback');
}

module.exports = {
  listAlertCenterLogs,
  recordAlertCenterLog,
};
