const { MongoClient } = require('mongodb');
const config = require('./config.json');

async function checkFailedEvents() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();
    const db = client.db(config.mongodb.database);

    console.log('\n=== Checking Failed Events (NO_WEBHOOK) ===\n');

    // Find recent events with NO_WEBHOOK error
    const failedEvents = await db.collection('event_audit')
      .find({
        skipCategory: 'NO_WEBHOOK',
        status: 'SKIPPED'
      })
      .sort({ receivedAt: -1 })
      .limit(10)
      .toArray();

    console.log(`Found ${failedEvents.length} recent NO_WEBHOOK events\n`);

    failedEvents.forEach((event, i) => {
      console.log(`${i + 1}. Event ID: ${event.eventId || event._id}`);
      console.log(`   Event Type: ${event.eventType}`);
      console.log(`   Tenant ID: ${event.tenantId}`);
      console.log(`   Received At: ${event.receivedAt}`);
      console.log(`   Skip Reason: ${event.skipReason}`);
      console.log(`   Payload Sample:`, JSON.stringify(event.payload || {}).substring(0, 200));
      console.log('');
    });

    // Check what event types are failing
    const failedByType = await db.collection('event_audit').aggregate([
      { $match: { skipCategory: 'NO_WEBHOOK' } },
      { $group: { _id: { eventType: '$eventType', tenantId: '$tenantId' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]).toArray();

    console.log('=== Failed Events by Type and Tenant ===\n');
    failedByType.forEach(item => {
      console.log(`EventType: ${item._id.eventType}, TenantId: ${item._id.tenantId}, Count: ${item.count}`);
    });

    // Check if there are any recent successful deliveries for tenant 145
    console.log('\n=== Recent Successful Events for Tenant 145 ===\n');
    const successEvents = await db.collection('event_audit')
      .find({
        tenantId: 145,
        status: 'DELIVERED'
      })
      .sort({ receivedAt: -1 })
      .limit(5)
      .toArray();

    console.log(`Found ${successEvents.length} recent successful events\n`);
    successEvents.forEach((event, i) => {
      console.log(`${i + 1}. ${event.eventType} - ${event.receivedAt}`);
    });

  } finally {
    await client.close();
  }
}

checkFailedEvents().catch(console.error);
