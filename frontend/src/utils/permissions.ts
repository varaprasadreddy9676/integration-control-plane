/**
 * Feature-Based Permissions - Frontend
 *
 * Simple permission system matching backend
 * Just check: Can this role access this feature with this operation?
 */

// ==========================================
// FEATURES (must match backend)
// ==========================================

export const FEATURES = {
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
  EVENT_SOURCE: 'event_source',
  EVENT_CATALOGUE: 'event_catalogue'
} as const;

export type Feature = typeof FEATURES[keyof typeof FEATURES];

// ==========================================
// OPERATIONS (must match backend)
// ==========================================

export const OPERATIONS = {
  READ: 'read',
  WRITE: 'write',
  DELETE: 'delete',
  EXECUTE: 'execute',
  CONFIGURE: 'configure',
  EXPORT: 'export'
} as const;

export type Operation = typeof OPERATIONS[keyof typeof OPERATIONS];

// ==========================================
// ROLE FEATURES (must match backend)
// ==========================================

type RoleFeatures = {
  [feature: string]: Operation[];
};

const ROLE_FEATURES: Record<string, RoleFeatures> = {
  SUPER_ADMIN: {
    [FEATURES.EVENT_SOURCE]: ['read', 'write', 'delete', 'configure'],
    [FEATURES.EVENT_CATALOGUE]: ['read', 'write', 'delete'],
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
    [FEATURES.DAILY_REPORTS]: ['read', 'write', 'configure']
  },

  ADMIN: {
    [FEATURES.EVENT_SOURCE]: ['read', 'write', 'delete', 'configure'],
    [FEATURES.EVENT_CATALOGUE]: ['read', 'write', 'delete'],
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
    [FEATURES.DAILY_REPORTS]: ['read', 'write', 'configure']
  },

  ORG_ADMIN: {
    [FEATURES.EVENT_SOURCE]: ['read', 'write', 'delete', 'configure'],
    [FEATURES.EVENT_CATALOGUE]: ['read', 'write', 'delete'],
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
    [FEATURES.DAILY_REPORTS]: ['read', 'write', 'configure']
  },

  INTEGRATION_EDITOR: {
    [FEATURES.EVENT_CATALOGUE]: ['read'],
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
    [FEATURES.ALERTS]: ['read']
  },

  VIEWER: {
    [FEATURES.EVENT_CATALOGUE]: ['read'],
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
    [FEATURES.SYSTEM_HEALTH]: ['read']
  },

  ORG_USER: {
    [FEATURES.DASHBOARD]: ['read'],
    [FEATURES.INTEGRATIONS]: ['read'],
    [FEATURES.LOGS]: ['read'],
    [FEATURES.ANALYTICS]: ['read'],
    [FEATURES.SYSTEM_HEALTH]: ['read']
  }
};

// ==========================================
// PERMISSION CHECKER
// ==========================================

/**
 * Check if a role has access to a feature with specific operation
 */
export function hasFeatureAccess(
  role: string | undefined,
  feature: Feature,
  operation: Operation
): boolean {
  if (!role) return false;

  // SUPER_ADMIN always has access
  if (role === 'SUPER_ADMIN') return true;

  const roleFeatures = ROLE_FEATURES[role];
  if (!roleFeatures) return false;

  const featureOps = roleFeatures[feature];
  if (!featureOps) return false;

  return featureOps.includes(operation);
}

/**
 * Check if role is global (can access all organizations)
 */
export function isGlobalRole(role: string | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

/**
 * Get all features for a role
 */
export function getRoleFeatures(role: string | undefined): RoleFeatures {
  if (!role) return {};
  return ROLE_FEATURES[role] || {};
}
