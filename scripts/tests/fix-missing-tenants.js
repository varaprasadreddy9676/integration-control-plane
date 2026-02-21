const { MongoClient } = require('mongodb');
const config = require('./config.json');

/**
 * Fix Missing Tenants
 *
 * This script adds missing tenant entries to org_units collection
 * so they can inherit webhooks from their parent organization (145)
 */

async function fixMissingTenants() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();
    const db = client.db(config.mongodb.database);

    console.log('\n=== Fixing Missing Tenants ===\n');

    // Define missing tenants and their parent orgId
    // You need to confirm which organization these tenants belong to
    const missingTenants = [
      {
        rid: 270,
        name: 'Tenant 270',  // UPDATE with actual name
        orgId: 145,  // Assuming they belong to Nova IVF - CONFIRM THIS
        type: 'UNIT',
        isActive: true
      },
      {
        rid: 273,
        name: 'Tenant 273',  // UPDATE with actual name
        orgId: 145,  // Assuming they belong to Nova IVF - CONFIRM THIS
        type: 'UNIT',
        isActive: true
      }
    ];

    console.log('⚠️  WARNING: Please verify these tenant-to-org mappings:\n');
    missingTenants.forEach(t => {
      console.log(`  Tenant ${t.rid} → Organization ${t.orgId}`);
    });
    console.log('\nPress Ctrl+C to cancel, or the script will continue in 5 seconds...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    for (const tenant of missingTenants) {
      const existing = await db.collection('org_units').findOne({ rid: tenant.rid });

      if (existing) {
        console.log(`✓ Tenant ${tenant.rid} already exists, skipping`);
        continue;
      }

      const result = await db.collection('org_units').insertOne({
        rid: tenant.rid,
        name: tenant.name,
        orgId: tenant.orgId,
        type: tenant.type,
        isActive: tenant.isActive,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      console.log(`✅ Added tenant ${tenant.rid} with orgId ${tenant.orgId}`);
    }

    console.log('\n=== Verification ===\n');

    // Test the fix
    const data = require('./src/data');

    for (const tenant of missingTenants) {
      const parentRid = await data.getParentRidForEntity(tenant.rid);
      console.log(`Tenant ${tenant.rid} parent: ${parentRid} ${parentRid === tenant.orgId ? '✅' : '❌'}`);

      const integrations = await data.listIntegrationsForDelivery(tenant.rid, 'APPOINTMENT_CONFIRMATION');
      console.log(`  → Found ${integrations.length} integrations for APPOINTMENT_CONFIRMATION`);
    }

    console.log('\n✅ Fix complete!\n');

  } finally {
    await client.close();
  }
}

// Execute the fix:
fixMissingTenants().catch(console.error);
