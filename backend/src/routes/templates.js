const express = require('express');
const { log } = require('../logger');
const data = require('../data');
const templates = require('../data/templates');
const asyncHandler = require('../utils/async-handler');
const { auditTemplate } = require('../middleware/audit');

const router = express.Router();

// Get all available templates (hardcoded + custom)
router.get('/', asyncHandler(async (req, res) => {
  try {
    const { category, includeInactive = false } = req.query;

    // Get custom templates from database (hardcoded templates are now deprecated)
    const customTemplates = await data.listCustomTemplates(req.orgId);

    // All templates come from MongoDB now
    let availableTemplates = customTemplates;

    // Filter by category if specified
    if (category) {
      availableTemplates = availableTemplates.filter(template => template.category === category);
    }

    // Filter inactive templates if not requested
    if (includeInactive !== 'true') {
      availableTemplates = availableTemplates.filter(template => template.isActive);
    }

    res.json({
      templates: availableTemplates,
      total: availableTemplates.length
    });

  } catch (error) {
    log('error', 'Failed to get templates', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve templates',
      code: 'TEMPLATES_ERROR'
    });
  }
}));

// Get template categories
router.get('/categories', asyncHandler(async (req, res) => {
  try {
    const categories = await templates.getTemplateCategories(req.orgId);

    res.json({
      categories
    });

  } catch (error) {
    log('error', 'Failed to get template categories', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve template categories',
      code: 'CATEGORIES_ERROR'
    });
  }
}));

// Get specific template by ID (from MongoDB only)
router.get('/:templateId', asyncHandler(async (req, res) => {
  try {
    const { templateId } = req.params;

    // All templates are now in MongoDB
    const template = await data.getCustomTemplate(req.orgId, templateId);

    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
        code: 'TEMPLATE_NOT_FOUND'
      });
    }

    res.json({
      template
    });

  } catch (error) {
    log('error', 'Failed to get template', {
      templateId: req.params.templateId,
      error: error.message
    });
    res.status(500).json({
      error: 'Failed to retrieve template',
      code: 'TEMPLATE_ERROR'
    });
  }
}));

// Get templates by category
router.get('/category/:category', asyncHandler(async (req, res) => {
  try {
    const { category } = req.params;
    const { includeInactive = false } = req.query;

    let categoryTemplates = await templates.getTemplatesByCategory(req.orgId, category);

    // Filter inactive templates if not requested
    if (includeInactive !== 'true') {
      categoryTemplates = categoryTemplates.filter(template => template.isActive);
    }

    if (categoryTemplates.length === 0) {
      return res.status(404).json({
        error: 'No templates found for this category',
        code: 'NO_TEMPLATES_IN_CATEGORY'
      });
    }

    res.json({
      category,
      templates: categoryTemplates,
      total: categoryTemplates.length
    });

  } catch (error) {
    log('error', 'Failed to get templates by category', {
      category: req.params.category,
      error: error.message
    });
    res.status(500).json({
      error: 'Failed to retrieve templates by category',
      code: 'CATEGORY_TEMPLATES_ERROR'
    });
  }
}));

// Validate template configuration
router.post('/:templateId/validate', asyncHandler(async (req, res) => {
  try {
    const { templateId } = req.params;
    const overrides = req.body;

    const validation = await templates.validateTemplate(req.orgId, templateId, overrides);

    if (validation.valid) {
      res.json({
        valid: true,
        warnings: validation.warnings,
        template: validation.template
      });
    } else {
      res.status(400).json({
        valid: false,
        errors: validation.errors,
        warnings: validation.warnings,
        template: validation.template
      });
    }

  } catch (error) {
    log('error', 'Template validation failed', {
      templateId: req.params.templateId,
      error: error.message
    });
    res.status(500).json({
      error: 'Template validation failed',
      code: 'VALIDATION_ERROR'
    });
  }
}));

