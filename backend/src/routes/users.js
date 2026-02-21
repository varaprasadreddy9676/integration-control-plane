/**
 * User Management Routes
 *
 * Allows admins to create users and assign roles/permissions
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const data = require('../data');
const { log } = require('../logger');
const auth = require('../middleware/auth');
const { requirePermission, requireAdmin } = require('../middleware/permission');
const asyncHandler = require('../utils/async-handler');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { ROLES, getAllPermissions, getAllRoles, getUserPermissions } = require('../rbac/permissions');
const { auditUser, auditAdmin } = require('../middleware/audit');

const router = express.Router();

// All routes require JWT authentication
router.use(auth);

/**
 * GET /api/v1/users
 * List all users (requires users:view permission)
 */
router.get('/', requirePermission('users:view'), asyncHandler(async (req, res) => {
  const { role, isActive, search, page = 1, limit = 50 } = req.query;

  const filters = {};

  // Filter by role
  if (role) {
    filters.role = role;
  }

  // Filter by active status
  if (isActive !== undefined) {
    filters.isActive = isActive === 'true';
  }

  // Search by email or name
  if (search) {
    filters.$or = [
      { email: { $regex: search, $options: 'i' } },
      { name: { $regex: search, $options: 'i' } }
    ];
  }

  // Org users can only see users in their org
  if (req.user.role === 'ORG_ADMIN' || req.user.role === 'ORG_USER') {
    filters.orgId = req.user.orgId;
  }

  const result = await data.listUsers({
    ...filters,
    page: Number(page),
    limit: Number(limit)
  });

  const { users, total } = result;

  // Remove sensitive data
  const sanitizedUsers = users.map(user => ({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    permissions: user.permissions || [],
    isActive: user.isActive !== false,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin
  }));

  res.json({
    users: sanitizedUsers,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit)
  });
}));

/**
 * GET /api/v1/users/roles/available
 * Get all available roles
 * NOTE: This route MUST be defined before /:id to avoid route collision
 */
router.get('/roles/available', auth, asyncHandler(async (req, res) => {
  const allRoles = getAllRoles();

  // Org admins cannot see SUPER_ADMIN and ADMIN roles
  let availableRoles = allRoles;
  if (req.user.role === 'ORG_ADMIN') {
    availableRoles = Object.keys(allRoles)
      .filter(key => key !== 'SUPER_ADMIN' && key !== 'ADMIN')
      .reduce((obj, key) => {
        obj[key] = allRoles[key];
        return obj;
      }, {});
  }

  res.json({
    roles: availableRoles
  });
}));

/**
 * GET /api/v1/users/permissions/available
 * Get all available permissions
 * NOTE: This route MUST be defined before /:id to avoid route collision
 */
router.get('/permissions/available', auth, asyncHandler(async (req, res) => {
  const allPermissions = getAllPermissions();

  res.json({
    permissions: allPermissions
  });
}));

/**
 * GET /api/v1/users/:id
 * Get user by ID (requires users:view permission)
 */
router.get('/:id', requirePermission('users:view'), asyncHandler(async (req, res) => {
  const user = await data.getUserById(req.params.id);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Org users can only see users in their org
  if (req.user.role === 'ORG_ADMIN' || req.user.role === 'ORG_USER') {
    if (user.orgId !== req.user.orgId) {
      throw new NotFoundError('User not found');
    }
  }

  // Get user's combined permissions
  const allPermissions = getUserPermissions(user);

  res.json({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    customPermissions: user.permissions || [],
    allPermissions,
    isActive: user.isActive !== false,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    updatedAt: user.updatedAt
  });
}));

/**
 * POST /api/v1/users
 * Create new user (requires users:create permission)
 */
router.post('/', requirePermission('users:create'), asyncHandler(async (req, res) => {
  const { email, password, name, role, orgId, permissions } = req.body;

  // Validation
  if (!email || !password) {
    throw new ValidationError('Email and password are required');
  }

  if (!role || !ROLES[role]) {
    throw new ValidationError('Invalid role');
  }

  // Org admins can only create users in their org
  let targetOrgId = orgId;
  if (req.user.role === 'ORG_ADMIN') {
    targetOrgId = req.user.orgId;
  }

  // Validate orgId for non-super-admin roles
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && !targetOrgId) {
    throw new ValidationError('orgId is required for this role');
  }

  // Check if user already exists
  const existingUser = await data.getUserByEmail(email);
  if (existingUser) {
    throw new ValidationError('User with this email already exists');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user
  const newUser = {
    email: email.trim().toLowerCase(),
    name: name || email.split('@')[0],
    passwordHash,
    role,
    orgId: targetOrgId || null,
    permissions: permissions || [],
    isActive: true,
    createdAt: new Date(),
    createdBy: req.user.id
  };

  const result = await data.createUser(newUser);

  log('info', 'User created', {
    userId: result.insertedId.toString(),
    email: newUser.email,
    role: newUser.role,
    createdBy: req.user.id
  });

  // Audit log
  await auditUser.created(req, {
    id: result.insertedId.toString(),
    _id: result.insertedId,
    email: newUser.email,
    role: newUser.role,
    orgId: newUser.orgId
  });

  res.status(201).json({
    id: result.insertedId.toString(),
    email: newUser.email,
    name: newUser.name,
    role: newUser.role,
    orgId: newUser.orgId,
    permissions: newUser.permissions,
    isActive: newUser.isActive
  });
}));

/**
 * PUT /api/v1/users/:id
 * Update user (requires users:edit permission)
 */
