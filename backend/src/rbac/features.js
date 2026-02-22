/**
 * Feature-Based RBAC System - Simple & Clean
 *
 * Each feature has standard operations: read, write, delete, configure
 * Roles are just simple mappings to features
 */

// ==========================================
// AVAILABLE FEATURES
// ==========================================

const FEATURES = {
  DASHBOARD: 'dashboard',
  INTEGRATIONS: 'integrations',
  LOGS: 'logs',
  EVENTS: 'events',
  EXECUTION_LOGS: 'execution_logs',
  DLQ: 'dlq',
  SCHEDULED_JOBS: 'scheduled_jobs',
  LOOKUP_TABLES: 'lookup_tables',
  TEMPLATES: 'templates',
  USERS: 'users',
  AI: 'ai',
  AI_CONFIG: 'ai_config',
  ANALYTICS: 'analytics',
  SETTINGS: 'settings',
  SYSTEM_HEALTH: 'system_health',
  AUDIT_LOGS: 'audit_logs',
  API_KEYS: 'api_keys',
  ALERTS: 'alerts',
  DAILY_REPORTS: 'daily_reports',
};

// ==========================================
// STANDARD OPERATIONS (same for all features)
// ==========================================

const OPERATIONS = {
  READ: 'read', // View/List
  WRITE: 'write', // Create/Edit
  DELETE: 'delete', // Delete/Remove
  EXECUTE: 'execute', // Run/Test/Execute
  CONFIGURE: 'configure', // Configure settings (for AI, Settings, etc.)
  EXPORT: 'export', // Export data
};

// ==========================================
// ROLE DEFINITIONS (Simple Feature Mapping)
// ==========================================

