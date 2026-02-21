const express = require('express');
const { log } = require('../logger');
const data = require('../data');
const templates = require('../data/templates');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();

// Bulk create outbound integrations
router.post('/outbound-integrations', asyncHandler(async (req, res) => {
  try {
    const { integrations, validateFirst = true, continueOnError = false } = req.body;

    if (!Array.isArray(integrations)) {
      return res.status(400).json({
        error: 'integrations must be an array',
        code: 'INVALID_INPUT'
      });
    }

    if (integrations.length === 0) {
      return res.status(400).json({
        error: 'integrations array cannot be empty',
        code: 'EMPTY_ARRAY'
      });
    }

    if (integrations.length > 100) {
      return res.status(400).json({
        error: 'Cannot process more than 100 integrations in a single bulk operation',
        code: 'TOO_MANY_WEBHOOKS'
      });
    }

    const results = {
      successful: [],
      failed: [],
      summary: {
        total: integrations.length,
        successful: 0,
        failed: 0
      }
    };

    // Validate all integrations first if requested
    if (validateFirst) {
      const validationResults = [];
      for (let i = 0; i < integrations.length; i++) {
        const integration = integrations[i];
        const validation = validateIntegration(integration);
        validationResults.push({
          index: i,
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings
        });
      }

      const invalidIntegrations = validationResults.filter(r => !r.valid);
      if (invalidIntegrations.length > 0 && !continueOnError) {
        return res.status(400).json({
          error: 'Validation failed for one or more integrations',
          code: 'VALIDATION_FAILED',
          errors: invalidIntegrations.map(r => ({
            index: r.index,
            errors: r.errors
          }))
        });
      }

      // Skip invalid integrations if continueOnError is true
      const validIndexes = validationResults
        .filter(r => r.valid)
        .map(r => r.index);

      const validIntegrations = validIndexes.map(i => integrations[i]);
      const invalidIndexes = validationResults
        .filter(r => !r.valid)
        .map(r => r.index);

      // Add failed entries for invalid integrations
      for (const index of invalidIndexes) {
        results.failed.push({
          index,
          integration: integrations[index],
          error: 'Validation failed',
          errors: validationResults.find(r => r.index === index).errors
        });
        results.summary.failed++;
      }

      // Process only valid integrations
      for (let i = 0; i < validIntegrations.length; i++) {
        const integration = validIntegrations[i];
        const originalIndex = validIndexes[i];

        try {
          const createdIntegration = await data.createIntegration(req.orgId, integration);
          results.successful.push({
            index: originalIndex,
            integration: createdIntegration
          });
          results.summary.successful++;
        } catch (error) {
          results.failed.push({
            index: originalIndex,
            integration,
            error: error.message
          });
          results.summary.failed++;
        }
      }
    } else {
      // Process without validation
      for (let i = 0; i < integrations.length; i++) {
        const integration = integrations[i];

        try {
          const createdIntegration = await data.createIntegration(req.orgId, integration);
          results.successful.push({
            index: i,
            integration: createdIntegration
          });
          results.summary.successful++;
        } catch (error) {
          results.failed.push({
            index: i,
            integration,
            error: error.message
          });
          results.summary.failed++;

          if (!continueOnError) {
            // Stop processing on first error
            break;
          }
        }
      }
    }

    log('info', 'Bulk integration creation completed', {
      orgId: req.orgId,
      summary: results.summary
    });

    res.status(200).json({
      message: 'Bulk operation completed',
      results
    });

  } catch (error) {
    log('error', 'Bulk integration creation failed', {
      orgId: req.orgId,
      error: error.message
    });

    res.status(500).json({
      error: 'Bulk operation failed',
      code: 'BULK_CREATE_ERROR'
    });
  }
}));

