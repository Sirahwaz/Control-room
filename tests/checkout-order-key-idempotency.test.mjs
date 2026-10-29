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
  assert.ok(migration.includes('HAVING count(*) > 1'), 'migration must detect duplicate public keys');
  assert.ok(migration.includes('RAISE EXCEPTION'), 'migration must abort if historical duplicates exist');
  assert.ok(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS midad_store_orders_public_order_key_uidx'));
  assert.ok(migration.includes('ON public.midad_store_orders (public_order_key)'));
  assert.ok(migration.includes('WHERE public_order_key IS NOT NULL'));
});

test('checkout reuses the order bound to a key and rejects terminal invoices instead of duplicating them', () => {
  assert.ok(checkout.includes('async function findExistingCheckoutByKey('));
  assert.ok(checkout.includes('error:"checkout_order_key_terminal"'));
  assert.ok(checkout.includes('requires_new_order_key:true'));
  assert.ok(checkout.includes('error:"checkout_order_key_product_mismatch"'));
  const initialLookup = checkout.indexOf('findExistingCheckoutByKey(key,oid,productId)');
  const atomicCreate = checkout.indexOf('db.rpc("midad_create_public_checkout_order"');
  assert.ok(initialLookup >= 0 && atomicCreate > initialLookup, 'existing key lookup must precede atomic checkout creation');
});

test('concurrent duplicate-key insert races resolve to the winning checkout', () => {
  assert.ok(checkout.includes('midad_store_orders_public_order_key_uidx'));
  assert.ok(checkout.includes('createError.code==="23505"'));
  assert.ok(checkout.includes('const winner=await findExistingCheckoutByKey(key,oid,productId)'));
});

test('checkout UI only clears its saved key after detecting a terminal payment/order status', () => {
  assert.ok(page.includes('["expired","cancelled","failed"].includes(payment)||orderStatus==="CANCELLED"'));
  assert.ok(page.includes('MIDADCheckoutKey.clearCheckoutKey({storage:window.localStorage,storageKey:currentMidadCheckoutKey.storageKey})'));
});
