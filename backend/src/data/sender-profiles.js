const mongodb = require('../mongodb');
const { ValidationError, NotFoundError } = require('../utils/errors');

const COLLECTION = 'communication_sender_profiles';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const normalizeAliases = (aliases) => {
  if (!Array.isArray(aliases)) return [];
  return Array.from(new Set(aliases.map(normalizeEmail).filter(Boolean)));
};

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const ensureProviderConfig = (provider, providerConfig, fromEmail) => {
  const normalizedProvider = String(provider || 'SMTP').trim().toUpperCase();
  const config = providerConfig && typeof providerConfig === 'object' ? { ...providerConfig } : {};

  if (normalizedProvider === 'SMTP') {
    if (!config.host) throw new ValidationError('providerConfig.host is required for SMTP sender profiles');
    if (!config.port || !Number.isFinite(Number(config.port))) {
      throw new ValidationError('providerConfig.port is required for SMTP sender profiles');
    }
    if (!config.username) throw new ValidationError('providerConfig.username is required for SMTP sender profiles');
    if (!config.password) throw new ValidationError('providerConfig.password is required for SMTP sender profiles');
    config.port = Number(config.port);
    config.fromEmail = config.fromEmail || fromEmail;
  }

  return {
    provider: normalizedProvider,
    providerConfig: config,
  };
};

const mapSenderProfile = (doc) => ({
  id: doc._id.toString(),
  _id: doc._id.toString(),
  orgId: doc.orgId,
  key: doc.key,
  name: doc.name || doc.key,
  fromEmail: doc.fromEmail,
  aliases: doc.aliases || [],
  channel: doc.channel || 'EMAIL',
  provider: doc.provider,
  providerConfig: doc.providerConfig || {},
  isDefault: doc.isDefault === true,
  isActive: doc.isActive !== false,
  createdAt: doc.createdAt || null,
  updatedAt: doc.updatedAt || null,
});

async function ensureIndexes() {
  const db = await mongodb.getDbSafe();
  await db.collection(COLLECTION).createIndexes([
    { key: { orgId: 1, key: 1 }, unique: true, name: 'org_key_unique_idx' },
    { key: { orgId: 1, normalizedFromEmail: 1 }, unique: true, name: 'org_from_unique_idx' },
    { key: { orgId: 1, isActive: 1 }, name: 'org_active_idx' },
    { key: { orgId: 1, isDefault: 1 }, name: 'org_default_idx' },
    {
      key: { orgId: 1, isDefault: 1 },
      unique: true,
      partialFilterExpression: { isDefault: true },
      name: 'org_single_default_unique_idx',
    },
  ]);
}

function validateSenderProfileInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Sender profile payload must be an object');
  }

  const key = partial ? normalizeKey(input.key || '') || undefined : normalizeKey(input.key);
  const fromEmail = partial ? (input.fromEmail !== undefined ? normalizeEmail(input.fromEmail) : undefined) : normalizeEmail(input.fromEmail);
  const name = input.name !== undefined ? String(input.name || '').trim() : undefined;

  if (!partial && !key) throw new ValidationError('key is required');
  if (!partial && !fromEmail) throw new ValidationError('fromEmail is required');
  if (input.fromEmail !== undefined && !fromEmail) throw new ValidationError('fromEmail is required');
  if (input.key !== undefined && !key) throw new ValidationError('key is required');

  const aliases = input.aliases !== undefined ? normalizeAliases(input.aliases) : undefined;
  const channel = input.channel ? String(input.channel).trim().toUpperCase() : undefined;
  const isDefault = input.isDefault === true;
  const isActive = input.isActive === undefined ? true : input.isActive !== false;
  if (channel && channel !== 'EMAIL') {
    throw new ValidationError('Only EMAIL sender profiles are currently supported');
  }
  if (isDefault && !isActive) {
    throw new ValidationError('Default sender profile must be active');
  }
  if (aliases && fromEmail && aliases.includes(fromEmail)) {
    throw new ValidationError('aliases cannot include fromEmail');
  }

  let providerPayload = {};
  if (input.provider !== undefined || input.providerConfig !== undefined || input.fromEmail !== undefined) {
    providerPayload = ensureProviderConfig(input.provider, input.providerConfig, fromEmail || input.fromEmail);
  }

  return {
    key,
    name: name || key,
    fromEmail,
    normalizedFromEmail: fromEmail,
    aliases,
    normalizedAliases: aliases,
    channel: channel || 'EMAIL',
    isDefault,
    isActive,
    ...providerPayload,
  };
}

async function clearOtherDefaults(orgId, excludedId) {
  const db = await mongodb.getDbSafe();
  const query = { orgId, isDefault: true };
  if (excludedId) {
    query._id = { $ne: mongodb.toObjectId(excludedId) };
  }
  await db.collection(COLLECTION).updateMany(query, { $set: { isDefault: false, updatedAt: new Date() } });
}

