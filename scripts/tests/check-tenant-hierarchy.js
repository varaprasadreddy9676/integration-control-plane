const { MongoClient } = require('mongodb');
const config = require('./config.json');

async function checkTenantHierarchy() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();
    const db = client.db(config.mongodb.database);

    console.log('\n=== Checking Tenant Hierarchy ===\n');

    // Check if entities/tenants table exists
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    console.log('Available collections:', collectionNames.filter(n =>
      n.includes('tenant') || n.includes('entity') || n.includes('org')
    ));
    console.log('');

    // Check for tenant 270 and its parent
    const tenants = [270, 778, 273, 145];

    for (const tenantId of tenants) {
      console.log(`\n--- Tenant ${tenantId} ---`);

      // Check in different possible collections
      if (collectionNames.includes('tenants')) {
        const tenant = await db.collection('tenants').findOne({ rid: tenantId });
        if (tenant) {
          console.log('Found in tenants collection:');
          console.log(`  RID: ${tenant.rid}`);
          console.log(`  Name: ${tenant.name || 'N/A'}`);
          console.log(`  Parent RID: ${tenant.parentRid || 'N/A'}`);
        }
      }

      if (collectionNames.includes('entities')) {
        const entity = await db.collection('entities').findOne({ rid: tenantId });
        if (entity) {
          console.log('Found in entities collection:');
          console.log(`  RID: ${entity.rid}`);
          console.log(`  Name: ${entity.name || 'N/A'}`);
          console.log(`  Parent RID: ${entity.parentRid || entity.parentRID || 'N/A'}`);
        }
      }

      if (collectionNames.includes('organizations')) {
        const org = await db.collection('organizations').findOne({ rid: tenantId });
        if (org) {
          console.log('Found in organizations collection:');
          console.log(`  RID: ${org.rid}`);
          console.log(`  Name: ${org.name || 'N/A'}`);
          console.log(`  Parent RID: ${org.parentRid || org.parentRID || 'N/A'}`);
        }
      }
    }

    // Try to find the getParentRidForEntity logic
    console.log('\n\n=== Testing getParentRidForEntity Logic ===\n');

    // Check tenant_cache collection (commonly used for tenant hierarchy)
    if (collectionNames.includes('tenant_cache')) {
      console.log('Found tenant_cache collection');
      const cache270 = await db.collection('tenant_cache').findOne({ rid: 270 });
      if (cache270) {
        console.log('Tenant 270 in cache:', JSON.stringify(cache270, null, 2));
      }
    }

  } finally {
    await client.close();
  }
}

checkTenantHierarchy().catch(console.error);
