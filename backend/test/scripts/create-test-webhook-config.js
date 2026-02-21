/**
 * Create Test Webhook Configuration
 *
 * Creates a webhook config for PATIENT_REGISTERED events targeting the webhook simulator
 */

const { MongoClient } = require('mongodb');
const config = require('./src/config');

async function createTestWebhookConfig() {
  const mongoClient = new MongoClient(config.mongodb.uri, config.mongodb.options);

  try {
    console.log('\n🔌 Connecting to MongoDB...');
    await mongoClient.connect();
    const db = mongoClient.db(config.mongodb.database);

    console.log('✅ Connected to MongoDB\n');

    // Create webhook configuration
    const webhookConfig = {
      name: 'Test Patient Registration Webhook',
      entityRid: 1,
      eventType: 'PATIENT_REGISTERED',
      targetUrl: 'http://localhost:5055/webhook/api-key',
      scope: 'OWN_ENTITY',
      authType: 'API_KEY',
      authConfig: {
        headerName: 'x-api-key',
        apiKey: 'test_api_key_123'
      },
      transformMode: 'SIMPLE',
      transformConfig: {
        mappings: [
          { sourceField: 'patientRid', targetField: 'patient_id' },
          { sourceField: 'patientName', targetField: 'full_name' },
          { sourceField: 'phone', targetField: 'phone_number' },
          { sourceField: 'email', targetField: 'email_address' },
          { sourceField: 'registrationDate', targetField: 'registered_at' }
        ],
        staticFields: [
          { field: 'event_source', value: 'medics' },
          { field: 'event_version', value: '1.0' }
        ]
      },
      deliveryMode: 'IMMEDIATE',
      retryConfig: {
        maxRetries: 3,
        retryDelayMs: 1000
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    console.log('📝 Creating webhook configuration...\n');
    console.log('Config:', JSON.stringify(webhookConfig, null, 2));

    const result = await db.collection('webhook_configs').insertOne(webhookConfig);

    console.log('\n✅ Webhook configuration created!');
    console.log(`   ID: ${result.insertedId}`);
    console.log(`   Name: ${webhookConfig.name}`);
    console.log(`   Event Type: ${webhookConfig.eventType}`);
    console.log(`   Target URL: ${webhookConfig.targetUrl}`);
    console.log(`   Transform Mode: ${webhookConfig.transformMode}`);
    console.log('\n💡 The delivery worker will now match this webhook to PATIENT_REGISTERED events\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoClient.close();
    console.log('👋 MongoDB connection closed\n');
  }
}

// Run if called directly
if (require.main === module) {
  createTestWebhookConfig()
    .then(() => {
      console.log('✨ Done!\n');
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { createTestWebhookConfig };