// Create integration from template
router.post('/:templateId/create', asyncHandler(async (req, res) => {
  try {
    const { templateId } = req.params;
    const overrides = req.body || {};

    // Get template from MongoDB
    const template = await data.getCustomTemplate(req.orgId, templateId);

    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
        code: 'TEMPLATE_NOT_FOUND'
      });
    }

    // Helper function to replace placeholders in strings
    const replacePlaceholders = (value, placeholders) => {
      if (typeof value !== 'string') return value;
      let result = value;
      Object.keys(placeholders || {}).forEach(key => {
        const placeholder = `{{${key}}}`;
        if (result.includes(placeholder)) {
          result = result.replace(new RegExp(placeholder, 'g'), placeholders[key] || '');
        }
      });
      return result;
    };

    // Helper function to replace placeholders in objects recursively
    const replacePlaceholdersInObject = (obj, placeholders) => {
      if (!obj || typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map(item => replacePlaceholdersInObject(item, placeholders));
      }

      const result = {};
      Object.keys(obj).forEach(key => {
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
    };

    // Build integration config from template with overrides
    const __KEEP_integrationConfig__ = {
      name: overrides.name || template.name,
      eventType: replacePlaceholders(overrides.eventType || template.eventType, overrides.placeholders),
      scope: overrides.scope || 'INCLUDE_CHILDREN',
      targetUrl: replacePlaceholders(overrides.targetUrl || template.targetUrl, overrides.placeholders),
      httpMethod: overrides.httpMethod || template.httpMethod,
      outgoingAuthType: overrides.outgoingAuthType || template.authType,
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
      description: overrides.description || template.description
    };

    // Save integration configuration
    const createdIntegration = await data.addIntegration(req.orgId, __KEEP_integrationConfig__);

    log('info', 'Integration created from template', {
      templateId,
      integrationId: createdIntegration.id,
      orgId: req.orgId,
      name: __KEEP_integrationConfig__.name
    });

    res.status(201).json({
      message: 'Integration created successfully from template',
      integration: createdIntegration,
      template: {
        id: templateId,
        name: template.name,
        category: template.category
      }
    });

  } catch (error) {
    log('error', 'Failed to create integration from template', {
      templateId: req.params.templateId,
      orgId: req.orgId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to create integration from template',
      code: 'CREATE_FAILED'
    });
  }
}));

// Preview integration configuration from template (without creating)
router.post('/:templateId/preview', asyncHandler(async (req, res) => {
  try {
    const { templateId } = req.params;
    const overrides = req.body;

    // Validate the template with overrides
    const validation = await templates.validateTemplate(req.orgId, templateId, overrides);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Template validation failed',
        code: 'VALIDATION_FAILED',
        errors: validation.errors
      });
    }

    // Create integration configuration preview
    const integrationPreview = await templates.createIntegrationFromTemplate(req.orgId, templateId, overrides);

    // Remove sensitive information from preview
    const safePreview = { ...integrationPreview };
    const authConfig = safePreview.outgoingAuthConfig || safePreview.authConfig;
    if (authConfig) {
      if (authConfig.apiKey) {
        authConfig.apiKey = '***HIDDEN***';
      }
      if (authConfig.clientSecret) {
        authConfig.clientSecret = '***HIDDEN***';
      }
      if (authConfig.token) {
        authConfig.token = '***HIDDEN***';
      }
      if (safePreview.outgoingAuthConfig) {
        safePreview.outgoingAuthConfig = authConfig;
      } else {
        safePreview.authConfig = authConfig;
      }
    }

    res.json({
      preview: safePreview,
      template: {
        id: templateId,
        name: validation.template.name,
        category: validation.template.category
      },
      warnings: validation.warnings
    });

  } catch (error) {
    log('error', 'Failed to preview template', {
      templateId: req.params.templateId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to preview template configuration',
      code: 'PREVIEW_FAILED'
    });
  }
}));

