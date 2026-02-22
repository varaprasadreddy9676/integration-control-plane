'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const {
  useMongo,
  fallbackDisabledError
} = require('./helpers');

function mapOrganizationSummary(doc) {
  return {
    orgId: doc.orgId,
    name: doc.name || `Org ${doc.orgId}`,
    code: doc.code || `ORG-${doc.orgId}`,
    region: doc.region || null,
    timezone: doc.timezone || null,
    email: doc.email || null,
    phone: doc.phone || null,
    address: doc.address || null,
    tags: Array.isArray(doc.tags) ? doc.tags : []
  };
}

async function listOrganizations() {
  if (!useMongo()) {
    return fallbackDisabledError('listOrganizations:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('organizations').find({}).sort({ orgId: 1 }).toArray();
}

async function getOrganization(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('getOrganization:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const org = await dbClient.collection('organizations').findOne({ orgId });
  if (!org) return null;
  const units = await dbClient.collection('org_units').find({ orgId }).sort({ rid: 1 }).toArray();
  return { ...org, units };
}

async function getNextSequenceValue(sequenceName) {
  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('counters').findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.value.sequence;
}

async function createOrganization(payload) {
  if (!useMongo()) {
    return fallbackDisabledError('createOrganization:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const now = new Date();

  // Auto-generate orgId if not provided
  let orgId = payload.orgId;
  if (!orgId || !Number.isFinite(Number(orgId)) || Number(orgId) <= 0) {
    orgId = await getNextSequenceValue('orgId');
  }

  const org = {
    orgId: Number(orgId),
    name: payload.name || null,
    code: payload.code || null,
    email: payload.email || null,
    phone: payload.phone || null,
    address: payload.address || null,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    region: payload.region || null,
    timezone: payload.timezone || null,
    createdAt: now,
    updatedAt: now
  };

  await dbClient.collection('organizations').insertOne(org);
  return org;
}

async function updateOrganization(orgId, updates) {
  if (!useMongo()) {
    return fallbackDisabledError('updateOrganization:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const updateDoc = {
    $set: {
      ...updates,
      updatedAt: new Date()
    }
  };
  const result = await dbClient.collection('organizations').findOneAndUpdate(
    { orgId },
    updateDoc,
    { returnDocument: 'after' }
  );
  return result.value || null;
}

async function deleteOrganization(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('deleteOrganization:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('organizations').deleteOne({ orgId });
  await dbClient.collection('org_units').deleteMany({ orgId });
  return result.deletedCount > 0;
}

async function listOrgUnits(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('listOrgUnits:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('org_units').find({ orgId }).sort({ rid: 1 }).toArray();
}

async function createOrgUnit(orgId, payload) {
  if (!useMongo()) {
    return fallbackDisabledError('createOrgUnit:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const now = new Date();

  // Auto-generate rid if not provided
  let rid = payload.rid;
  if (!rid || !Number.isFinite(Number(rid)) || Number(rid) <= 0) {
    rid = await getNextSequenceValue('rid');
  }

  const unit = {
    orgId,
    rid: Number(rid),
    name: payload.name || null,
    code: payload.code || null,
    email: payload.email || null,
    phone: payload.phone || null,
    address: payload.address || null,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    region: payload.region || null,
    timezone: payload.timezone || null,
    createdAt: now,
    updatedAt: now
  };
  await dbClient.collection('org_units').insertOne(unit);
  return unit;
}

async function updateOrgUnit(orgId, rid, updates) {
  if (!useMongo()) {
    return fallbackDisabledError('updateOrgUnit:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('org_units').findOneAndUpdate(
    { orgId, rid },
    {
      $set: {
        ...updates,
        updatedAt: new Date()
      }
    },
    { returnDocument: 'after' }
  );
  return result.value || null;
}

async function deleteOrgUnit(orgId, rid) {
  if (!useMongo()) {
    return fallbackDisabledError('deleteOrgUnit:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('org_units').deleteOne({ orgId, rid });
  return result.deletedCount > 0;
}

async function listTenantIds() {
  if (!useMongo()) {
    return fallbackDisabledError('listTenantIds:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const orgIds = await dbClient.collection('organizations').distinct('orgId');
  const cleaned = orgIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b);

  if (cleaned.length > 0) {
    return cleaned;
  }

  const sources = await Promise.all([
    dbClient.collection('integration_configs').distinct('orgId'),
    dbClient.collection('integration_configs').distinct('orgId'),
    dbClient.collection('ui_config').distinct('orgId'),
    dbClient.collection('lookups').distinct('orgId'),
    dbClient.collection('event_audit').distinct('orgId'),
    dbClient.collection('execution_logs').distinct('orgId')
  ]);

  const ids = new Set();
  sources.flat().forEach((id) => {
    const num = Number(id);
    if (Number.isFinite(num) && num > 0) {
      ids.add(num);
    }
  });

  return Array.from(ids).sort((a, b) => a - b);
}

async function listTenantSummaries() {
  if (useMongo()) {
    const orgs = await listOrganizations();
    if (orgs.length > 0) {
      return orgs.map(mapOrganizationSummary);
    }
  }

  const ids = await listTenantIds();
  return ids.map((orgId) => ({
    orgId,
    name: `Org ${orgId}`,
    code: `ORG-${orgId}`,
    region: null,
    timezone: null,
    email: null
  }));
}

module.exports = {
  mapOrganizationSummary,
  listOrganizations,
  getOrganization,
  getNextSequenceValue,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  listOrgUnits,
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  listTenantIds,
  listTenantSummaries
};
