const express = require('express');
const { log } = require('../logger');
const data = require('../data');
const { auditVersion } = require('../middleware/audit');

const router = express.Router();

// Helper function to generate semantic version numbers
function _generateSemanticVersion(major = 1, minor = 0, patch = 0, prerelease = null) {
  let version = `${major}.${minor}.${patch}`;
  if (prerelease) {
    version += `-${prerelease}`;
  }
  return version;
}

// Helper function to parse semantic version strings
function parseSemanticVersion(version) {
  if (!version || typeof version !== 'string') {
    return null;
  }

  // Remove 'v' prefix if present
  const cleanVersion = version.replace(/^v/, '');

  // Handle prerelease versions (e.g., "1.0.0-alpha")
  const prereleaseMatch = cleanVersion.match(/^(.*)-(.+)$/);
  const baseVersion = prereleaseMatch ? prereleaseMatch[1] : cleanVersion;

  const parts = baseVersion.split('.');
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;

  return {
    version: cleanVersion,
    major,
    minor,
    patch,
    prerelease: prereleaseMatch ? prereleaseMatch[2] : null,
    isPrerelease: !!prereleaseMatch,
  };
}

// Helper function to compare semantic versions
function compareVersions(v1, v2) {
  const parsed1 = parseSemanticVersion(v1);
  const parsed2 = parseSemanticVersion(v2);

  if (!parsed1 || !parsed2) return 0;

  // Compare major versions
  if (parsed1.major !== parsed2.major) {
    return parsed1.major > parsed2.major ? 1 : -1;
  }

  // Compare minor versions if major is equal
  if (parsed1.minor !== parsed2.minor) {
    return parsed1.minor > parsed2.minor ? 1 : -1;
  }

  // Compare patch versions if major and minor are equal
  return parsed1.patch > parsed2.patch ? 1 : -1;
}

// Helper function to validate version format
function isValidVersion(version) {
  if (!version) return false;
  const parsed = parseSemanticVersion(version);
  return parsed && parsed.major >= 0 && parsed.minor >= 0 && parsed.patch >= 0;
}

function isInOrg(integration, orgId) {
  return integration?.orgId === orgId || integration?.orgUnitRid === orgId;
}

// Create integration with version tracking
router.post('/', async (req, res) => {
  try {
    const {
      integrationData,
      version,
      versionNotes,
      isPrerelease = false,
      isDefault = false,
      compatibilityMode = 'BACKWARD_COMPATIBLE', // BACKWARD_COMPATIBLE, STRICT, NONE
      tags = [],
    } = req.body;

    // Validate integration data
    const required = ['name', 'eventType', 'targetUrl', 'httpMethod'];
    const missing = required.filter((field) => !integrationData[field]);

    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'VALIDATION_ERROR',
        missing,
      });
    }

    // Validate version
    if (!isValidVersion(version)) {
      return res.status(400).json({
        error: 'Invalid version format',
        code: 'INVALID_VERSION',
        details: 'Version must follow semantic versioning (e.g., 1.0.0, 2.1.1-beta)',
      });
    }

    // Check for duplicate version if not prerelease
    if (!isPrerelease) {
      const existingVersions = await getIntegrationVersions(req.orgId, integrationData.name || 'unnamed');
      const duplicate = existingVersions.find((v) => v.version === version && !v.isPrerelease);

      if (duplicate) {
        return res.status(409).json({
          error: 'Version already exists',
          code: 'DUPLICATE_VERSION',
          existingVersion: duplicate.version,
        });
      }
    }

    // Create integration with version metadata
    const integrationPayload = {
      ...integrationData,
      // Remove any existing version from the integration data itself
      orgId: req.orgId,
      isActive: integrationData.isActive !== false,
      metadata: {
        ...integrationData.metadata,
        version,
        versionNotes,
        isPrerelease,
        isDefault,
        compatibilityMode,
        tags: Array.isArray(tags) ? tags : [],
        createdAt: new Date().toISOString(),
        versioning: {
          strategy: 'SEMANTIC',
          autoIncrement: false,
          major: parseSemanticVersion(version).major,
          minor: parseSemanticVersion(version).minor,
          patch: parseSemanticVersion(version).patch,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    const createdIntegration = await data.createIntegration(req.orgId, integrationPayload);

    log('info', 'Integration created with version', {
      integrationId: createdIntegration.id,
      name: integrationData.name,
      version,
      compatibilityMode,
    });

    await auditVersion.created(req, createdIntegration);

    // If this is marked as default, update other integrations of same name to not be default
    if (isDefault) {
      await updateDefaultVersionForName(req.orgId, integrationData.name, version, createdIntegration.id);
    }

    res.status(201).json({
      message: 'Integration version created successfully',
      integration: createdIntegration,
      version,
    });
  } catch (error) {
    log('error', 'Integration version creation failed', {
      error: error.message,
      __KEEP_integrationName__: req.body.integrationData?.name,
    });

    res.status(500).json({
      error: 'Failed to create integration version',
      code: 'VERSION_CREATE_ERROR',
    });
  }
});

