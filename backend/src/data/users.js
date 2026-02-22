'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const {
  useMongo,
  fallbackDisabledError
} = require('./helpers');

async function getUserByEmail(email) {
  if (!useMongo()) {
    return fallbackDisabledError('getUserByEmail:mongo');
  }

  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('users').findOne({ email: normalizedEmail });
}

async function getUserById(userId) {
  if (!useMongo()) {
    return fallbackDisabledError('getUserById:mongo');
  }

  const objectId = mongodb.toObjectId(userId);
  if (!objectId) {
    return null;
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('users').findOne({ _id: objectId });
}

async function createUser(user) {
  if (!useMongo()) {
    return fallbackDisabledError('createUser:mongo');
  }

  const now = new Date();
  const normalizedEmail = (user.email || '').trim().toLowerCase();
  const payload = {
    email: normalizedEmail,
    passwordHash: user.passwordHash,
    role: user.role,
    orgId: user.orgId || null,
    isActive: user.isActive !== false,
    createdAt: now,
    updatedAt: now
  };

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('users').insertOne(payload);
  return { ...payload, _id: result.insertedId };
}

async function updateUser(userId, updates) {
  if (!useMongo()) {
    return fallbackDisabledError('updateUser:mongo');
  }

  const objectId = mongodb.toObjectId(userId);
  if (!objectId) {
    return null;
  }

  const updatePayload = { ...updates, updatedAt: new Date() };
  if (updatePayload.email) {
    updatePayload.email = updatePayload.email.trim().toLowerCase();
  }

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('users').updateOne(
    { _id: objectId },
    { $set: updatePayload }
  );

  if (!result.matchedCount) {
    return null;
  }

  return dbClient.collection('users').findOne({ _id: objectId });
}

async function setUserLastLogin(userId) {
  return updateUser(userId, { lastLoginAt: new Date() });
}

async function listUsers(filter = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('listUsers:mongo');
  }

  const query = {};
  if (filter.orgId !== undefined && filter.orgId !== null) {
    query.orgId = filter.orgId;
  }
  if (filter.role) {
    query.role = filter.role;
  }
  if (filter.isActive !== undefined) {
    if (filter.isActive === true) {
      query.isActive = { $ne: false };
    } else {
      query.isActive = false;
    }
  }
  if (filter.search) {
    const escaped = String(filter.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.email = { $regex: escaped, $options: 'i' };
  }

  const page = Number(filter.page) > 0 ? Number(filter.page) : 1;
  const limit = Number(filter.limit) > 0 ? Number(filter.limit) : 50;
  const skip = (page - 1) * limit;

  const dbClient = await mongodb.getDbSafe();
  const collection = dbClient.collection('users');

  const [users, total] = await Promise.all([
    collection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    collection.countDocuments(query)
  ]);

  return { users, total, page, limit };
}

async function countUsers(filter = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('countUsers:mongo');
  }

  const query = {};
  if (filter.orgId !== undefined && filter.orgId !== null) {
    query.orgId = filter.orgId;
  }
  if (filter.role) {
    query.role = filter.role;
  }
  if (filter.isActive !== undefined) {
    if (filter.isActive === true) {
      query.isActive = { $ne: false };
    } else {
      query.isActive = false;
    }
  }
  if (filter.$or) {
    query.$or = filter.$or;
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('users').countDocuments(query);
}

module.exports = {
  getUserByEmail,
  getUserById,
  createUser,
  updateUser,
  setUserLastLogin,
  listUsers,
  countUsers
};
