# RBAC System Guide

## Overview

The Integration Gateway now has a comprehensive **Role-Based Access Control (RBAC)** system that provides fine-grained permissions for all features.

## Key Features

✅ **Simple Feature-Based Permissions** - No complex permission strings, just features + operations
✅ **6 Standard Operations** - read, write, delete, execute, configure, export
✅ **Type-Safe Frontend** - Full TypeScript support with autocomplete
✅ **Declarative Permission Checks** - `<PermissionGuard>` component for easy UI control
✅ **Backend Middleware** - Protected routes with `requireFeature()` middleware
✅ **Consistent Across Stack** - Same permission model in frontend and backend

---

## How to Use

### Frontend: Permission Checks

#### 1. **Using the `usePermissions` Hook**

```tsx
import { usePermissions } from '../../hooks/usePermissions';
import { FEATURES, OPERATIONS } from '../../utils/permissions';

function MyComponent() {
  const { can, configureAI, createIntegration } = usePermissions();

  // Method 1: Direct permission check
  if (can(FEATURES.AI, OPERATIONS.EXECUTE)) {
    // User can execute AI operations
  }

  // Method 2: Convenience methods
  if (configureAI()) {
    // User can configure AI settings
  }

  if (createIntegration()) {
    // User can create integrations
  }

  return (
    <div>
      {can(FEATURES.INTEGRATIONS, OPERATIONS.WRITE) && (
        <Button>Create Integration</Button>
      )}
    </div>
  );
}
```

#### 2. **Using the `<PermissionGuard>` Component**

```tsx
import { PermissionGuard } from '../../components/common/PermissionGuard';
import { FEATURES, OPERATIONS } from '../../utils/permissions';

function MyPage() {
  return (
    <div>
      {/* Hide content if user lacks permission */}
      <PermissionGuard feature={FEATURES.AI} operation={OPERATIONS.EXECUTE}>
        <Button>Use AI Assistant</Button>
      </PermissionGuard>

      {/* Show fallback message */}
      <PermissionGuard
        feature={FEATURES.AI_CONFIG}
        operation={OPERATIONS.CONFIGURE}
        fallback={
          <Alert type="error" message="You don't have permission to configure AI" />
        }
      >
        <AIConfigForm />
      </PermissionGuard>
    </div>
  );
}
```

### Backend: Protected Routes

#### 1. **Using the `requireFeature` Middleware**

```javascript
const { requireFeature } = require('../middleware/feature-permission');
const { FEATURES, OPERATIONS } = require('../rbac/features');

// Single operation
router.post('/ai/execute',
  auth,
  requireFeature(FEATURES.AI, OPERATIONS.EXECUTE),
  asyncHandler(async (req, res) => {
    // Only users with AI execute permission can access this
  })
);

// Multiple operations (user needs ANY of them)
router.post('/integrations/:id/test',
  auth,
  requireFeature(FEATURES.INTEGRATIONS, [OPERATIONS.WRITE, OPERATIONS.EXECUTE]),
  asyncHandler(async (req, res) => {
    // User needs write OR execute permission
  })
);

// Multiple operations (user needs ALL of them)
router.delete('/integrations/:id',
  auth,
  requireFeature(FEATURES.INTEGRATIONS, [OPERATIONS.WRITE, OPERATIONS.DELETE], { requireAll: true }),
  asyncHandler(async (req, res) => {
    // User needs BOTH write AND delete permission
  })
);
```

#### 2. **Checking Permissions in Code**

```javascript
const { hasFeatureAccess } = require('../rbac/features');

function myHandler(req, res) {
  if (hasFeatureAccess(req.user, FEATURES.AI_CONFIG, OPERATIONS.CONFIGURE)) {
    // User can configure AI
  }
}
```

---

## Available Features