// List all versions of a specific integration
router.get('/integration/:__KEEP_integrationName__/versions', async (req, res) => {
  try {
    const { __KEEP_integrationName__ } = req.params;
    const { limit = 50, includeInactive = false, includePrerelease = false } = req.query;

    const integrations = await data.listIntegrations(req.orgId);
    const integrationVersions = integrations
      .filter((integration) => isInOrg(integration, req.orgId) && integration.name === __KEEP_integrationName__)
      .map((integration) => ({
        id: integration.id,
        name: integration.name,
        version: integration.metadata?.version || '1.0.0',
        versionNotes: integration.metadata?.versionNotes || '',
        isPrerelease: integration.metadata?.isPrerelease || false,
        isDefault: integration.metadata?.isDefault || false,
        isActive: integration.isActive,
        compatibilityMode: integration.metadata?.compatibilityMode || 'BACKWARD_COMPATIBLE',
        tags: integration.metadata?.tags || [],
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt,
        metadata: {
          versioning: integration.metadata?.versioning,
          templateId: integration.metadata?.templateId,
        },
      }))
      .filter((version) => {
        if (!includePrerelease && version.isPrerelease) return false;
        if (!includeInactive && !version.isActive) return false;
        return true;
      })
      .sort((a, b) => {
        // Sort by semantic version (descending)
        const versionA = parseSemanticVersion(a.version);
        const versionB = parseSemanticVersion(b.version);

        if (!versionA || !versionB) return 0;

        // Compare major first
        if (versionA.major !== versionB.major) {
          return versionB.major - versionA.major;
        }

        // Compare minor if major is equal
        if (versionA.minor !== versionB.minor) {
          return versionB.minor - versionA.minor;
        }

        // Compare patch if major and minor are equal
        return versionB.patch - versionA.patch;
      })
      .slice(0, parseInt(limit, 10));

    const summary = {
      __KEEP_integrationName__,
      totalVersions: integrationVersions.length,
      activeVersions: integrationVersions.filter((v) => v.isActive).length,
      defaultVersion: integrationVersions.find((v) => v.isDefault),
    };

    res.json({
      versions: integrationVersions,
      summary,
      pagination: {
        limit: parseInt(limit, 10),
        hasMore: integrationVersions.length > parseInt(limit, 10),
      },
    });
  } catch (error) {
    log('error', 'Failed to retrieve integration versions', {
      error: error.message,
      __KEEP_integrationName__: req.params.__KEEP_integrationName__,
    });

    res.status(500).json({
      error: 'Failed to retrieve integration versions',
      code: 'VERSION_LIST_ERROR',
    });
  }
});

// Get specific version of a integration
router.get('/integration/:__KEEP_integrationName__/version/:version', async (req, res) => {
  try {
    const { __KEEP_integrationName__, version } = req.params;

    const integrations = await data.listIntegrations(req.orgId);
    const targetIntegration = integrations.find(
      (integration) =>
        isInOrg(integration, req.orgId) &&
        integration.name === __KEEP_integrationName__ &&
        integration.metadata?.version === version
    );

    if (!targetIntegration) {
      return res.status(404).json({
        error: 'Integration version not found',
        code: 'VERSION_NOT_FOUND',
      });
    }

    res.json({
      integration: targetIntegration,
    });
  } catch (error) {
    log('error', 'Failed to retrieve integration version', {
      error: error.message,
      __KEEP_integrationName__: req.params.__KEEP_integrationName__,
      version: req.params.version,
    });

    res.status(500).json({
      error: 'Failed to retrieve integration version',
      code: 'VERSION_GET_ERROR',
    });
  }
});