// Bulk create outbound integrations from templates
router.post('/outbound-integrations/from-templates', asyncHandler(async (req, res) => {
  try {
    const { integrations, validateFirst = true, continueOnError = false } = req.body;

    if (!Array.isArray(integrations)) {
      return res.status(400).json({
        error: 'integrations must be an array',
        code: 'INVALID_INPUT'
      });
    }

    if (integrations.length > 50) {
      return res.status(400).json({
        error: 'Cannot process more than 50 template integrations in a single bulk operation',
        code: 'TOO_MANY_TEMPLATE_WEBHOOKS'
      });
    }

    const results = {
      successful: [],
      failed: [],
      summary: {
        total: integrations.length,
        successful: 0,
        failed: 0
      }
    };

    // Validate all template integrations first if requested
    if (validateFirst) {
      const validationResults = [];
      for (let i = 0; i < integrations.length; i++) {
        const { templateId, overrides = {} } = integrations[i];

        if (!templateId) {
          validationResults.push({
            index: i,
            valid: false,
            errors: ['templateId is required'],
            warnings: []
          });
          continue;
        }

        const validation = await templates.validateTemplate(req.orgId, templateId, overrides);
        validationResults.push({
          index: i,
          templateId,
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings
        });
      }

      const invalidIntegrations = validationResults.filter(r => !r.valid);
      if (invalidIntegrations.length > 0 && !continueOnError) {
        return res.status(400).json({
          error: 'Template validation failed for one or more integrations',
          code: 'TEMPLATE_VALIDATION_FAILED',
          errors: invalidIntegrations.map(r => ({
            index: r.index,
            templateId: r.templateId,
            errors: r.errors
          }))
        });
      }

      // Process valid integrations
      const validIndexes = validationResults
        .filter(r => r.valid)
        .map(r => r.index);

      const invalidIndexes = validationResults
        .filter(r => !r.valid)
        .map(r => r.index);

      // Add failed entries for invalid integrations
      for (const index of invalidIndexes) {
        const failedIntegration = integrations[index];
        results.failed.push({
          index,
          templateId: failedIntegration.templateId,
          overrides: failedIntegration.overrides,
          error: 'Template validation failed',
          errors: validationResults.find(r => r.index === index).errors
        });
        results.summary.failed++;
      }

      // Process only valid integrations
      for (let i = 0; i < validIndexes.length; i++) {
        const integration = integrations[validIndexes[i]];
        const originalIndex = validIndexes[i];

        try {
          const __KEEP_integrationConfig__ = await templates.createIntegrationFromTemplate(
            req.orgId,
            integration.templateId,
            integration.overrides
          );

          const createdIntegration = await data.createIntegration(req.orgId, __KEEP_integrationConfig__);
          results.successful.push({
            index: originalIndex,
            templateId: integration.templateId,
            integration: createdIntegration
          });
          results.summary.successful++;
        } catch (error) {
          results.failed.push({
            index: originalIndex,
            templateId: integration.templateId,
            overrides: integration.overrides,
            error: error.message
          });
          results.summary.failed++;
        }
      }
    } else {
      // Process without validation
      for (let i = 0; i < integrations.length; i++) {
        const integration = integrations[i];

        try {
          const __KEEP_integrationConfig__ = await templates.createIntegrationFromTemplate(
            req.orgId,
            integration.templateId,
            integration.overrides
          );

          const createdIntegration = await data.createIntegration(req.orgId, __KEEP_integrationConfig__);
          results.successful.push({
            index: i,
            templateId: integration.templateId,
            integration: createdIntegration
          });
          results.summary.successful++;
        } catch (error) {
          results.failed.push({
            index: i,
            templateId: integration.templateId,
            overrides: integration.overrides,
            error: error.message
          });
          results.summary.failed++;

          if (!continueOnError) {
            break;
          }
        }
      }
    }

    log('info', 'Bulk integration creation from templates completed', {
      orgId: req.orgId,
      summary: results.summary
    });

    res.status(200).json({
      message: 'Bulk template operation completed',
      results
    });

  } catch (error) {
    log('error', 'Bulk integration creation from templates failed', {
      orgId: req.orgId,
      error: error.message
    });

    res.status(500).json({
      error: 'Bulk template operation failed',
      code: 'BULK_TEMPLATE_ERROR'
    });
  }
}));

