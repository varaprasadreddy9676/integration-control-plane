/**
 * RBAC Permission System - Product-Grade
 *
 * Aligned with Integration Gateway architecture
 * Simple roles, granular permissions
 */

// ==========================================
// GRANULAR PERMISSIONS
// ==========================================

const PERMISSIONS = {
  // Organization Management
  'org:create': 'Create organizations',
  'org:view': 'View organizations',
  'org:edit': 'Edit organizations',
  'org:delete': 'Delete organizations',
  'org:view_all': 'View all organizations (cross-tenant)',

  // Integration Management
  'integration:create': 'Create integrations (outbound, inbound, scheduled)',
  'integration:view': 'View integrations',
  'integration:edit': 'Edit integrations',
  'integration:delete': 'Delete integrations',
  'integration:activate': 'Activate/deactivate integrations',
  'integration:test': 'Test integrations',
  'integration:configure_auth': 'Configure authentication',
  'integration:configure_rate_limit': 'Configure rate limits',
  'integration:version_history': 'Access version history',

  // Logs & Monitoring
  'logs:view': 'View delivery logs',
  'logs:export': 'Export logs',
  'logs:delete': 'Delete logs',
  'execution_logs:view': 'View execution logs',

  // Dead Letter Queue
  'dlq:view': 'View DLQ',
  'dlq:retry': 'Retry failed events',
  'dlq:bulk_retry': 'Bulk retry DLQ',
  'dlq:delete': 'Delete DLQ entries',

  // Analytics & Dashboard
  'analytics:view': 'View analytics dashboard',
  'analytics:export': 'Export analytics data',
  'dashboard:view': 'View dashboard',

  // Lookup Tables
  'lookups:view': 'View lookup tables',
  'lookups:create': 'Create lookup tables',
  'lookups:edit': 'Edit lookup tables',
  'lookups:delete': 'Delete lookup tables',
  'lookups:import': 'Import lookup data',
  'lookups:export': 'Export lookup data',

  // Templates
  'templates:view': 'View integration templates',
  'templates:create': 'Create templates',
  'templates:edit': 'Edit templates',
  'templates:delete': 'Delete templates',

  // Scheduled Jobs
  'scheduled:view': 'View scheduled jobs',
  'scheduled:create': 'Create scheduled jobs',
  'scheduled:edit': 'Edit scheduled jobs',
  'scheduled:delete': 'Delete scheduled jobs',
  'scheduled:execute': 'Manually execute scheduled jobs',

  // User Management
  'users:view': 'View users',
  'users:create': 'Create users',
  'users:edit': 'Edit users',
  'users:delete': 'Delete users',
  'users:assign_roles': 'Assign roles to users',
  'users:assign_permissions': 'Assign permissions to users',
  'users:reset_password': 'Reset user passwords',

  // API Keys
  'api_keys:view': 'View API keys',
  'api_keys:create': 'Create API keys',
  'api_keys:revoke': 'Revoke API keys',

  // Event Source (inbound data source configuration)
  'event_source:view':   'View event source configs',
  'event_source:manage': 'Create / update / delete event source configs (MySQL, Kafka, HTTP Push)',

  // Event Catalogue (per-org event type definitions)
  'event_catalogue:view':   'View event catalogue',
  'event_catalogue:manage': 'Create / update / delete org-specific event types',

  // System & Admin
  'system:health': 'View system health',
  'system:config': 'View system configuration',
  'system:edit_config': 'Edit system configuration',
  'system:worker_control': 'Control worker processes',
  'admin:audit_logs': 'View audit logs',
  'admin:impersonate': 'Impersonate users',
  'admin:notifications': 'Configure notification channels',
};

// ==========================================
// PRODUCT-GRADE ROLES
// ==========================================