// Update integration to new version
router.put('/integration/:__KEEP_integrationName__/version/:version', async (req, res) => {
  try {
    const { __KEEP_integrationName__, version } = req.params;
    const {
      versionNotes,
      isPrerelease = false,
      isDefault = false,
      compatibilityMode,
      tags,
      deactivationMode = 'IMMEDIATE', // IMMEDIATE, SCHEDULED, NEVER
      deactivationDelay = 0, // seconds
    } = req.body;

    const integrations = await data.listIntegrations(req.orgId);
    const currentIntegration = integrations.find(
      (integration) =>
        isInOrg(integration, req.orgId) && integration.name === __KEEP_integrationName__ && integration.isActive
    );

    if (!currentIntegration) {
      return res.status(404).json({
        error: 'Active integration not found',
        code: 'WEBHOOK_NOT_FOUND',
      });
    }

    // Create new version
    const newVersionIntegration = {
      name: currentIntegration.name,
      eventType: currentIntegration.eventType,
      orgId: currentIntegration.orgId || req.orgId,
      entityName: currentIntegration.entityName,
      scope: currentIntegration.scope,
      targetUrl: currentIntegration.targetUrl,
      httpMethod: currentIntegration.httpMethod,
      outgoingAuthType: currentIntegration.outgoingAuthType || currentIntegration.authType,
      outgoingAuthConfig: currentIntegration.outgoingAuthConfig || currentIntegration.authConfig,
      timeoutMs: currentIntegration.timeoutMs,
      retryCount: currentIntegration.retryCount,
      transformationMode: currentIntegration.transformationMode,
      transformation: currentIntegration.transformation,
      isActive: true,
      metadata: {
        ...currentIntegration.metadata,
        version,
        versionNotes,
        isPrerelease,
        isDefault,
        compatibilityMode,
        tags: Array.isArray(tags) ? tags : [],
        createdAt: new Date().toISOString(),
        versioning: {
          strategy: 'SEMANTIC',
          autoIncrement: false,
          major: parseSemanticVersion(version).major,
          minor: parseSemanticVersion(version).minor,
          patch: parseSemanticVersion(version).patch,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    // Handle deactivation of previous version
    if (deactivationMode === 'IMMEDIATE') {
      // Deactivate current version immediately
      const deactivatedIntegration = await data.updateIntegration(req.orgId, currentIntegration.id, {
        isActive: false,
      });

      if (deactivatedIntegration) {
        log('info', 'Previous integration version deactivated', {
          integrationId: currentIntegration.id,
          __KEEP_integrationName__,
          oldVersion: currentIntegration.metadata?.version,
          newVersion: version,
        });
      } else {
        log('warn', 'Failed to deactivate previous integration version', {
          integrationId: currentIntegration.id,
          __KEEP_integrationName__,
        });
      }
    } else if (deactivationMode === 'SCHEDULED') {
      // Schedule deactivation for later
      const deactivationTime = new Date(Date.now() + deactivationDelay * 1000);

      log('info', 'Scheduled integration version deactivation', {
        integrationId: currentIntegration.id,
        __KEEP_integrationName__,
        deactivationTime: deactivationTime.toISOString(),
        delay: deactivationDelay,
      });

      // This would require a background job system
      // For now, just log the scheduled deactivation
      // In production, this would be handled by a queue system
    }

    // Create new version
    const createdIntegration = await data.createIntegration(req.orgId, newVersionIntegration);

    log('info', 'Integration version updated', {
      integrationId: currentIntegration.id,
      __KEEP_integrationName__,
      oldVersion: currentIntegration.metadata?.version,
      newVersion: version,
      deactivationMode,
    });

    await auditVersion.updated(req, currentIntegration.id, {
      before: currentIntegration,
      after: createdIntegration,
      fromVersion: currentIntegration.metadata?.version,
      toVersion: version,
    });

    res.json({
      message: 'Integration version updated successfully',
      previousIntegration: {
        id: currentIntegration.id,
        isDeactivated:
          deactivationMode === 'IMMEDIATE'
            ? !(await data.getIntegrationById(req.orgId, currentIntegration.id))?.isActive
            : false,
      },
      newIntegration: createdIntegration,
      version,
    });
  } catch (error) {
    log('error', 'Failed to update integration version', {
      error: error.message,
      __KEEP_integrationName__: req.params.__KEEP_integrationName__,
      version: req.params.version,
    });

    res.status(500).json({
      error: 'Failed to update integration version',
      code: 'VERSION_UPDATE_ERROR',
    });
  }
});

// Activate/deactivate specific integration version
router.patch('/integration/:__KEEP_integrationName__/version/:version/status', async (req, res) => {
  try {
    const { __KEEP_integrationName__, version } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        error: 'isActive must be a boolean',
        code: 'INVALID_STATUS',
      });
    }

    const integrations = await data.listIntegrations(req.orgId);
    const targetIntegration = integrations.find(
      (integration) =>
        isInOrg(integration, req.orgId) &&
        integration.name === __KEEP_integrationName__ &&
        integration.metadata?.version === version
    );

    if (!targetIntegration) {
      return res.status(404).json({
        error: 'Integration version not found',
        code: 'VERSION_NOT_FOUND',
      });
    }

    const updatedIntegration = await data.updateIntegration(req.orgId, targetIntegration.id, { isActive });

    log('info', 'Integration version status updated', {
      integrationId: targetIntegration.id,
      __KEEP_integrationName__,
      version,
      status: isActive ? 'activated' : 'deactivated',
    });

    await auditVersion.statusChanged(req, targetIntegration.id, { isActive, version, name: __KEEP_integrationName__ });

    res.json({
      message: `Integration version ${isActive ? 'activated' : 'deactivated'} successfully`,
      integration: updatedIntegration,
      version,
    });
  } catch (error) {
    log('error', 'Failed to update integration version status', {
      error: error.message,
      __KEEP_integrationName__: req.params.__KEEP_integrationName__,
      version: req.params.version,
    });

    res.status(500).json({
      error: 'Failed to update integration version status',
      code: 'VERSION_STATUS_ERROR',
    });
  }
});

