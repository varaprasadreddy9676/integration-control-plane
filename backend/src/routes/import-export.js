const express = require('express');
const { log } = require('../logger');
const data = require('../data');
const templates = require('../data/templates');
const asyncHandler = require('../utils/async-handler');
const { auditData } = require('../middleware/audit');

const router = express.Router();

// Export outbound integrations to JSON format
router.get(
  '/outbound-integrations.json',
  asyncHandler(async (req, res) => {
    try {
      const { includeInactive = false, includeSensitive = false, integrationIds, format = 'standard' } = req.query;

      const integrations = integrationIds
        ? await Promise.all(integrationIds.split(',').map((id) => data.getIntegrationById(req.orgId, id.trim())))
        : await data.listIntegrations(req.orgId);

      // Filter integrations based on parameters
      const filteredIntegrations = integrations
        .filter((integration) => integration && (includeInactive === 'true' || integration.isActive))
        .map((integration) => sanitizeIntegrationForExport(integration, includeSensitive === 'true', format));

      const exportData = {
        metadata: {
          exportedAt: new Date().toISOString(),
          exportedBy: req.user?.id || 'system',
          orgId: req.orgId,
          format: format,
          version: '1.0',
          totalIntegrations: filteredIntegrations.length,
        },
        integrations: filteredIntegrations,
      };

      // Set appropriate headers
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="outbound-integrations-${new Date().toISOString().split('T')[0]}.json"`
      );

      res.json(exportData);
    } catch (error) {
      log('error', 'Integration export failed', {
        orgId: req.orgId,
        error: error.message,
      });

      res.status(500).json({
        error: 'Export failed',
        code: 'EXPORT_ERROR',
      });
    }
  })
);

// Export outbound integrations to CSV format
router.get(
  '/outbound-integrations.csv',
  asyncHandler(async (req, res) => {
    try {
      const { includeInactive = false, integrationIds } = req.query;

      const integrations = integrationIds
        ? await Promise.all(integrationIds.split(',').map((id) => data.getIntegrationById(req.orgId, id.trim())))
        : await data.listIntegrations(req.orgId);

      // Filter integrations
      const filteredIntegrations = integrations.filter(
        (integration) => integration && (includeInactive === 'true' || integration.isActive)
      );

      // CSV headers
      const headers = [
        'id',
        'name',
        'description',
        'targetUrl',
        'httpMethod',
        'authType',
        'eventType',
        'isActive',
        'timeoutMs',
        'retryCount',
        'transformationMode',
        'createdAt',
        'updatedAt',
        'orgId',
        'scope',
        'templateId',
      ];

      // Convert integrations to CSV rows
      const csvRows = filteredIntegrations.map((integration) => [
        integration.id || '',
        integration.name || '',
        integration.description || '',
        integration.targetUrl || '',
        integration.httpMethod || '',
        integration.outgoingAuthType || integration.authType || '',
        Array.isArray(integration.type) ? integration.type.join(';') : integration.type || '',
        integration.isActive ? 'true' : 'false',
        integration.timeoutMs || '',
        integration.retryCount || '',
        integration.transformationMode || '',
        integration.createdAt || '',
        integration.updatedAt || '',
        integration.orgId || '',
        integration.scope || '',
        integration.metadata?.templateId || '',
      ]);

      // Build CSV content
      const csvContent = [
        headers.join(','),
        ...csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      // Set appropriate headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="outbound-integrations-${new Date().toISOString().split('T')[0]}.csv"`
      );

      res.send(csvContent);
    } catch (error) {
      log('error', 'Integration CSV export failed', {
        orgId: req.orgId,
        error: error.message,
      });

      res.status(500).json({
        error: 'CSV export failed',
        code: 'CSV_EXPORT_ERROR',
      });
    }
  })
);

