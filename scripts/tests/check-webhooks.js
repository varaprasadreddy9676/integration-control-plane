const { MongoClient } = require('mongodb');
const config = require('./config.json');

async function checkWebhooks() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();
    const db = client.db(config.mongodb.database);

    console.log('\n=== Checking OUTBOUND Webhooks in MongoDB ===\n');

    // Count total configurations
    const totalCount = await db.collection('integration_configs').countDocuments({});
    console.log(`Total integration configs: ${totalCount}`);

    // Count OUTBOUND webhooks
    const outboundCount = await db.collection('integration_configs').countDocuments({
      direction: 'OUTBOUND'
    });
    console.log(`OUTBOUND configs: ${outboundCount}`);

    // Count INBOUND webhooks
    const inboundCount = await db.collection('integration_configs').countDocuments({
      direction: 'INBOUND'
    });
    console.log(`INBOUND configs: ${inboundCount}`);

    // Count active OUTBOUND webhooks
    const activeOutbound = await db.collection('integration_configs').countDocuments({
      direction: 'OUTBOUND',
      isActive: true
    });
    console.log(`Active OUTBOUND configs: ${activeOutbound}`);

    // Count OUTBOUND webhooks by tenant
    const byTenant = await db.collection('integration_configs').aggregate([
      { $match: { direction: 'OUTBOUND' } },
      { $group: { _id: '$tenantId', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();

    console.log('\nOUTBOUND configs by tenantId:');
    byTenant.forEach(t => {
      console.log(`  Tenant ${t._id}: ${t.count} webhooks`);
    });

    // Check for multi-action webhooks
    const multiAction = await db.collection('integration_configs').countDocuments({
      direction: 'OUTBOUND',
      'actions.1': { $exists: true } // Has at least 2 actions
    });
    console.log(`\nOUTBOUND configs with multiple actions: ${multiAction}`);

    // Sample some OUTBOUND webhooks
    console.log('\n=== Sample OUTBOUND Webhooks ===\n');
    const samples = await db.collection('integration_configs')
      .find({ direction: 'OUTBOUND', tenantId: 145 })
      .limit(5)
      .toArray();

    samples.forEach((webhook, i) => {
      console.log(`${i + 1}. ${webhook.name}`);
      console.log(`   Type: ${webhook.type}`);
      console.log(`   TenantId: ${webhook.tenantId}`);
      console.log(`   Active: ${webhook.isActive}`);
      console.log(`   Actions: ${webhook.actions ? webhook.actions.length : 0}`);
      console.log('');
    });

    // Check if there are any webhooks for specific event types
    console.log('=== Checking Specific Event Types ===\n');
    const eventTypes = ['APPOINTMENT_CONFIRMATION', 'PATIENT_REGISTERED', 'OP_VISIT_CREATED'];

    for (const eventType of eventTypes) {
      const count = await db.collection('integration_configs').countDocuments({
        direction: 'OUTBOUND',
        type: eventType,
        tenantId: 145,
        isActive: true
      });
      console.log(`${eventType}: ${count} active webhooks`);

      if (count > 0) {
        const webhook = await db.collection('integration_configs').findOne({
          direction: 'OUTBOUND',
          type: eventType,
          tenantId: 145,
          isActive: true
        });
        console.log(`  → Found: ${webhook.name}, Actions: ${webhook.actions?.length || 0}`);
      }
    }

  } finally {
    await client.close();
  }
}

checkWebhooks().catch(console.error);