// Set default version for integration
router.put('/integration/:__KEEP_integrationName__/default', async (req, res) => {
  try {
    const { __KEEP_integrationName__ } = req.params;
    const { version } = req.body;

    if (!version) {
      return res.status(400).json({
        error: 'Version is required',
        code: 'VERSION_REQUIRED',
      });
    }

    if (!isValidVersion(version)) {
      return res.status(400).json({
        error: 'Invalid version format',
        code: 'INVALID_VERSION',
      });
    }

    await updateDefaultVersionForName(req.orgId, __KEEP_integrationName__, version);

    log('info', 'Default integration version updated', {
      __KEEP_integrationName__,
      version,
    });

    await auditVersion.defaultSet(req, __KEEP_integrationName__, version);

    res.json({
      message: 'Default integration version updated successfully',
      __KEEP_integrationName__,
      version,
    });
  } catch (error) {
    log('error', 'Failed to update default integration version', {
      error: error.message,
      __KEEP_integrationName__: req.params.__KEEP_integrationName__,
    });

    res.status(500).json({
      error: 'Failed to update default integration version',
      code: 'DEFAULT_VERSION_ERROR',
    });
  }
});

// Delete integration version
router.delete('/integration/:__KEEP_integrationName__/version/:version', async (req, res) => {
  try {
    const { __KEEP_integrationName__, version } = req.params;
    const { force = false } = req.query;

    const integrations = await data.listIntegrations(req.orgId);
    const targetIntegration = integrations.find(
      (integration) =>
        isInOrg(integration, req.orgId) &&
        integration.name === __KEEP_integrationName__ &&
        integration.metadata?.version === version
    );

    if (!targetIntegration) {
      return res.status(404).json({
        error: 'Integration version not found',
        code: 'VERSION_NOT_FOUND',
      });
    }

    // Prevent deletion of default version unless forced
    if (targetIntegration.metadata?.isDefault && !force) {
      return res.status(409).json({
        error: 'Cannot delete default version',
        code: 'CANNOT_DELETE_DEFAULT',
        details: 'Use ?force=true to override this restriction',
      });
    }

    const deleted = await data.deleteIntegration(req.orgId, targetIntegration.id);

    if (deleted) {
      log('info', 'Integration version deleted', {
        integrationId: targetIntegration.id,
        __KEEP_integrationName__,
        version,
        isDefault: targetIntegration.metadata?.isDefault || false,
      });

      await auditVersion.deleted(req, targetIntegration.id, targetIntegration);

      res.json({
        message: 'Integration version deleted successfully',
        integrationId: targetIntegration.id,
        __KEEP_integrationName__,
        version,
      });
    } else {
      res.status(500).json({
        error: 'Failed to delete integration version',
        code: 'VERSION_DELETE_ERROR',
      });
    }
  } catch (error) {
    log('error', 'Failed to delete integration version', {
      error: error.message,
      __KEEP_integrationName__: req.params.__KEEP_integrationName__,
      version: req.params.version,
    });

    res.status(500).json({
      error: 'Failed to delete integration version',
      code: 'VERSION_DELETE_ERROR',
    });
  }
});

