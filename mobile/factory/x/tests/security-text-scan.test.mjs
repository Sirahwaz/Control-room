import test from 'node:test';
import assert from 'node:assert/strict';
import {
  containsPrivateKeyBlock,
  containsKnownSecretPattern,
} from '../security-text-scan.mjs';

test('PEM boundary marker literals in parser source are not treated as leaked key material', () => {
  const parserSource = [
    "const pkcs1 = normalized.startsWith('-----BEGIN RSA PRIVATE KEY-----');",
    "const pkcs8 = normalized.startsWith('-----BEGIN PRIVATE KEY-----');",
    ".replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')",
  ].join('\n');
  assert.equal(containsPrivateKeyBlock(parserSource), false);
});

test('a complete multi-line private-key PEM block is detected', () => {
  const body = Array.from({ length: 8 }, () => 'QUJD'.repeat(16)).join('\n');
  const pem = [
    '-----BEGIN PRIVATE KEY-----',
    body,
    '-----END PRIVATE KEY-----',
  ].join('\n');
  assert.equal(containsPrivateKeyBlock(pem), true);
});

test('a PEM header without a base64 key body is not treated as a complete private key', () => {
  const source = [
    '-----BEGIN PRIVATE KEY-----',
    'this is a source-code placeholder, not base64 key material',
    '-----END PRIVATE KEY-----',
  ].join('\n');
  assert.equal(containsPrivateKeyBlock(source), false);
});

test('known high-risk credential patterns remain detectable', () => {
  assert.equal(containsKnownSecretPattern('SUPABASE_SERVICE_ROLE_KEY'), true);
  assert.equal(containsKnownSecretPattern('sk-' + 'A'.repeat(24)), true);
  assert.equal(containsKnownSecretPattern('AIza' + 'A'.repeat(24)), true);
  assert.equal(containsKnownSecretPattern('ordinary parser text'), false);
});