async function findReplacementDefault(orgId, excludedId) {
  const db = await mongodb.getDbSafe();
  const query = { orgId, isActive: true };
  if (excludedId) {
    query._id = { $ne: mongodb.toObjectId(excludedId) };
  }
  return db.collection(COLLECTION).findOne(query, { sort: { key: 1 } });
}

async function promoteReplacementDefault(orgId, excludedId) {
  const db = await mongodb.getDbSafe();
  const replacement = await findReplacementDefault(orgId, excludedId);
  if (!replacement) {
    throw new ValidationError('At least one active default sender profile is required');
  }
  await db
    .collection(COLLECTION)
    .updateOne({ _id: replacement._id }, { $set: { isDefault: true, updatedAt: new Date() } });
}

async function listSenderProfiles(orgId) {
  const db = await mongodb.getDbSafe();
  const items = await db.collection(COLLECTION).find({ orgId }).sort({ isDefault: -1, key: 1 }).toArray();
  return items.map(mapSenderProfile);
}

async function getSenderProfile(orgId, id) {
  const db = await mongodb.getDbSafe();
  const doc = await db.collection(COLLECTION).findOne({ _id: mongodb.toObjectId(id), orgId });
  if (!doc) throw new NotFoundError('Sender profile not found');
  return mapSenderProfile(doc);
}

async function createSenderProfile(orgId, input, { createdBy = 'system' } = {}) {
  const db = await mongodb.getDbSafe();
  const payload = validateSenderProfileInput(input);
  const now = new Date();

  if (payload.isDefault) {
    await clearOtherDefaults(orgId);
  } else {
    const existingDefault = await db.collection(COLLECTION).findOne({ orgId, isDefault: true });
    if (!existingDefault) {
      if (!payload.isActive) {
        throw new ValidationError('The first sender profile for an org must be active and default');
      }
      payload.isDefault = true;
    }
  }

  const doc = {
    orgId,
    ...payload,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };

  await db.collection(COLLECTION).insertOne(doc);
  return mapSenderProfile(doc);
}

async function updateSenderProfile(orgId, id, input) {
  const db = await mongodb.getDbSafe();
  const existing = await db.collection(COLLECTION).findOne({ _id: mongodb.toObjectId(id), orgId });
  if (!existing) throw new NotFoundError('Sender profile not found');

  const payload = validateSenderProfileInput(input, { partial: true });
  const nextDoc = {
    ...existing,
    ...payload,
    key: payload.key || existing.key,
    name: payload.name || existing.name,
    fromEmail: payload.fromEmail || existing.fromEmail,
    normalizedFromEmail: payload.normalizedFromEmail || existing.normalizedFromEmail,
    aliases: payload.aliases !== undefined ? payload.aliases : existing.aliases,
    normalizedAliases: payload.normalizedAliases !== undefined ? payload.normalizedAliases : existing.normalizedAliases,
    provider: payload.provider || existing.provider,
    providerConfig: payload.providerConfig || existing.providerConfig,
    updatedAt: new Date(),
  };

  if (payload.isDefault === true) {
    await clearOtherDefaults(orgId, id);
    nextDoc.isDefault = true;
  } else if (payload.isDefault === false) {
    nextDoc.isDefault = false;
  }

  if (nextDoc.isDefault && nextDoc.isActive === false) {
    throw new ValidationError('Default sender profile must be active');
  }

  const removingDefault = existing.isDefault === true && nextDoc.isDefault !== true;
  const deactivatingDefault = existing.isDefault === true && nextDoc.isActive === false;

  if (removingDefault || deactivatingDefault) {
    await findReplacementDefault(orgId, id).then((replacement) => {
      if (!replacement) {
        throw new ValidationError('At least one active default sender profile is required');
      }
    });
  }

  await db.collection(COLLECTION).updateOne({ _id: existing._id }, { $set: nextDoc });

  if (removingDefault || deactivatingDefault) {
    await promoteReplacementDefault(orgId, id);
  }

  return mapSenderProfile(nextDoc);
}

async function deleteSenderProfile(orgId, id) {
  const db = await mongodb.getDbSafe();
  const existing = await db.collection(COLLECTION).findOne({ _id: mongodb.toObjectId(id), orgId });
  if (!existing) throw new NotFoundError('Sender profile not found');

  if (existing.isDefault) {
    const replacement = await findReplacementDefault(orgId, id);
    if (!replacement) {
      throw new ValidationError('Cannot delete the only active default sender profile');
    }
  }

  await db.collection(COLLECTION).deleteOne({ _id: existing._id });

  if (existing.isDefault) {
    await promoteReplacementDefault(orgId, id);
  }
}

async function getActiveSenderProfiles(orgId) {
  const db = await mongodb.getDbSafe();
  return db.collection(COLLECTION).find({ orgId, isActive: true }).sort({ isDefault: -1, key: 1 }).toArray();
}

module.exports = {
  COLLECTION,
  ensureIndexes,
  mapSenderProfile,
  normalizeEmail,
  normalizeKey,
  validateSenderProfileInput,
  listSenderProfiles,
  getSenderProfile,
  createSenderProfile,
  updateSenderProfile,
  deleteSenderProfile,
  getActiveSenderProfiles,
};
