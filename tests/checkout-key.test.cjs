const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const {
  createCheckoutKey,
  clearCheckoutKey,
  PUBLIC_ORDER_KEY_RE
} = require('../revenue/checkout-key.js');

function makeStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function deps(storage, ids = []) {
  let i = 0;
  return {
    storage,
    cryptoApi: {
      subtle: webcrypto.subtle,
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: () => ids[i++] || webcrypto.randomUUID()
    }
  };
}

test('creates the exact public order key format expected by the checkout status API', async () => {
  const storage = makeStorage();
  const state = await createCheckoutKey({
    product: 'payment-path-mini-v1',
    customerRequirements: 'Internal acceptance test',
    ...deps(storage, ['123e4567-e89b-42d3-a456-426614174000'])
  });
  assert.equal(state.orderKey, 'store-123e4567-e89b-42d3-a456-426614174000');
  assert.equal(PUBLIC_ORDER_KEY_RE.test(state.orderKey), true);
});

test('reuses one key for an identical checkout brief without storing personal data in storage keys', async () => {
  const storage = makeStorage();
  const input = {
    product: 'payment-path-mini-v1',
    customerName: 'Example',
    customerEmail: 'buyer@example.invalid',
    customerRequirements: 'Review a public checkout'
  };
  const a = await createCheckoutKey({ ...input, ...deps(storage, ['123e4567-e89b-42d3-a456-426614174000']) });
  const b = await createCheckoutKey({ ...input, ...deps(storage, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']) });
  assert.equal(a.orderKey, b.orderKey);
  assert.equal([...storage.values.keys()].some((key) =>
    key.includes(input.customerEmail) || key.includes(input.customerName)), false);
});

test('isolates different product briefs and rotates the key when the cached key is cleared', async () => {
  const storage = makeStorage();
  const input = {
    product: 'payment-path-mini-v1',
    customerName: '',
    customerEmail: '',
    customerRequirements: 'First scope'
  };
  const a = await createCheckoutKey({ ...input, ...deps(storage, ['123e4567-e89b-42d3-a456-426614174000']) });
  const b = await createCheckoutKey({
    ...input,
    customerRequirements: 'Changed scope',
    ...deps(storage, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
  });
  assert.notEqual(a.orderKey, b.orderKey);
  clearCheckoutKey({ storage, storageKey: a.storageKey });
  const c = await createCheckoutKey({ ...input, ...deps(storage, ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']) });
  assert.notEqual(a.orderKey, c.orderKey);
});

test('checkout page uses the shared key helper and can read the existing order-status endpoint', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'revenue-forge.html'), 'utf8');
  assert.match(html, /<script src="\.\/revenue\/checkout-key\.js"><\/script>/);
  assert.match(html, /MIDADCheckoutKey\.createCheckoutKey/);
  assert.match(html, /action\s*:\s*['"]order_status['"]/);
  assert.match(html, /MIDADCheckoutKey\.clearCheckoutKey/);
  assert.doesNotMatch(html, /return\s+base\s*\+\s*["']-["']\s*\+\s*product/);
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]).filter(Boolean);
  assert.ok(inlineScripts.length > 0, 'checkout page should retain inline app scripts');
  inlineScripts.forEach((script, index) => {
    assert.doesNotThrow(() => new Function(script), `checkout inline script syntax #${index + 1}`);
  });
});