// Compare two integration versions
router.get('/integration/:__KEEP_integrationName__/compare/:v1/:v2', async (req, res) => {
  try {
    const { __KEEP_integrationName__, v1, v2 } = req.params;

    const integrations = await data.listIntegrations(req.orgId);
    const integration1 = integrations.find(
      (integration) =>
        isInOrg(integration, req.orgId) &&
        integration.name === __KEEP_integrationName__ &&
        integration.metadata?.version === v1
    );

    const integration2 = integrations.find(
      (integration) =>
        isInOrg(integration, req.orgId) &&
        integration.name === __KEEP_integrationName__ &&
        integration.metadata?.version === v2
    );

    if (!integration1 || !integration2) {
      return res.status(404).json({
        error: 'One or both integration versions not found',
        code: 'VERSION_NOT_FOUND',
      });
    }

    const parsed1 = parseSemanticVersion(v1);
    const parsed2 = parseSemanticVersion(v2);

    const comparison = {
      __KEEP_integrationName__,
      versions: {
        v1: {
          version: v1,
          parsed: parsed1,
          integration: {
            id: integration1.id,
            name: integration1.name,
            isActive: integration1.isActive,
            createdAt: integration1.createdAt,
            updatedAt: integration1.updatedAt,
          },
        },
        v2: {
          version: v2,
          parsed: parsed2,
          integration: {
            id: integration2.id,
            name: integration2.name,
            isActive: integration2.isActive,
            createdAt: integration2.createdAt,
            updatedAt: integration2.updatedAt,
          },
        },
      },
      comparison: {
        direction: compareVersions(v1, v2) > 0 ? 'v2 is newer' : 'v1 is newer or equal',
        difference: Math.abs(compareVersions(v1, v2)),
        compatibility: checkCompatibility(parsed1, parsed2),
      },
    };

    res.json(comparison);
  } catch (error) {
    log('error', 'Failed to compare integration versions', {
      error: error.message,
      __KEEP_integrationName__: req.params.__KEEP_integrationName__,
      versions: [req.params.v1, req.params.v2],
    });

    res.status(500).json({
      error: 'Failed to compare integration versions',
      code: 'VERSION_COMPARE_ERROR',
    });
  }
});

