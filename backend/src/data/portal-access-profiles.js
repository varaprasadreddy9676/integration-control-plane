'use strict';

/**
 * Portal Access Profile data layer.
 *
 * Collection: portal_access_profiles
 *
 * A Portal Access Profile is the persistent object that backs a stable "launch link"
 * for the embeddable portal. The launch URL contains a random secret whose bcrypt hash
 * is stored on the profile. On launch the backend verifies the secret, checks isActive
 * and tokenVersion, then issues a short-lived JWT + refresh token.
 *
 * tokenVersion is incremented on rotate-link and revoke-all to immediately invalidate
 * any outstanding refresh tokens for that profile.
 */

const { randomBytes } = require('crypto');
const bcrypt = require('bcryptjs');
const mongodb = require('../mongodb');
const { ObjectId } = require('mongodb');
const { log } = require('../logger');

const COLLECTION = 'portal_access_profiles';
const BCRYPT_ROUNDS = 10;

// ── Helpers ────────────────────────────────────────────────────────────────────

function col() {
  return mongodb.getDb().collection(COLLECTION);
}

function generateLinkSecret() {
  // 32 random bytes → 64-char hex string. This is the raw secret embedded in the URL.
  return randomBytes(32).toString('hex');
}

async function hashSecret(secret) {
  return bcrypt.hash(secret, BCRYPT_ROUNDS);
}

async function verifySecret(secret, hash) {
  return bcrypt.compare(secret, hash);
}

function toPublicProfile(doc) {
  if (!doc) return null;
  const { linkSecretHash, ...rest } = doc;
  void linkSecretHash; // intentionally excluded from public representation
  return {
    ...rest,
    id: doc._id.toString(),
  };
}

// ── Index setup ────────────────────────────────────────────────────────────────

