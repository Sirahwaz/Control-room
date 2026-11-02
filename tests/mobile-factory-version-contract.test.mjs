import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../mobile/factory/products/midad-mobile.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../mobile/package.json', import.meta.url), 'utf8'));
const verify = readFileSync(new URL('../.github/workflows/control-room-verify.yml', import.meta.url), 'utf8');
const factory = readFileSync(new URL('../.github/workflows/midad-mobile-factory.yml', import.meta.url), 'utf8');

function validProductVersionContract(product, sharedPackage) {
  return /^\d+\.\d+\.\d+$/.test(product.version)
    && String(product.artifact_name || '').endsWith('-v' + product.version)
    && sharedPackage.name === 'midad-mobile';
}

test('per-product manifest owns the Android version and artifact suffix', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.artifact_name.endsWith('-v' + manifest.version));
  assert.equal(pkg.name, 'midad-mobile');
  assert.doesNotMatch(verify, /manifest\.version\s*!==\s*pkg\.version/);
  assert.match(verify, /Mobile Factory product version must be semantic version/);
  assert.match(verify, /Mobile Factory artifact\/version contract drift/);
});

test('product version may diverge from shared package version without breaking the contract', () => {
  const decoupled = { ...manifest, version: '1.2.3', artifact_name: 'MIDAD-Mobile-v1.2.3' };
  assert.notEqual(decoupled.version, pkg.version);
  assert.equal(validProductVersionContract(decoupled, pkg), true);
});

test('invalid semantic version or artifact suffix still fails closed', () => {
  assert.equal(validProductVersionContract({ ...manifest, version: 'latest' }, pkg), false);
  assert.equal(validProductVersionContract({ ...manifest, artifact_name: 'MIDAD-Mobile-v9.9.9' }, pkg), false);
});

test('factory build derives version and APK name from the selected product manifest', () => {
  assert.match(factory, /VERSION_NAME=\"\$\{\{ steps\.product\.outputs\.version \}\}\"/);
  assert.match(factory, /steps\.product\.outputs\.artifact_name/);
});