// Bulk update outbound integrations
router.put('/outbound-integrations', asyncHandler(async (req, res) => {
  try {
    const { updates, validateFirst = true, continueOnError = false } = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({
        error: 'updates must be an array',
        code: 'INVALID_INPUT'
      });
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'updates array cannot be empty',
        code: 'EMPTY_ARRAY'
      });
    }

    if (updates.length > 100) {
      return res.status(400).json({
        error: 'Cannot process more than 100 integration updates in a single bulk operation',
        code: 'TOO_MANY_UPDATES'
      });
    }

    const results = {
      successful: [],
      failed: [],
      summary: {
        total: updates.length,
        successful: 0,
        failed: 0
      }
    };

    // Validate all updates first if requested
    if (validateFirst) {
      const validationResults = [];
      for (let i = 0; i < updates.length; i++) {
        const update = updates[i];

        if (!update.id) {
          validationResults.push({
            index: i,
            valid: false,
            errors: ['Integration ID is required for updates']
          });
          continue;
        }

        // Validate the update patch
        const validation = validateIntegrationUpdate(update);
        validationResults.push({
          index: i,
          integrationId: update.id,
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings
        });
      }

      const invalidUpdates = validationResults.filter(r => !r.valid);
      if (invalidUpdates.length > 0 && !continueOnError) {
        return res.status(400).json({
          error: 'Update validation failed for one or more integrations',
          code: 'UPDATE_VALIDATION_FAILED',
          errors: invalidUpdates.map(r => ({
            index: r.index,
            integrationId: r.integrationId,
            errors: r.errors
          }))
        });
      }

      // Process valid updates
      for (let i = 0; i < validationResults.length; i++) {
        const validationResult = validationResults[i];
        if (!validationResult.valid) {
          results.failed.push({
            index: validationResult.index,
            integrationId: validationResult.integrationId,
            error: 'Update validation failed',
            errors: validationResult.errors
          });
          results.summary.failed++;
          continue;
        }

        const update = updates[validationResult.index];
        try {
          const updatedIntegration = await data.updateIntegration(
            req.orgId,
            update.id,
            update
          );

          if (updatedIntegration) {
            results.successful.push({
              index: validationResult.index,
              integrationId: update.id,
              integration: updatedIntegration
            });
            results.summary.successful++;
          } else {
            results.failed.push({
              index: validationResult.index,
              integrationId: update.id,
              error: 'Integration not found or no permission to update'
            });
            results.summary.failed++;
          }
        } catch (error) {
          results.failed.push({
            index: validationResult.index,
            integrationId: update.id,
            error: error.message
          });
          results.summary.failed++;
        }
      }
    } else {
      // Process without validation
      for (let i = 0; i < updates.length; i++) {
        const update = updates[i];

        if (!update.id) {
          results.failed.push({
            index: i,
            error: 'Integration ID is required for updates'
          });
          results.summary.failed++;
          continue;
        }

        try {
          const updatedIntegration = await data.updateIntegration(
            req.orgId,
            update.id,
            update
          );

          if (updatedIntegration) {
            results.successful.push({
              index: i,
              integrationId: update.id,
              integration: updatedIntegration
            });
            results.summary.successful++;
          } else {
            results.failed.push({
              index: i,
              integrationId: update.id,
              error: 'Integration not found or no permission to update'
            });
            results.summary.failed++;
          }
        } catch (error) {
          results.failed.push({
            index: i,
            integrationId: update.id,
            error: error.message
          });
          results.summary.failed++;

          if (!continueOnError) {
            break;
          }
        }
      }
    }

    log('info', 'Bulk integration updates completed', {
      orgId: req.orgId,
      summary: results.summary
    });

    res.status(200).json({
      message: 'Bulk update operation completed',
      results
    });

  } catch (error) {
    log('error', 'Bulk integration updates failed', {
      orgId: req.orgId,
      error: error.message
    });

    res.status(500).json({
      error: 'Bulk update operation failed',
      code: 'BULK_UPDATE_ERROR'
    });
  }
}));