router.put('/:id', requirePermission('users:edit'), asyncHandler(async (req, res) => {
  const { name, isActive } = req.body;

  const user = await data.getUserById(req.params.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Org admins can only edit users in their org
  if (req.user.role === 'ORG_ADMIN' && user.orgId !== req.user.orgId) {
    throw new NotFoundError('User not found');
  }

  // Users cannot deactivate themselves
  if (req.params.id === req.user.id && isActive === false) {
    throw new ValidationError('You cannot deactivate your own account');
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (isActive !== undefined) updates.isActive = isActive;
  updates.updatedAt = new Date();
  updates.updatedBy = req.user.id;

  await data.updateUser(req.params.id, updates);

  log('info', 'User updated', {
    userId: req.params.id,
    updates: Object.keys(updates),
    updatedBy: req.user.id
  });

  // Audit log
  await auditUser.updated(req, req.params.id, {
    before: { name: user.name, isActive: user.isActive },
    after: { name: updates.name, isActive: updates.isActive }
  });

  res.json({
    message: 'User updated successfully',
    userId: req.params.id
  });
}));

/**
 * PUT /api/v1/users/:id/role
 * Update user role (requires users:assign_roles permission)
 */
router.put('/:id/role', requirePermission('users:assign_roles'), asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (!role || !ROLES[role]) {
    throw new ValidationError('Invalid role');
  }

  const user = await data.getUserById(req.params.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Org admins can only manage users in their org and cannot assign SUPER_ADMIN or ADMIN
  if (req.user.role === 'ORG_ADMIN') {
    if (user.orgId !== req.user.orgId) {
      throw new NotFoundError('User not found');
    }
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
      throw new ValidationError('You cannot assign this role');
    }
  }

  // Users cannot change their own role
  if (req.params.id === req.user.id) {
    throw new ValidationError('You cannot change your own role');
  }

  await data.updateUser(req.params.id, {
    role,
    updatedAt: new Date(),
    updatedBy: req.user.id
  });

  log('info', 'User role updated', {
    userId: req.params.id,
    oldRole: user.role,
    newRole: role,
    updatedBy: req.user.id
  });

  // Audit log
  await auditUser.updated(req, req.params.id, {
    before: { role: user.role },
    after: { role }
  });

  res.json({
    message: 'User role updated successfully',
    userId: req.params.id,
    role
  });
}));

/**
 * PUT /api/v1/users/:id/permissions
 * Update user custom permissions (requires users:assign_permissions permission)
 */
router.put('/:id/permissions', requirePermission('users:assign_permissions'), asyncHandler(async (req, res) => {
  const { permissions } = req.body;

  if (!Array.isArray(permissions)) {
    throw new ValidationError('Permissions must be an array');
  }

  // Validate all permissions exist
  const validPermissions = getAllPermissions();
  const invalidPerms = permissions.filter(p => !validPermissions[p]);
  if (invalidPerms.length > 0) {
    throw new ValidationError(`Invalid permissions: ${invalidPerms.join(', ')}`);
  }

  const user = await data.getUserById(req.params.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Org admins can only manage users in their org
  if (req.user.role === 'ORG_ADMIN' && user.orgId !== req.user.orgId) {
    throw new NotFoundError('User not found');
  }

  await data.updateUser(req.params.id, {
    permissions,
    updatedAt: new Date(),
    updatedBy: req.user.id
  });

  log('info', 'User permissions updated', {
    userId: req.params.id,
    permissionsCount: permissions.length,
    updatedBy: req.user.id
  });

  // Audit log
  await auditUser.updated(req, req.params.id, {
    before: { permissions: user.permissions || [] },
    after: { permissions }
  });

  res.json({
    message: 'User permissions updated successfully',
    userId: req.params.id,
    permissions
  });
}));

/**
 * PUT /api/v1/users/:id/password
 * Update user password
 */
router.put('/:id/password', auth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    throw new ValidationError('Password must be at least 6 characters');
  }

  const user = await data.getUserById(req.params.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Users can only change their own password unless admin
  if (req.params.id !== req.user.id) {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      throw new ValidationError('You can only change your own password');
    }
  } else {
    // Verify current password
    const isValid = await bcrypt.compare(currentPassword || '', user.passwordHash || '');
    if (!isValid) {
      throw new ValidationError('Current password is incorrect');
    }
  }

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await data.updateUser(req.params.id, {
    passwordHash,
    updatedAt: new Date()
  });

  log('info', 'User password updated', {
    userId: req.params.id,
    updatedBy: req.user.id
  });

  await auditAdmin.passwordChanged(req, req.params.id);

  res.json({
    message: 'Password updated successfully'
  });
}));

/**
 * DELETE /api/v1/users/:id
 * Delete user (requires users:delete permission)
 */
router.delete('/:id', requirePermission('users:delete'), asyncHandler(async (req, res) => {
  const user = await data.getUserById(req.params.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Users cannot delete themselves
  if (req.params.id === req.user.id) {
    throw new ValidationError('You cannot delete your own account');
  }

  // Org admins can only delete users in their org
  if (req.user.role === 'ORG_ADMIN' && user.orgId !== req.user.orgId) {
    throw new NotFoundError('User not found');
  }

  // Soft delete (set isActive = false)
  await data.updateUser(req.params.id, {
    isActive: false,
    deletedAt: new Date(),
    deletedBy: req.user.id
  });

  log('info', 'User deleted', {
    userId: req.params.id,
    deletedBy: req.user.id
  });

  // Audit log
  await auditUser.deleted(req, req.params.id);

  res.json({
    message: 'User deleted successfully',
    userId: req.params.id
  });
}));

module.exports = router;
