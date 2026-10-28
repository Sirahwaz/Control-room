import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SERVICES } from '../services.catalog.mjs';

const html = await readFile(new URL('../services.html', import.meta.url), 'utf8');
const checkoutSource = await readFile(new URL('../supabase/functions/midad_public_checkout/index.ts', import.meta.url), 'utf8');

test('service catalog has unique IDs, positive prices, and complete descriptions', () => {
  assert.equal(SERVICES.length, 8);
  const ids = SERVICES.map((service) => service.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const service of SERVICES) {
    assert.match(service.id, /^[a-z0-9-]+$/);
    assert.ok(service.priceUsd > 0);
    assert.ok(service.nameEn.length > 3);
    assert.ok(service.descriptionAr.length > 15);
  }
});

test('all displayed services and prices match the live public checkout contract', () => {
  for (const service of SERVICES) {
    const entry = `"${service.id}":{name:"${service.nameEn}",usd:${service.priceUsd},`;
    assert.ok(checkoutSource.includes(entry), `checkout product missing or price drift: ${service.id}`);
  }
});

test('landing page explicitly identifies Base USDC and uses the real checkout endpoint', () => {
  assert.match(html, /midad_public_checkout/);
  assert.match(html, /settlement_asset:\s*["']USDC["']/);
  assert.match(html, /network:\s*["']base["']/);
  assert.match(html, /https:\/\/froegigfmpmvtecztfbf\.supabase\.co\/functions\/v1\/midad_public_checkout/);
});

test('invoice creation is user-triggered, and status checks are separate and read-only', () => {
  assert.match(html, /addEventListener\(["']submit["']/);
  assert.match(html, /action:\s*["']order_status["']/);
  assert.match(html, /order_key/);
  assert.match(html, /expires_at/);
  assert.match(html, /wallet_address/);
  assert.match(html, /reconciliation_status/);
  assert.match(html, /No payment is made by clicking this button|لا يتم دفع أي مبلغ بمجرد الضغط على الزر/);
});

test('standalone page has no third-party runtime dependencies or hardcoded credentials', () => {
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:https?:\/\/|cdn\.)/i);
  assert.doesNotMatch(html, /(?:service_role|SUPABASE_SERVICE_ROLE_KEY|midad_autonomy_key|sk-[A-Za-z0-9]{12,})/i);
  assert.match(html, /textContent/);
});