const ROLES = {
  // ============================================================
  // SUPER_ADMIN - Super Admin (Cross-tenant, Full Control)
  // ============================================================
  SUPER_ADMIN: {
    name: 'Super Admin',
    description: 'Full system access across all organizations',
    permissions: Object.keys(PERMISSIONS), // ALL permissions
    scope: 'global',
    isSystemRole: true
  },

  // ============================================================
  // ADMIN - Admin (Cross-tenant, Full Control except super admin functions)
  // ============================================================
  ADMIN: {
    name: 'Admin',
    description: 'Full system access across all organizations (cannot create super admins)',
    permissions: Object.keys(PERMISSIONS).filter(p => p !== 'admin:impersonate'), // ALL except impersonate
    scope: 'global',
    isSystemRole: true
  },

  // ============================================================
  // ORG_ADMIN - Organization Admin (Single tenant, Full control)
  // ============================================================
  ORG_ADMIN: {
    name: 'Organization Admin',
    description: 'Full control within their organization',
    permissions: [
      // Organization (own org only)
      'org:view',
      'org:edit',

      // Integrations (full control)
      'integration:create',
      'integration:view',
      'integration:edit',
      'integration:delete',
      'integration:activate',
      'integration:test',
      'integration:configure_auth',
      'integration:configure_rate_limit',
      'integration:version_history',

      // Logs & Monitoring
      'logs:view',
      'logs:export',
      'logs:delete',
      'execution_logs:view',

      // DLQ
      'dlq:view',
      'dlq:retry',
      'dlq:bulk_retry',
      'dlq:delete',

      // Analytics
      'analytics:view',
      'analytics:export',
      'dashboard:view',

      // Lookup Tables
      'lookups:view',
      'lookups:create',
      'lookups:edit',
      'lookups:delete',
      'lookups:import',
      'lookups:export',

      // Templates
      'templates:view',
      'templates:create',
      'templates:edit',
      'templates:delete',

      // Scheduled Jobs
      'scheduled:view',
      'scheduled:create',
      'scheduled:edit',
      'scheduled:delete',
      'scheduled:execute',

      // User Management (within org)
      'users:view',
      'users:create',
      'users:edit',
      'users:delete',
      'users:assign_roles',
      'users:assign_permissions',
      'users:reset_password',

      // API Keys (own org)
      'api_keys:view',
      'api_keys:create',
      'api_keys:revoke',

      // Event Source (own org only)
      'event_source:view',
      'event_source:manage',

      // Event Catalogue (own org only)
      'event_catalogue:view',
      'event_catalogue:manage',

      // Audit (own org only)
      'admin:audit_logs',

      // System
      'system:health'
    ],
    scope: 'organization',
    isSystemRole: true
  },

  // ============================================================
  // INTEGRATION_EDITOR - Developer/Integration Engineer
  // ============================================================
  INTEGRATION_EDITOR: {
    name: 'Integration Editor',
    description: 'Can create and edit integrations, cannot delete',
    permissions: [
      // Integrations (create/edit only)
      'integration:create',
      'integration:view',
      'integration:edit',
      'integration:activate',
      'integration:test',
      'integration:version_history',

      // Logs (read-only)
      'logs:view',
      'logs:export',
      'execution_logs:view',

      // DLQ (retry only)
      'dlq:view',
      'dlq:retry',

      // Analytics
      'analytics:view',
      'dashboard:view',

      // Lookup Tables
      'lookups:view',
      'lookups:create',
      'lookups:edit',
      'lookups:import',
      'lookups:export',

      // Templates
      'templates:view',
      'templates:create',
      'templates:edit',

      // Scheduled Jobs
      'scheduled:view',
      'scheduled:create',
      'scheduled:edit',
      'scheduled:execute',

      // Event Catalogue (read-only)
      'event_catalogue:view',

      // System
      'system:health'
    ],
    scope: 'organization',
    isSystemRole: true
  },

  // ============================================================
  // VIEWER - Read-only Access (Compliance, Audit, Management)
  // ============================================================
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access to integrations and logs',
    permissions: [
      // Integrations (read-only)
      'integration:view',

      // Logs (read-only)
      'logs:view',
      'execution_logs:view',

      // DLQ (read-only)
      'dlq:view',

      // Analytics
      'analytics:view',
      'dashboard:view',

      // Lookup Tables (read-only)
      'lookups:view',

      // Templates (read-only)
      'templates:view',

      // Scheduled Jobs (read-only)
      'scheduled:view',

      // Event Catalogue (read-only)
      'event_catalogue:view',

      // System
      'system:health'
    ],
    scope: 'organization',
    isSystemRole: true
  },

  // ============================================================
  // ORG_USER - Basic User (Organization-scoped, Read-only)
  // ============================================================
  ORG_USER: {
    name: 'Organization User',
    description: 'Basic user within their organization with read-only access',
    permissions: [
      // Integrations (read-only)
      'integration:view',

      // Logs (read-only)
      'logs:view',
      'execution_logs:view',

      // Analytics
      'analytics:view',
      'dashboard:view',

      // System
      'system:health'
    ],
    scope: 'organization',
    isSystemRole: true
  },

  // ============================================================
  // API_KEY - Service-to-Service Authentication
  // ============================================================
  API_KEY: {
    name: 'API Key',
    description: 'Technical role for API access',
    permissions: [
      'integration:view',  // Call runtime integrations
      'system:health'      // Health checks
    ],
    scope: 'api',
    isSystemRole: true,
    isApiRole: true
  }
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Get all permissions for a role
 */
function getRolePermissions(roleName) {
  const role = ROLES[roleName];
  return role ? [...role.permissions] : [];
}

/**
 * Check if a role has a specific permission
 */
function roleHasPermission(roleName, permission) {
  const permissions = getRolePermissions(roleName);
  return permissions.includes(permission);
}

/**
 * Get all available permissions
 */
function getAllPermissions() {
  return { ...PERMISSIONS };
}

/**
 * Get all available roles
 */
function getAllRoles() {
  return { ...ROLES };
}

/**
 * Check if user has permission (from role or custom permissions)
 */
function userHasPermission(user, permission) {
  if (!user) return false;

  // SUPER_ADMIN has all permissions
  if (user.role === 'SUPER_ADMIN') return true;

  // Check role permissions
  const rolePermissions = getRolePermissions(user.role);
  if (rolePermissions.includes(permission)) return true;

  // Check custom permissions
  if (Array.isArray(user.permissions) && user.permissions.includes(permission)) {
    return true;
  }

  return false;
}

/**
 * Get combined permissions for a user (role + custom)
 */
function getUserPermissions(user) {
  if (!user) return [];

  // SUPER_ADMIN gets all permissions
  if (user.role === 'SUPER_ADMIN') {
    return Object.keys(PERMISSIONS);
  }

  const rolePermissions = getRolePermissions(user.role);
  const customPermissions = user.permissions || [];

  // Combine and deduplicate
  return [...new Set([...rolePermissions, ...customPermissions])];
}

/**
 * Check if role can access other organizations
 */
function canAccessAllOrgs(roleName) {
  return roleName === 'SUPER_ADMIN' || roleName === 'ADMIN';
}

/**
 * Get role scope
 */
function getRoleScope(roleName) {
  const role = ROLES[roleName];
  return role ? role.scope : 'organization';
}

module.exports = {
  PERMISSIONS,
  ROLES,
  getRolePermissions,
  roleHasPermission,
  getAllPermissions,
  getAllRoles,
  userHasPermission,
  getUserPermissions,
  canAccessAllOrgs,
  getRoleScope
};
