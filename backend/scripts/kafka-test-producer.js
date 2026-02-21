/**
 * Kafka Test Producer
 *
 * Sends test events to Kafka for validating the KafkaEventSource adapter
 * Usage: node scripts/kafka-test-producer.js
 */

const { Kafka } = require('kafkajs');
const config = require('../config.json');

async function publishTestEvent() {
  console.log('Kafka Test Producer');
  console.log('===================');
  console.log(`Brokers: ${config.kafka.brokers.join(', ')}`);
  console.log(`Topic: ${config.kafka.topic}`);
  console.log('');

  const kafka = new Kafka({
    clientId: 'test-producer',
    brokers: config.kafka.brokers
  });

  const producer = kafka.producer();

  try {
    await producer.connect();
    console.log('✓ Connected to Kafka');

    // Create test event matching notification_queue structure
    const testEvent = {
      id: Date.now(),
      eventId: `100-TEST_EVENT-${Date.now()}`,
      entity_rid: 201,
      entity_parent_rid: 100,
      event_type: 'TEST_EVENT',
      transaction_type: 'TEST_EVENT',
      created_at: new Date().toISOString(),
      payload: {
        patient: {
          fullName: 'Test Patient',
          mrn: { documentNumber: 'TEST001', sequenceNumber: 12345 },
          phone: '1234567890'
        },
        entityCode: '7306191',
        entityName: 'Test Entity',
        entityPhone: '080 4943 6666',
        description: 'Test event from Kafka producer'
      }
    };

    // Publish to Kafka with entityParentRid as key (for partition ordering)
    await producer.send({
      topic: config.kafka.topic,
      messages: [
        {
          key: testEvent.entity_parent_rid.toString(), // Partition key
          value: JSON.stringify(testEvent),
          headers: {
            source: 'test-producer',
            timestamp: Date.now().toString()
          }
        }
      ]
    });

    console.log('✓ Test event published to Kafka');
    console.log('');
    console.log('Event Details:');
    console.log(`  Event ID: ${testEvent.eventId}`);
    console.log(`  Event Type: ${testEvent.event_type}`);
    console.log(`  Entity RID: ${testEvent.entity_rid}`);
    console.log(`  Parent RID: ${testEvent.entity_parent_rid}`);
    console.log('');
    console.log('Next Steps:');
    console.log('1. Check backend logs for message processing');
    console.log('2. Verify in delivery_logs collection');
    console.log('3. Check webhook deliveries if configured');

  } catch (error) {
    console.error('✗ Error publishing test event:', error.message);
    process.exit(1);
  } finally {
    await producer.disconnect();
    console.log('');
    console.log('✓ Disconnected from Kafka');
  }
}

// Run the test
publishTestEvent().catch(console.error);
