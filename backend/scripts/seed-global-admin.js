/* eslint-disable no-console */
const bcrypt = require('bcryptjs');
const mongodb = require('../src/mongodb');

const getArg = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
};

const emailArg = getArg('--email');
const passwordArg = getArg('--password');
const activeArg = getArg('--active');

const email = (emailArg || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = passwordArg || process.env.ADMIN_PASSWORD;
const isActive = activeArg ? activeArg !== 'false' : true;

const usage = () => {
  console.log('Usage:');
  console.log('  node backend/scripts/seed-global-admin.js --email admin@example.com --password \"StrongPass123\"');
  console.log('');
  console.log('Or via env:');
  console.log('  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=\"StrongPass123\" node backend/scripts/seed-global-admin.js');
};

async function main() {
  if (!email || !password) {
    console.error('Missing required --email or --password.');
    usage();
    process.exit(1);
  }

  const db = await mongodb.getDbSafe();
  const now = new Date();
  const passwordHash = await bcrypt.hash(password, 12);

  const update = {
    email,
    passwordHash,
    role: 'ADMIN',
    orgId: null,
    isActive,
    updatedAt: now
  };

  const result = await db.collection('users').updateOne(
    { email },
    { $set: update, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );

  const action = result.upsertedCount ? 'created' : 'updated';
  console.log(`Global admin ${action}: ${email}`);

  await mongodb.close();
}

main().catch((err) => {
  console.error('Failed to seed global admin:', err.message);
  process.exit(1);
});
