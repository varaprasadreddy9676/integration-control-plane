const { log } = require('../logger');

// Semantic versioning utilities
class SemanticVersion {
  constructor(versionString) {
    if (!versionString || typeof versionString !== 'string') {
      throw new Error('Version string is required');
    }

    // Parse version string
    const cleanVersion = versionString.replace(/^v/, '');
    const parts = cleanVersion.split('.');

    if (parts.length < 3) {
      throw new Error('Invalid version format: major.min.patch');
    }

    this.major = parseInt(parts[0]) || 0;
    this.minor = parseInt(parts[1]) || 0;
    this.patch = parseInt(parts[2]) || 0;

    // Check for pre-release
    const prereleaseMatch = cleanVersion.match(/^(.*)-(.+)$/);
    if (prereleaseMatch) {
      this.prerelease = prereleaseMatch[1];
      this.baseVersion = prereleaseMatch[1];
    } else {
      this.prerelease = null;
      this.baseVersion = cleanVersion;
    }

    this.version = cleanVersion;
    this.toString = () => this.version;
  }

  static parse(versionString) {
    if (!versionString || typeof versionString !== 'string') {
      return null;
    }

    try {
      return new SemanticVersion(versionString);
    } catch (error) {
      log('warn', `Failed to parse version: ${versionString}`, { error: error.message });
      return null;
    }
  }

  static isValid(versionString) {
    try {
      const parsed = SemanticVersion.parse(versionString);
      return parsed && parsed.major >= 0 && parsed.minor >= 0 && parsed.patch >= 0;
    } catch (error) {
      return false;
    }
  }

  // Compare with another version
  compare(other) {
    if (!other || !(other instanceof SemanticVersion)) {
      return 0;
    }

    // Compare major version
    if (this.major !== other.major) {
      return this.major > other.major ? 1 : -1;
    }

    // Major versions equal, compare minor
    if (this.minor !== other.minor) {
      return this.minor > other.minor ? 1 : -1;
    }

    // Major and minor equal, compare patch
    return this.patch > other.patch ? 1 : -1;
  }

  // Check if this is a pre-release
  isPrerelease() {
    return this.prerelease !== null;
  }

  // Check if this is greater than another version
  greaterThan(other) {
    return this.compare(other) > 0;
  }

  // Check if this is less than another version
  lessThan(other) {
    return this.compare(other) < 0;
  }

  // Check if versions are equal
  equals(other) {
    return this.compare(other) === 0;
  }
}

// Version management service
class VersionManager {
  constructor(dataLayer) {
    this.data = dataLayer;
    this.cache = new Map(); // Cache version calculations for performance
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  // Generate next semantic version
  async generateNextVersion(__KEEP_integrationName__, currentVersion, strategy = 'SEMANTIC', increment = 'PATCH') {
    try {
      const current = new SemanticVersion(currentVersion);
      let nextVersion;

      switch (strategy) {
        case 'SEMANTIC':
          switch (increment) {
            case 'PATCH':
              nextVersion = new SemanticVersion(
                `${current.major}.${current.minor}.${current.patch + 1}`
              );
              break;
            case 'MINOR':
              nextVersion = new SemanticVersion(
                `${current.major}.${current.minor + 1}.0`
              );
              break;
            case 'MAJOR':
              nextVersion = new SemanticVersion(
                `${current.major + 1}.0.0`
              );
              break;
            default:
              throw new Error(`Invalid increment type: ${increment}`);
          }
          break;

        case 'TIMESTAMP':
          const now = new Date();
          const timestamp = now.getTime().toString();
          nextVersion = new SemanticVersion(timestamp);
          break;

        case 'MANUAL':
          throw new Error('Manual versioning not implemented yet');
          break;

        default:
          throw new Error(`Invalid versioning strategy: ${strategy}`);
      }

      return nextVersion.toString();
    } catch (error) {
      log('error', 'Failed to generate next version', {
        __KEEP_integrationName__,
        currentVersion,
        strategy,
        increment,
        error: error.message
      });
      throw error;
    }
  }

  // Get all versions of a integration
  async getIntegrationVersions(__KEEP_integrationName__, orgId, limit = 50, includeInactive = false, includePrerelease = false) {
    const cacheKey = `versions_${orgId}_${__KEEP_integrationName__}_${limit}_${includeInactive}_${includePrerelease}`;

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
      // Cache expired, continue to fetch
    }

    try {
      const integrations = await this.data.listIntegrations(orgId);
      const integrationVersions = integrations
        .filter(integration => integration.name === __KEEP_integrationName__ && (includeInactive || integration.isActive))
        .filter(integration => includePrerelease || !new SemanticVersion(integration.version || '1.0.0').isPrerelease())
        .map(integration => ({
          id: integration.id,
          name: integration.name,
          version: integration.version,
          versionNotes: integration.versionNotes,
          compatibilityMode: integration.compatibilityMode,
          isDefault: integration.isDefault,
          isPrerelease: integration.version ? new SemanticVersion(integration.version).isPrerelease() : false,
          isActive: integration.isActive,
          createdAt: integration.createdAt,
          updatedAt: integration.updatedAt,
          metadata: integration.metadata
        }))
        .sort((a, b) => {
          // Sort by semantic version (newest first)
          const versionA = a.version ? new SemanticVersion(a.version) : new SemanticVersion('0.0.0');
          const versionB = b.version ? new SemanticVersion(b.version) : new SemanticVersion('0.0.0');
          return versionB.greaterThan(versionA) ? -1 : 1;
        })
        .slice(0, parseInt(limit));

      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        data: integrationVersions
      });

