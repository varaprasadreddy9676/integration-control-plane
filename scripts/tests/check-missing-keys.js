const { MongoClient } = require('mongodb');
const config = require('./config.json');

async function checkMissingKeys() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();
    const db = client.db(config.mongodb.database);

    console.log('Checking for records with missing key fields...\n');

    // Check for records missing eventId
    const missingEventId = await db.collection('notification_queue').countDocuments({
      $or: [
        { eventId: { $exists: false } },
        { eventId: null },
        { eventId: '' }
      ]
    });

    // Check for records missing _id (should be impossible in MongoDB)
    const missingId = await db.collection('notification_queue').countDocuments({
      $or: [
        { _id: { $exists: false } },
        { _id: null }
      ]
    });

    console.log(`Records missing eventId: ${missingEventId}`);
    console.log(`Records missing _id: ${missingId}`);

    // Get a sample of records to see their key fields
    const sample = await db.collection('notification_queue').find({})
      .limit(5)
      .project({ eventId: 1, _id: 1, eventType: 1, tenantId: 1 })
      .toArray();

    console.log('\nSample records with their keys:');
    sample.forEach((doc, idx) => {
      console.log(`${idx + 1}. eventId: ${doc.eventId || 'MISSING'}, _id: ${doc._id}, eventType: ${doc.eventType}, tenantId: ${doc.tenantId}`);
    });

    // Check if eventIds look like "145-PATIENT_REGISTERED-32355"
    const weirdFormat = await db.collection('notification_queue').find({
      eventId: /^\d+-[A-Z_]+-\d+$/
    }).limit(5).toArray();

    if (weirdFormat.length > 0) {
      console.log('\n⚠️ Found eventIds with unexpected format (tenantId-eventType-id):');
      weirdFormat.forEach(doc => {
        console.log(`  - ${doc.eventId}`);
      });
    }

  } finally {
    await client.close();
  }
}

checkMissingKeys().catch(console.error);
