# Simplified Feature-Based Permissions - Summary

## What Changed

### Before (Complex)
- 50+ granular permissions like `integration:create`, `integration:edit`, `integration:delete`, `integration:activate`, `integration:test`, `integration:configure_auth`, etc.
- Hard to manage and understand
- Adding new features required updating multiple permission strings

### After (Simple)
- **Features** - High-level capabilities (integrations, ai, logs, etc.)
- **Operations** - Standard actions (read, write, delete, execute, configure, export)
- **Roles** - Simple mappings of features → operations

---

## File Structure

```
backend/src/
├── rbac/
│   ├── features.js          ← NEW: Simple feature-based permissions
│   └── permissions.js        ← OLD: Complex granular permissions (deprecated)
├── middleware/
│   ├── feature-permission.js ← NEW: Simple middleware
│   └── permission.js         ← OLD: Complex middleware (deprecated)
└── routes/
    ├── ai.js                 ← UPDATED: Uses new system
    └── ai-config.js          ← NEW: AI configuration routes
```

---

## How It Works

### 1. Define Features (`rbac/features.js`)
```javascript
const FEATURES = {
  AI: 'ai',
  AI_CONFIG: 'ai_config',
  INTEGRATIONS: 'integrations',
  // ... etc
};
```

### 2. Map Roles to Features
```javascript
const ROLE_FEATURES = {
  ORG_ADMIN: {
    features: {
      [FEATURES.AI]: ['read', 'write', 'execute'],
      [FEATURES.AI_CONFIG]: ['read', 'write', 'configure']
    }
  },
  INTEGRATION_EDITOR: {
    features: {
      [FEATURES.AI]: ['read', 'write', 'execute'],
      // No AI_CONFIG access - can't change API keys
    }
  }
};
```

### 3. Use in Routes
```javascript
const { requireFeature, FEATURES } = require('../middleware/feature-permission');

// Use AI features
router.post('/ai/generate',
  auth,
  requireFeature(FEATURES.AI, 'execute'),
  async (req, res) => { /* ... */ }
);

// Configure AI (API keys, provider)
router.put('/ai-config',
  auth,
  requireFeature(FEATURES.AI_CONFIG, 'configure'),
  async (req, res) => { /* ... */ }
);
```

---

## AI Feature Access

### Who Can Use AI?
- ✅ SUPER_ADMIN
- ✅ ADMIN
- ✅ ORG_ADMIN
- ✅ INTEGRATION_EDITOR (can use, but can't configure)
- ❌ VIEWER
- ❌ ORG_USER

### Who Can Configure AI (API Keys, Provider)?
- ✅ SUPER_ADMIN
- ✅ ADMIN
- ✅ ORG_ADMIN
- ❌ INTEGRATION_EDITOR (can't change AI settings)
- ❌ VIEWER
- ❌ ORG_USER

---

## Adding a New Feature

Example: Adding "Reports" feature

1. **Add to FEATURES**:
```javascript
const FEATURES = {
  // ... existing
  REPORTS: 'reports'
};
```

2. **Map to Roles**:
```javascript
const ROLE_FEATURES = {
  SUPER_ADMIN: {
    features: {
      [FEATURES.REPORTS]: ['read', 'write', 'delete', 'export']
    }
  },
  ORG_ADMIN: {
    features: {
      [FEATURES.REPORTS]: ['read', 'write', 'export']
    }
  },
  VIEWER: {
    features: {
      [FEATURES.REPORTS]: ['read']
    }
  }
};
```

3. **Use in Routes**:
```javascript
router.get('/reports',
  auth,
  requireFeature(FEATURES.REPORTS, 'read'),
  getReports
);

router.post('/reports',
  auth,
  requireFeature(FEATURES.REPORTS, 'write'),
  createReport
);
```

**Done! Took 2 minutes.**

---

## Benefits

✅ **Super Simple** - Just features + operations, no complex strings
✅ **Consistent** - Same operations across all features
✅ **Easy to Extend** - Add new features in minutes
✅ **Self-Documenting** - Clear what each role can do
✅ **No Complex Logic** - Just simple mappings

---

## Migration Path

### Option 1: Gradual Migration (Recommended)
1. Keep old system running
2. Migrate routes one-by-one to new system
3. Remove old system when done

### Option 2: Big Bang
1. Update all routes at once
2. Remove old permission system
3. Update frontend to use new feature-based checks

---

## Next Steps

1. ✅ Created feature-based permission system
2. ✅ Updated AI routes to use new system
3. ✅ Added AI configuration routes (for API keys, provider)
4. 🔲 Migrate other routes (integrations, users, logs, etc.)
5. 🔲 Update frontend to use feature-based checks
6. 🔲 Add AI config UI for ORG_ADMIN
7. 🔲 Remove old permission system

---

**Questions? Check `FEATURE-PERMISSIONS-GUIDE.md` for detailed examples.**
