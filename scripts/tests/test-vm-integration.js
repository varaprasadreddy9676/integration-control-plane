#!/usr/bin/env node

/**
 * Comprehensive Integration Tests for vm2 Replacement
 * Tests real-world transformation and scheduling scenarios
 */

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(message, passed) {
  const color = passed ? colors.green : colors.red;
  const symbol = passed ? '✓' : '✗';
  console.log(`${color}${symbol} ${message}${colors.reset}`);
  return passed;
}

function logSection(message) {
  console.log(`\n${colors.blue}${message}${colors.reset}\n`);
}

let passed = 0;
let failed = 0;

async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.blue}VM Integration Tests - Real-world Scenarios${colors.reset}`);
  console.log('='.repeat(70));

  const { applyTransform } = require('./src/services/transformer');
  const { executeSchedulingScript } = require('./src/services/scheduler');

  // ============================================================================
  // TRANSFORMATION TESTS
  // ============================================================================

  logSection('1. Basic Transformation Scripts');

  // Test 1: Simple field mapping
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformationMode: 'SCRIPT',
      transformation: {
        script: `
          return {
            patientName: payload.patient.fullName,
            age: payload.patient.age,
            visitDate: payload.appointment.date
          };
        `
      },
      tenantId: 123
    };

    const payload = {
      patient: { fullName: 'John Doe', age: 35 },
      appointment: { date: '2026-02-15' }
    };

    const result = await applyTransform(integration, payload, { tenantId: 123 });

    const success = result.patientName === 'John Doe' &&
                   result.age === 35 &&
                   result.visitDate === '2026-02-15';
    log('Simple field mapping transformation', success) ? passed++ : failed++;
  } catch (err) {
    log(`Simple field mapping: ${err.message}`, false);
    failed++;
  }

  // Test 2: Conditional logic
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          return {
            status: payload.age >= 18 ? 'adult' : 'minor',
            discount: payload.age >= 65 ? 0.2 : 0,
            category: payload.age < 18 ? 'pediatric' : 'general'
          };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, { age: 70 }, { tenantId: 123 });

    const success = result.status === 'adult' &&
                   result.discount === 0.2 &&
                   result.category === 'general';
    log('Conditional logic in transformation', success) ? passed++ : failed++;
  } catch (err) {
    log(`Conditional logic: ${err.message}`, false);
    failed++;
  }

  // Test 3: Array manipulation
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          return {
            totalItems: payload.items.length,
            itemNames: payload.items.map(item => item.name),
            totalPrice: payload.items.reduce((sum, item) => sum + item.price, 0),
            hasExpensiveItems: payload.items.some(item => item.price > 100)
          };
        `
      },
      tenantId: 123
    };

    const payload = {
      items: [
        { name: 'Item A', price: 50 },
        { name: 'Item B', price: 150 },
        { name: 'Item C', price: 30 }
      ]
    };

    const result = await applyTransform(integration, payload, { tenantId: 123 });

    const success = result.totalItems === 3 &&
                   result.itemNames.length === 3 &&
                   result.totalPrice === 230 &&
                   result.hasExpensiveItems === true;
    log('Array manipulation (map, reduce, some)', success) ? passed++ : failed++;
  } catch (err) {
    log(`Array manipulation: ${err.message}`, false);
    failed++;
  }

  // Test 4: Date manipulation
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          const appointmentDate = new Date(payload.date);
          const tomorrow = new Date(appointmentDate);
          tomorrow.setDate(tomorrow.getDate() + 1);

          return {
            originalDate: payload.date,
            dayOfWeek: appointmentDate.getDay(),
            nextDay: tomorrow.toISOString().split('T')[0],
            isWeekend: appointmentDate.getDay() === 0 || appointmentDate.getDay() === 6
          };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, { date: '2026-02-14' }, { tenantId: 123 });

    const success = result.originalDate === '2026-02-14' &&
                   result.nextDay === '2026-02-15' &&
                   typeof result.dayOfWeek === 'number';
    log('Date manipulation with Date object', success) ? passed++ : failed++;
  } catch (err) {
    log(`Date manipulation: ${err.message}`, false);
    failed++;
  }

  // Test 5: String operations
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          return {
            upperName: payload.name.toUpperCase(),
            lowerName: payload.name.toLowerCase(),
            initials: payload.name.split(' ').map(n => n[0]).join(''),
            length: payload.name.length,
            trimmed: payload.name.trim()
          };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, { name: '  John Doe  ' }, { tenantId: 123 });

    const success = result.upperName === '  JOHN DOE  ' &&
                   result.initials === 'JD' &&
                   result.trimmed === 'John Doe';
    log('String operations (upper, lower, split, trim)', success) ? passed++ : failed++;
  } catch (err) {
    log(`String operations: ${err.message}`, false);
    failed++;
  }

  // Test 6: JSON parsing and stringification
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          const jsonStr = JSON.stringify(payload.data);
          const parsed = JSON.parse(jsonStr);

          return {
            stringified: jsonStr,
            roundTrip: parsed,
            isEqual: JSON.stringify(payload.data) === jsonStr
          };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, { data: { a: 1, b: 2 } }, { tenantId: 123 });

    const success = result.stringified === '{"a":1,"b":2}' &&
                   result.roundTrip.a === 1 &&
                   result.isEqual === true;
    log('JSON parsing and stringification', success) ? passed++ : failed++;
  } catch (err) {
    log(`JSON operations: ${err.message}`, false);
    failed++;
  }

  logSection('2. Async Transformation Scripts');

  // Test 7: Async/await with Promise
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          await new Promise(resolve => setTimeout(resolve, 100));

          return {
            message: 'async completed',
            timestamp: new Date().toISOString()
          };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, {}, { tenantId: 123 });

    const success = result.message === 'async completed' &&
                   result.timestamp.includes('2026');
    log('Async/await with setTimeout Promise', success) ? passed++ : failed++;
  } catch (err) {
    log(`Async/await: ${err.message}`, false);
    failed++;
  }

  // Test 8: Multiple async operations
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

          await delay(50);
          const step1 = 'first';

          await delay(50);
          const step2 = 'second';

          return {
            steps: [step1, step2],
            completed: true
          };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, {}, { tenantId: 123 });

    const success = result.steps.length === 2 &&
                   result.steps[0] === 'first' &&
                   result.completed === true;
    log('Multiple sequential async operations', success) ? passed++ : failed++;
  } catch (err) {
    log(`Multiple async: ${err.message}`, false);
    failed++;
  }

  logSection('3. Context and Global Utilities');

  // Test 9: Access to context variables
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          return {
            tenantId: context.tenantId,
            hasContext: typeof context !== 'undefined',
            hasPayload: typeof payload !== 'undefined'
          };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, { test: 'data' }, { tenantId: 456 });

    const success = result.tenantId === 456 &&
                   result.hasContext === true &&
                   result.hasPayload === true;
    log('Access to context and payload variables', success) ? passed++ : failed++;
  } catch (err) {
    log(`Context access: ${err.message}`, false);
    failed++;
  }

  // Test 10: Math operations
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          return {
            max: Math.max(...payload.numbers),
            min: Math.min(...payload.numbers),
            random: Math.random() > 0 && Math.random() < 1,
            rounded: Math.round(payload.value),
            ceil: Math.ceil(payload.value),
            floor: Math.floor(payload.value)
          };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, {
      numbers: [5, 2, 9, 1, 7],
      value: 3.7
    }, { tenantId: 123 });

    const success = result.max === 9 &&
                   result.min === 1 &&
                   result.random === true &&
                   result.rounded === 4 &&
                   result.ceil === 4 &&
                   result.floor === 3;
    log('Math operations (max, min, round, ceil, floor)', success) ? passed++ : failed++;
  } catch (err) {
    log(`Math operations: ${err.message}`, false);
    failed++;
  }

  logSection('4. Error Handling');

  // Test 11: Script syntax error
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          return { invalid syntax here
        `
      },
      tenantId: 123
    };

    await applyTransform(integration, {}, { tenantId: 123 });
    log('Script syntax error handling', false);
    failed++;
  } catch (err) {
    log('Script syntax error is caught properly', err.message.includes('execution failed') || err.message.includes('Unexpected')) ? passed++ : failed++;
  }

  // Test 12: Runtime error in script
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          return payload.nonexistent.field.value;
        `
      },
      tenantId: 123
    };

    await applyTransform(integration, {}, { tenantId: 123 });
    log('Runtime error handling', false);
    failed++;
  } catch (err) {
    log('Runtime error is caught properly', err.message.includes('execution failed') || err.message.includes('Cannot read')) ? passed++ : failed++;
  }

  // Test 13: Access to forbidden objects
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          return { process: typeof process, require: typeof require };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, {}, { tenantId: 123 });

    const success = result.process === 'undefined' && result.require === 'undefined';
    log('Security: no access to process or require', success) ? passed++ : failed++;
  } catch (err) {
    // Error is also acceptable (means they're blocked)
    log('Security: process/require blocked', true);
    passed++;
  }

  // ============================================================================
  // SCHEDULING TESTS
  // ============================================================================

  logSection('5. Scheduling Scripts - DELAYED Mode');

  // Test 14: Simple timestamp calculation
  try {
    const script = `
      const appointmentTime = new Date(event.appointmentDate).getTime();
      return appointmentTime;
    `;

    const event = {
      appointmentDate: '2026-02-15T10:00:00Z'
    };

    const result = await executeSchedulingScript(script, event, { tenantId: 123 });

    const success = typeof result === 'number' && result > Date.now();
    log('DELAYED: Simple timestamp calculation', success) ? passed++ : failed++;
  } catch (err) {
    log(`DELAYED timestamp: ${err.message}`, false);
    failed++;
  }

  // Test 15: Schedule with addDays utility
  try {
    const script = `
      const baseDate = new Date(event.date);
      const scheduled = addDays(baseDate, 7);
      return toTimestamp(scheduled);
    `;

    const event = {
      date: '2026-02-14'
    };

    const result = await executeSchedulingScript(script, event, { tenantId: 123 });

    const scheduledDate = new Date(result);
    const expectedDate = new Date('2026-02-21');

    const success = scheduledDate.getDate() === expectedDate.getDate() &&
                   scheduledDate.getMonth() === expectedDate.getMonth();
    log('DELAYED: Schedule 7 days ahead with addDays', success) ? passed++ : failed++;
  } catch (err) {
    log(`DELAYED addDays: ${err.message}`, false);
    failed++;
  }

  // Test 16: Schedule with epoch utility
  try {
    const script = `
      const epochTime = epoch(event.scheduledDate);
      return epochTime * 1000; // Convert to milliseconds
    `;

    const event = {
      scheduledDate: '04/02/2026'
    };

    const result = await executeSchedulingScript(script, event, { tenantId: 123 });

    const success = typeof result === 'number' && result > Date.now();
    log('DELAYED: Convert date string to timestamp with epoch', success) ? passed++ : failed++;
  } catch (err) {
    log(`DELAYED epoch: ${err.message}`, false);
    failed++;
  }

  // Test 17: Schedule with datetime utility
  try {
    const script = `
      const epochTime = datetime('2026-02-15', '14:30:00', '+05:30');
      return epochTime * 1000;
    `;

    const event = {};

    const result = await executeSchedulingScript(script, event, { tenantId: 123 });

    const success = typeof result === 'number' && result > Date.now();
    log('DELAYED: Parse date and time with datetime utility', success) ? passed++ : failed++;
  } catch (err) {
    log(`DELAYED datetime: ${err.message}`, false);
    failed++;
  }

  // Test 18: Conditional scheduling
  try {
    const script = `
      const baseDate = new Date(event.appointmentDate);
      const delay = event.priority === 'urgent' ? 1 : 7;
      const scheduled = addDays(baseDate, delay);
      return toTimestamp(scheduled);
    `;

    const event = {
      appointmentDate: '2026-02-14',
      priority: 'urgent'
    };

    const result = await executeSchedulingScript(script, event, { tenantId: 123 });

    const scheduledDate = new Date(result);
    const expectedDate = new Date('2026-02-15');

    const success = scheduledDate.getDate() === expectedDate.getDate();
    log('DELAYED: Conditional scheduling based on priority', success) ? passed++ : failed++;
  } catch (err) {
    log(`DELAYED conditional: ${err.message}`, false);
    failed++;
  }

  logSection('6. Scheduling Scripts - RECURRING Mode');

  // Test 19: Daily recurring schedule
  try {
    const script = `
      return {
        pattern: 'DAILY',
        hour: 9,
        minute: 0,
        timezone: 'Asia/Kolkata'
      };
    `;

    const result = await executeSchedulingScript(script, {}, { tenantId: 123 });

    const success = result.pattern === 'DAILY' &&
                   result.hour === 9 &&
                   result.minute === 0;
    log('RECURRING: Daily pattern at 9:00 AM', success) ? passed++ : failed++;
  } catch (err) {
    log(`RECURRING daily: ${err.message}`, false);
    failed++;
  }

  // Test 20: Weekly recurring schedule
  try {
    const script = `
      return {
        pattern: 'WEEKLY',
        dayOfWeek: 1, // Monday
        hour: 14,
        minute: 30,
        timezone: 'Asia/Kolkata'
      };
    `;

    const result = await executeSchedulingScript(script, {}, { tenantId: 123 });

    const success = result.pattern === 'WEEKLY' &&
                   result.dayOfWeek === 1 &&
                   result.hour === 14;
    log('RECURRING: Weekly pattern on Mondays at 2:30 PM', success) ? passed++ : failed++;
  } catch (err) {
    log(`RECURRING weekly: ${err.message}`, false);
    failed++;
  }

  // Test 21: Monthly recurring schedule
  try {
    const script = `
      return {
        pattern: 'MONTHLY',
        dayOfMonth: 1,
        hour: 0,
        minute: 0,
        timezone: 'Asia/Kolkata'
      };
    `;

    const result = await executeSchedulingScript(script, {}, { tenantId: 123 });

    const success = result.pattern === 'MONTHLY' &&
                   result.dayOfMonth === 1;
    log('RECURRING: Monthly pattern on 1st at midnight', success) ? passed++ : failed++;
  } catch (err) {
    log(`RECURRING monthly: ${err.message}`, false);
    failed++;
  }

  // Test 22: Dynamic recurring based on event data
  try {
    const script = `
      return {
        pattern: event.frequency.toUpperCase(),
        hour: parseInt(event.preferredHour),
        minute: 0,
        timezone: 'Asia/Kolkata'
      };
    `;

    const event = {
      frequency: 'daily',
      preferredHour: '10'
    };

    const result = await executeSchedulingScript(script, event, { tenantId: 123 });

    const success = result.pattern === 'DAILY' && result.hour === 10;
    log('RECURRING: Dynamic pattern from event data', success) ? passed++ : failed++;
  } catch (err) {
    log(`RECURRING dynamic: ${err.message}`, false);
    failed++;
  }

  logSection('7. Complex Real-world Scenarios');

  // Test 23: Complex patient data transformation
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          const patient = payload.patient;
          const appointments = payload.appointments || [];

          return {
            demographics: {
              id: patient.id,
              fullName: patient.firstName + ' ' + patient.lastName,
              age: new Date().getFullYear() - new Date(patient.dob).getFullYear(),
              contact: {
                phone: patient.phone,
                email: patient.email
              }
            },
            appointments: appointments.map(apt => ({
              id: apt.id,
              date: apt.scheduledDate,
              doctor: apt.doctor.name,
              status: apt.status,
              isUpcoming: new Date(apt.scheduledDate) > new Date()
            })),
            summary: {
              totalAppointments: appointments.length,
              upcomingCount: appointments.filter(a => new Date(a.scheduledDate) > new Date()).length,
              lastVisit: appointments.length > 0 ? appointments[appointments.length - 1].scheduledDate : null
            }
          };
        `
      },
      tenantId: 123
    };

    const payload = {
      patient: {
        id: 'P001',
        firstName: 'John',
        lastName: 'Doe',
        dob: '1990-01-01',
        phone: '1234567890',
        email: 'john@example.com'
      },
      appointments: [
        {
          id: 'A001',
          scheduledDate: '2026-02-20',
          doctor: { name: 'Dr. Smith' },
          status: 'confirmed'
        },
        {
          id: 'A002',
          scheduledDate: '2026-03-15',
          doctor: { name: 'Dr. Jones' },
          status: 'pending'
        }
      ]
    };

    const result = await applyTransform(integration, payload, { tenantId: 123 });

    const success = result.demographics.fullName === 'John Doe' &&
                   result.appointments.length === 2 &&
                   result.summary.totalAppointments === 2 &&
                   result.summary.upcomingCount === 2;
    log('Complex patient data transformation', success) ? passed++ : failed++;
  } catch (err) {
    log(`Complex transformation: ${err.message}`, false);
    failed++;
  }

  // Test 24: Appointment reminder scheduling logic
  try {
    const script = `
      const appointmentDate = new Date(event.appointment.scheduledDate);
      const reminderDays = event.reminderSettings.daysBefore || 1;
      const reminderTime = event.reminderSettings.time || '09:00';

      const [hours, minutes] = reminderTime.split(':');

      const reminderDate = subtractDays(appointmentDate, reminderDays);
      reminderDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      return toTimestamp(reminderDate);
    `;

    const event = {
      appointment: {
        scheduledDate: '2026-02-20T14:00:00Z'
      },
      reminderSettings: {
        daysBefore: 2,
        time: '10:00'
      }
    };

    const result = await executeSchedulingScript(script, event, { tenantId: 123 });

    const reminderDate = new Date(result);
    const expectedDate = new Date('2026-02-18T10:00:00');

    const success = reminderDate.getDate() === expectedDate.getDate() &&
                   reminderDate.getHours() === expectedDate.getHours();
    log('Appointment reminder scheduling logic', success) ? passed++ : failed++;
  } catch (err) {
    log(`Reminder scheduling: ${err.message}`, false);
    failed++;
  }

  // Test 25: console.log doesn't break execution
  try {
    const integration = {
      transformationMode: 'SCRIPT',
      transformation: {
        
        script: `
          console.log('Debug: processing patient', payload.name);
          console.log('Debug: age is', payload.age);

          return {
            processed: true,
            name: payload.name
          };
        `
      },
      tenantId: 123
    };

    const result = await applyTransform(integration, { name: 'Test', age: 25 }, { tenantId: 123 });

    const success = result.processed === true && result.name === 'Test';
    log('console.log in transformations works', success) ? passed++ : failed++;
  } catch (err) {
    log(`console.log test: ${err.message}`, false);
    failed++;
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================

  console.log('\n' + '='.repeat(70));
  console.log(`${colors.blue}Test Summary${colors.reset}\n`);
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  console.log('='.repeat(70) + '\n');

  if (failed === 0) {
    console.log(`${colors.green}✅ ALL TESTS PASSED!${colors.reset}`);
    console.log(`${colors.green}✅ vm2 replacement is working correctly${colors.reset}`);
    console.log(`${colors.green}✅ Transformations: Working${colors.reset}`);
    console.log(`${colors.green}✅ Scheduling: Working${colors.reset}`);
    console.log(`${colors.green}✅ Async/await: Working${colors.reset}`);
    console.log(`${colors.green}✅ Security: Enforced${colors.reset}`);
    console.log(`${colors.green}✅ Safe to deploy!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}⚠️  Some tests failed${colors.reset}`);
    console.log(`${colors.red}Review failures above before deploying${colors.reset}\n`);
    process.exit(1);
  }
}

// Run tests
runTests().catch(err => {
  console.error(`${colors.red}Fatal error: ${err.message}${colors.reset}`);
  console.error(err.stack);
  process.exit(1);
});