async function ensureIndexes() {
  try {
    const c = col();
    await c.createIndex({ orgId: 1, isActive: 1 });
    await c.createIndex({ orgId: 1, createdAt: -1 });
    log('info', '[portal-access-profiles] Indexes ensured');
  } catch (err) {
    log('warn', '[portal-access-profiles] Failed to ensure indexes', { error: err.message });
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

/**
 * Create a new Portal Access Profile.
 * Returns { profile (public), linkSecret (plaintext — shown once) }.
 */
async function createProfile({
  orgId,
  name,
  role = 'VIEWER',
  allowedIntegrationIds = [],
  allowedTags = [],
  allowedViews = ['dashboard', 'logs'],
  allowedOrigins = [],
  createdBy,
}) {
  const linkSecret = generateLinkSecret();
  const linkSecretHash = await hashSecret(linkSecret);
  const now = new Date();

  const doc = {
    orgId: Number(orgId),
    name: String(name).trim(),
    role,
    allowedIntegrationIds: Array.isArray(allowedIntegrationIds) ? allowedIntegrationIds : [],
    allowedTags: Array.isArray(allowedTags) ? allowedTags : [],
    allowedViews: Array.isArray(allowedViews) ? allowedViews : ['dashboard', 'logs'],
    allowedOrigins: Array.isArray(allowedOrigins) ? allowedOrigins : [],
    isActive: true,
    tokenVersion: 1,
    linkSecretHash,
    createdBy: createdBy || null,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  };

  const result = await col().insertOne(doc);
  const inserted = { ...doc, _id: result.insertedId };

  log('info', '[portal] Profile created', {
    profileId: result.insertedId.toString(),
    orgId,
    role,
    createdBy,
  });

  return { profile: toPublicProfile(inserted), linkSecret };
}

/**
 * List profiles for an org (excludes linkSecretHash).
 */
async function listProfiles(orgId) {
  const docs = await col()
    .find({ orgId: Number(orgId) }, { projection: { linkSecretHash: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(toPublicProfile);
}

/**
 * Get a single profile by id (excludes linkSecretHash).
 */
async function getProfile(profileId) {
  let oid;
  try {
    oid = new ObjectId(profileId);
  } catch {
    return null;
  }
  const doc = await col().findOne({ _id: oid }, { projection: { linkSecretHash: 0 } });
  return toPublicProfile(doc);
}

/**
 * Get full profile including linkSecretHash (internal — for verification only).
 */
async function getProfileWithSecret(profileId) {
  let oid;
  try {
    oid = new ObjectId(profileId);
  } catch {
    return null;
  }
  return col().findOne({ _id: oid });
}

/**
 * Update mutable profile fields (name, role, allowedIntegrationIds, allowedTags,
 * allowedViews, allowedOrigins, isActive).
 */
async function updateProfile(profileId, updates) {
  let oid;
  try {
    oid = new ObjectId(profileId);
  } catch {
    return null;
  }

  const allowed = [
    'name', 'role',
    'allowedIntegrationIds', 'allowedTags', 'allowedViews', 'allowedOrigins',
    'isActive',
  ];
  const $set = { updatedAt: new Date() };
  for (const key of allowed) {
    if (Object.hasOwn(updates, key)) {
      $set[key] = updates[key];
    }
  }

  const result = await col().findOneAndUpdate(
    { _id: oid },
    { $set },
    { returnDocument: 'after', projection: { linkSecretHash: 0 } }
  );

  // MongoDB driver v4 returns ModifyResult { value, ok, lastErrorObject }
  const doc = result?.value ?? result;
  return toPublicProfile(doc);
}

/**
 * Rotate the link secret.
 * Generates a new secret, hashes it, and increments tokenVersion to invalidate
 * all outstanding refresh tokens.
 * Returns { profile (public), linkSecret (new plaintext — shown once) }.
 */
async function rotateProfileLink(profileId, updatedBy) {
  let oid;
  try {
    oid = new ObjectId(profileId);
  } catch {
    return null;
  }

  const linkSecret = generateLinkSecret();
  const linkSecretHash = await hashSecret(linkSecret);
  const now = new Date();

  const result = await col().findOneAndUpdate(
    { _id: oid },
    {
      $set: { linkSecretHash, updatedAt: now },
      $inc: { tokenVersion: 1 },
    },
    { returnDocument: 'after', projection: { linkSecretHash: 0 } }
  );

  // MongoDB driver v4 returns ModifyResult { value, ok, lastErrorObject }
  const doc = result?.value ?? result;
  if (!doc) return null;

  log('info', '[portal] Profile link rotated', {
    profileId,
    newTokenVersion: doc.tokenVersion,
    updatedBy,
  });

  return { profile: toPublicProfile(doc), linkSecret };
}

/**
 * Revoke all active sessions for a profile by incrementing tokenVersion.
 * Does NOT change the link secret — the launch URL remains valid for new sessions,
 * but all current refresh tokens are immediately invalidated.
 */
async function revokeAllSessions(profileId, updatedBy) {
  let oid;
  try {
    oid = new ObjectId(profileId);
  } catch {
    return null;
  }

  const result = await col().findOneAndUpdate(
    { _id: oid },
    {
      $inc: { tokenVersion: 1 },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: 'after', projection: { linkSecretHash: 0 } }
  );

  // MongoDB driver v4 returns ModifyResult { value, ok, lastErrorObject }
  const doc = result?.value ?? result;
  if (!doc) return null;

  log('info', '[portal] All sessions revoked for profile', {
    profileId,
    newTokenVersion: doc.tokenVersion,
    updatedBy,
  });

  return toPublicProfile(doc);
}

/**
 * Permanently delete a profile by id.
 * Returns true if a document was deleted, false if it was not found.
 */
async function deleteProfile(profileId) {
  let oid;
  try {
    oid = new ObjectId(profileId);
  } catch {
    return false;
  }
  const result = await col().deleteOne({ _id: oid });
  return result.deletedCount > 0;
}

/**
 * Record a launch (update lastUsedAt) — best-effort, non-blocking.
 */
async function recordProfileUsage(profileId) {
  try {
    let oid;
    try { oid = new ObjectId(profileId); } catch { return; }
    await col().updateOne({ _id: oid }, { $set: { lastUsedAt: new Date() } });
  } catch {
    // non-fatal
  }
}

/**
 * Verify a launch secret against a profile's stored hash.
 */
async function verifyProfileSecret(profileId, secret) {
  const profile = await getProfileWithSecret(profileId);
  if (!profile) return { valid: false, profile: null };
  if (!profile.isActive) return { valid: false, profile };
  const valid = await verifySecret(secret, profile.linkSecretHash);
  return { valid, profile };
}

module.exports = {
  ensureIndexes,
  createProfile,
  listProfiles,
  getProfile,
  getProfileWithSecret,
  updateProfile,
  deleteProfile,
  rotateProfileLink,
  revokeAllSessions,
  recordProfileUsage,
  verifyProfileSecret,
};
