const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCheckoutAttribution } = require('../revenue/checkout-attribution.js');

test('captures only allowlisted UTM parameters and the landing path', () => {
  const actual = buildCheckoutAttribution(
    'https://sirahwaz.github.io/Control-room/revenue-forge.html?utm_source=linkedin&utm_medium=social&utm_campaign=oct-2026&utm_content=post-1&utm_term=checkout&utm_noise=secret&email=person%40example.com',
    ''
  );

  assert.deepEqual(actual, {
    utm_source: 'linkedin',
    utm_medium: 'social',
    utm_campaign: 'oct-2026',
    utm_content: 'post-1',
    utm_term: 'checkout',
    lane: 'revenue_forge',
    landing_path: '/Control-room/revenue-forge.html'
  });
});

test('records only the external referrer hostname, never its path or query', () => {
  const actual = buildCheckoutAttribution(
    'https://sirahwaz.github.io/Control-room/revenue-forge.html',
    'https://www.linkedin.com/feed/update/urn:abc?tracking=private'
  );

  assert.deepEqual(actual, {
    ref: 'www.linkedin.com',
    lane: 'revenue_forge',
    landing_path: '/Control-room/revenue-forge.html'
  });
});

test('does not count a same-origin referrer as an external source', () => {
  const actual = buildCheckoutAttribution(
    'https://sirahwaz.github.io/Control-room/revenue-forge.html',
    'https://sirahwaz.github.io/Control-room/index.html?private=1'
  );

  assert.equal(Object.hasOwn(actual, 'ref'), false);
  assert.equal(actual.lane, 'revenue_forge');
});

test('omits empty and unknown query parameters', () => {
  const actual = buildCheckoutAttribution(
    'https://sirahwaz.github.io/Control-room/revenue-forge.html?utm_source=&utm_campaign=%20%20&api_key=do-not-capture',
    ''
  );

  assert.deepEqual(actual, {
    lane: 'revenue_forge',
    landing_path: '/Control-room/revenue-forge.html'
  });
});

test('uses the first non-empty UTM value and caps values at 160 characters', () => {
  const longValue = 'x'.repeat(220);
  const actual = buildCheckoutAttribution(
    'https://sirahwaz.github.io/Control-room/revenue-forge.html?utm_source=&utm_source=valid&utm_campaign=' + longValue,
    ''
  );

  assert.equal(actual.utm_source, 'valid');
  assert.equal(actual.utm_campaign.length, 160);
});

test('ignores non-HTTP referrers', () => {
  const actual = buildCheckoutAttribution(
    'https://sirahwaz.github.io/Control-room/revenue-forge.html',
    'javascript:alert(1)'
  );

  assert.equal(Object.hasOwn(actual, 'ref'), false);
});