// Bulk delete outbound integrations
router.delete('/outbound-integrations', asyncHandler(async (req, res) => {
  try {
    const { integrationIds, confirm = false } = req.body;

    if (!Array.isArray(integrationIds)) {
      return res.status(400).json({
        error: 'integrationIds must be an array',
        code: 'INVALID_INPUT'
      });
    }

    if (integrationIds.length === 0) {
      return res.status(400).json({
        error: 'integrationIds array cannot be empty',
        code: 'EMPTY_ARRAY'
      });
    }

    if (integrationIds.length > 100) {
      return res.status(400).json({
        error: 'Cannot process more than 100 integration deletions in a single bulk operation',
        code: 'TOO_MANY_DELETIONS'
      });
    }

    if (!confirm) {
      return res.status(400).json({
        error: 'Deletion confirmation required. Set confirm: true to proceed.',
        code: 'CONFIRMATION_REQUIRED'
      });
    }

    const results = {
      successful: [],
      failed: [],
      summary: {
        total: integrationIds.length,
        successful: 0,
        failed: 0
      }
    };

    for (let i = 0; i < integrationIds.length; i++) {
      const integrationId = integrationIds[i];

      try {
        const deleted = await data.deleteIntegration(req.orgId, integrationId);

        if (deleted) {
          results.successful.push({
            index: i,
            integrationId
          });
          results.summary.successful++;
        } else {
          results.failed.push({
            index: i,
            integrationId,
            error: 'Integration not found or no permission to delete'
          });
          results.summary.failed++;
        }
      } catch (error) {
        results.failed.push({
          index: i,
          integrationId,
          error: error.message
        });
        results.summary.failed++;
      }
    }

    log('info', 'Bulk integration deletions completed', {
      orgId: req.orgId,
      summary: results.summary
    });

    res.status(200).json({
      message: 'Bulk delete operation completed',
      results
    });

  } catch (error) {
    log('error', 'Bulk integration deletions failed', {
      orgId: req.orgId,
      error: error.message
    });

    res.status(500).json({
      error: 'Bulk delete operation failed',
      code: 'BULK_DELETE_ERROR'
    });
  }
}));

// Bulk toggle outbound integration status (activate/deactivate)
router.patch('/outbound-integrations/status', asyncHandler(async (req, res) => {
  try {
    const { integrationIds, isActive, continueOnError = false } = req.body;

    if (!Array.isArray(integrationIds)) {
      return res.status(400).json({
        error: 'integrationIds must be an array',
        code: 'INVALID_INPUT'
      });
    }

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        error: 'isActive must be a boolean',
        code: 'INVALID_STATUS'
      });
    }

    if (integrationIds.length === 0) {
      return res.status(400).json({
        error: 'integrationIds array cannot be empty',
        code: 'EMPTY_ARRAY'
      });
    }

    if (integrationIds.length > 100) {
      return res.status(400).json({
        error: 'Cannot process more than 100 integration status changes in a single bulk operation',
        code: 'TOO_MANY_STATUS_CHANGES'
      });
    }

    const results = {
      successful: [],
      failed: [],
      summary: {
        total: integrationIds.length,
        successful: 0,
        failed: 0
      }
    };

    for (let i = 0; i < integrationIds.length; i++) {
      const integrationId = integrationIds[i];

      try {
        const updatedIntegration = await data.updateIntegration(
          req.orgId,
          integrationId,
          { isActive }
        );

        if (updatedIntegration) {
          results.successful.push({
            index: i,
            integrationId,
            previousStatus: !isActive,
            newStatus: isActive,
            integration: updatedIntegration
          });
          results.summary.successful++;
        } else {
          results.failed.push({
            index: i,
            integrationId,
            error: 'Integration not found or no permission to update'
          });
          results.summary.failed++;

          if (!continueOnError) {
            break;
          }
        }
      } catch (error) {
        results.failed.push({
          index: i,
          integrationId,
          error: error.message
        });
        results.summary.failed++;

        if (!continueOnError) {
          break;
        }
      }
    }

    const action = isActive ? 'activation' : 'deactivation';
    log('info', `Bulk integration ${action} completed`, {
      orgId: req.orgId,
      summary: results.summary
    });

    res.status(200).json({
      message: `Bulk ${action} operation completed`,
      results
    });

  } catch (error) {
    log('error', 'Bulk integration status changes failed', {
      orgId: req.orgId,
      error: error.message
    });

    res.status(500).json({
      error: 'Bulk status change operation failed',
      code: 'BULK_STATUS_ERROR'
    });
  }
}));

