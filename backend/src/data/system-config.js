/**
 * System Config Data Layer
 * Reads and writes runtime-mutable system settings to MongoDB.
 * Bootstrap-critical values (db, port, jwt secret) stay in config.json only.
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');

const COLLECTION = 'system_config';
const DOC_ID = 'main';

/**
 * Get the stored system config document from MongoDB.
 * Returns null if nothing has been saved yet.
 */
async function getSystemConfig() {
  const db = await mongodb.getDbSafe();
  const doc = await db.collection(COLLECTION).findOne({ _id: DOC_ID });
  if (doc) {
    // Strip internal MongoDB fields before returning
    const { _id, updatedAt, ...rest } = doc;
    return rest;
  }
  return null;
}

/**
 * Merge a patch into the stored system config document.
 * Creates the document if it does not exist yet.
 * @param {object} patch
 */
async function updateSystemConfig(patch) {
  const db = await mongodb.getDbSafe();
  await db
    .collection(COLLECTION)
    .findOneAndUpdate({ _id: DOC_ID }, { $set: { ...patch, updatedAt: new Date() } }, { upsert: true });
}

/**
 * Load system config from MongoDB and apply overrides to the shared config
 * object in-place.  Because Node.js caches the config module, every part of
 * the codebase that has already called `require('../config')` will immediately
 * see the updated values — no restart required.
 */
async function applyRuntimeConfig() {
  if (!mongodb.isConnected()) return;

  try {
    const stored = await getSystemConfig();
    if (!stored) return;

    // Require config here (not at module load) to avoid circular deps
    const config = require('../config');

    if (stored.worker && typeof stored.worker === 'object') {
      Object.assign(config.worker, stored.worker);
    }
    if (stored.scheduler && typeof stored.scheduler === 'object') {
      Object.assign(config.scheduler, stored.scheduler);
    }
    if (stored.eventSource && typeof stored.eventSource === 'object') {
      Object.assign(config.eventSource, stored.eventSource);
    }
    if (stored.kafka && typeof stored.kafka === 'object') {
      Object.assign(config.kafka, stored.kafka);
    }
    if (stored.security && typeof stored.security === 'object') {
      if (typeof stored.security.enforceHttps === 'boolean') {
        config.security.enforceHttps = stored.security.enforceHttps;
      }
      if (typeof stored.security.blockPrivateNetworks === 'boolean') {
        config.security.blockPrivateNetworks = stored.security.blockPrivateNetworks;
      }
    }
    if (stored.eventAudit && typeof stored.eventAudit === 'object') {
      config.eventAudit = { ...(config.eventAudit || {}), ...stored.eventAudit };
    }
    if (typeof stored.communicationServiceUrl === 'string') {
      config.communicationServiceUrl = stored.communicationServiceUrl;
    }
    if (typeof stored.frontendUrl === 'string') {
      config.frontendUrl = stored.frontendUrl;
    }
  } catch (err) {
    log('warn', 'Could not apply runtime config from MongoDB — using config.json values', {
      error: err.message,
    });
  }
}

module.exports = { getSystemConfig, updateSystemConfig, applyRuntimeConfig };
