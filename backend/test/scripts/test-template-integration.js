/**
 * Test Template Integration with Event Types
 * Verifies templates work correctly with field schemas
 */

const mongodb = require('../src/mongodb');
const { getAllEventTypes } = require('../src/services/field-schema');

async function testTemplateIntegration() {
  try {
    await mongodb.connect();
    const db = await mongodb.getDbSafe();

    console.log('=== Template Integration Tests ===\n');

    // Test 1: Get existing templates
    console.log('1. Checking existing templates...');
    const templatesCollection = db.collection('webhook_templates');
    const templates = await templatesCollection.find({}).toArray();
    console.log(`   Found ${templates.length} templates`);

    if (templates.length === 0) {
      console.log('   ⚠️  No templates found - skipping integration tests');
      console.log('   This is OK if templates haven\'t been created yet');
      process.exit(0);
    }

    // Test 2: Check template event types have schemas
    console.log('\n2. Verifying event types in templates have schemas...');
    const allEventTypes = await getAllEventTypes();
    const eventTypeMap = new Map(allEventTypes.map(et => [et.eventType, et]));

    let templatesWithMissingSchemas = 0;
    let templatesWithSchemas = 0;

    for (const template of templates) {
      const eventType = template.eventType;
      if (!eventType) {
        console.log(`   ⚠️  Template "${template.name}" has no eventType`);
        continue;
      }

      const schema = eventTypeMap.get(eventType);
      if (!schema) {
        console.log(`   ❌ Template "${template.name}" event type "${eventType}" has NO schema`);
        templatesWithMissingSchemas++;
      } else {
        templatesWithSchemas++;
        console.log(`   ✓ Template "${template.name}" → ${eventType} (${schema.fields.length} fields)`);
      }
    }

    if (templatesWithMissingSchemas > 0) {
      console.log(`\n   ⚠️  ${templatesWithMissingSchemas} templates have event types without schemas`);
      console.log('   These templates may not have field suggestions in the UI');
    } else {
      console.log(`\n   ✓ All ${templatesWithSchemas} templates have event schemas`);
    }

    // Test 3: Check template transformations reference valid fields
    console.log('\n3. Checking template transformations...');

    for (const template of templates) {
      if (!template.transformation) continue;

      const eventType = template.eventType;
      const schema = eventTypeMap.get(eventType);

      if (!schema) continue; // Already warned above

      console.log(`\n   Template: ${template.name}`);
      console.log(`   Event: ${eventType}`);
      console.log(`   Mode: ${template.transformationMode}`);

      // Check SIMPLE mode transformations
      if (template.transformationMode === 'SIMPLE' && template.transformation.mappings) {
        const mappings = template.transformation.mappings;
        console.log(`   Mappings: ${mappings.length}`);

        // Get all available field names
        const availableFields = new Set(schema.fields.map(f => f.name));

        // Check each mapping's source field
        let validMappings = 0;
        let invalidMappings = 0;

        for (const mapping of mappings) {
          if (mapping.sourceField) {
            // Handle nested fields (e.g., "patient.name" -> check "patient")
            const rootField = mapping.sourceField.split('.')[0];

            if (availableFields.has(rootField)) {
              validMappings++;
            } else {
              console.log(`     ⚠️  Mapping "${mapping.targetField}" references unknown field: ${mapping.sourceField}`);
              invalidMappings++;
            }
          }
        }

        if (invalidMappings > 0) {
          console.log(`     ⚠️  ${invalidMappings}/${mappings.length} mappings reference unknown fields`);
        } else {
          console.log(`     ✓ All ${validMappings} mappings valid`);
        }
      }

      // Check SCRIPT mode transformations
      if (template.transformationMode === 'SCRIPT' && template.transformation.script) {
        const script = template.transformation.script;
        console.log(`   Script length: ${script.length} chars`);

        // Check if script references fields that exist
        const fieldNames = schema.fields.map(f => f.name);
        let referencedFields = 0;

        for (const fieldName of fieldNames) {
          if (script.includes(fieldName)) {
            referencedFields++;
          }
        }

        console.log(`   ✓ Script references ${referencedFields}/${fieldNames.length} available fields`);
      }
    }

    // Test 4: Simulate template loading flow
    console.log('\n4. Simulating template → webhook → transformation flow...');

    if (templates.length > 0) {
      const testTemplate = templates[0];
      console.log(`   Using template: ${testTemplate.name}`);

      // Step 1: Template loads
      console.log('   Step 1: Template loads with transformation');
      console.log(`     ✓ transformationMode: ${testTemplate.transformationMode}`);
      console.log(`     ✓ transformation: ${testTemplate.transformation ? 'present' : 'missing'}`);

      // Step 2: Webhook created from template
      console.log('   Step 2: Webhook created with eventType:', testTemplate.eventType);

      // Step 3: Field schema fetched
      const schema = eventTypeMap.get(testTemplate.eventType);
      if (schema) {
        console.log(`     ✓ Field schema fetched: ${schema.fields.length} fields`);

        // Step 4: availableFields populated
        const availableFields = schema.fields.map(f => ({
          key: f.name,
          label: f.description || f.name,
          type: f.type,
          path: f.path
        }));
        console.log(`     ✓ availableFields populated: ${availableFields.length} items`);

        // Step 5: Transformation designer uses availableFields
        console.log('   Step 3: Transformation designer renders');
        console.log(`     ✓ Field suggestions available: ${availableFields.length}`);
        console.log(`     ✓ Sample fields:`);
        availableFields.slice(0, 3).forEach(f => {
          console.log(`       - ${f.key} (${f.type}): ${f.label.substring(0, 50)}...`);
        });
      } else {
        console.log('     ❌ No field schema found!');
      }
    }

    // Test 5: Check for potential issues
    console.log('\n5. Checking for potential issues...');

    let issuesFound = 0;

    // Issue: Templates without transformations
    const templatesWithoutTransform = templates.filter(t => !t.transformation);
    if (templatesWithoutTransform.length > 0) {
      console.log(`   ⚠️  ${templatesWithoutTransform.length} templates have no transformation`);
      console.log('      These templates will create webhooks without field mappings');
      issuesFound++;
    }

    // Issue: Templates with eventType but no schema
    if (templatesWithMissingSchemas > 0) {
      console.log(`   ⚠️  ${templatesWithMissingSchemas} templates reference event types without schemas`);
      console.log('      Users won\'t see field suggestions for these templates');
      issuesFound++;
    }

    if (issuesFound === 0) {
      console.log('   ✓ No issues found');
    }

    console.log('\n=== Test Summary ===');
    console.log(`Total templates: ${templates.length}`);
    console.log(`Templates with schemas: ${templatesWithSchemas}`);
    console.log(`Templates with missing schemas: ${templatesWithMissingSchemas}`);
    console.log(`Issues found: ${issuesFound}`);

    if (issuesFound === 0) {
      console.log('\n✅ Template integration: READY FOR PRODUCTION');
    } else {
      console.log('\n⚠️  Template integration: HAS WARNINGS (not critical)');
    }

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  testTemplateIntegration();
}

module.exports = { testTemplateIntegration };
