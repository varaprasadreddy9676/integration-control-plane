const { MongoClient } = require('mongodb');
const config = require('./config.json');

async function test() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();
    const db = client.db(config.mongodb.database);
    
    const sample = await db.collection('user_activities').findOne({});
    console.log('Timestamp type:', typeof sample.timestamp);
    console.log('Timestamp value:', sample.timestamp);
    console.log('Is Date?', sample.timestamp instanceof Date);
    
    const query = { timestamp: { $gte: new Date('2026-01-16'), $lte: new Date('2026-02-16') } };
    const count = await db.collection('user_activities').countDocuments(query);
    console.log('\nActivities in range:', count);
    
  } finally {
    await client.close();
  }
}

test().catch(console.error);
