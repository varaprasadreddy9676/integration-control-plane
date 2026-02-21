const { MongoClient } = require('mongodb');
const config = require('./config.json');
const { queryActivities } = require('./src/services/user-activity-tracker');

async function testActivitiesAPI() {
  const client = new MongoClient(config.mongodb.uri);
  try {
    await client.connect();

    console.log('Testing queryActivities function for orgId 648...\n');

    // Test with no filters (like the UI does initially)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const now = new Date();

    const result = await queryActivities({
      startDate: thirtyDaysAgo.toISOString(),
      endDate: now.toISOString(),
      orgId: 648,
      limit: 50,
      page: 1
    });

    console.log(`Query parameters:`);
    console.log(`  startDate: ${thirtyDaysAgo.toISOString()}`);
    console.log(`  endDate: ${now.toISOString()}`);
    console.log(`  orgId: 648`);
    console.log(`  limit: 50`);
    console.log(`  page: 1`);

    console.log(`\nResult:`);
    console.log(`  Total activities: ${result.pagination?.total || 0}`);
    console.log(`  Returned activities: ${result.activities?.length || 0}`);

    if (result.activities && result.activities.length > 0) {
      console.log('\nFirst 3 activities:');
      result.activities.slice(0, 3).forEach((activity, idx) => {
        console.log(`  ${idx + 1}. ${activity.event} - ${activity.userEmail} - ${activity.timestamp}`);
      });
    } else {
      console.log('\n❌ No activities returned!');
      console.log('Full result:', JSON.stringify(result, null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

testActivitiesAPI().catch(console.error);
