'use strict';

const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const {
  useMongo,
  normalizeOrgId,
  scheduledOrgQuery,
  fallbackDisabledError,
} = require('./helpers');
const { normalizeSubjectExtraction } = require('../services/lifecycle-config');
const { normalizeConditionConfig, findConditionRule } = require('../services/condition-config');
const { normalizeEventSubject, matchSubjects } = require('../processor/event-normalizer');

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

async function createHeldOutboundDelivery(data) {
  if (!useMongo()) {
    throw new Error('MongoDB required for held outbound deliveries');
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();
    const integrationConfigId =
      data.__KEEP___KEEP_integrationConfig__Id__ || data.integrationConfigId || data.webhookConfigId;
    const integrationConfigObjectId = mongodb.toObjectId(integrationConfigId) || integrationConfigId;
    const orgId = normalizeOrgId(data.orgId || data.orgUnitRid || data.entityRid);
    const conditionConfig = normalizeConditionConfig(data.conditionConfig);
    const expiresAt = conditionConfig?.expiresAfterMs ? new Date(now.getTime() + conditionConfig.expiresAfterMs) : null;
    const subject = data.subject || null;
    const subjectFingerprint = subject?.data
      ? stableStringify({
          subjectType: subject.subjectType || null,
          data: subject.data,
        })
      : null;

    const heldDelivery = {
      __KEEP___KEEP_integrationConfig__Id__: integrationConfigObjectId,
      __KEEP_integrationName__: data.__KEEP_integrationName__ || data.integrationName || data.webhookName,
      integrationConfigId: integrationConfigObjectId,
      integrationName: data.__KEEP_integrationName__ || data.integrationName || data.webhookName,
      webhookConfigId: integrationConfigObjectId,
      webhookName: data.__KEEP_integrationName__ || data.integrationName || data.webhookName,
      orgId,
      orgUnitRid: data.orgUnitRid || data.entityRid || orgId,
      originalEventId: data.originalEventId || null,
      eventType: data.eventType,
      targetUrl: data.targetUrl,
      httpMethod: data.httpMethod,
      payload: data.payload,
      originalPayload: data.originalPayload || data.payload,
      status: 'HELD',
      subject,
      subjectExtraction: normalizeSubjectExtraction(data.subjectExtraction) || null,
      conditionConfig,
      subjectFingerprint,
      expiresAt,
      releaseAttemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const dedupeQuery = subjectFingerprint
      ? {
          ...scheduledOrgQuery(orgId),
          __KEEP___KEEP_integrationConfig__Id__: integrationConfigObjectId,
          status: 'HELD',
          subjectFingerprint,
        }
      : null;

    if (dedupeQuery) {
      const existing = await db.collection('held_outbound_deliveries').findOne(dedupeQuery, {
        sort: { updatedAt: -1, createdAt: -1 },
      });

      if (existing?._id) {
        const updated = await db.collection('held_outbound_deliveries').findOneAndUpdate(
          { _id: existing._id, status: 'HELD' },
          {
            $set: {
              originalEventId: heldDelivery.originalEventId,
              eventType: heldDelivery.eventType,
              targetUrl: heldDelivery.targetUrl,
              httpMethod: heldDelivery.httpMethod,
              payload: heldDelivery.payload,
              originalPayload: heldDelivery.originalPayload,
              subject: heldDelivery.subject,
              subjectExtraction: heldDelivery.subjectExtraction,
              conditionConfig: heldDelivery.conditionConfig,
              subjectFingerprint: heldDelivery.subjectFingerprint,
              expiresAt: heldDelivery.expiresAt,
              updatedAt: now,
            },
            $unset: {
              lastReleaseError: '',
              lastReleaseEventType: '',
            },
          },
          { returnDocument: 'after' }
        );

        const updatedDoc = updated?.value || updated;
        if (updatedDoc?._id) {
          return {
            id: updatedDoc._id.toString(),
            ...updatedDoc,
          };
        }
      }
    }

    const result = await db.collection('held_outbound_deliveries').insertOne(heldDelivery);
    return {
      id: result.insertedId.toString(),
      ...heldDelivery,
    };
  } catch (error) {
    logError(error, { scope: 'createHeldOutboundDelivery' });
    throw error;
  }
}

async function resolveHeldSubject(held, criteria) {
  if (held.subject?.data) {
    return held.subject;
  }

  const subjectExtraction =
    normalizeSubjectExtraction(held.subjectExtraction) ||
    normalizeSubjectExtraction(criteria.subjectExtraction);

  if (!subjectExtraction || !held.originalPayload) {
    return null;
  }

  return normalizeEventSubject(held.eventType || criteria.eventType || '', held.originalPayload, {
    subjectType: held.subject?.subjectType || criteria.subject?.subjectType || null,
    subjectExtraction,
  });
}

async function findHeldOutboundDeliveriesByMatch(orgId, criteria) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];
  if (!useMongo()) return [];

  try {
    const db = await mongodb.getDbSafe();
    const integrationConfigObjectId = criteria.integrationConfigId
      ? mongodb.toObjectId(criteria.integrationConfigId) || criteria.integrationConfigId
      : null;

    const query = {
      ...scheduledOrgQuery(normalizedOrgId),
      status: 'HELD',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    };

    if (integrationConfigObjectId) {
      query.__KEEP___KEEP_integrationConfig__Id__ = integrationConfigObjectId;
    }

    const candidates = await db
      .collection('held_outbound_deliveries')
      .find(query, {
        projection: {
          _id: 1,
          __KEEP_integrationName__: 1,
          eventType: 1,
          status: 1,
          createdAt: 1,
          subject: 1,
          subjectExtraction: 1,
          conditionConfig: 1,
          originalPayload: 1,
        },
      })
      .toArray();

    const matches = [];

    for (const held of candidates) {
      const conditionRule = findConditionRule(held.conditionConfig || criteria.conditionConfig, criteria.eventType);
      if (!conditionRule) {
        continue;
      }

      const matchKeys = Array.isArray(conditionRule.matchKeys) ? conditionRule.matchKeys : [];
      if (matchKeys.length === 0) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const candidateSubject = await resolveHeldSubject(held, criteria);
      if (!candidateSubject?.data) {
        continue;
      }

      if (
        criteria.subject?.subjectType &&
        candidateSubject.subjectType &&
        criteria.subject.subjectType !== candidateSubject.subjectType
      ) {
        continue;
      }

      const match = matchSubjects(criteria.subject, candidateSubject, matchKeys);
      if (!match) {
        continue;
      }

      matches.push({
        id: held._id,
        heldId: held._id.toString(),
        integrationName: held.__KEEP_integrationName__ || null,
        status: held.status,
        eventType: held.eventType,
        createdAt: held.createdAt,
        matchedOn: match.matchedOn,
      });
    }

    return matches;
  } catch (error) {
    logError(error, { scope: 'findHeldOutboundDeliveriesByMatch' });
    return [];
  }
}

