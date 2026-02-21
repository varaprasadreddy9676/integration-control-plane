/**
 * Fix Multi-Action Integrations - Remove Hybrid Schema
 *
 * This script cleans up multi-action integrations that have both:
 * - Top-level transformationMode + transformation (legacy single-action fields)
 * - actions array (new multi-action field)
 *
 * It removes the legacy fields and keeps only the actions array.
 *
 * Run with: node scripts/fix-multi-action-integrations.js
 */

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

// MongoDB connection string from your config
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE || 'medics_event_gateway';

async function fixMultiActionIntegrations() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection('integration_configs');

    // Step 1: Find all integrations with BOTH actions array AND top-level transformation
    const hybridIntegrations = await collection.find({
      actions: { $exists: true, $ne: [], $type: 'array' },
      $or: [
        { transformationMode: { $exists: true } },
        { transformation: { $exists: true } }
      ]
    }).toArray();

    console.log(`\n📊 Found ${hybridIntegrations.length} integrations with hybrid schema`);

    if (hybridIntegrations.length === 0) {
      console.log('✅ No hybrid integrations found. All multi-action integrations are clean!');
      return;
    }

    // Step 2: Show what will be cleaned
    console.log('\n🔍 Integrations to be cleaned:');
    hybridIntegrations.forEach((integration, index) => {
      console.log(`  ${index + 1}. ${integration.name} (${integration.type})`);
      console.log(`     - Actions: ${integration.actions?.length || 0}`);
      console.log(`     - Has transformationMode: ${!!integration.transformationMode}`);
      console.log(`     - Has transformation: ${!!integration.transformation}`);
    });

    // Step 3: Confirm before proceeding
    console.log('\n⚠️  This will remove the top-level transformationMode and transformation fields.');
    console.log('    The actions array will be preserved.');
    console.log('\n    Press Ctrl+C to cancel, or wait 5 seconds to continue...');

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 4: Clean up the hybrid integrations
    const result = await collection.updateMany(
      {
        actions: { $exists: true, $ne: [], $type: 'array' }
      },
      {
        $unset: {
          transformationMode: '',
          transformation: ''
        },
        $set: {
          updatedAt: new Date()
        }
      }
    );

    console.log(`\n✅ Cleaned ${result.modifiedCount} integrations`);

    // Step 5: Verify the cleanup
    const verifyHybrid = await collection.find({
      actions: { $exists: true, $ne: [], $type: 'array' },
      $or: [
        { transformationMode: { $exists: true } },
        { transformation: { $exists: true } }
      ]
    }).count();

    if (verifyHybrid === 0) {
      console.log('✅ Verification passed: No hybrid integrations remaining');
    } else {
      console.log(`⚠️  Warning: ${verifyHybrid} hybrid integrations still exist`);
    }

    // Step 6: Show the cleaned integrations
    const cleanedIntegrations = await collection.find({
      _id: { $in: hybridIntegrations.map(i => i._id) }
    }, {
      projection: {
        name: 1,
        type: 1,
        transformationMode: 1,
        transformation: 1,
        'actions.name': 1
      }
    }).toArray();

    console.log('\n📋 Cleaned integrations:');
    cleanedIntegrations.forEach((integration, index) => {
      console.log(`  ${index + 1}. ${integration.name}`);
      console.log(`     - transformationMode: ${integration.transformationMode || '(removed)' }`);
      console.log(`     - transformation: ${integration.transformation ? '(exists - should be removed!)' : '(removed)'}`);
      console.log(`     - Actions: ${integration.actions?.map(a => a.name).join(', ')}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n✅ MongoDB connection closed');
  }
}

// Run the fix
if (require.main === module) {
  fixMultiActionIntegrations()
    .then(() => {
      console.log('\n✅ Done! Multi-action integrations have been cleaned.');
      console.log('   You can now edit and save these integrations in the UI without errors.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Failed:', error.message);
      process.exit(1);
    });
}

module.exports = { fixMultiActionIntegrations };