const ROLE_FEATURES = {
  // ============================================================
  // SUPER_ADMIN - Full access to everything
  // ============================================================
  SUPER_ADMIN: {
    name: 'Super Admin',
    description: 'Full system access across all organizations',
    scope: 'global',
    features: {
      [FEATURES.DASHBOARD]: ['read', 'export'],
      [FEATURES.INTEGRATIONS]: ['read', 'write', 'delete', 'execute'],
      [FEATURES.LOGS]: ['read', 'export', 'delete'],
      [FEATURES.EVENTS]: ['read', 'write', 'delete'],
      [FEATURES.EXECUTION_LOGS]: ['read', 'export'],
      [FEATURES.DLQ]: ['read', 'write', 'delete', 'execute'],
      [FEATURES.SCHEDULED_JOBS]: ['read', 'write', 'delete', 'execute'],
      [FEATURES.LOOKUP_TABLES]: ['read', 'write', 'delete', 'export'],
      [FEATURES.TEMPLATES]: ['read', 'write', 'delete'],
      [FEATURES.USERS]: ['read', 'write', 'delete'],
      [FEATURES.AI]: ['read', 'write', 'execute'],
      [FEATURES.AI_CONFIG]: ['read', 'write', 'configure'],
      [FEATURES.ANALYTICS]: ['read', 'export'],
      [FEATURES.SETTINGS]: ['read', 'write', 'configure'],
      [FEATURES.SYSTEM_HEALTH]: ['read'],
      [FEATURES.AUDIT_LOGS]: ['read', 'export'],
      [FEATURES.API_KEYS]: ['read', 'write', 'delete'],
      [FEATURES.ALERTS]: ['read', 'write', 'configure'],
      [FEATURES.DAILY_REPORTS]: ['read', 'write', 'configure'],
    },
  },

  // ============================================================
  // ADMIN - Same as ORG_ADMIN (for backwards compatibility)
  // ============================================================
  ADMIN: {
    name: 'Admin',
    description: 'Organization administrator (same as ORG_ADMIN)',
    scope: 'organization',
    features: {
      [FEATURES.DASHBOARD]: ['read', 'export'],
      [FEATURES.INTEGRATIONS]: ['read', 'write', 'delete', 'execute'],
      [FEATURES.LOGS]: ['read', 'export', 'delete'],
      [FEATURES.EVENTS]: ['read', 'write', 'delete'],
      [FEATURES.EXECUTION_LOGS]: ['read', 'export'],
      [FEATURES.DLQ]: ['read', 'write', 'delete', 'execute'],
      [FEATURES.SCHEDULED_JOBS]: ['read', 'write', 'delete', 'execute'],
      [FEATURES.LOOKUP_TABLES]: ['read', 'write', 'delete', 'export'],
      [FEATURES.TEMPLATES]: ['read', 'write', 'delete'],
      [FEATURES.USERS]: ['read', 'write', 'delete'],
      [FEATURES.AI]: ['read', 'write', 'execute'],
      [FEATURES.AI_CONFIG]: ['read', 'write', 'configure'],
      [FEATURES.ANALYTICS]: ['read', 'export'],
      [FEATURES.SETTINGS]: ['read', 'write'],
      [FEATURES.SYSTEM_HEALTH]: ['read'],
      [FEATURES.AUDIT_LOGS]: ['read', 'export'],
      [FEATURES.API_KEYS]: ['read', 'write', 'delete'],
      [FEATURES.ALERTS]: ['read', 'write', 'configure'],
      [FEATURES.DAILY_REPORTS]: ['read', 'write', 'configure'],
    },
  },

  // ============================================================
  // ORG_ADMIN - Full control within their organization
  // ============================================================
  ORG_ADMIN: {
    name: 'Organization Admin',
    description: 'Full control within their organization',
    scope: 'organization',
    features: {
      [FEATURES.DASHBOARD]: ['read', 'export'],
      [FEATURES.INTEGRATIONS]: ['read', 'write', 'delete', 'execute'],
      [FEATURES.LOGS]: ['read', 'export', 'delete'],
      [FEATURES.EVENTS]: ['read', 'write'],
      [FEATURES.EXECUTION_LOGS]: ['read', 'export'],
      [FEATURES.DLQ]: ['read', 'write', 'delete', 'execute'],
      [FEATURES.SCHEDULED_JOBS]: ['read', 'write', 'delete', 'execute'],
      [FEATURES.LOOKUP_TABLES]: ['read', 'write', 'delete', 'export'],
      [FEATURES.TEMPLATES]: ['read', 'write', 'delete'],
      [FEATURES.USERS]: ['read', 'write', 'delete'],
      [FEATURES.AI]: ['read', 'write', 'execute'],
      [FEATURES.AI_CONFIG]: ['read', 'write', 'configure'],
      [FEATURES.ANALYTICS]: ['read', 'export'],
      [FEATURES.SETTINGS]: ['read'],
      [FEATURES.SYSTEM_HEALTH]: ['read'],
      [FEATURES.API_KEYS]: ['read', 'write', 'delete'],
      [FEATURES.ALERTS]: ['read', 'write', 'configure'],
      [FEATURES.DAILY_REPORTS]: ['read', 'write', 'configure'],
    },
  },

  // ============================================================
  // INTEGRATION_EDITOR - Can create/edit integrations
  // ============================================================
  INTEGRATION_EDITOR: {
    name: 'Integration Editor',
    description: 'Can create and edit integrations, use AI features',
    scope: 'organization',
    features: {
      [FEATURES.DASHBOARD]: ['read'],
      [FEATURES.INTEGRATIONS]: ['read', 'write', 'execute'],
      [FEATURES.LOGS]: ['read', 'export'],
      [FEATURES.EVENTS]: ['read'],
      [FEATURES.EXECUTION_LOGS]: ['read'],
      [FEATURES.DLQ]: ['read', 'execute'],
      [FEATURES.SCHEDULED_JOBS]: ['read', 'write', 'execute'],
      [FEATURES.LOOKUP_TABLES]: ['read', 'write', 'export'],
      [FEATURES.TEMPLATES]: ['read', 'write'],
      [FEATURES.AI]: ['read', 'write', 'execute'],
      [FEATURES.ANALYTICS]: ['read'],
      [FEATURES.SYSTEM_HEALTH]: ['read'],
      [FEATURES.ALERTS]: ['read'],
    },
  },

  // ============================================================
  // VIEWER - Read-only access
  // ============================================================
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access to most features',
    scope: 'organization',
    features: {
      [FEATURES.DASHBOARD]: ['read'],
      [FEATURES.INTEGRATIONS]: ['read'],
      [FEATURES.LOGS]: ['read'],
      [FEATURES.EVENTS]: ['read'],
      [FEATURES.EXECUTION_LOGS]: ['read'],
      [FEATURES.DLQ]: ['read'],
      [FEATURES.SCHEDULED_JOBS]: ['read'],
      [FEATURES.LOOKUP_TABLES]: ['read'],
      [FEATURES.TEMPLATES]: ['read'],
      [FEATURES.ANALYTICS]: ['read'],
      [FEATURES.SYSTEM_HEALTH]: ['read'],
    },
  },

  // ============================================================
  // ORG_USER - Basic organization user
  // ============================================================
  ORG_USER: {
    name: 'Organization User',
    description: 'Basic user with limited access',
    scope: 'organization',
    features: {
      [FEATURES.DASHBOARD]: ['read'],
      [FEATURES.INTEGRATIONS]: ['read'],
      [FEATURES.LOGS]: ['read'],
      [FEATURES.ANALYTICS]: ['read'],
      [FEATURES.SYSTEM_HEALTH]: ['read'],
    },
  },

  // ============================================================
  // API_KEY - Service-to-service authentication
  // ============================================================
  API_KEY: {
    name: 'API Key',
    description: 'Service account for API access',
    scope: 'api',
    features: {
      [FEATURES.INTEGRATIONS]: ['read', 'execute'],
      [FEATURES.SYSTEM_HEALTH]: ['read'],
    },
  },
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Check if user has access to a feature with specific operation
 * Now supports custom role overrides from database
 */
