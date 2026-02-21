const { MongoClient } = require('mongodb');
const config = require('./config.json');

async function fixTimestamps() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();
    const db = client.db(config.mongodb.database);
    
    // Find all activities with string timestamps
    const activities = await db.collection('user_activities').find({
      timestamp: { $type: 'string' }
    }).toArray();
    
    console.log(`Found ${activities.length} activities with string timestamps`);
    
    if (activities.length === 0) {
      console.log('No timestamps to fix');
      return;
    }
    
    // Update each activity
    let updated = 0;
    for (const activity of activities) {
      await db.collection('user_activities').updateOne(
        { _id: activity._id },
        { 
          $set: { 
            timestamp: new Date(activity.timestamp),
            date: new Date(activity.timestamp).toISOString().split('T')[0],
            hour: new Date(activity.timestamp).getHours()
          }
        }
      );
      updated++;
    }
    
    console.log(`Updated ${updated} activities`);
    
    // Verify
    const remaining = await db.collection('user_activities').countDocuments({
      timestamp: { $type: 'string' }
    });
    console.log(`Remaining string timestamps: ${remaining}`);
    
  } finally {
    await client.close();
  }
}

fixTimestamps().catch(console.error);
