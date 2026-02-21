/**
 * AI Configuration Data Layer
 * Stores per-org AI provider configs in MongoDB with encrypted API keys.
 *
 * Also manages the legacy ui_config.features.aiAssistant flag for backward compatibility.
 */

const crypto = require('crypto');
const config = require('../config');
const mongodb = require('../mongodb');
const { log } = require('../logger');

const COLLECTION = 'ai_configs';

function buildOrgQuery(orgId) {
  return {
    $or: [{ orgId }, { entityParentRid: orgId }]
  };
}

// Derive a 32-byte encryption key from the app's security key
function getEncryptionKey() {
  const seed = config.security?.apiKey || 'default-fallback-key-change-this';
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptApiKey(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptApiKey(ciphertext) {
  try {
    const [ivHex, encryptedHex] = ciphertext.split(':');
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    log('error', 'Failed to decrypt AI API key', { error: err.message });
    return null;
  }
}

async function getDb() {
  if (!mongodb.isConnected()) {
    throw new Error('MongoDB not connected');
  }
  return mongodb.getDbSafe();
}

/**
 * Ensure the ai_configs collection has the right indexes.
 * Call this during app startup.
 */
async function ensureIndexes() {
  try {
    const db = await getDb();
    const collection = db.collection(COLLECTION);

    // One-time migration: promote legacy entityParentRid to orgId.
    await collection.updateMany(
      { orgId: { $exists: false }, entityParentRid: { $exists: true } },
      [{ $set: { orgId: '$entityParentRid' } }]
    );

    // Move to orgId unique index for ai_configs collection.
    await collection.dropIndex('entityParentRid_1').catch(() => {});
    await collection.createIndex({ orgId: 1 }, { unique: true });
  } catch (err) {
    log('warn', 'Failed to ensure ai_configs indexes', { error: err.message });
  }
}

/**
 * Get AI config for an entity.
 * Returns config with hasApiKey (bool) but NOT the raw API key.
 */
async function getAIConfig(orgId) {
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne(buildOrgQuery(orgId));
  if (!doc) return null;

  return {
    orgId: doc.orgId || doc.entityParentRid,
    provider: doc.provider || 'openai',
    model: doc.model || null,
    dailyLimit: doc.dailyLimit ?? 100,
    enabled: doc.enabled !== false,
    hasApiKey: !!doc.apiKeyEncrypted,
    updatedAt: doc.updatedAt
  };
}

/**
 * Get the decrypted API key for an entity.
 * INTERNAL USE ONLY - never expose to clients.
 */
async function getDecryptedApiKey(orgId) {
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne(buildOrgQuery(orgId));
  if (!doc || !doc.apiKeyEncrypted) return null;
  return decryptApiKey(doc.apiKeyEncrypted);
}

/**
 * Get full provider config for an entity (for creating a provider instance).
 * Returns { provider, apiKey, model, maxTokens } or null.
 */
async function getProviderConfig(orgId) {
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne(buildOrgQuery(orgId));
  if (!doc || !doc.apiKeyEncrypted || doc.enabled === false) return null;

  const apiKey = decryptApiKey(doc.apiKeyEncrypted);
  if (!apiKey) return null;

  return {
    provider: doc.provider || 'openai',
    apiKey,
    model: doc.model || null,
    maxTokens: doc.maxTokens || 2048,
    dailyLimit: doc.dailyLimit ?? 100,
    enabled: true
  };
}

/**
 * Save AI config for an entity.
 * If apiKey is provided, it is encrypted and stored.
 * If apiKey is omitted, the existing key is preserved.
 */
async function saveAIConfig(orgId, { provider, apiKey, model, maxTokens, dailyLimit, enabled }) {
  const db = await getDb();

  const update = {
    orgId,
    provider: provider || 'openai',
    model: model || null,
    maxTokens: typeof maxTokens === 'number' ? maxTokens : 2048,
    dailyLimit: typeof dailyLimit === 'number' ? dailyLimit : 100,
    enabled: enabled !== false,
    updatedAt: new Date()
  };

  if (apiKey && apiKey.trim()) {
    update.apiKeyEncrypted = encryptApiKey(apiKey.trim());
  }

  await db.collection(COLLECTION).updateOne(
    buildOrgQuery(orgId),
    { $set: update, $unset: { entityParentRid: '' }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );

  log('info', 'AI config saved for org', { orgId, provider: update.provider });
  return getAIConfig(orgId);
}

/**
 * Remove the API key for an entity (disables AI for this entity).
 */
async function deleteAIKey(orgId) {
  const db = await getDb();
  await db.collection(COLLECTION).updateOne(
    buildOrgQuery(orgId),
    {
      $unset: { apiKeyEncrypted: '', entityParentRid: '' },
      $set: { orgId, enabled: false, updatedAt: new Date() }
    }
  );
  log('info', 'AI API key removed for org', { orgId });
}

/**
 * Get all AI configs - admin overview, no keys returned.
 */
async function getAllConfigs() {
  const db = await getDb();
  const docs = await db.collection(COLLECTION).find({}).toArray();
  return docs.map(doc => ({
    orgId: doc.orgId || doc.entityParentRid,
    provider: doc.provider,
    model: doc.model,
    dailyLimit: doc.dailyLimit,
    enabled: doc.enabled,
    hasApiKey: !!doc.apiKeyEncrypted,
    updatedAt: doc.updatedAt
  }));
}

// ---------------------------------------------------------------------------
// Legacy ui_config helpers (kept for backward compatibility)
// ---------------------------------------------------------------------------

async function enableAIForEntity(orgId) {
  if (!mongodb.isConnected()) throw new Error('MongoDB not connected');
  const db = await mongodb.getDbSafe();
  await db.collection('ui_config').updateOne(
    { $or: [{ orgId }, { entityParentRid: orgId }] },
    {
      $set: {
        orgId,
        'features.aiAssistant': true,
        updatedAt: new Date()
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
  log('info', 'AI Assistant enabled for org', { orgId });
  return true;
}

async function disableAIForEntity(orgId) {
  if (!mongodb.isConnected()) throw new Error('MongoDB not connected');
  const db = await mongodb.getDbSafe();
  await db.collection('ui_config').updateOne(
    { $or: [{ orgId }, { entityParentRid: orgId }] },
    {
      $set: {
        orgId,
        'features.aiAssistant': false,
        updatedAt: new Date()
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
  log('info', 'AI Assistant disabled for org', { orgId });
  return true;
}

async function isAIEnabledForEntity(orgId) {
  if (!mongodb.isConnected()) return false;
  const db = await mongodb.getDbSafe();
  const uiConfig = await db.collection('ui_config').findOne({
    $or: [{ orgId }, { entityParentRid: orgId }]
  });
  if (!uiConfig || !uiConfig.features) return true;
  return uiConfig.features.aiAssistant !== false;
}

async function getAllAIConfigurations() {
  if (!mongodb.isConnected()) return [];
  const db = await mongodb.getDbSafe();
  const configs = await db.collection('ui_config')
    .find({ 'features.aiAssistant': { $exists: true } })
    .project({ orgId: 1, entityParentRid: 1, 'features.aiAssistant': 1 })
    .toArray();
  return configs.map(c => ({ orgId: c.orgId || c.entityParentRid, aiEnabled: c.features.aiAssistant }));
}

// ---------------------------------------------------------------------------
// Global system prompt storage (ai_prompts collection)
// ---------------------------------------------------------------------------

const PROMPTS_COLLECTION = 'ai_prompts';
const SYSTEM_PROMPT_KEY = 'default';

/**
 * Get the global system prompt from DB.
 * Returns { content, updatedAt, isCustomized: true } or null if using hardcoded default.
 */
async function getSystemPromptFromDB() {
  if (!mongodb.isConnected()) return null;
  const db = await mongodb.getDbSafe();
  const doc = await db.collection(PROMPTS_COLLECTION).findOne({ key: SYSTEM_PROMPT_KEY });
  if (!doc) return null;
  return {
    content: doc.content,
    updatedAt: doc.updatedAt,
    characterCount: doc.content ? doc.content.length : 0,
    isCustomized: true
  };
}

/**
 * Save (or update) the global system prompt in DB.
 */
async function saveSystemPromptToDB(content) {
  if (!mongodb.isConnected()) throw new Error('MongoDB not connected');
  const db = await mongodb.getDbSafe();
  await db.collection(PROMPTS_COLLECTION).updateOne(
    { key: SYSTEM_PROMPT_KEY },
    {
      $set: { content, updatedAt: new Date() },
      $setOnInsert: { key: SYSTEM_PROMPT_KEY, createdAt: new Date() }
    },
    { upsert: true }
  );
  log('info', 'Global system prompt saved to DB');
}

/**
 * Remove the custom system prompt — falls back to hardcoded default.
 */
async function resetSystemPromptInDB() {
  if (!mongodb.isConnected()) throw new Error('MongoDB not connected');
  const db = await mongodb.getDbSafe();
  await db.collection(PROMPTS_COLLECTION).deleteOne({ key: SYSTEM_PROMPT_KEY });
  log('info', 'Global system prompt reset to hardcoded default');
}

module.exports = {
  ensureIndexes,
  getAIConfig,
  getDecryptedApiKey,
  getProviderConfig,
  saveAIConfig,
  deleteAIKey,
  getAllConfigs,
  // System prompt
  getSystemPromptFromDB,
  saveSystemPromptToDB,
  resetSystemPromptInDB,
  // Legacy
  enableAIForEntity,
  disableAIForEntity,
  isAIEnabledForEntity,
  getAllAIConfigurations
};
