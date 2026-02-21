/**
 * PermissionGuard - Conditional Rendering Based on Permissions
 *
 * Super simple component to show/hide UI based on permissions
 *
 * Usage:
 *   <PermissionGuard feature="ai" operation="execute">
 *     <Button>Generate with AI</Button>
 *   </PermissionGuard>
 *
 *   <PermissionGuard feature="ai_config" operation="configure" fallback={<DisabledMessage />}>
 *     <AIConfigPanel />
 *   </PermissionGuard>
 */

import type { ReactNode } from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import type { Feature, Operation } from '../../utils/permissions';

interface PermissionGuardProps {
  feature: Feature;
  operation: Operation;
  children: ReactNode;
  fallback?: ReactNode;
}

export const PermissionGuard = ({
  feature,
  operation,
  children,
  fallback = null
}: PermissionGuardProps) => {
  const { can } = usePermissions();

  if (!can(feature, operation)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

/**
 * Show content only for specific roles
 */
interface RoleGuardProps {
  roles: string | string[];
  children: ReactNode;
  fallback?: ReactNode;
}

export const RoleGuard = ({ roles, children, fallback = null }: RoleGuardProps) => {
  const { role } = usePermissions();

  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  if (!role || !allowedRoles.includes(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

/**
 * Show content only for admin roles (SUPER_ADMIN or ADMIN)
 */
interface AdminGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export const AdminGuard = ({ children, fallback = null }: AdminGuardProps) => {
  const { isAdmin } = usePermissions();

  if (!isAdmin()) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
