const { MongoClient } = require('mongodb');
const config = require('./config.json');

async function test() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();
    const db = client.db(config.mongodb.database);

    // Check timestamp type now
    const sample = await db.collection('user_activities').findOne({});
    console.log('Timestamp is now Date?', sample.timestamp instanceof Date);
    console.log('Sample timestamp:', sample.timestamp);

    // Test the query that was failing before
    const query = {
      timestamp: {
        $gte: new Date('2026-01-16'),
        $lte: new Date('2026-02-16')
      }
    };
    const count = await db.collection('user_activities').countDocuments(query);
    console.log('\nActivities in date range (last 30 days):', count);

    // Get sample activities
    const activities = await db.collection('user_activities')
      .find(query)
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();

    console.log('\nSample activities:');
    activities.forEach((a, i) => {
      console.log(`${i+1}. ${a.event} - ${a.userEmail} - ${a.timestamp.toISOString()}`);
    });

  } finally {
    await client.close();
  }
}

test().catch(console.error);