| Feature | Description |
|---------|-------------|
| `DASHBOARD` | Overview and analytics |
| `INTEGRATIONS` | Integration configurations |
| `LOGS` | Delivery logs |
| `EVENTS` | Event catalog and audit |
| `EXECUTION_LOGS` | Execution history |
| `DLQ` | Dead letter queue |
| `SCHEDULED_JOBS` | Job scheduling |
| `LOOKUP_TABLES` | Data lookup tables |
| `TEMPLATES` | Integration templates |
| `USERS` | User management |
| `AI` | AI-powered features |
| `AI_CONFIG` | AI configuration (API keys, models) |
| `ANALYTICS` | Analytics and reporting |
| `SETTINGS` | System settings |
| `SYSTEM_HEALTH` | Health monitoring |
| `AUDIT_LOGS` | Audit trail |
| `API_KEYS` | API key management |
| `ALERTS` | Alert configuration |
| `DAILY_REPORTS` | Daily reports |

---

## Available Operations

| Operation | Description |
|-----------|-------------|
| `READ` | View and list items |
| `WRITE` | Create and edit items |
| `DELETE` | Remove items |
| `EXECUTE` | Run operations (test, retry, etc.) |
| `CONFIGURE` | Modify settings and configurations |
| `EXPORT` | Export data to files |

---

## Available Roles

### SUPER_ADMIN
- **Scope:** Global (all organizations)
- **Access:** Full access to everything
- **Use Case:** Platform administrators

### ADMIN
- **Scope:** Organization
- **Access:** Same as ORG_ADMIN (backward compatibility)
- **Use Case:** Legacy admin accounts

### ORG_ADMIN
- **Scope:** Organization
- **Access:** Full control within their organization
- **Permissions:**
  - ✅ All integration operations
  - ✅ User management
  - ✅ AI configuration
  - ✅ Settings (read-only system config)
  - ❌ Cannot modify global system settings

### INTEGRATION_EDITOR
- **Scope:** Organization
- **Access:** Can create and edit integrations
- **Permissions:**
  - ✅ Create/edit/test integrations
  - ✅ Use AI features
  - ✅ Manage lookup tables and templates
  - ❌ Cannot delete integrations
  - ❌ Cannot manage users

### VIEWER
- **Scope:** Organization
- **Access:** Read-only access
- **Permissions:**
  - ✅ View dashboards, integrations, logs
  - ❌ Cannot create or modify anything

### ORG_USER
- **Scope:** Organization
- **Access:** Basic user access
- **Permissions:**
  - ✅ View dashboards and analytics
  - ❌ Limited access to other features

---

## Example: Creating a Protected Feature

### 1. Frontend Component

```tsx
// src/features/my-feature/MyFeatureRoute.tsx
import { PermissionGuard } from '../../components/common/PermissionGuard';
import { usePermissions } from '../../hooks/usePermissions';
import { FEATURES, OPERATIONS } from '../../utils/permissions';

export const MyFeatureRoute = () => {
  const { can } = usePermissions();

  return (
    <div>
      <PageHeader title="My Feature" />

      {/* Only show to users with read permission */}
      <PermissionGuard
        feature={FEATURES.MY_FEATURE}
        operation={OPERATIONS.READ}
        fallback={<Alert type="error" message="Access Denied" />}
      >
        <FeatureContent />

        {/* Only show create button to users with write permission */}
        {can(FEATURES.MY_FEATURE, OPERATIONS.WRITE) && (
          <Button onClick={handleCreate}>Create New</Button>
        )}
      </PermissionGuard>
    </div>
  );
};
```

### 2. Backend Routes

```javascript
// src/routes/my-feature.js
const { requireFeature } = require('../middleware/feature-permission');
const { FEATURES, OPERATIONS } = require('../rbac/features');

// GET - requires read permission
router.get('/my-feature',
  auth,
  requireFeature(FEATURES.MY_FEATURE, OPERATIONS.READ),
  asyncHandler(async (req, res) => {
    // Implementation
  })
);

// POST - requires write permission
router.post('/my-feature',
  auth,
  requireFeature(FEATURES.MY_FEATURE, OPERATIONS.WRITE),
  asyncHandler(async (req, res) => {
    // Implementation
  })
);

// DELETE - requires delete permission
router.delete('/my-feature/:id',
  auth,
  requireFeature(FEATURES.MY_FEATURE, OPERATIONS.DELETE),
  asyncHandler(async (req, res) => {
    // Implementation
  })
);
```

