/**
 * usePermissions Hook - Super Simple Permission Checks
 *
 * Usage:
 *   const can = usePermissions();
 *   if (can.useAI()) { ... }
 *   if (can.configureAI()) { ... }
 *   if (can.createIntegration()) { ... }
 */

import { useAuth } from '../app/auth-context';
import { hasFeatureAccess, isGlobalRole, FEATURES, OPERATIONS } from '../utils/permissions';
import type { Feature, Operation } from '../utils/permissions';

export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role;

  // Generic permission check
  const can = (feature: Feature, operation: Operation): boolean => {
    return hasFeatureAccess(role, feature, operation);
  };

  // Convenience methods for common checks
  return {
    // Generic check
    can,

    // AI Features
    useAI: () => can(FEATURES.AI, OPERATIONS.EXECUTE),
    viewAI: () => can(FEATURES.AI, OPERATIONS.READ),
    configureAI: () => can(FEATURES.AI_CONFIG, OPERATIONS.CONFIGURE),

    // Integrations
    viewIntegrations: () => can(FEATURES.INTEGRATIONS, OPERATIONS.READ),
    createIntegration: () => can(FEATURES.INTEGRATIONS, OPERATIONS.WRITE),
    editIntegration: () => can(FEATURES.INTEGRATIONS, OPERATIONS.WRITE),
    deleteIntegration: () => can(FEATURES.INTEGRATIONS, OPERATIONS.DELETE),
    testIntegration: () => can(FEATURES.INTEGRATIONS, OPERATIONS.EXECUTE),

    // Logs
    viewLogs: () => can(FEATURES.LOGS, OPERATIONS.READ),
    exportLogs: () => can(FEATURES.LOGS, OPERATIONS.EXPORT),
    deleteLogs: () => can(FEATURES.LOGS, OPERATIONS.DELETE),

    // DLQ
    viewDLQ: () => can(FEATURES.DLQ, OPERATIONS.READ),
    retryDLQ: () => can(FEATURES.DLQ, OPERATIONS.EXECUTE),
    deleteDLQ: () => can(FEATURES.DLQ, OPERATIONS.DELETE),

    // Users
    viewUsers: () => can(FEATURES.USERS, OPERATIONS.READ),
    createUser: () => can(FEATURES.USERS, OPERATIONS.WRITE),
    editUser: () => can(FEATURES.USERS, OPERATIONS.WRITE),
    deleteUser: () => can(FEATURES.USERS, OPERATIONS.DELETE),

    // Lookup Tables
    viewLookups: () => can(FEATURES.LOOKUP_TABLES, OPERATIONS.READ),
    editLookups: () => can(FEATURES.LOOKUP_TABLES, OPERATIONS.WRITE),
    deleteLookups: () => can(FEATURES.LOOKUP_TABLES, OPERATIONS.DELETE),
    exportLookups: () => can(FEATURES.LOOKUP_TABLES, OPERATIONS.EXPORT),

    // Templates
    viewTemplates: () => can(FEATURES.TEMPLATES, OPERATIONS.READ),
    createTemplate: () => can(FEATURES.TEMPLATES, OPERATIONS.WRITE),
    editTemplate: () => can(FEATURES.TEMPLATES, OPERATIONS.WRITE),
    deleteTemplate: () => can(FEATURES.TEMPLATES, OPERATIONS.DELETE),

    // Scheduled Jobs
    viewScheduledJobs: () => can(FEATURES.SCHEDULED_JOBS, OPERATIONS.READ),
    createScheduledJob: () => can(FEATURES.SCHEDULED_JOBS, OPERATIONS.WRITE),
    editScheduledJob: () => can(FEATURES.SCHEDULED_JOBS, OPERATIONS.WRITE),
    deleteScheduledJob: () => can(FEATURES.SCHEDULED_JOBS, OPERATIONS.DELETE),
    executeScheduledJob: () => can(FEATURES.SCHEDULED_JOBS, OPERATIONS.EXECUTE),

    // Settings
    viewSettings: () => can(FEATURES.SETTINGS, OPERATIONS.READ),
    editSettings: () => can(FEATURES.SETTINGS, OPERATIONS.WRITE),
    configureSettings: () => can(FEATURES.SETTINGS, OPERATIONS.CONFIGURE),

    // Analytics
    viewAnalytics: () => can(FEATURES.ANALYTICS, OPERATIONS.READ),
    exportAnalytics: () => can(FEATURES.ANALYTICS, OPERATIONS.EXPORT),

    // Role checks
    isGlobalRole: () => isGlobalRole(role),
    isSuperAdmin: () => role === 'SUPER_ADMIN',
    isAdmin: () => role === 'SUPER_ADMIN' || role === 'ADMIN',
    isOrgAdmin: () => role === 'ORG_ADMIN',

    // Current role
    role
  };
}
