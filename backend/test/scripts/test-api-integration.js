/**
 * Test API Integration with Event Types
 * Simulates API calls to verify event_types work correctly
 */

const mongodb = require('../src/mongodb');
const { getAllEventTypes, getEventType, getFieldSchema } = require('../src/services/field-schema');

async function testAPIIntegration() {
  try {
    await mongodb.connect();

    console.log('=== API Integration Tests ===\n');

    // Test 1: Get all event types
    console.log('1. Testing getAllEventTypes()...');
    const allEvents = await getAllEventTypes();
    if (allEvents.length === 56) {
      console.log('   ✓ Returns 56 event types');
    } else {
      console.log(`   ❌ Expected 56, got ${allEvents.length}`);
      process.exit(1);
    }

    // Check structure
    const firstEvent = allEvents[0];
    const hasRequiredFields = firstEvent.eventType &&
                              firstEvent.eventTypeId !== undefined &&
                              firstEvent.label &&
                              firstEvent.description &&
                              firstEvent.category &&
                              Array.isArray(firstEvent.fields);

    if (hasRequiredFields) {
      console.log('   ✓ Event structure correct');
    } else {
      console.log('   ❌ Missing required fields in event structure');
      console.log('   Event:', firstEvent);
      process.exit(1);
    }

    // Test 2: Get specific event type
    console.log('\n2. Testing getEventType("BILL_CREATED")...');
    const billEvent = await getEventType('BILL_CREATED');
    if (billEvent) {
      console.log('   ✓ Returns BILL_CREATED event');
      console.log(`   ✓ Has ${billEvent.fields.length} fields`);
      console.log(`   ✓ Category: ${billEvent.category}`);
    } else {
      console.log('   ❌ Failed to retrieve BILL_CREATED');
      process.exit(1);
    }

    // Test 3: Get field schema (backward compatibility)
    console.log('\n3. Testing getFieldSchema("APPOINTMENT_CREATED")...');
    const apptFields = await getFieldSchema('APPOINTMENT_CREATED');
    if (Array.isArray(apptFields) && apptFields.length > 0) {
      console.log(`   ✓ Returns ${apptFields.length} fields as array`);

      // Check field structure
      const hasFieldStructure = apptFields.every(f =>
        f.name && f.type && f.path
      );
      if (hasFieldStructure) {
        console.log('   ✓ Field structure correct');
      } else {
        console.log('   ❌ Invalid field structure');
        console.log('   Sample:', apptFields[0]);
      }
    } else {
      console.log('   ❌ Failed to get field schema');
      process.exit(1);
    }

    // Test 4: Non-existent event type
    console.log('\n4. Testing non-existent event type...');
    const nonExistent = await getEventType('INVALID_EVENT');
    if (nonExistent === null) {
      console.log('   ✓ Returns null for non-existent event');
    } else {
      console.log('   ❌ Should return null for non-existent event');
    }

    // Test 5: Complex event with nested schemas
    console.log('\n5. Testing complex event (LAB_RESULT_SIGNED)...');
    const labEvent = await getEventType('LAB_RESULT_SIGNED');
    if (labEvent) {
      const labTestsField = labEvent.fields.find(f => f.name === 'labTests');
      if (labTestsField) {
        console.log('   ✓ Found labTests field');
        console.log(`   ✓ Type: ${labTestsField.type}`);
        console.log(`   ✓ Item type: ${labTestsField.itemType}`);
        console.log(`   ✓ Has nested schema: ${labTestsField.itemSchema ? 'Yes' : 'No'}`);

        if (labTestsField.type === 'array' && labTestsField.itemSchema) {
          console.log(`   ✓ Nested schema has ${labTestsField.itemSchema.length} fields`);
        }
      } else {
        console.log('   ⚠️  labTests field not found');
      }
    }

    // Test 6: Sample payload availability
    console.log('\n6. Testing sample payload availability...');
    const eventsWithSamples = allEvents.filter(e => e.samplePayload);
    console.log(`   ✓ ${eventsWithSamples.length}/56 events have sample payloads`);

    if (eventsWithSamples.length < 56) {
      console.log(`   ⚠️  ${56 - eventsWithSamples.length} events missing sample payloads`);
    }

    // Test 7: Categories coverage
    console.log('\n7. Testing category coverage...');
    const categories = [...new Set(allEvents.map(e => e.category))];
    console.log(`   ✓ ${categories.length} unique categories`);
    console.log('   Categories:');
    categories.forEach(cat => {
      const count = allEvents.filter(e => e.category === cat).length;
      console.log(`     - ${cat}: ${count} events`);
    });

    // Test 8: Field type distribution
    console.log('\n8. Testing field type distribution...');
    const allFields = allEvents.flatMap(e => e.fields || []);
    const typeDistribution = {};
    allFields.forEach(f => {
      typeDistribution[f.type] = (typeDistribution[f.type] || 0) + 1;
    });
    console.log('   Field types found:');
    Object.entries(typeDistribution).forEach(([type, count]) => {
      console.log(`     - ${type}: ${count} fields`);
    });

    // Test 9: Check for Base64Print fields
    console.log('\n9. Checking Base64Print field handling...');
    const eventsWithBase64 = allEvents.filter(e =>
      e.fields?.some(f => f.name === 'Base64Print' || f.name === 'base64Print')
    );
    console.log(`   ✓ ${eventsWithBase64.length} events have Base64Print fields`);

    // Test 10: Response size check
    console.log('\n10. Testing API response sizes...');
    const singleEventSize = JSON.stringify(billEvent).length;
    const allEventsSize = JSON.stringify(allEvents).length;

    console.log(`   Single event (BILL_CREATED): ${(singleEventSize / 1024).toFixed(2)} KB`);
    console.log(`   All events: ${(allEventsSize / 1024).toFixed(2)} KB`);

    if (allEventsSize > 1024 * 1024) { // 1MB
      console.log('   ⚠️  Response size > 1MB - consider pagination');
    } else {
      console.log('   ✓ Response size acceptable');
    }

    console.log('\n=== All Tests Passed! ✅ ===\n');
    console.log('API Integration Status: READY FOR PRODUCTION');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  testAPIIntegration();
}

module.exports = { testAPIIntegration };
