import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const checkoutPath = new URL('../supabase/functions/midad_public_checkout/index.ts', import.meta.url);
const pagePath = new URL('../revenue-forge.html', import.meta.url);
const migrationPath = new URL('../supabase/migrations/20261029140000_midad_checkout_order_key_idempotency_v1.sql', import.meta.url);
const checkout = readFileSync(checkoutPath, 'utf8');
const page = readFileSync(pagePath, 'utf8');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

test('migration fails closed on historical duplicate keys and enforces one order per public key', () => {
  assert.match(migration, /HAVING\\s+count\\(\\*\\)\\s*>\\s*1/i);
  assert.match(migration, /RAISE\\s+EXCEPTION/i);
  assert.match(migration, /CREATE\\s+UNIQUE\\s+INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+midad_store_orders_public_order_key_uidx/i);
  assert.match(migration, /ON\\s+public\\.midad_store_orders\\s*\\(\\s*public_order_key\\s*\\)[\\s\\S]*?WHERE\\s+public_order_key\\s+IS\\s+NOT\\s+NULL/i);
});

test('checkout reuses the order bound to a key and rejects terminal invoices instead of duplicating them', () => {
  assert.match(checkout, /async function findExistingCheckoutByKey\\s*\\(/);
  assert.match(checkout, /checkout_order_key_terminal/);
  assert.match(checkout, /requires_new_order_key\\s*:\\s*true/);
  assert.match(checkout, /checkout_order_key_product_mismatch/);
  const initialLookup = checkout.indexOf('findExistingCheckoutByKey(key, oid, productId)');
  const atomicCreate = checkout.indexOf('db.rpc("midad_create_public_checkout_order"');
  assert.ok(initialLookup >= 0 && atomicCreate > initialLookup, 'existing key lookup must precede atomic checkout creation');
});

test('concurrent duplicate-key insert races resolve to the winning checkout rather than a generic server error', () => {
  assert.match(checkout, /midad_store_orders_public_order_key_uidx/);
  assert.match(checkout, /if\\s*\\(createError\\)[\\s\\S]{0,1200}findExistingCheckoutByKey\\(key, oid, productId\\)/);
});

test('the checkout page rotates a key only after the server confirms its invoice is terminal, with one retry maximum', () => {
  assert.match(page, /d\\?\\.error\\s*===\\s*["']checkout_order_key_terminal["']/);
  assert.match(page, /d\\?\\.requires_new_order_key\\s*===\\s*true/);
  assert.match(page, /clearCheckoutKey\\(\\{storage:window\\.localStorage,storageKey:keyState\\.storageKey\\}\\)/);
  assert.match(page, /for\\s*\\(let attempt=0;attempt<2;attempt\\+\\+\\)/);
});
