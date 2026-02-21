/**
 * Test script to verify AI interaction logging
 */

const mongodb = require('./src/mongodb');
const config = require('./src/config');

async function testInteractions() {
  try {
    // Connect to MongoDB
    await mongodb.connect();
    console.log('Connected to MongoDB');

    const db = await mongodb.getDbSafe();

    // Query recent AI interactions
    const interactions = await db
      .collection('ai_interactions')
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    console.log(`\nFound ${interactions.length} AI interactions\n`);

    interactions.forEach((interaction, index) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Interaction #${index + 1}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`Operation: ${interaction.operation}`);
      console.log(`Entity: ${interaction.entityParentRid}`);
      console.log(`Provider: ${interaction.provider}`);
      console.log(`Success: ${interaction.success}`);
      console.log(`Latency: ${interaction.metadata.latencyMs}ms`);
      console.log(`Created: ${interaction.createdAt}`);

      console.log(`\n--- REQUEST ---`);
      console.log(`Data:`, JSON.stringify(interaction.request.data, null, 2));

      if (interaction.request.systemPrompt) {
        console.log(`\nSystem Prompt (first 200 chars):`);
        console.log(interaction.request.systemPrompt.substring(0, 200) + '...');
      }

      if (interaction.request.prompt) {
        console.log(`\nUser Prompt (first 500 chars):`);
        console.log(interaction.request.prompt.substring(0, 500) + '...');
      }

      console.log(`\n--- RESPONSE ---`);
      if (interaction.response.raw) {
        console.log(`Raw Response (first 500 chars):`);
        console.log(
          (typeof interaction.response.raw === 'string'
            ? interaction.response.raw
            : JSON.stringify(interaction.response.raw)
          ).substring(0, 500) + '...'
        );
      }

      if (interaction.error) {
        console.log(`\nError: ${interaction.error}`);
      }
    });

    // Get stats
    console.log(`\n${'='.repeat(80)}`);
    console.log('STATISTICS (Last 7 days)');
    console.log(`${'='.repeat(80)}\n`);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stats = await db
      .collection('ai_interactions')
      .aggregate([
        {
          $match: {
            createdAt: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: '$operation',
            count: { $sum: 1 },
            successCount: { $sum: { $cond: ['$success', 1, 0] } },
            avgLatencyMs: { $avg: '$metadata.latencyMs' }
          }
        }
      ])
      .toArray();

    stats.forEach((stat) => {
      console.log(`Operation: ${stat._id}`);
      console.log(`  Total requests: ${stat.count}`);
      console.log(`  Successful: ${stat.successCount}`);
      console.log(`  Success rate: ${((stat.successCount / stat.count) * 100).toFixed(2)}%`);
      console.log(`  Avg latency: ${Math.round(stat.avgLatencyMs)}ms\n`);
    });

    await mongodb.close();
    console.log('\nDone!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testInteractions();