### 3. Add Feature to RBAC Config

```javascript
// backend/src/rbac/features.js
const FEATURES = {
  // ... existing features
  MY_FEATURE: 'my_feature'
};

const ROLE_FEATURES = {
  SUPER_ADMIN: {
    features: {
      // ... existing features
      [FEATURES.MY_FEATURE]: ['read', 'write', 'delete']
    }
  },
  ORG_ADMIN: {
    features: {
      // ... existing features
      [FEATURES.MY_FEATURE]: ['read', 'write']
    }
  }
  // ... other roles
};
```

```typescript
// frontend/src/utils/permissions.ts
export const FEATURES = {
  // ... existing features
  MY_FEATURE: 'my_feature'
} as const;

const ROLE_FEATURES: Record<string, RoleFeatures> = {
  SUPER_ADMIN: {
    // ... existing features
    [FEATURES.MY_FEATURE]: ['read', 'write', 'delete']
  },
  ORG_ADMIN: {
    // ... existing features
    [FEATURES.MY_FEATURE]: ['read', 'write']
  }
  // ... other roles
};
```

---

## New Pages Added

### 1. **AI Settings** (`/ai-settings`)
- Configure AI provider (OpenAI, Anthropic, Custom)
- Manage API keys (only visible to ORG_ADMIN and SUPER_ADMIN)
- Set model parameters (temperature, max tokens)
- Shows current user's AI permissions

**Access:** Only ORG_ADMIN and SUPER_ADMIN can configure
**Location:** Configuration menu (when org is selected)

### 2. **Permissions Demo** (`/admin/permissions`)
- View complete permission matrix for your role
- See which features and operations you have access to
- Understand the RBAC system
- View your account details

**Access:** SUPER_ADMIN and ADMIN
**Location:** Administration menu

---

## Testing the System

1. **Login as SUPER_ADMIN**
   - Navigate to `/admin/permissions` to see full permission matrix
   - All features should show checkmarks for all operations

2. **Select an organization**
   - Go to `/ai-settings` to see AI configuration
   - You should be able to modify all settings

3. **Login as ORG_ADMIN**
   - Navigate to `/admin/permissions` (should show limited access)
   - Go to `/ai-settings` (should have configure access)
   - Try accessing features - some should be read-only

4. **Login as VIEWER**
   - Most write/delete/configure operations should be hidden
   - Only read operations available

---

## Key Files

### Frontend
- `frontend/src/utils/permissions.ts` - Permission definitions
- `frontend/src/hooks/usePermissions.ts` - Permission hook
- `frontend/src/components/common/PermissionGuard.tsx` - Guard component
- `frontend/src/features/ai-settings/AISettingsRoute.tsx` - AI Settings page
- `frontend/src/features/admin/PermissionsDemoRoute.tsx` - Permissions demo

### Backend
- `backend/src/rbac/features.js` - RBAC configuration
- `backend/src/middleware/feature-permission.js` - Permission middleware
- `backend/src/routes/admin.js` - Admin routes (updated for SUPER_ADMIN)
- `backend/src/routes/auth.js` - Auth routes (updated for SUPER_ADMIN)

---

## Benefits

✅ **Simple to Use** - No complex permission strings, just features + operations
✅ **Type-Safe** - Full TypeScript support prevents typos
✅ **Consistent** - Same model in frontend and backend
✅ **Declarative** - Use `<PermissionGuard>` for clean code
✅ **Flexible** - Easy to add new features and roles
✅ **Secure** - Backend enforcement prevents unauthorized access

---

## Migration Notes

If you have existing code that checks `user.role === 'ADMIN'`:
- Change to `user.role === 'SUPER_ADMIN' || user.role === 'ADMIN'` OR
- Use the permission system: `can(FEATURES.X, OPERATIONS.Y)`

Only **SUPER_ADMIN** has global access now. **ADMIN** is organization-scoped.
