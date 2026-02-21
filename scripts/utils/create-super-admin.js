/**
 * Create Super Admin User
 *
 * Usage:
 *   node create-super-admin.js
 *   node create-super-admin.js admin@yourdomain.com SecurePassword123!
 */

const bcrypt = require('bcryptjs');
const mongodb = require('./src/mongodb');
const config = require('./src/config');

async function createSuperAdmin() {
  try {
    console.log('🚀 Creating Super Admin User...\n');

    // Connect to MongoDB
    await mongodb.connect();
    const db = await mongodb.getDb();
    console.log('✓ Connected to MongoDB');

    // Get email and password from command line or use defaults
    const email = process.argv[2] || 'admin@example.com';
    const password = process.argv[3] || 'admin123';

    // Validate email
    if (!email.includes('@')) {
      console.error('❌ Error: Invalid email address');
      process.exit(1);
    }

    // Validate password
    if (password.length < 6) {
      console.error('❌ Error: Password must be at least 6 characters');
      process.exit(1);
    }

    // Check if user already exists
    const existing = await db.collection('users').findOne({
      email: email.trim().toLowerCase()
    });

    if (existing) {
      console.log('\n⚠️  User already exists!');
      console.log('Email:', existing.email);
      console.log('Role:', existing.role);
      console.log('Created:', existing.createdAt);

      // Ask if want to reset password
      console.log('\nTo reset password, delete the user first:');
      console.log(`db.users.deleteOne({ email: "${email}" })`);

      await mongodb.close();
      process.exit(0);
    }

    // Hash password
    console.log('✓ Hashing password...');
    const passwordHash = await bcrypt.hash(password, 10);

    // Create super admin user
    const result = await db.collection('users').insertOne({
      email: email.trim().toLowerCase(),
      name: 'Super Admin',
      passwordHash,
      role: 'SUPER_ADMIN',
      orgId: null,
      permissions: [],
      isActive: true,
      createdAt: new Date(),
      createdBy: 'system'
    });

    console.log('✓ Super Admin created successfully!\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email:    ', email);
    console.log('🔑 Password: ', password);
    console.log('👤 User ID:  ', result.insertedId.toString());
    console.log('🎭 Role:     ', 'SUPER_ADMIN');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('⚠️  IMPORTANT SECURITY NOTES:');
    console.log('1. Change this password after first login!');
    console.log('2. Keep these credentials secure');
    console.log('3. Do not share with others\n');

    console.log('🎯 Next Steps:');
    console.log('1. Login at: POST /api/v1/auth/login');
    console.log('2. Create additional users with appropriate roles');
    console.log('3. See RBAC-GUIDE.md for complete documentation\n');

    await mongodb.close();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error creating super admin:', error.message);
    console.error(error);

    try {
      await mongodb.close();
    } catch (closeError) {
      // Ignore close errors
    }

    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  createSuperAdmin();
}

module.exports = createSuperAdmin;
