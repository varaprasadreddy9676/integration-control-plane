const { log } = require('../logger');
const data = require('./index');
const config = require('../config');
const { validateTargetUrl } = require('../utils/url-check');

// Pre-built integration templates are now stored in MongoDB
const WEBHOOK_TEMPLATES = {};

async function getAllTemplates(orgId) {
  try {
    return await data.listCustomTemplates(orgId);
  } catch (err) {
    log('error', 'Failed to list templates', { error: err.message });
    return [];
  }
}

async function getTemplateById(orgId, templateId) {
  try {
    return await data.getCustomTemplate(orgId, templateId);
  } catch (err) {
    log('error', 'Failed to get template', { templateId, error: err.message });
    return null;
  }
}

async function getTemplatesByCategory(orgId, category) {
  try {
    const templates = await data.listCustomTemplates(orgId);
    return templates.filter(t => t.category === category);
  } catch (err) {
    log('error', 'Failed to list templates by category', { category, error: err.message });
    return [];
  }
}

async function getTemplateCategories(orgId) {
  try {
    const templates = await data.listCustomTemplates(orgId);
    const categories = new Set();
    templates.forEach(t => {
      if (t.category) categories.add(t.category);
    });
    return Array.from(categories).sort();
  } catch (err) {
    log('error', 'Failed to get template categories', { error: err.message });
    return [];
  }
}

function replacePlaceholders(value, placeholders) {
  if (typeof value !== 'string') return value;
  let result = value;
  Object.keys(placeholders || {}).forEach((key) => {
    const placeholder = `{{${key}}}`;
    if (result.includes(placeholder)) {
      result = result.replace(new RegExp(placeholder, 'g'), placeholders[key] || '');
    }
  });
  return result;
}

function replacePlaceholdersInObject(obj, placeholders) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => replacePlaceholdersInObject(item, placeholders));
  }
  const result = {};
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (typeof value === 'string') {
      result[key] = replacePlaceholders(value, placeholders);
    } else if (typeof value === 'object') {
      result[key] = replacePlaceholdersInObject(value, placeholders);
    } else {
      result[key] = value;
    }
  });
  return result;
}

async function createIntegrationFromTemplate(orgId, templateId, overrides = {}) {
  const template = await getTemplateById(orgId, templateId);
  if (!template) {
    throw new Error('Template not found');
  }

  const rawAuthType = overrides.outgoingAuthType || template.authType;
  const outgoingAuthType = rawAuthType === 'BEARER_TOKEN' ? 'BEARER' : rawAuthType;

  return {
    name: overrides.name || template.name,
    eventType: replacePlaceholders(overrides.eventType || template.eventType, overrides.placeholders),
    scope: overrides.scope || 'INCLUDE_CHILDREN',
    targetUrl: replacePlaceholders(overrides.targetUrl || template.targetUrl, overrides.placeholders),
    httpMethod: overrides.httpMethod || template.httpMethod,
    outgoingAuthType,
    outgoingAuthConfig: replacePlaceholdersInObject(
      overrides.outgoingAuthConfig || template.authConfig,
      overrides.placeholders
    ),
    headers: replacePlaceholdersInObject(
      overrides.headers || template.headers || {},
      overrides.placeholders
    ),
    timeoutMs: overrides.timeoutMs || template.timeoutMs || 15000,
    retryCount: overrides.retryCount !== undefined ? overrides.retryCount : (template.retryCount || 3),
    transformationMode: overrides.transformationMode || template.transformationMode,
    transformation: replacePlaceholdersInObject(
      overrides.transformation || template.transformation || {},
      overrides.placeholders
    ),
    actions: replacePlaceholdersInObject(
      overrides.actions || template.actions,
      overrides.placeholders
    ),
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    description: overrides.description || template.description,
    metadata: {
      ...template.metadata,
      templateId: template.id,
      templateName: template.name,
      templateCategory: template.category
    }
  };
}

async function validateTemplate(orgId, templateId, overrides = {}) {
  const errors = [];
  const warnings = [];
  const template = await getTemplateById(orgId, templateId);

  if (!template) {
    return { valid: false, errors: ['Template not found'], warnings, template: null };
  }

  let __KEEP_integrationConfig__;
  try {
    __KEEP_integrationConfig__ = await createIntegrationFromTemplate(orgId, templateId, overrides);
  } catch (err) {
    return { valid: false, errors: [err.message], warnings, template };
  }

  if (!__KEEP_integrationConfig__.name) {
    errors.push('Name is required');
  }

  if (!__KEEP_integrationConfig__.eventType) {
    errors.push('Event type is required');
  }

  if (__KEEP_integrationConfig__.actions && Array.isArray(__KEEP_integrationConfig__.actions) && __KEEP_integrationConfig__.actions.length > 0) {
    __KEEP_integrationConfig__.actions.forEach((action, index) => {
      const target = action.targetUrl || __KEEP_integrationConfig__.targetUrl;
      if (!target) {
        errors.push(`Action ${index + 1} requires targetUrl`);
      } else {
        const check = validateTargetUrl(target, config.security);
        if (!check.valid) {
          errors.push(`Action ${index + 1}: ${check.reason}`);
        }
      }
    });
  } else {
    if (!__KEEP_integrationConfig__.targetUrl) {
      errors.push('Target URL is required');
    } else {
      const check = validateTargetUrl(__KEEP_integrationConfig__.targetUrl, config.security);
      if (!check.valid) {
        errors.push(check.reason);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    template,
    __KEEP_integrationConfig__
  };
}

module.exports = {
  WEBHOOK_TEMPLATES,
  getAllTemplates,
  getTemplateById,
  getTemplatesByCategory,
  getTemplateCategories,
  validateTemplate,
  createIntegrationFromTemplate
};