      return integrationVersions;
    } catch (error) {
      log('error', 'Failed to retrieve integration versions', {
        __KEEP_integrationName__,
        orgId,
        error: error.message
      });
      throw error;
    }
  }

  // Get version compatibility matrix
  async getVersionCompatibilityMatrix(__KEEP_integrationName__, orgId) {
    try {
      const integrations = await this.data.listIntegrations(orgId);
      const targetIntegrations = integrations.filter(integration => integration.name === __KEEP_integrationName__);

      if (targetIntegrations.length === 0) {
        return {
          __KEEP_integrationName__,
          versions: [],
          compatibleVersions: [],
          incompatibleVersions: [],
          summary: {
            totalVersions: 0,
            activeVersions: 0,
            defaultVersion: null
          }
        };
      }

      // Analyze all versions
      const versions = targetIntegrations.map(integration => ({
        id: integration.id,
        version: integration.version,
        parsedVersion: new SemanticVersion(integration.version),
        isPrerelease: integration.version ? new SemanticVersion(integration.version).isPrerelease() : false,
        isActive: integration.isActive,
        isDefault: integration.isDefault,
        compatibilityMode: integration.compatibilityMode || 'BACKWARD_COMPATIBLE',
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt
      }));

      // Find the latest stable version
      const latestStable = versions
        .filter(v => !v.isPrerelease)
        .sort((a, b) => {
          const versionA = a.parsedVersion;
          const versionB = b.parsedVersion;
          return versionB.greaterThan(versionA) ? -1 : 1;
        })
        [0];

      const latestVersion = versions.length > 0 ? new SemanticVersion(latestStable[0].version) : null;

      // Check compatibility with latest version
      const compatibleVersions = versions.filter(v => {
        if (!latestVersion) return false;

        // Check semantic version compatibility rules
        const parsedLatest = latestVersion;
        const parsedCurrent = v.parsedVersion;

        // Major version must be <= latest major (for backward compatibility)
        if (parsedCurrent.major > parsedLatest.major) {
          return false;
        }

        // If major is equal, minor must be <= latest minor (for backward compatibility)
        if (parsedCurrent.major === parsedLatest.major && parsedCurrent.minor > parsedLatest.minor) {
          return false;
        }

        // If major and minor are equal, patch must be <= latest patch (for bug fixes)
        if (parsedCurrent.major === parsedLatest.major && parsedCurrent.minor === parsedLatest.minor && parsedCurrent.patch > parsedLatest.patch) {
          return false; // Current version has newer patches than latest
        }

        return true; // Compatible
      });

      const incompatibleVersions = versions.filter(v => !compatibleVersions.includes(v));

      const defaultVersion = versions.find(v => v.isDefault);

      return {
        __KEEP_integrationName__,
        versions: versions.map(v => ({
          id: v.id,
          version: v.version,
          versionNotes: v.versionNotes,
          isPrerelease: v.isPrerelease,
          isActive: v.isActive,
          isDefault: v.isDefault,
          compatibilityMode: v.compatibilityMode,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
          isCompatible: compatibleVersions.includes(v)
        })),
        compatibleVersions,
        incompatibleVersions,
        summary: {
          totalVersions: versions.length,
          activeVersions: versions.filter(v => v.isActive && compatibleVersions.includes(v)).length,
          defaultVersion,
          latestVersion: latestVersion?.toString(),
          defaultCompatibilityMode: defaultVersion?.compatibilityMode || 'BACKWARD_COMPATIBLE'
        }
      };

    } catch (error) {
      log('error', 'Failed to get version compatibility matrix', {
        __KEEP_integrationName__,
        orgId,
        error: error.message
      });
      throw error;
    }
  }

  // Check for breaking changes between versions
  checkForBreakingChanges(fromVersion, toVersion) {
    try {
      const from = new SemanticVersion(fromVersion);
      const to = new SemanticVersion(toVersion);

      const breakingChanges = [];

      // Major version bump = breaking change
      if (from.major < to.major) {
        breakingChanges.push({
          type: 'MAJOR',
          description: `Major version bump from ${from.toString()} to ${to.toString()}`,
          severity: 'BREAKING',
          recommendation: 'Review all integration configurations before upgrading'
        });
      }

      // Check for removed features in newer version
      if (from.major === to.major && from.minor > to.minor) {
        breakingChanges.push({
          type: 'FEATURE_REMOVAL',
          description: `Features may have been removed in version ${to.toString()}`,
          severity: 'WARNING',
          recommendation: 'Check integration configuration compatibility'
        });
      }

      // Check for added features in newer version
      if (from.major === to.major && from.minor < to.minor) {
        breakingChanges.push({
          type: 'FEATURE_ADDITION',
          description: `New features may have been added in version ${to.toString()}`,
          severity: 'INFO',
          recommendation: 'Review new features and migration guides'
        });
      }

      return {
        isBreaking: breakingChanges.some(change => change.severity === 'BREAKING'),
        hasWarnings: breakingChanges.some(change => change.severity === 'WARNING'),
        changes: breakingChanges,
        fromVersion: from.toString(),
        toVersion: to.toString()
      };

    } catch (error) {
      log('error', 'Failed to check for breaking changes', {
        fromVersion,
        toVersion,
        error: error.message
      });
      return {
        isBreaking: true,
        changes: []
      };
    }
  }

  // Suggest upgrade path for integration
  async getUpgradePath(__KEEP_integrationName__, fromVersion, toVersion, orgId) {
    try {
      const integrations = await this.data.listIntegrations(orgId);
      const integration = integrations.find(w => w.name === __KEEP_integrationName__);

      if (!integration) {
        throw new Error(`Integration not found: ${__KEEP_integrationName__}`);
      }

      const changes = this.checkForBreakingChanges(fromVersion, toVersion);

      // Determine upgrade strategy based on changes
      let strategy = 'GRADUAL';
      if (changes.isBreaking) {
        strategy = 'MANUAL';
      }

      // Generate upgrade recommendation
      const recommendation = {
        strategy,
        steps: [],
        prerequisites: [],
        estimatedDowntime: 0,
        rollbackPlan: changes.hasWarnings ? 'automatic' : 'manual'
      };

      if (strategy === 'MANUAL' && changes.isBreaking) {
        recommendation.steps.push('1. Review breaking changes in integration configurations');
        recommendation.steps.push('2. Create integration version backup');
        recommendation.steps.push('3. Test new version in staging environment');
        recommendation.steps.push('4. Update integration configuration with new version');
        recommendation.steps.push('5. Gradually migrate clients to new version');
        recommendation.prerequisites.push('Backup of existing configurations');
        recommendation.estimatedDowntime = 300; // 5 minutes estimated
      } else if (strategy === 'GRADUAL') {
        recommendation.steps.push('1. Deploy new integration version alongside existing version');
        recommendation.steps.push('2. Monitor delivery success rates');
        recommendation.steps.push('3. Gradually migrate clients to new version');
        recommendation.steps.push('4. Deprecate old version after transition period');
        recommendation.prerequisites.push('Client compatibility testing');
      }

      return {
        __KEEP_integrationName__,
        fromVersion,
        toVersion,
        changes,
        recommendation
      };

    } catch (error) {
      log('error', 'Failed to generate upgrade path', {
        __KEEP_integrationName__,
        fromVersion,
        toVersion,
        error: error.message
      });
      throw error;
    }
  }

  // Generate release notes
  generateReleaseNotes(fromVersion, toVersion, changes) {
    try {
      const releaseNotes = {
        version: toVersion,
        releaseDate: new Date().toISOString(),
        breaking: false,
        features: [],
        bugFixes: [],
        security: [],
        deprecations: [],
        migration: []
      };

      // Analyze changes to categorize them
      if (changes.hasWarnings || changes.isBreaking) {
        releaseNotes.breaking = true;
      }

      // Extract features, fixes, etc. based on changes
      // This would be expanded in a real implementation
      if (changes.hasWarnings) {
        releaseNotes.deprecations.push('Some features may be deprecated in future versions');
      }

      return releaseNotes;

    } catch (error) {
      log('error', 'Failed to generate release notes', {
        fromVersion,
        toVersion,
        error: error.message
      });
      return {
        version: toVersion,
        releaseDate: new Date().toISOString(),
        error: 'Failed to generate release notes'
      };
    }
  }

  // Clear version cache
  clearCache(__KEEP_integrationName__ = null) {
    const keysToDelete = [];
    for (const [key, value] of this.cache.entries()) {
      if (key.startsWith(`versions_${__KEEP_integrationName__}_`) && __KEEP_integrationName__ === null) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
}

module.exports = {
  SemanticVersion,
  VersionManager
};
