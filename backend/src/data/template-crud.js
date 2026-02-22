'use strict';

const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const { normalizeOrgId, addOrgScope, getCollection } = require('./helpers');

const useMongo = () => mongodb.isConnected();

// Template management functions (MongoDB-based)
async function listCustomTemplates(orgId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  if (useMongo()) {
    try {
      const collection = await getCollection('integration_templates');
      const templates = await collection.find(addOrgScope({}, normalizedOrgId)).sort({ updatedAt: -1 }).toArray();

      return templates.map((template) => ({
        id: template._id.toString(),
        name: template.name,
        description: template.description,
        category: template.category,
        eventType: template.eventType,
        targetUrl: template.targetUrl,
        httpMethod: template.httpMethod,
        authType: template.authType,
        authConfig: template.authConfig || {},
        headers: template.headers || {},
        timeoutMs: template.timeoutMs,
        retryCount: template.retryCount,
        transformationMode: template.transformationMode,
        transformation: template.transformation || {},
        actions: template.actions || null,
        isActive: template.isActive !== false,
        metadata: template.metadata || {},
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        isCustom: true,
      }));
    } catch (err) {
      logError(err, { scope: 'listCustomTemplates' });
      return [];
    }
  }
  return [];
}

async function getCustomTemplate(orgId, templateId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;

  if (useMongo()) {
    try {
      const { ObjectId } = require('mongodb');
      const collection = await getCollection('integration_templates');

      const template = await collection.findOne(
        addOrgScope(
          {
            _id: new ObjectId(templateId),
          },
          normalizedOrgId
        )
      );

      if (template) {
        return {
          id: template._id.toString(),
          name: template.name,
          description: template.description,
          category: template.category,
          eventType: template.eventType,
          targetUrl: template.targetUrl,
          httpMethod: template.httpMethod,
          authType: template.authType,
          authConfig: template.authConfig || {},
          headers: template.headers || {},
          timeoutMs: template.timeoutMs,
          retryCount: template.retryCount,
          transformationMode: template.transformationMode,
          transformation: template.transformation || {},
          actions: template.actions || null,
          isActive: template.isActive !== false,
          metadata: template.metadata || {},
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
          isCustom: true,
        };
      }
    } catch (err) {
      logError(err, { scope: 'getCustomTemplate', templateId });
    }
  }
  return null;
}

async function createTemplate(orgId, template) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('orgId is required');
  }

  if (useMongo()) {
    try {
      const collection = await getCollection('integration_templates');
      const now = new Date();

      const templateDoc = {
        orgId: normalizedOrgId,
        name: template.name,
        description: template.description,
        category: template.category,
        eventType: template.eventType,
        targetUrl: template.targetUrl,
        httpMethod: template.httpMethod,
        authType: template.authType,
        authConfig: template.authConfig || {},
        headers: template.headers || {},
        timeoutMs: template.timeoutMs,
        retryCount: template.retryCount,
        transformationMode: template.transformationMode,
        transformation: template.transformation || {},
        actions: template.actions || null,
        isActive: template.isActive !== false,
        metadata: template.metadata || {},
        createdAt: now,
        updatedAt: now,
      };

      const result = await collection.insertOne(templateDoc);

      return {
        id: result.insertedId.toString(),
        ...template,
        isCustom: true,
        createdAt: now,
        updatedAt: now,
      };
    } catch (err) {
      logError(err, { scope: 'createTemplate' });
      throw err;
    }
  }
  throw new Error('MongoDB not configured');
}

async function updateTemplate(orgId, templateId, updates) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;

  if (useMongo()) {
    try {
      const { ObjectId } = require('mongodb');
      const collection = await getCollection('integration_templates');

      const updateDoc = {
        name: updates.name,
        description: updates.description,
        category: updates.category,
        eventType: updates.eventType,
        targetUrl: updates.targetUrl,
        httpMethod: updates.httpMethod,
        authType: updates.authType,
        authConfig: updates.authConfig || {},
        headers: updates.headers || {},
        timeoutMs: updates.timeoutMs,
        retryCount: updates.retryCount,
        transformationMode: updates.transformationMode,
        transformation: updates.transformation || {},
        actions: updates.actions || null,
        isActive: updates.isActive !== false,
        metadata: updates.metadata || {},
        updatedAt: new Date(),
      };

      await collection.updateOne(addOrgScope({ _id: new ObjectId(templateId) }, normalizedOrgId), { $set: updateDoc });

      return getCustomTemplate(normalizedOrgId, templateId);
    } catch (err) {
      logError(err, { scope: 'updateTemplate', templateId });
      throw err;
    }
  }
  throw new Error('MongoDB not configured');
}

async function deleteTemplate(orgId, templateId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return false;

  if (useMongo()) {
    try {
      const { ObjectId } = require('mongodb');
      const collection = await getCollection('integration_templates');

      const result = await collection.deleteOne(addOrgScope({ _id: new ObjectId(templateId) }, normalizedOrgId));

      return result.deletedCount > 0;
    } catch (err) {
      logError(err, { scope: 'deleteTemplate', templateId });
      throw err;
    }
  }
  throw new Error('MongoDB not configured');
}

module.exports = {
  listCustomTemplates,
  getCustomTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};
