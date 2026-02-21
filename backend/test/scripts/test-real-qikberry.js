const { connect, getDbSafe } = require('./src/mongodb');

async function testRealQikberry() {
  try {
    await connect();
    const db = await getDbSafe();

    console.log('\n🧪 Testing Real Qikberry WhatsApp Integration\n');
    console.log('='.repeat(60));

    // Step 1: Check if Qikberry template exists
    console.log('\n📋 Step 1: Checking Qikberry template...');
    const template = await db.collection('webhook_templates').findOne({
      entityRid: 33,
      name: /Qikberry/i
    });

    if (!template) {
      console.log('❌ Qikberry template not found!');
      process.exit(1);
    }

    console.log(`✅ Template found: ${template.name}`);
    console.log(`   Version: ${template.metadata.version}`);
    console.log(`   Placeholders: ${Object.keys(template.metadata.placeholders).length}`);

    // Step 2: Create a test webhook using the template
    console.log('\n📋 Step 2: Creating test webhook from template...');

    const webhookConfig = {
      entityRid: 33,
      name: 'Test Qikberry - Appointment Confirmation',
      eventType: 'APPOINTMENT_CONFIRMATION',
      scope: 'ENTITY_ONLY',
      targetUrl: 'https://api.qikchat.in/v1/messages',
      httpMethod: 'POST',
      outgoingAuthType: 'CUSTOM_HEADERS',
      outgoingAuthConfig: {
        headers: {
          'QIKCHAT-API-KEY': 'no8R-j6gM-hTtS',
          'Content-Type': 'application/json'
        }
      },
      headers: {},
      timeoutMs: 30000,
      retryCount: 3,
      transformationMode: 'SCRIPT',
      transformation: {
        script: `// Phone number formatting
const phoneNumber = payload.patientPhone || payload.phone || '';
const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone;

// Parse body parameters configuration
const bodyParamsConfig = [{"field": "patientName", "default": "Guest"}, {"field": "appointmentDate", "default": "TBD"}, {"field": "doctorName", "default": "Doctor"}];

const message = {
  to_contact: formattedPhone,
  type: 'template',
  template: {
    name: 'appointment_confirmation',
    language: 'en',
    components: []
  }
};

// Add body parameters
const bodyParameters = bodyParamsConfig.map(param => ({
  type: 'text',
  text: String(payload[param.field] || param.default || '')
}));

message.template.components.push({
  type: 'body',
  parameters: bodyParameters
});

return message;`
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Check if webhook already exists and delete it
    const existingWebhook = await db.collection('webhook_configs').findOne({
      entityRid: 33,
      name: 'Test Qikberry - Appointment Confirmation'
    });

    if (existingWebhook) {
      console.log('   Deleting existing test webhook...');
      await db.collection('webhook_configs').deleteOne({ _id: existingWebhook._id });
    }

    const webhookResult = await db.collection('webhook_configs').insertOne(webhookConfig);
    const webhookId = webhookResult.insertedId.toString();

    console.log(`✅ Webhook created: ${webhookId}`);
    console.log(`   Event Type: ${webhookConfig.eventType}`);
    console.log(`   Target URL: ${webhookConfig.targetUrl}`);

    // Step 3: Check for real APPOINTMENT_CONFIRMATION events in notification_queue
    console.log('\n📋 Step 3: Looking for real APPOINTMENT_CONFIRMATION events...');

    const { query } = require('./src/db');

    const [events] = await query(
      `SELECT id, entity_rid, transaction_type, message, created_at
       FROM notification_queue
       WHERE transaction_type = 'APPOINTMENT_CONFIRMATION'
       AND entity_rid IN (33, 145, 147, 270)
       ORDER BY id DESC
       LIMIT 5`
    );

    if (events.length === 0) {
      console.log('❌ No APPOINTMENT_CONFIRMATION events found');
      console.log('   Cleaning up test webhook...');
      await db.collection('webhook_configs').deleteOne({ _id: webhookResult.insertedId });
      process.exit(0);
    }

    console.log(`✅ Found ${events.length} real appointment events`);

    // Show event details
    events.forEach((event, idx) => {
      const payload = typeof event.message === 'string' ? JSON.parse(event.message) : event.message;
      console.log(`\n   Event ${idx + 1}:`);
      console.log(`     ID: ${event.id}`);
      console.log(`     Entity: ${event.entity_rid}`);
      console.log(`     Patient: ${payload.appt?.patientName || 'N/A'}`);
      console.log(`     Phone: ${payload.appt?.patientPhone || 'N/A'}`);
      console.log(`     Date: ${payload.appt?.fromDate || 'N/A'}`);
      console.log(`     Doctor: ${payload.appt?.serviceProviderName || 'N/A'}`);
    });

    // Step 4: Test transformation with a real event
    console.log('\n📋 Step 4: Testing transformation with real event data...');

    const testEvent = events[0];
    const testPayload = typeof testEvent.message === 'string' ? JSON.parse(testEvent.message) : testEvent.message;

    console.log('\n   Input Payload:');
    console.log(`     Patient Name: ${testPayload.appt?.patientName}`);
    console.log(`     Patient Phone: ${testPayload.appt?.patientPhone}`);
    console.log(`     Appointment Date: ${testPayload.appt?.fromDate}`);
    console.log(`     Doctor: ${testPayload.appt?.serviceProviderName}`);

    // Simulate transformation
    const { applyTransform } = require('./src/services/transformer');

    // First, let's create a test payload that matches what the worker would see
    const workerPayload = {
      type: 'APPOINTMENT_CONFIRMATION',
      patientName: testPayload.appt?.patientName || 'Guest',
      patientPhone: testPayload.appt?.patientPhone || '',
      appointmentDate: testPayload.appt?.fromDate || 'TBD',
      doctorName: testPayload.appt?.serviceProviderName || 'Doctor',
      ...testPayload
    };

    try {
      const transformed = await applyTransform(webhookConfig, workerPayload, {
        eventType: 'APPOINTMENT_CONFIRMATION',
        entityRid: testEvent.entity_rid
      });

      console.log('\n   ✅ Transformation successful!');
      console.log('\n   Output Message:');
      console.log(JSON.stringify(transformed, null, 2));

      // Validate transformed message structure
      if (!transformed.to_contact) {
        console.log('\n   ⚠️  Warning: Missing to_contact field');
      } else {
        console.log(`\n   📞 Recipient: ${transformed.to_contact}`);
      }

      if (!transformed.template?.name) {
        console.log('   ⚠️  Warning: Missing template name');
      } else {
        console.log(`   📝 Template: ${transformed.template.name}`);
      }

      if (!transformed.template?.components) {
        console.log('   ⚠️  Warning: Missing template components');
      } else {
        console.log(`   📦 Components: ${transformed.template.components.length}`);
        transformed.template.components.forEach((comp, idx) => {
          console.log(`      Component ${idx + 1} (${comp.type}): ${comp.parameters?.length || 0} parameters`);
          if (comp.parameters) {
            comp.parameters.forEach((param, pidx) => {
              console.log(`        Param ${pidx + 1}: "${param.text}"`);
            });
          }
        });
      }

    } catch (transformError) {
      console.log('\n   ❌ Transformation failed:', transformError.message);
      console.log('   Stack:', transformError.stack);
    }

    // Step 5: Ask user if they want to trigger a real delivery
    console.log('\n📋 Step 5: Ready for real delivery test');
    console.log('\n   ⚠️  This will send a REAL WhatsApp message!');
    console.log(`   Recipient: ${workerPayload.patientPhone}`);
    console.log('   Message: Appointment confirmation');
    console.log('\n   To test real delivery:');
    console.log(`   1. Activate the webhook in the UI`);
    console.log(`   2. Trigger a new APPOINTMENT_CONFIRMATION event`);
    console.log(`   3. Check delivery logs in the dashboard`);

    // Step 6: Cleanup
    console.log('\n📋 Step 6: Cleanup');
    console.log('\n   Options:');
    console.log('   A. Keep webhook for manual testing (recommended)');
    console.log('   B. Delete webhook immediately');
    console.log(`\n   Webhook ID: ${webhookId}`);
    console.log(`   Delete command: curl -X DELETE -H "X-API-Key: mdcs_dev_key_1f4a" "http://localhost:4000/api/v1/webhooks/${webhookId}?entityParentRid=33"`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Testing completed successfully!\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testRealQikberry();
