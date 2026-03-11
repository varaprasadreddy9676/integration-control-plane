'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Node 14 cannot parse logical assignment operators (||=, &&=, ??=).
 * A transitive logger dependency currently ships one `||=` expression.
 * Patch it in-place after install so production can start on Node 14.
 */
function patchColorspace() {
  const target = path.join(__dirname, '..', 'node_modules', '@so-ric', 'colorspace', 'dist', 'index.cjs.js');

  if (!fs.existsSync(target)) {
    console.log('[node14-compat] colorspace target not found, skipping');
    return;
  }

  const source = fs.readFileSync(target, 'utf8');
  const needle = '(limiters[m] ||= [])[channel] = modifier;';
  if (!source.includes(needle)) {
    console.log('[node14-compat] colorspace already compatible, skipping');
    return;
  }

  const replacement = '((limiters[m] = limiters[m] || []))[channel] = modifier;';
  const patched = source.replace(needle, replacement);
  fs.writeFileSync(target, patched, 'utf8');
  console.log('[node14-compat] patched @so-ric/colorspace for Node 14');
}

try {
  patchColorspace();
} catch (err) {
  console.error('[node14-compat] patch failed:', err.message);
  process.exitCode = 1;
}
