#!/usr/bin/env node
/**
 * Add direction: "OUTBOUND" field to all integration configs
 */

const fs = require('fs');
const path = require('path');

function addDirectionField(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => addDirectionField(item));
  }

  // Add direction field right after name
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = typeof value === 'object' && value !== null ? addDirectionField(value) : value;

    // Add direction field after name if this is a root config object
    if (key === 'name' && !obj.direction) {
      result.direction = 'OUTBOUND';
    }
  }

  return result;
}

// Process CleverTap webhooks
const clevertapPath = path.join(__dirname, 'setup/clevertap-webhooks.json');
const clevertapData = JSON.parse(fs.readFileSync(clevertapPath, 'utf8'));
const updatedClevertap = addDirectionField(clevertapData);
fs.writeFileSync(clevertapPath, JSON.stringify(updatedClevertap, null, 2) + '\n');
console.log('✓ Added direction field to CleverTap webhooks');

// Process Luma configs
const lumaDir = path.join(__dirname, 'setup/luma-qikberry-configs');
const lumaFiles = fs.readdirSync(lumaDir).filter(f => f.endsWith('.json'));

for (const file of lumaFiles) {
  const filePath = path.join(lumaDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = addDirectionField(data);
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n');
}
console.log(`✓ Added direction field to ${lumaFiles.length} Luma configs`);

console.log('\n✅ All configurations updated with direction: "OUTBOUND"');
