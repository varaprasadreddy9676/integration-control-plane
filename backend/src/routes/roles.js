const express = require('express');
const { log } = require('../logger');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const { ValidationError, NotFoundError } = require('../utils/errors');
const mongodb = require('../mongodb');
const { auditRole } = require('../middleware/audit');
const { clearRoleCache } = require('../rbac/features');

const router = express.Router();

// All role routes require SUPER_ADMIN or ADMIN role
router.use(auth.requireRole(['SUPER_ADMIN', 'ADMIN']));

/**
 * GET /api/v1/roles
 * Get all available roles and their permissions
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const db = await mongodb.getDbSafe();

    // Get custom roles from database
    const customRoles = await db.collection('roles').find({}).toArray();

    // Get default roles from features.js
    const { getAllRoles, getRoleFeatures } = require('../rbac/features');
    const defaultRoles = getAllRoles();

    // Combine default and custom roles
    const roles = await Promise.all(
      Object.keys(defaultRoles).map(async (roleKey) => {
        const customRole = customRoles.find((r) => r.role === roleKey);

        if (customRole) {
          // Use custom permissions if they exist
          return {
            role: roleKey,
            name: customRole.name || defaultRoles[roleKey].name,
            description: customRole.description || defaultRoles[roleKey].description,
            scope: customRole.scope || defaultRoles[roleKey].scope,
            features: customRole.features || {},
            isCustom: true,
          };
        }

        // Use default permissions
        return {
          role: roleKey,
          name: defaultRoles[roleKey].name,
          description: defaultRoles[roleKey].description,
          scope: defaultRoles[roleKey].scope,
          features: await getRoleFeatures(roleKey),
          isCustom: false,
        };
      })
    );

    // Add any custom roles that don't exist in defaults
    customRoles.forEach((customRole) => {
      if (!defaultRoles[customRole.role]) {
        roles.push({
          role: customRole.role,
          name: customRole.name,
          description: customRole.description,
          scope: customRole.scope,
          features: customRole.features || {},
          isCustom: true,
        });
      }
    });

    res.json({ roles });
  })
);

/**
 * GET /api/v1/roles/:role
 * Get a specific role's permissions
 */
router.get(
  '/:role',
  asyncHandler(async (req, res) => {
    const { role } = req.params;
    const db = await mongodb.getDbSafe();

    // Check if custom role exists in database
    const customRole = await db.collection('roles').findOne({ role });

    if (customRole) {
      return res.json({
        role: customRole.role,
        name: customRole.name,
        description: customRole.description,
        scope: customRole.scope,
        features: customRole.features,
        isCustom: true,
      });
    }

    // Check if it's a default role
    const { getRoleInfo, getRoleFeatures, getAllRoles } = require('../rbac/features');
    const roleInfo = getRoleInfo(role);

    if (!roleInfo) {
      throw new NotFoundError('Role not found');
    }

    res.json({
      role,
      name: roleInfo.name,
      description: roleInfo.description,
      scope: roleInfo.scope,
      features: await getRoleFeatures(role),
      isCustom: false,
    });
  })
);

/**
 * POST /api/v1/roles
 * Create a new custom role
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, description, scope, features } = req.body || {};

    if (!name || !description || !scope) {
      throw new ValidationError('name, description, and scope are required');
    }

    // Generate role key from name
    const role = name.toUpperCase().replace(/\s+/g, '_');

    // Validate scope
    if (!['global', 'organization', 'api'].includes(scope)) {
      throw new ValidationError('scope must be global, organization, or api');
    }

    const db = await mongodb.getDbSafe();

    // Check if role already exists
    const existing = await db.collection('roles').findOne({ role });
    if (existing) {
      throw new ValidationError('Role already exists');
    }

    // Check if it's a default role (can't override)
    const { getAllRoles } = require('../rbac/features');
    const defaultRoles = getAllRoles();
    if (defaultRoles[role]) {
      throw new ValidationError('Cannot create custom role with same name as default role');
    }

    const roleDoc = {
      role,
      name,
      description,
      scope,
      features: features || {},
      createdBy: req.user?.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection('roles').insertOne(roleDoc);

    // Clear role cache to ensure new role is loaded
    clearRoleCache(role);

    // Audit log
    await auditRole.created(req, roleDoc);

    log('info', 'Custom role created', {
      adminId: req.user?.id,
      role,
    });

    res.status(201).json({
      role,
      name,
      description,
      scope,
      features: features || {},
      isCustom: true,
    });
  })
);

/**
 * PUT /api/v1/roles/:role
 * Update role permissions
 */
router.put(
  '/:role',
  asyncHandler(async (req, res) => {
    const { role } = req.params;
    const { name, description, features } = req.body || {};

    // Can't edit SUPER_ADMIN role
    if (role === 'SUPER_ADMIN') {
      throw new ValidationError('Cannot modify SUPER_ADMIN role');
    }

    const db = await mongodb.getDbSafe();

    // Check if custom role exists
    let customRole = await db.collection('roles').findOne({ role });

    const updates = {
      updatedAt: new Date(),
      updatedBy: req.user?.id,
    };

    if (name) updates.name = name;
    if (description) updates.description = description;
    if (features !== undefined) updates.features = features;

    if (customRole) {
      // Update existing custom role
      await db.collection('roles').updateOne({ role }, { $set: updates });
    } else {
      // Create override for default role
      const { getRoleInfo, getRoleFeatures } = require('../rbac/features');
      const roleInfo = getRoleInfo(role);

      if (!roleInfo) {
        throw new NotFoundError('Role not found');
      }

      await db.collection('roles').insertOne({
        role,
        name: name || roleInfo.name,
        description: description || roleInfo.description,
        scope: roleInfo.scope,
        features: features || (await getRoleFeatures(role)),
        createdBy: req.user?.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Fetch updated role
    customRole = await db.collection('roles').findOne({ role });

    // Clear role cache to ensure updated role is loaded
    clearRoleCache(role);

    // Audit log
    await auditRole.updated(req, role, {
      before: { features: {} },
      after: { features: customRole.features },
    });

    log('info', 'Role permissions updated', {
      adminId: req.user?.id,
      role,
    });

    res.json({
      role: customRole.role,
      name: customRole.name,
      description: customRole.description,
      scope: customRole.scope,
      features: customRole.features,
      isCustom: true,
    });
  })
);

/**
 * DELETE /api/v1/roles/:role
 * Delete a custom role (only custom roles can be deleted)
 */
router.delete(
  '/:role',
  asyncHandler(async (req, res) => {
    const { role } = req.params;

    // Can't delete default roles
    const { getAllRoles } = require('../rbac/features');
    const defaultRoles = getAllRoles();
    if (defaultRoles[role]) {
      throw new ValidationError('Cannot delete default role');
    }

    const db = await mongodb.getDbSafe();

    const result = await db.collection('roles').deleteOne({ role });

    if (result.deletedCount === 0) {
      throw new NotFoundError('Role not found');
    }

    // Clear role cache since role was deleted
    clearRoleCache(role);

    // Audit log
    await auditRole.deleted(req, role);

    log('info', 'Custom role deleted', {
      adminId: req.user?.id,
      role,
    });

    res.json({ message: 'Role deleted successfully' });
  })
);

module.exports = router;