// Get integration template usage statistics
router.get('/stats/usage', asyncHandler(async (req, res) => {
  try {
    const integrations = await data.listIntegrations(req.orgId);
    const templateUsage = {};

    integrations.forEach(integration => {
      const templateId = integration.metadata?.templateId;
      if (templateId) {
        if (!templateUsage[templateId]) {
          templateUsage[templateId] = {
            templateId,
            templateName: integration.metadata?.templateName || 'Unknown',
            category: integration.metadata?.templateCategory || 'Unknown',
            count: 0,
            active: 0,
            inactive: 0
          };
        }

        templateUsage[templateId].count++;
        if (integration.isActive) {
          templateUsage[templateId].active++;
        } else {
          templateUsage[templateId].inactive++;
        }
      }
    });

    // Get all available templates for comparison
    const allTemplates = await templates.getAllTemplates(req.orgId);
    const templateStats = allTemplates.map(template => {
      const usage = templateUsage[template.id] || {
        count: 0,
        active: 0,
        inactive: 0
      };

      return {
        templateId: template.id,
        name: template.name,
        category: template.category,
        isActive: template.isActive,
        usage: {
          totalIntegrations: usage.count,
          activeIntegrations: usage.active,
          inactiveIntegrations: usage.inactive
        }
      };
    });

    // Sort by usage (most used first)
    templateStats.sort((a, b) => b.usage.totalIntegrations - a.usage.totalIntegrations);

    res.json({
      templateStats,
      summary: {
        totalTemplates: templateStats.length,
        activeTemplates: templateStats.filter(t => t.isActive).length,
        templatesInUse: templateStats.filter(t => t.usage.totalIntegrations > 0).length,
        totalIntegrationsFromTemplates: templateStats.reduce((sum, t) => sum + t.usage.totalIntegrations, 0)
      }
    });

  } catch (error) {
    log('error', 'Failed to get template usage stats', {
      orgId: req.orgId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve template usage statistics',
      code: 'USAGE_STATS_ERROR'
    });
  }
}));

// Clone and modify an existing template (for custom templates)
router.post('/:templateId/clone', asyncHandler(async (req, res) => {
  try {
    const { templateId } = req.params;
    const {
      newName,
      newDescription,
      modifications = {}
    } = req.body;

    if (!newName) {
      return res.status(400).json({
        error: 'New name is required for cloned template',
        code: 'NAME_REQUIRED'
      });
    }

    const originalTemplate = await templates.getTemplateById(req.orgId, templateId);
    if (!originalTemplate) {
      return res.status(404).json({
        error: 'Original template not found',
        code: 'TEMPLATE_NOT_FOUND'
      });
    }

    // Create custom template based on original
    const clonedTemplate = {
      ...originalTemplate,
      name: newName,
      description: newDescription || `Clone of ${originalTemplate.name}`,
      ...modifications,
      metadata: {
        ...originalTemplate.metadata,
        clonedFrom: templateId,
        clonedAt: new Date().toISOString(),
        customTemplate: true
      }
    };

    // Create integration from the cloned template
    const __KEEP_integrationConfig__ = await templates.createIntegrationFromTemplate(
      req.orgId,
      templateId,
      {
        name: newName,
        targetUrl: modifications.targetUrl,
        outgoingAuthType: modifications.outgoingAuthType || modifications.authType,
        outgoingAuthConfig: modifications.outgoingAuthConfig || modifications.authConfig,
        headers: modifications.headers,
        timeoutMs: modifications.timeoutMs,
        retryCount: modifications.retryCount,
        transformation: modifications.transformation,
        isActive: modifications.isActive !== undefined ? modifications.isActive : true,
        eventType: modifications.eventType,
        description: newDescription
      }
    );

    // Add template metadata to integration
    __KEEP_integrationConfig__.metadata = {
      ...__KEEP_integrationConfig__.metadata,
      customTemplate: true,
      originalTemplateId: templateId
    };

    const createdIntegration = await data.createIntegration(req.orgId, __KEEP_integrationConfig__);

    log('info', 'Template cloned and integration created', {
      originalTemplateId: templateId,
      integrationId: createdIntegration.id,
      orgId: req.orgId,
      newName
    });

    res.status(201).json({
      message: 'Template cloned and integration created successfully',
      integration: createdIntegration,
      template: {
        originalId: templateId,
        originalName: originalTemplate.name,
        newName: clonedTemplate.name
      }
    });

  } catch (error) {
    log('error', 'Failed to clone template', {
      templateId: req.params.templateId,
      orgId: req.orgId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to clone template',
      code: 'CLONE_FAILED'
    });
  }
}));