// Export templates as configuration
router.get(
  '/templates',
  asyncHandler(async (req, res) => {
    try {
      const { templateIds, includeCustom = false } = req.query;

      const allTemplates = await templates.getAllTemplates(req.orgId);
      let selectedTemplates = allTemplates;

      if (templateIds) {
        const requestedIds = templateIds.split(',').map((id) => id.trim());
        selectedTemplates = allTemplates.filter((template) => requestedIds.includes(template.id));
      }

      // Filter out custom/inactive templates unless explicitly requested
      if (includeCustom !== 'true') {
        selectedTemplates = selectedTemplates.filter((template) => template.isActive);
      }

      const exportData = {
        metadata: {
          exportedAt: new Date().toISOString(),
          exportedBy: req.user?.id || 'system',
          format: 'templates',
          version: '1.0',
          totalTemplates: selectedTemplates.length,
        },
        templates: selectedTemplates.map((template) => ({
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          eventType: template.eventType,
          targetUrl: template.targetUrl,
          httpMethod: template.httpMethod,
          authType: template.authType,
          headers: template.headers,
          timeoutMs: template.timeoutMs,
          retryCount: template.retryCount,
          transformationMode: template.transformationMode,
          transformation: template.transformation,
          metadata: template.metadata,
        })),
      };

      // Set appropriate headers
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="templates-${new Date().toISOString().split('T')[0]}.json"`
      );

      res.json(exportData);
    } catch (error) {
      log('error', 'Template export failed', {
        orgId: req.orgId,
        error: error.message,
      });

      res.status(500).json({
        error: 'Template export failed',
        code: 'TEMPLATE_EXPORT_ERROR',
      });
    }
  })
);

// Import outbound integrations from JSON
router.post(
  '/outbound-integrations.json',
  asyncHandler(async (req, res) => {
    try {
      const {
        importData,
        options = {
          validateFirst: true,
          continueOnError: false,
          updateExisting: false,
          preserveIds: false,
          activateImported: true,
        },
      } = req.body;

      // Validate import data structure
      if (!importData || !importData.integrations || !Array.isArray(importData.integrations)) {
        return res.status(400).json({
          error: 'Invalid import data format',
          code: 'INVALID_IMPORT_FORMAT',
        });
      }

      if (importData.integrations.length === 0) {
        return res.status(400).json({
          error: 'No integrations to import',
          code: 'EMPTY_IMPORT',
        });
      }

      if (importData.integrations.length > 100) {
        return res.status(400).json({
          error: 'Cannot import more than 100 integrations at once',
          code: 'TOO_MANY_WEBHOOKS',
        });
      }

      const results = {
        successful: [],
        failed: [],
        updated: [],
        skipped: [],
        summary: {
          total: importData.integrations.length,
          successful: 0,
          failed: 0,
          updated: 0,
          skipped: 0,
        },
      };

      // Process each integration
      for (let i = 0; i < importData.integrations.length; i++) {
        const importedIntegration = importData.integrations[i];

        try {
          // Prepare integration for import
          const integrationForImport = prepareIntegrationForImport(importedIntegration, options, req.orgId);

          // Check if integration already exists
          const existingIntegration =
            options.updateExisting && importedIntegration.id
              ? await data.getIntegrationById(req.orgId, importedIntegration.id)
              : null;

          if (existingIntegration) {
            // Update existing integration
            const updatedIntegration = await data.updateIntegration(
              req.orgId,
              importedIntegration.id,
              integrationForImport
            );

            if (updatedIntegration) {
              results.updated.push({
                index: i,
                integrationId: importedIntegration.id,
                integration: updatedIntegration,
                action: 'updated',
              });
              results.summary.updated++;
            } else {
              results.failed.push({
                index: i,
                integrationId: importedIntegration.id,
                error: 'Failed to update existing integration',
              });
              results.summary.failed++;
            }
          } else {
            // Create new integration
            const createdIntegration = await data.createIntegration(req.orgId, integrationForImport);

            results.successful.push({
              index: i,
              integration: createdIntegration,
              action: 'created',
            });
            results.summary.successful++;
          }
        } catch (error) {
          results.failed.push({
            index: i,
            integration: importedIntegration,
            error: error.message,
          });
          results.summary.failed++;

          if (!options.continueOnError) {
            break;
          }
        }
      }

      log('info', 'Integration import completed', {
        orgId: req.orgId,
        importFormat: 'json',
        summary: results.summary,
        importMetadata: importData.metadata,
      });

      await auditData.imported(req, 'integrations', results.summary);

      res.status(200).json({
        message: 'Import completed',
        results,
        importMetadata: importData.metadata,
      });
    } catch (error) {
      log('error', 'Integration import failed', {
        orgId: req.orgId,
        error: error.message,
      });

      res.status(500).json({
        error: 'Import failed',
        code: 'IMPORT_ERROR',
      });
    }
  })
);

// Import outbound integrations from templates
router.post(
  '/outbound-integrations.from-templates',
  asyncHandler(async (req, res) => {
    try {
      const {
        templateIntegrations,
        options = {
          validateFirst: true,
          continueOnError: false,
          activateAll: true,
        },
      } = req.body;

      if (!Array.isArray(templateIntegrations)) {
        return res.status(400).json({
          error: 'templateIntegrations must be an array',
          code: 'INVALID_INPUT',
        });
      }

      if (templateIntegrations.length > 50) {
        return res.status(400).json({
          error: 'Cannot import more than 50 template integrations at once',
          code: 'TOO_MANY_TEMPLATE_WEBHOOKS',
        });
      }

      const results = {
        successful: [],
        failed: [],
        summary: {
          total: templateIntegrations.length,
          successful: 0,
          failed: 0,
        },
      };

      // Process each template integration
      for (let i = 0; i < templateIntegrations.length; i++) {
        const { templateId, overrides = {} } = templateIntegrations[i];

        if (!templateId) {
          results.failed.push({
            index: i,
            error: 'templateId is required',
          });
          results.summary.failed++;
          continue;
        }

        try {
          // Validate template
          const template = await templates.getTemplateById(req.orgId, templateId);
          if (!template) {
            throw new Error(`Template not found: ${templateId}`);
          }

          // Set active status from options
          if (typeof options.activateAll === 'boolean') {
            overrides.isActive = options.activateAll;
          }

          // Create integration from template
          const __KEEP_integrationConfig__ = await templates.createIntegrationFromTemplate(
            req.orgId,
            templateId,
            overrides
          );

          const createdIntegration = await data.createIntegration(req.orgId, __KEEP_integrationConfig__);

          results.successful.push({
            index: i,
            templateId,
            integration: createdIntegration,
            action: 'created',
          });
          results.summary.successful++;
        } catch (error) {
          results.failed.push({
            index: i,
            templateId,
            error: error.message,
          });
          results.summary.failed++;

          if (!options.continueOnError) {
            break;
          }
        }
      }

      log('info', 'Template integration import completed', {
        orgId: req.orgId,
        summary: results.summary,
      });

      await auditData.imported(req, 'template-integrations', results.summary);

      res.status(200).json({
        message: 'Template import completed',
        results,
      });
    } catch (error) {
      log('error', 'Template integration import failed', {
        orgId: req.orgId,
        error: error.message,
      });

      res.status(500).json({
        error: 'Template import failed',
        code: 'TEMPLATE_IMPORT_ERROR',
      });
    }
  })
);

// Validate import data without importing
router.post('/validate', (req, res) => {
  try {
    const { importData, format = 'json' } = req.body;

    if (!importData) {
      return res.status(400).json({
        error: 'No import data provided',
        code: 'NO_DATA',
      });
    }

    const validation = validateImportData(importData, format);

    res.json({
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      summary: validation.summary,
    });
  } catch (error) {
    log('error', 'Import validation failed', {
      orgId: req.orgId,
      error: error.message,
    });

    res.status(500).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
    });
  }
});

// Helper functions
function sanitizeIntegrationForExport(integration, includeSensitive = false, format = 'standard') {
  const sanitized = {
    name: integration.name,
    description: integration.description,
    targetUrl: integration.targetUrl,
    httpMethod: integration.httpMethod,
    authType: integration.outgoingAuthType || integration.authType,
    eventType: integration.type,
    isActive: integration.isActive,
    timeoutMs: integration.timeoutMs,
    retryCount: integration.retryCount,
    transformationMode: integration.transformationMode,
    headers: integration.headers,
    metadata: integration.metadata || {},
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };

  // Include ID for standard format
  if (format === 'standard') {
    sanitized.id = integration.id;
  }

  // Include sensitive data only if requested
  if (includeSensitive) {
    sanitized.authConfig = integration.outgoingAuthConfig || integration.authConfig;
    sanitized.transformation = integration.transformation;
  } else {
    // Mask sensitive data
    if (integration.outgoingAuthConfig || integration.authConfig) {
      sanitized.authConfig = maskAuthConfig(integration.outgoingAuthConfig || integration.authConfig);
    }
    if (integration.transformation) {
      sanitized.transformation = {
        mode: integration.transformationMode,
        hasScript: !!integration.transformation.script,
        scriptLength: integration.transformation.script?.length || 0,
      };
    }
  }

  return sanitized;
}

function maskAuthConfig(authConfig) {
  const masked = { ...authConfig };

  if (masked.apiKey) {
    masked.apiKey = maskKey(masked.apiKey);
  }
  if (masked.clientSecret) {
    masked.clientSecret = maskKey(masked.clientSecret);
  }
  if (masked.token) {
    masked.token = maskKey(masked.token);
  }
  if (masked.password) {
    masked.password = maskKey(masked.password);
  }

  return masked;
}

function maskKey(key) {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.substring(0, 4) + '*'.repeat(key.length - 8) + key.substring(key.length - 4);
}

function prepareIntegrationForImport(importedIntegration, options, orgId) {
  const prepared = { ...importedIntegration };

  // Remove system fields that shouldn't be imported
  delete prepared.id;
  delete prepared.createdAt;
  delete prepared.updatedAt;

  // Normalize org identity
  prepared.orgId = orgId;

  // Normalize auth fields to outgoingAuthType/outgoingAuthConfig
  if (prepared.authType && !prepared.outgoingAuthType) {
    prepared.outgoingAuthType = prepared.authType === 'BEARER_TOKEN' ? 'BEARER' : prepared.authType;
  }
  if (prepared.authConfig && !prepared.outgoingAuthConfig) {
    prepared.outgoingAuthConfig = prepared.authConfig;
  }
  if (prepared.headers && !prepared.outgoingAuthConfig && prepared.outgoingAuthType === 'CUSTOM_HEADERS') {
    prepared.outgoingAuthConfig = { headers: prepared.headers };
  }

  // Apply options
  if (typeof options.activateImported === 'boolean') {
    prepared.isActive = options.activateImported;
  }

  // Ensure transformation is properly formatted
  if (prepared.transformation && typeof prepared.transformation === 'object') {
    if (prepared.transformation.script) {
      prepared.transformationMode = 'SCRIPT';
    }
  }

  // Clean up metadata
  if (prepared.metadata) {
    prepared.metadata = {
      ...prepared.metadata,
      importedAt: new Date().toISOString(),
      importedFrom: 'bulk_import',
    };
  }

  return prepared;
}

function validateImportData(importData, format) {
  const errors = [];
  const warnings = [];
  let valid = true;

  if (format === 'json') {
    if (!importData.integrations) {
      errors.push('Missing integrations array in import data');
      valid = false;
    } else if (!Array.isArray(importData.integrations)) {
      errors.push('integrations must be an array');
      valid = false;
    } else {
      // Validate each integration
      importData.integrations.forEach((integration, index) => {
        if (!integration.name) {
          errors.push(`Integration at index ${index}: Missing name`);
          valid = false;
        }
        if (!integration.targetUrl) {
          errors.push(`Integration at index ${index}: Missing targetUrl`);
          valid = false;
        } else if (!isValidUrl(integration.targetUrl)) {
          errors.push(`Integration at index ${index}: Invalid targetUrl`);
          valid = false;
        }
        if (!integration.type) {
          warnings.push(`Integration at index ${index}: Missing eventType`);
        }
      });
    }
  }

  return {
    valid,
    errors,
    warnings,
    summary: {
      totalIntegrations: importData.integrations?.length || 0,
      format: format,
      version: importData.metadata?.version || 'unknown',
    },
  };
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

module.exports = router;