// Get version compatibility info
router.get('/integration/:__KEEP_integrationName__/compatibility/:version', async (req, res) => {
  try {
    const { __KEEP_integrationName__, version } = req.params;

    const integrations = await data.listIntegrations(req.orgId);
    const integrationVersions = integrations
      .filter((integration) => isInOrg(integration, req.orgId) && integration.name === __KEEP_integrationName__)
      .sort((a, b) => {
        const versionA = parseSemanticVersion(a.metadata?.version || '1.0.0');
        const versionB = parseSemanticVersion(b.metadata?.version || '1.0.0');
        return compareVersions(versionA, versionB);
      })
      .reverse();

    const targetVersion = integrationVersions.find((w) => w.metadata?.version === version);
    if (!targetVersion) {
      return res.status(404).json({
        error: 'Integration version not found',
        code: 'VERSION_NOT_FOUND',
      });
    }

    const targetParsed = parseSemanticVersion(version);

    // Check backward compatibility
    const compatibleVersions = integrationVersions.filter((w) => {
      const wp = parseSemanticVersion(w.metadata?.version || '1.0.0');
      return isBackwardCompatible(wp, targetParsed);
    });

    const incompatibleVersions = integrationVersions.filter((w) => {
      const wp = parseSemanticVersion(w.metadata?.version || '1.0.0');
      return !isBackwardCompatible(wp, targetParsed);
    });

    const compatibility = {
      targetVersion: version,
      targetParsed,
      totalVersions: integrationVersions.length,
      compatibleVersions: compatibleVersions.map((w) => w.metadata?.version),
      incompatibleVersions: incompatibleVersions.map((w) => w.metadata?.version),
      isDefault: targetVersion?.metadata?.isDefault || false,
      compatibilityMode: targetVersion?.metadata?.compatibilityMode || 'BACKWARD_COMPATIBLE',
    };

    res.json({
      __KEEP_integrationName__,
      compatibility,
      allVersions: integrationVersions.map((w) => ({
        version: w.metadata?.version || '1.0.0',
        parsed: parseSemanticVersion(w.metadata?.version || '1.0.0'),
        isCompatible: isBackwardCompatible(parseSemanticVersion(w.metadata?.version || '1.0.0'), targetParsed),
      })),
    });
  } catch (error) {
    log('error', 'Failed to check version compatibility', {
      error: error.message,
      __KEEP_integrationName__: req.params.__KEEP_integrationName__,
      version: req.params.version,
    });

    res.status(500).json({
      error: 'Failed to check version compatibility',
      code: 'COMPATIBILITY_CHECK_ERROR',
    });
  }
});

// Rollback to previous version
router.post('/integration/:__KEEP_integrationName__/rollback/:version', async (req, res) => {
  try {
    const { __KEEP_integrationName__, version } = req.params;
    const { rollbackReason, force = false } = req.body;

    const integrations = await data.listIntegrations(req.orgId);
    const targetIntegration = integrations.find(
      (integration) =>
        isInOrg(integration, req.orgId) &&
        integration.name === __KEEP_integrationName__ &&
        integration.metadata?.version === version
    );

    if (!targetIntegration) {
      return res.status(404).json({
        error: 'Integration version not found',
        code: 'VERSION_NOT_FOUND',
      });
    }

    // Find the current active version
    const currentActiveVersion = integrations.find(
      (integration) =>
        isInOrg(integration, req.orgId) && integration.name === __KEEP_integrationName__ && integration.isActive
    );

    if (!currentActiveVersion) {
      return res.status(409).json({
        error: 'No active integration version found to rollback from',
        code: 'NO_ACTIVE_VERSION',
      });
    }

    // Prevent rollback to newer version unless forced
    const currentVersionParsed = parseSemanticVersion(currentActiveVersion.metadata?.version || '1.0.0');
    const targetVersionParsed = parseSemanticVersion(version);
    const isRollbackToOlder = compareVersions(targetVersionParsed, currentVersionParsed) < 0;

    if (!isRollbackToOlder && !force) {
      return res.status(409).json({
        error: 'Cannot rollback to newer version',
        code: 'CANNOT_ROLLBACK_TO_NEWER',
        details: 'Target version is newer than current active version. Use ?force=true to override.',
      });
    }

    // Activate the rollback version and deactivate current
    const [rollbackIntegration, deactivatedIntegration] = await Promise.all([
      data.updateIntegration(req.orgId, targetIntegration.id, { isActive: true }),
      data.updateIntegration(req.orgId, currentActiveVersion.id, { isActive: false }),
    ]);

    log('info', 'Integration version rollback completed', {
      integrationId: targetIntegration.id,
      __KEEP_integrationName__,
      fromVersion: currentActiveVersion.metadata?.version,
      toVersion: version,
      rollbackReason,
      forced: isRollbackToOlder,
    });

    await auditVersion.rolledBack(req, targetIntegration.id, {
      fromVersion: currentActiveVersion.metadata?.version,
      toVersion: version,
      rollbackReason,
    });

    res.json({
      message: 'Integration version rollback completed successfully',
      rollback: {
        fromVersion: currentActiveVersion.metadata?.version,
        toVersion: version,
        rollbackIntegration,
        deactivatedIntegration,
      },
    });
  } catch (error) {
    log('error', 'Failed to rollback integration version', {
      error: error.message,
      __KEEP_integrationName__: req.params.__KEEP_integrationName__,
      version: req.params.version,
    });

    res.status(500).json({
      error: 'Failed to rollback integration version',
      code: 'ROLLBACK_ERROR',
    });
  }
});

