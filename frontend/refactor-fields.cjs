#!/usr/bin/env node

/**
 * Clean Field Refactoring Script - Frontend
 *
 * Renames all occurrences of:
 * - entityParentRid → orgId
 * - entityRid → tenantId
 */

const fs = require('fs');
const path = require('path');

const REPLACEMENTS = [
  // entityParentRid → orgId
  { from: /entityParentRid/g, to: 'orgId' },
  { from: /'entityParentRid'/g, to: "'orgId'" },
  { from: /"entityParentRid"/g, to: '"orgId"' },
  { from: /`entityParentRid`/g, to: '`orgId`' },

  // entityRid → tenantId
  { from: /\bentityRid\b/g, to: 'tenantId' },
  { from: /'entityRid'/g, to: "'tenantId'" },
  { from: /"entityRid"/g, to: '"tenantId"' },
  { from: /`entityRid`/g, to: '`tenantId`' }
];

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Skip node_modules, dist, build
      if (!['node_modules', 'dist', 'build', '.git'].includes(file)) {
        getAllFiles(filePath, fileList);
      }
    } else if (/\.(ts|tsx|js|jsx)$/.test(file)) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;

    // Apply all replacements
    for (const replacement of REPLACEMENTS) {
      content = content.replace(replacement.from, replacement.to);
    }

    // Check if anything changed
    if (content === originalContent) {
      return false;
    }

    // Write updated content
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

function main() {
  console.log('🚀 Starting frontend field refactoring...\n');

  const srcDir = path.join(__dirname, 'src');
  const files = getAllFiles(srcDir);

  console.log(`📁 Found ${files.length} TypeScript/JavaScript files\n`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const relativePath = path.relative(__dirname, file);
    const wasUpdated = processFile(file);

    if (wasUpdated) {
      console.log(`✅ Updated: ${relativePath}`);
      updatedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(`\n✅ Frontend refactoring complete!`);
  console.log(`   Updated: ${updatedCount} files`);
  console.log(`   Skipped: ${skippedCount} files`);
}

main();
