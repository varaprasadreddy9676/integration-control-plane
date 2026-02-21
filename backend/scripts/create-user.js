const bcrypt = require('bcryptjs');
const mongodb = require('../src/mongodb');
const data = require('../src/data');
const { log } = require('../src/logger');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.replace(/^--/, '');
    const value = args[i + 1];
    out[key] = value;
    i += 0;
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const email = args.email;
  const password = args.password;
  const role = args.role || 'ORG_ADMIN';
  const orgId = args.orgId ? Number(args.orgId) : null;

  if (!email || !password) {
    console.log('Usage: node scripts/create-user.js --email user@example.com --password secret --role ADMIN|ORG_ADMIN|ORG_USER --orgId 100');
    process.exit(1);
  }

  if (role !== 'ADMIN' && (!orgId || !Number.isFinite(orgId))) {
    console.log('orgId is required for ORG_ADMIN/ORG_USER roles');
    process.exit(1);
  }

  await mongodb.connect();

  const existing = await data.getUserByEmail(email);
  if (existing) {
    console.log('User already exists:', existing.email);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await data.createUser({
    email,
    passwordHash,
    role,
    orgId
  });

  log('info', 'User created', {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    orgId: user.orgId || null
  });

  console.log('Created user:', {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    orgId: user.orgId || null
  });

  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to create user:', err.message);
  process.exit(1);
});