async function releaseHeldDeliveriesByMatch(orgId, criteria) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return { releasedCount: 0, failedCount: 0, matchedCount: 0 };
  if (!useMongo()) return { releasedCount: 0, failedCount: 0, matchedCount: 0 };
  if (!criteria?.subject?.data || !criteria?.integration?.id) {
    return { releasedCount: 0, failedCount: 0, matchedCount: 0 };
  }

  try {
    const { deliverToIntegration } = require('../processor/delivery-engine');
    const db = await mongodb.getDbSafe();
    const matches = await findHeldOutboundDeliveriesByMatch(normalizedOrgId, criteria);
    let releasedCount = 0;
    let failedCount = 0;

    for (const match of matches) {
      // eslint-disable-next-line no-await-in-loop
      const held = await db.collection('held_outbound_deliveries').findOne({
        _id: match.id,
        ...scheduledOrgQuery(normalizedOrgId),
        status: 'HELD',
      });

      if (!held) {
        continue;
      }

      const releaseEvent = {
        id: held.originalEventId || `held-${match.heldId}`,
        event_type: held.eventType,
        payload: held.originalPayload || held.payload,
        orgId: normalizedOrgId,
      };

      // eslint-disable-next-line no-await-in-loop
      const result = await deliverToIntegration(
        criteria.integration,
        releaseEvent,
        false,
        0,
        null,
        null,
        true,
        {
          preparedPayload: held.payload,
          triggerType: 'WAIT_FOR_CONDITION',
          reason: `Released by ${criteria.eventType}`,
        }
      );

      const status = typeof result === 'string' ? result : result?.status;

      if (status === 'SUCCESS' || status === 'SKIPPED') {
        releasedCount += 1;
        // eslint-disable-next-line no-await-in-loop
        await db.collection('held_outbound_deliveries').updateOne(
          { _id: held._id, status: 'HELD' },
          {
            $set: {
              status: 'RELEASED',
              releasedAt: new Date(),
              releasedByEventType: criteria.eventType,
              releaseMatchedOn: match.matchedOn,
              updatedAt: new Date(),
            },
          }
        );
      } else {
        failedCount += 1;
        // eslint-disable-next-line no-await-in-loop
        await db.collection('held_outbound_deliveries').updateOne(
          { _id: held._id, status: 'HELD' },
          {
            $set: {
              lastReleaseEventType: criteria.eventType,
              lastReleaseError: `Release failed with status ${status || 'UNKNOWN'}`,
              updatedAt: new Date(),
            },
            $inc: {
              releaseAttemptCount: 1,
            },
          }
        );
      }
    }

    return {
      releasedCount,
      failedCount,
      matchedCount: matches.length,
    };
  } catch (error) {
    logError(error, { scope: 'releaseHeldDeliveriesByMatch' });
    return { releasedCount: 0, failedCount: 0, matchedCount: 0 };
  }
}

async function discardHeldDeliveriesByMatch(orgId, criteria) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return 0;
  if (!useMongo()) return 0;
  if (!criteria?.subject?.data) return 0;

  try {
    const db = await mongodb.getDbSafe();
    const matches = await findHeldOutboundDeliveriesByMatch(normalizedOrgId, criteria);
    if (matches.length === 0) {
      return 0;
    }

    const result = await db.collection('held_outbound_deliveries').updateMany(
      {
        ...scheduledOrgQuery(normalizedOrgId),
        _id: { $in: matches.map((match) => match.id) },
        status: 'HELD',
      },
      {
        $set: {
          status: 'DISCARDED',
          discardedAt: new Date(),
          discardedByEventType: criteria.eventType,
          updatedAt: new Date(),
        },
      }
    );

    return result.modifiedCount;
  } catch (error) {
    logError(error, { scope: 'discardHeldDeliveriesByMatch' });
    return 0;
  }
}

module.exports = {
  createHeldOutboundDelivery,
  findHeldOutboundDeliveriesByMatch,
  releaseHeldDeliveriesByMatch,
  discardHeldDeliveriesByMatch,
};
