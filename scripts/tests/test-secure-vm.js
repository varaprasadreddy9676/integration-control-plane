#!/usr/bin/env node

/**
 * Test Secure VM Wrapper
 * Validates that the vm2 replacement works correctly
 */

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(message, passed) {
  const color = passed ? colors.green : colors.red;
  const symbol = passed ? '✓' : '✗';
  console.log(`${color}${symbol} ${message}${colors.reset}`);
  return passed;
}

let passed = 0;
let failed = 0;

console.log('\n' + '='.repeat(70));
console.log(`${colors.blue}Secure VM Wrapper Tests${colors.reset}`);
console.log('='.repeat(70) + '\n');

async function runTests() {
  try {
    const { VM } = require('./src/utils/secure-vm');

    // Test 1: Simple synchronous execution
    try {
      const vm = new VM({ timeout: 1000, allowAsync: false });
      const result = await vm.run('return 1 + 1;');
      log('Simple synchronous execution (1 + 1 = 2)', result === 2) ? passed++ : failed++;
    } catch (err) {
      log(`Simple synchronous execution: ${err.message}`, false);
      failed++;
    }

    // Test 2: Access to Math object
    try {
      const vm = new VM({ timeout: 1000, allowAsync: false });
      const result = await vm.run('return Math.max(5, 10);');
      log('Access to Math object (Math.max)', result === 10) ? passed++ : failed++;
    } catch (err) {
      log(`Access to Math object: ${err.message}`, false);
      failed++;
    }

    // Test 3: Access to Date object
    try {
      const vm = new VM({ timeout: 1000, allowAsync: false });
      const result = await vm.run('return new Date().getFullYear() > 2020;');
      log('Access to Date object', result === true) ? passed++ : failed++;
    } catch (err) {
      log(`Access to Date object: ${err.message}`, false);
      failed++;
    }

    // Test 4: Access to JSON object
    try {
      const vm = new VM({ timeout: 1000, allowAsync: false });
      const result = await vm.run('return JSON.stringify({a: 1});');
      log('Access to JSON object', result === '{"a":1}') ? passed++ : failed++;
    } catch (err) {
      log(`Access to JSON object: ${err.message}`, false);
      failed++;
    }

    // Test 5: Custom sandbox variables
    try {
      const vm = new VM({
        timeout: 1000,
        allowAsync: false,
        sandbox: { customVar: 'hello' }
      });
      const result = await vm.run('return customVar;');
      log('Custom sandbox variables', result === 'hello') ? passed++ : failed++;
    } catch (err) {
      log(`Custom sandbox variables: ${err.message}`, false);
      failed++;
    }

    // Test 6: Async execution with Promise
    try {
      const vm = new VM({ timeout: 2000, allowAsync: true });
      const result = await vm.run(`
        return new Promise((resolve) => {
          setTimeout(() => resolve('async result'), 100);
        });
      `);
      log('Async execution with Promise', result === 'async result') ? passed++ : failed++;
    } catch (err) {
      log(`Async execution: ${err.message}`, false);
      failed++;
    }

    // Test 7: Async/await support
    try {
      const vm = new VM({ timeout: 2000, allowAsync: true });
      const result = await vm.run(`
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'awaited';
      `);
      log('Async/await support', result === 'awaited') ? passed++ : failed++;
    } catch (err) {
      log(`Async/await support: ${err.message}`, false);
      failed++;
    }

    // Test 8: Timeout enforcement
    try {
      const vm = new VM({ timeout: 100, allowAsync: false });
      await vm.run('while(true) {}'); // Infinite loop
      log('Timeout enforcement', false);
      failed++;
    } catch (err) {
      log('Timeout enforcement (infinite loop blocked)', err.message.includes('timeout')) ? passed++ : failed++;
    }

    // Test 9: No access to process
    try {
      const vm = new VM({ timeout: 1000, allowAsync: false });
      await vm.run('return process.exit;');
      log('No access to process', false);
      failed++;
    } catch (err) {
      log('No access to process (security)', err.message.includes('process is not defined')) ? passed++ : failed++;
    }

    // Test 10: No access to require
    try {
      const vm = new VM({ timeout: 1000, allowAsync: false });
      await vm.run('return require("fs");');
      log('No access to require', false);
      failed++;
    } catch (err) {
      log('No access to require (security)', err.message.includes('require is not defined')) ? passed++ : failed++;
    }

    // Test 11: No eval allowed
    try {
      const vm = new VM({ timeout: 1000, allowAsync: false });
      await vm.run('return eval("1 + 1");');
      log('No eval allowed', false);
      failed++;
    } catch (err) {
      log('No eval allowed (security)', err.message.includes('eval is not defined') || err.message.includes('Code generation')) ? passed++ : failed++;
    }

    // Test 12: Test transformation-like script
    try {
      const vm = new VM({
        timeout: 5000,
        allowAsync: true,
        sandbox: {
          payload: { name: 'John', age: 30 },
          context: { tenantId: 123 }
        }
      });
      const result = await vm.run(`
        return {
          fullName: payload.name,
          isAdult: payload.age >= 18,
          tenant: context.tenantId
        };
      `);
      const success = result.fullName === 'John' && result.isAdult === true && result.tenant === 123;
      log('Transformation-like script', success) ? passed++ : failed++;
    } catch (err) {
      log(`Transformation-like script: ${err.message}`, false);
      failed++;
    }

    // Test 13: Test scheduling-like script
    try {
      const vm = new VM({
        timeout: 1000,
        allowAsync: false,
        sandbox: {
          event: { scheduledDate: '2026-02-15' }
        }
      });
      const result = await vm.run(`
        const date = new Date(event.scheduledDate);
        return date.getTime();
      `);
      log('Scheduling-like script', typeof result === 'number' && result > 0) ? passed++ : failed++;
    } catch (err) {
      log(`Scheduling-like script: ${err.message}`, false);
      failed++;
    }

    // Test 14: console.log doesn't break execution
    try {
      const vm = new VM({ timeout: 1000, allowAsync: false });
      const result = await vm.run(`
        console.log('test message');
        return 'success';
      `);
      log('console.log doesn\'t break execution', result === 'success') ? passed++ : failed++;
    } catch (err) {
      log(`console.log test: ${err.message}`, false);
      failed++;
    }

  } catch (err) {
    console.error(`${colors.red}Fatal error: ${err.message}${colors.reset}`);
    console.error(err.stack);
    process.exit(1);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.blue}Test Summary${colors.reset}\n`);
  console.log(`Total: ${passed + failed}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  console.log('='.repeat(70) + '\n');

  if (failed === 0) {
    console.log(`${colors.green}✓ All tests passed!${colors.reset}`);
    console.log(`${colors.green}✓ Secure VM is working correctly${colors.reset}`);
    console.log(`${colors.green}✓ Safe to remove vm2 from package.json${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}✗ Some tests failed${colors.reset}\n`);
    process.exit(1);
  }
}

runTests();
