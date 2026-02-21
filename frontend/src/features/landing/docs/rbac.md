# Role-Based Access Control

The gateway has a full multi-tenant RBAC system with predefined roles, granular permissions, and optional custom per-user permissions. Every user action is scoped to their role and — for org-level roles — to their organization.

---

## Roles

Seven roles are defined. The first two are global (cross-tenant); the rest are scoped to a single organization.

| Role | Scope | Description |
|------|-------|-------------|
| `SUPER_ADMIN` | Global | Full access to everything. Can impersonate users. No orgId required. |
| `ADMIN` | Global | Same as SUPER_ADMIN except cannot impersonate. |
| `ORG_ADMIN` | Organization | Full control within their org. Cannot create SUPER_ADMIN/ADMIN users. |
| `INTEGRATION_EDITOR` | Organization | Create/edit integrations. Cannot delete. No user management. |
| `VIEWER` | Organization | Read-only access across all features. Cannot create, edit, or delete. |
| `ORG_USER` | Organization | Minimal read-only: integrations, logs, analytics, dashboard only. |
| `API_KEY` | API | Service-to-service. Can view integrations and check system health. |

---

## Permissions

**52 granular permissions** are available, grouped by feature area:

| Category | Permissions |
|----------|------------|
| Organizations | `org:create`, `org:view`, `org:edit`, `org:delete`, `org:view_all` |
| Integrations | `integration:create`, `integration:view`, `integration:edit`, `integration:delete`, `integration:activate`, `integration:test`, `integration:configure_auth`, `integration:configure_rate_limit`, `integration:version_history` |
| Logs & Monitoring | `logs:view`, `logs:export`, `logs:delete`, `execution_logs:view` |
| Dead Letter Queue | `dlq:view`, `dlq:retry`, `dlq:bulk_retry`, `dlq:delete` |
| Analytics | `analytics:view`, `analytics:export`, `dashboard:view` |
| Lookup Tables | `lookups:view`, `lookups:create`, `lookups:edit`, `lookups:delete`, `lookups:import`, `lookups:export` |
| Templates | `templates:view`, `templates:create`, `templates:edit`, `templates:delete` |
| Scheduled Jobs | `scheduled:view`, `scheduled:create`, `scheduled:edit`, `scheduled:delete`, `scheduled:execute` |
| User Management | `users:view`, `users:create`, `users:edit`, `users:delete`, `users:assign_roles`, `users:assign_permissions`, `users:reset_password` |
| API Keys | `api_keys:view`, `api_keys:create`, `api_keys:revoke` |
| System & Admin | `system:health`, `system:config`, `system:edit_config`, `system:worker_control`, `admin:audit_logs`, `admin:impersonate`, `admin:notifications` |

### Custom Permissions

Individual users can be granted additional permissions on top of their role. The effective permission set is the **union** of role permissions and custom permissions. SUPER_ADMIN always has all permissions regardless of configuration.

---

## Authentication

**JWT Tokens** — expiry default 12 hours (configurable), signed with a secret key.

Login response includes an `accessToken` JWT containing:
- `sub` — user ID
- `email`
- `role`
- `orgId` (null for SUPER_ADMIN)

**API Key** — Requests can also use `X-API-Key` header for service-to-service access. This grants `API_KEY` role permissions.

---

## Impersonation

`SUPER_ADMIN` can generate a token scoped to any `ORG_ADMIN` or `ORG_USER` for debugging purposes. The impersonated token includes `impersonated: true` and `impersonatedBy: <adminId>` so all actions taken while impersonating are traceable.

---

## User Management

Key rules enforced by the API:

| Action | Restriction |
|--------|------------|
| Create user | `ORG_ADMIN` can only create within their own org |
| Assign roles | `ORG_ADMIN` cannot assign `SUPER_ADMIN` or `ADMIN` |
| Deactivate user | Cannot deactivate your own account |
| Change own role | Not allowed |
| Delete user | Soft delete — sets `isActive: false`, data is preserved |
| Password change | Users can change their own (requires current password). SUPER_ADMIN/ADMIN can reset any password. |

---

## Audit Logging

All sensitive operations are logged:
- Login attempts (success and failure)
- User created, updated, deactivated, deleted
- Role assigned or changed
- Admin actions (bulk rate limit changes, etc.)

Audit logs are queryable with filters for action, role, admin ID, and date range. A trend view shows daily counts.

---

## Role Caching

Role permissions are cached in memory for 60 seconds to reduce database lookups. The cache is keyed by role name and invalidated when a role is updated.

---

## Custom Roles

`SUPER_ADMIN` and `ADMIN` can define custom roles in addition to the built-in ones:
- Custom roles cannot override `SUPER_ADMIN`
- Scope options: `global`, `organization`, `api`
- Each custom role maps features to allowed operations (`read`, `write`, `delete`, `execute`, `configure`, `export`)

---

## Available Features for Feature-Based Access

19 features are available for role configuration:

`DASHBOARD`, `INTEGRATIONS`, `LOGS`, `EVENTS`, `EXECUTION_LOGS`, `DLQ`, `SCHEDULED_JOBS`, `LOOKUP_TABLES`, `TEMPLATES`, `USERS`, `AI`, `AI_CONFIG`, `ANALYTICS`, `SETTINGS`, `SYSTEM_HEALTH`, `AUDIT_LOGS`, `API_KEYS`, `ALERTS`, `DAILY_REPORTS`
