const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'revenue', 'index.html'), 'utf8');
const checkoutSource = fs.readFileSync(path.join(root, 'supabase', 'functions', 'midad_public_checkout', 'index.ts'), 'utf8');

test('checkout email is required in the UI and validated before creating an order', () => {
  assert.match(html, /<input id="customerEmail" name="customer_email" type="email"[^>]*required aria-required="true" aria-describedby="emailHint"/);
  assert.match(html, /emailInput\.checkValidity\(\)/);
  assert.match(html, /emailInput\?\.reportValidity\(\)/);
  assert.doesNotMatch(html, /emailLabel'\)\+\s*'<span class="optional">/);
});

test('all six supported locales describe email as required, never optional', () => {
  const labels = [...html.matchAll(/emailLabel:'([^']*)'/g)].map((match) => match[1]);
  const hints = [...html.matchAll(/emailHint:'([^']*)'/g)].map((match) => match[1]);
  assert.equal(labels.length, 6);
  assert.equal(hints.length, 6);
  const requiredTerms = [/required/i, /مطلوب/, /الزامی/, /obligatorio/i, /obligatoire/i, /erforderlich/i];
  labels.forEach((label, index) => assert.match(label, requiredTerms[index]));
  hints.forEach((hint) => assert.doesNotMatch(hint, /optional|اختياري|اختیاری|opcional|facultatif/i));
});

test('frontend intake contract matches the backend email requirement', () => {
  assert.match(checkoutSource, /validEmail\(customerEmail\)/);
  assert.match(checkoutSource, /invalid_customer_email/);
});

test('public revenue page inline JavaScript remains syntactically valid', () => {
  const scripts = [...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)]
    .map((match) => match[1]).filter(Boolean);
  assert.equal(scripts.length, 1);
  scripts.forEach((script, index) => {
    assert.doesNotThrow(() => new Function(script), `inline script syntax #${index + 1}`);
  });
});
