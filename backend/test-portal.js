const { initDataLayer } = require('./src/data/index');
const mongodb = require('./src/mongodb');
const users = require('./src/data/users');
const crypto = require('./src/utils/crypto');

async function run() {
  await initDataLayer();
  
  // Find super admin
  const admin = await users.getUserByEmail('admin@eventgateway.local');
  if (!admin) {
    console.log("Admin not found!");
    process.exit(1);
  }
  
  // Create API key manually via mongo since createApiKey isn't exported directly
  const db = mongodb.getDb();
  
  const rawKey = `sk_test_${crypto.generateRandomString(32)}`;
  const keyHash = crypto.hashValue(rawKey);
  
  await db.collection('api_keys').insertOne({
    userId: admin._id,
    name: 'Portal Test Key 4',
    prefix: 'sk_test_',
    last4: rawKey.slice(-4),
    keyHash: keyHash,
    createdAt: new Date(),
    expiresAt: null,
    lastUsedAt: null
  });

  console.log(`\n\nAPI_KEY=${rawKey}\n\n`);
  
  await mongodb.close();
  process.exit(0);
}
run();