// Validation helper functions
function validateIntegration(integration) {
  const errors = [];
  const warnings = [];

  // Required fields
  if (!integration.name || typeof integration.name !== 'string') {
    errors.push('Name is required and must be a string');
  }

  if (!integration.targetUrl || typeof integration.targetUrl !== 'string') {
    errors.push('Target URL is required and must be a string');
  } else if (!isValidUrl(integration.targetUrl)) {
    errors.push('Target URL must be a valid HTTP/HTTPS URL');
  }

  if (!integration.type || !(typeof integration.type === 'string' || Array.isArray(integration.type))) {
    errors.push('Event type is required and must be a string or array');
  }

  // Optional field validations
  if (integration.timeoutMs && (typeof integration.timeoutMs !== 'number' || integration.timeoutMs < 1000 || integration.timeoutMs > 60000)) {
    warnings.push('Timeout should be a number between 1000 and 60000 milliseconds');
  }

  if (integration.retryCount && (typeof integration.retryCount !== 'number' || integration.retryCount < 0 || integration.retryCount > 10)) {
    warnings.push('Retry count should be a number between 0 and 10');
  }

  if (integration.httpMethod && !['GET', 'POST', 'PUT', 'PATCH'].includes(integration.httpMethod)) {
    errors.push('HTTP method must be one of: GET, POST, PUT, PATCH');
  }

  const authType = integration.outgoingAuthType || integration.authType;
  if (authType && !['NONE', 'API_KEY', 'BEARER', 'BEARER_TOKEN', 'OAUTH2', 'BASIC', 'CUSTOM', 'CUSTOM_HEADERS'].includes(authType)) {
    errors.push('Auth type must be one of: NONE, API_KEY, BEARER, OAUTH2, BASIC, CUSTOM, CUSTOM_HEADERS');
  }

  if (integration.transformationMode && !['NONE', 'SIMPLE', 'SCRIPT'].includes(integration.transformationMode)) {
    errors.push('Transformation mode must be one of: NONE, SIMPLE, SCRIPT');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function validateIntegrationUpdate(update) {
  const errors = [];
  const warnings = [];

  // Validate allowed fields
  const allowedFields = [
    'name', 'targetUrl', 'httpMethod', 'outgoingAuthType', 'outgoingAuthConfig', 'authType', 'authConfig',
    'headers', 'timeoutMs', 'retryCount', 'transformationMode', 'actions',
    'transformation', 'isActive', 'eventType', 'description', 'scope'
  ];

  const updateFields = Object.keys(update).filter(key => key !== 'id');
  const invalidFields = updateFields.filter(field => !allowedFields.includes(field));

  if (invalidFields.length > 0) {
    errors.push(`Invalid fields: ${invalidFields.join(', ')}`);
  }

  // Validate specific field values
  if (update.targetUrl && !isValidUrl(update.targetUrl)) {
    errors.push('Target URL must be a valid HTTP/HTTPS URL');
  }

  if (update.timeoutMs && (typeof update.timeoutMs !== 'number' || update.timeoutMs < 1000 || update.timeoutMs > 60000)) {
    warnings.push('Timeout should be a number between 1000 and 60000 milliseconds');
  }

  if (update.retryCount && (typeof update.retryCount !== 'number' || update.retryCount < 0 || update.retryCount > 10)) {
    warnings.push('Retry count should be a number between 0 and 10');
  }

  if (update.httpMethod && !['GET', 'POST', 'PUT', 'PATCH'].includes(update.httpMethod)) {
    errors.push('HTTP method must be one of: GET, POST, PUT, PATCH');
  }

  const updateAuthType = update.outgoingAuthType || update.authType;
  if (updateAuthType && !['NONE', 'API_KEY', 'BEARER', 'BEARER_TOKEN', 'OAUTH2', 'BASIC', 'CUSTOM', 'CUSTOM_HEADERS'].includes(updateAuthType)) {
    errors.push('Auth type must be one of: NONE, API_KEY, BEARER, OAUTH2, BASIC, CUSTOM, CUSTOM_HEADERS');
  }

  if (update.transformationMode && !['NONE', 'SIMPLE', 'SCRIPT'].includes(update.transformationMode)) {
    errors.push('Transformation mode must be one of: NONE, SIMPLE, SCRIPT');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
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