async function hasFeatureAccess(user, feature, operation) {
  if (!user || !user.role) return false;

  // SUPER_ADMIN always has access
  if (user.role === 'SUPER_ADMIN') return true;

  // Try to load custom role features from database
  const effectiveFeatures = await getEffectiveRoleFeatures(user.role);

  const featureOps = effectiveFeatures[feature];
  if (!featureOps) return false;

  return featureOps.includes(operation);
}

// ==========================================
// ROLE FEATURES CACHE
// (Caches custom role features from database)
// ==========================================

const roleCache = new Map();
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Get effective role features (database overrides + defaults)
 * This function checks the database for custom role configurations
 * and falls back to static ROLE_FEATURES if not found
 * Includes caching to avoid excessive database queries
 */
async function getEffectiveRoleFeatures(roleName) {
  // Check cache first
  const cached = roleCache.get(roleName);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.features };
  }

  let features = null;

  try {
    const mongodb = require('../mongodb');
    const db = await mongodb.getDbSafe();

    // Check if there's a custom role configuration in database
    const customRole = await db.collection('roles').findOne({ role: roleName });

    if (customRole?.features) {
      // Use custom features from database
      features = customRole.features;
    }
  } catch (error) {
    // If DB query fails, fall back to static features
    console.error('[RBAC] Failed to load custom role from DB:', error.message);
  }

  // Fall back to static role features if no custom found
  if (!features) {
    const roleConfig = ROLE_FEATURES[roleName];
    features = roleConfig ? { ...roleConfig.features } : {};
  }

  // Cache the result
  roleCache.set(roleName, {
    features,
    timestamp: Date.now(),
  });

  return { ...features };
}

/**
 * Clear role cache (call this when roles are updated)
 */
function clearRoleCache(roleName = null) {
  if (roleName) {
    roleCache.delete(roleName);
  } else {
    roleCache.clear();
  }
}

/**
 * Get all features accessible by a role
 * Now supports custom role overrides from database
 */
async function getRoleFeatures(roleName) {
  return await getEffectiveRoleFeatures(roleName);
}

/**
 * Get all features accessible by a user
 * Now supports custom role overrides from database
 */
async function getUserFeatures(user) {
  if (!user || !user.role) return {};
  return await getRoleFeatures(user.role);
}

/**
 * Check if role is global (can access all organizations)
 */
function isGlobalRole(roleName) {
  const roleConfig = ROLE_FEATURES[roleName];
  return roleConfig ? roleConfig.scope === 'global' : false;
}

/**
 * Get role info
 */
function getRoleInfo(roleName) {
  const roleConfig = ROLE_FEATURES[roleName];
  if (!roleConfig) return null;

  return {
    name: roleConfig.name,
    description: roleConfig.description,
    scope: roleConfig.scope,
  };
}

/**
 * Get all available roles
 */
function getAllRoles() {
  return Object.keys(ROLE_FEATURES).reduce((acc, key) => {
    acc[key] = {
      name: ROLE_FEATURES[key].name,
      description: ROLE_FEATURES[key].description,
      scope: ROLE_FEATURES[key].scope,
    };
    return acc;
  }, {});
}

/**
 * Get all available features
 */
function getAllFeatures() {
  return { ...FEATURES };
}

/**
 * Get all available operations
 */
function getAllOperations() {
  return { ...OPERATIONS };
}

module.exports = {
  FEATURES,
  OPERATIONS,
  ROLE_FEATURES,
  hasFeatureAccess,
  getRoleFeatures,
  getUserFeatures,
  isGlobalRole,
  getRoleInfo,
  getAllRoles,
  getAllFeatures,
  getAllOperations,
  clearRoleCache,
};
