const { MongoClient } = require('mongodb');
const config = require('./config.json');

async function checkDuplicates() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();
    const db = client.db(config.mongodb.database);

    console.log('Checking for duplicate eventIds...\n');

    // Find duplicate eventIds
    const duplicates = await db.collection('notification_queue').aggregate([
      { $group: {
        _id: '$eventId',
        count: { $sum: 1 },
        docs: { $push: { _id: '$_id', eventType: '$eventType', tenantId: '$tenantId', status: '$status' } }
      }},
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]).toArray();

    console.log(`Found ${duplicates.length} eventIds with duplicates\n`);

    if (duplicates.length > 0) {
      console.log('First 10 duplicates:\n');
      duplicates.forEach((dup, idx) => {
        console.log(`${idx + 1}. eventId: ${dup._id} (${dup.count} occurrences)`);
        dup.docs.forEach(doc => {
          console.log(`   - _id: ${doc._id}, type: ${doc.eventType}, tenant: ${doc.tenantId}, status: ${doc.status}`);
        });
        console.log('');
      });
    } else {
      console.log('✅ No duplicate eventIds found!');
      console.log('\nThe issue might be with missing _id fields or the rowKey function.');
    }

    // Check if any records are missing both eventId and _id
    const missingKeys = await db.collection('notification_queue').countDocuments({
      $or: [
        { eventId: { $exists: false } },
        { eventId: null },
        { eventId: '' }
      ]
    });

    console.log(`Records missing eventId: ${missingKeys}`);

  } finally {
    await client.close();
  }
}

checkDuplicates().catch(console.error);