// Helper functions
async function getIntegrationVersions(orgId, __KEEP_integrationName__) {
  try {
    const integrations = await data.listIntegrations(orgId);
    return integrations
      .filter((integration) => isInOrg(integration, orgId) && integration.name === __KEEP_integrationName__)
      .map((integration) => ({
        version: integration.metadata?.version || '1.0.0',
        isPrerelease: integration.metadata?.isPrerelease || false,
      }))
      .filter((meta) => meta.version && isValidVersion(meta.version));
  } catch (error) {
    log('error', 'Failed to get integration versions', {
      error: error.message,
      __KEEP_integrationName__,
    });
    return [];
  }
}

async function updateDefaultVersionForName(orgId, __KEEP_integrationName__, version, excludeIntegrationId = null) {
  try {
    const integrations = await data.listIntegrations(orgId);

    // Clear existing default flag
    const updates = integrations
      .filter(
        (integration) =>
          isInOrg(integration, orgId) &&
          integration.name === __KEEP_integrationName__ &&
          integration.metadata?.isDefault &&
          integration.id !== excludeIntegrationId
      )
      .map((integration) => ({
        id: integration.id,
        isDefault: false,
        metadata: { ...(integration.metadata || {}), isDefault: false },
      }));

    // Set new default
    const newDefaultIntegration = integrations.find(
      (integration) =>
        isInOrg(integration, orgId) &&
        integration.name === __KEEP_integrationName__ &&
        integration.metadata?.version === version
    );

    if (newDefaultIntegration) {
      updates.push({
        id: newDefaultIntegration.id,
        isDefault: true,
        metadata: { ...(newDefaultIntegration.metadata || {}), isDefault: true },
      });
    }

    // Update all integrations
    for (const update of updates) {
      await data.updateIntegration(orgId, update.id, { isDefault: update.isDefault, metadata: update.metadata });
    }

    if (updates.length > 0) {
      log('info', 'Default integration version updated', {
        __KEEP_integrationName__,
        version,
        updatedCount: updates.length,
      });
    }

    return true;
  } catch (error) {
    log('error', 'Failed to update default integration version', {
      error: error.message,
      __KEEP_integrationName__,
      version,
    });
    return false;
  }
}

function isBackwardCompatible(fromVersion, toVersion) {
  // Semantic versioning rules:
  // - Major version bumps are breaking changes
  // - Minor version bumps are additive (backward compatible)
  // - Patch version bumps are bug fixes (backward compatible)
  // - Pre-release versions are not subject to these rules

  if (fromVersion.major > toVersion.major) {
    return false; // Breaking change
  }

  if (fromVersion.major < toVersion.major) {
    return true; // Target is newer major version
  }

  // Same major version
  if (fromVersion.minor > toVersion.minor) {
    return false; // Target has fewer features
  }

  return true; // Same major, target has same or more features
}

function checkCompatibility(fromVersion, toVersion) {
  if (fromVersion.major < toVersion.major) {
    return 'BREAKING'; // Breaking change
  }

  if (fromVersion.major === toVersion.major && fromVersion.minor > toVersion.minor) {
    return 'INCOMPATIBLE'; // Target missing features
  }

  if (fromVersion.major === toVersion.major && fromVersion.minor < toVersion.minor) {
    return 'COMPATIBLE'; // Target has additional features
  }

  if (fromVersion.major === toVersion.major && fromVersion.minor === toVersion.minor) {
    return 'FULLY_COMPATIBLE'; // Same feature set
  }

  return 'UNKNOWN';
}

module.exports = router;