// Create custom template
router.post('/', asyncHandler(async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      eventType,
      targetUrl,
      httpMethod,
      authType,
      authConfig,
      headers,
      timeoutMs,
      retryCount,
      transformationMode,
      transformation,
      isActive,
      metadata
    } = req.body;

    // Validate required fields
    if (!name || !category || !eventType || !targetUrl || !httpMethod || !authType) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'VALIDATION_ERROR',
        required: ['name', 'category', 'eventType', 'targetUrl', 'httpMethod', 'authType']
      });
    }

    const template = await data.createTemplate(req.orgId, {
      name,
      description,
      category,
      eventType,
      targetUrl,
      httpMethod,
      authType,
      authConfig,
      headers,
      timeoutMs,
      retryCount,
      transformationMode,
      transformation,
      isActive,
      metadata
    });

    log('info', 'Custom template created', {
      templateId: template.id,
      orgId: req.orgId,
      name
    });

    await auditTemplate.created(req, template);

    res.status(201).json({
      message: 'Template created successfully',
      template
    });

  } catch (error) {
    log('error', 'Failed to create template', {
      orgId: req.orgId,
      error: error.message
    });
    res.status(500).json({
      error: 'Failed to create template',
      code: 'CREATE_ERROR'
    });
  }
}));

// Update custom template
router.put('/:templateId', asyncHandler(async (req, res) => {
  try {
    const { templateId } = req.params;

    // Only allow updating custom templates
    if (!templateId.startsWith('custom_')) {
      return res.status(403).json({
        error: 'Cannot modify built-in templates',
        code: 'FORBIDDEN'
      });
    }

    const beforeTemplate = await data.getCustomTemplate(req.orgId, templateId).catch(() => null);

    const {
      name,
      description,
      category,
      eventType,
      targetUrl,
      httpMethod,
      authType,
      authConfig,
      headers,
      timeoutMs,
      retryCount,
      transformationMode,
      transformation,
      isActive,
      metadata
    } = req.body;

    const updatedTemplate = await data.updateTemplate(req.orgId, templateId, {
      name,
      description,
      category,
      eventType,
      targetUrl,
      httpMethod,
      authType,
      authConfig,
      headers,
      timeoutMs,
      retryCount,
      transformationMode,
      transformation,
      isActive,
      metadata
    });

    if (!updatedTemplate) {
      return res.status(404).json({
        error: 'Template not found',
        code: 'TEMPLATE_NOT_FOUND'
      });
    }

    log('info', 'Custom template updated', {
      templateId,
      orgId: req.orgId
    });

    await auditTemplate.updated(req, templateId, { before: beforeTemplate, after: updatedTemplate });

    res.json({
      message: 'Template updated successfully',
      template: updatedTemplate
    });

  } catch (error) {
    log('error', 'Failed to update template', {
      templateId: req.params.templateId,
      orgId: req.orgId,
      error: error.message
    });
    res.status(500).json({
      error: 'Failed to update template',
      code: 'UPDATE_ERROR'
    });
  }
}));

// Delete custom template
router.delete('/:templateId', asyncHandler(async (req, res) => {
  try {
    const { templateId } = req.params;

    // Only allow deleting custom templates
    if (!templateId.startsWith('custom_')) {
      return res.status(403).json({
        error: 'Cannot delete built-in templates',
        code: 'FORBIDDEN'
      });
    }

    const beforeTemplate = await data.getCustomTemplate(req.orgId, templateId).catch(() => null);

    const deleted = await data.deleteTemplate(req.orgId, templateId);

    if (!deleted) {
      return res.status(404).json({
        error: 'Template not found',
        code: 'TEMPLATE_NOT_FOUND'
      });
    }

    log('info', 'Custom template deleted', {
      templateId,
      orgId: req.orgId
    });

    await auditTemplate.deleted(req, templateId, beforeTemplate);

    res.json({
      message: 'Template deleted successfully'
    });

  } catch (error) {
    log('error', 'Failed to delete template', {
      templateId: req.params.templateId,
      orgId: req.orgId,
      error: error.message
    });
    res.status(500).json({
      error: 'Failed to delete template',
      code: 'DELETE_ERROR'
    });
  }
}));

module.exports = router;
