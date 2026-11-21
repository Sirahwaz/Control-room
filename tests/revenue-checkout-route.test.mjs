import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('Control Room revenue entry routes to the canonical services checkout', () => {
  const entry = read('../index.html');
  assert.match(entry, /q\.get\("view"\)===\s*"revenue"\)\s*\{location\.replace\("\.\/services\.html"\+location\.search\)/);
  assert.doesNotMatch(entry, /q\.get\("view"\)===\s*"revenue"\)\s*\{location\.replace\("\.\/revenue-forge\.html"/);
});

test('PWA precaches the canonical services page and its shared catalog module', () => {
  const worker = read('../service-worker.js');
  assert.match(worker, /\.\/services\.html/);
  assert.match(worker, /\.\/services\.catalog\.mjs/);
});

test('legacy Revenue Forge remains available for existing direct links', () => {
  const legacy = read('../revenue-forge.html');
  assert.match(legacy, /MIDAD — Revenue Forge/);
});
