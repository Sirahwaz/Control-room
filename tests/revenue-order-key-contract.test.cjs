const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const helperSource = fs.readFileSync("revenue/checkout-order-key.js", "utf8");
const revenuePage = fs.readFileSync("revenue/index.html", "utf8");
const legacyPage = fs.readFileSync("revenue-forge.html", "utf8");
const edgeSource = fs.readFileSync("supabase/functions/midad_public_checkout/index.ts", "utf8");

function createBrowserHarness() {
  const values = new Map();
  let uuidCounter = 0;
  const sessionStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  const crypto = {
    subtle: webcrypto.subtle,
    randomUUID: () => {
      uuidCounter += 1;
      return "00000000-0000-4000-8000-" + String(uuidCounter).padStart(12, "0");
    }
  };
  const window = { crypto, sessionStorage };
  const context = { window, TextEncoder, Map, Uint8Array, Array, String, Error };
  vm.runInNewContext(helperSource, context, { filename: "checkout-order-key.js" });
  return { api: window.MIDADOrderKeys, values };
}

test("pending key is canonical, stable across retries, and cleared after success", async () => {
  const { api } = createBrowserHarness();
  const input = { productId: "diagnostic", customerName: "Client", customerEmail: "CLIENT@example.com", requirements: "Check API" };
  const first = await api.getPendingKey(input);
  const retry = await api.getPendingKey(input);
  assert.equal(first.key, retry.key);
  assert.match(first.key, /^store-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const other = await api.getPendingKey({ ...input, productId: "different-service" });
  assert.notEqual(other.key, first.key);
  api.clearPendingKey(first.slot);
  const nextOrder = await api.getPendingKey(input);
  assert.notEqual(nextOrder.key, first.key);
});

test("both Revenue Forge pages use the shared pending-order key", () => {
  assert.match(revenuePage, /<script src="\.\/checkout-order-key\.js"><\/script>/);
  assert.match(revenuePage, /MIDADOrderKeys\.getPendingKey/);
  assert.match(revenuePage, /MIDADOrderKeys\.clearPendingKey/);
  assert.match(legacyPage, /<script src="\.\/revenue\/checkout-order-key\.js"><\/script>/);
  assert.match(legacyPage, /MIDADOrderKeys\.getPendingKey/);
  assert.match(legacyPage, /MIDADOrderKeys\.clearPendingKey/);
  assert.doesNotMatch(legacyPage, /function checkoutKey\(product\)/);
});

test("public checkout fails closed on invalid keys and persists the same key to both records", () => {
  assert.match(edgeSource, /normalizePublicOrderKey\(clean\(body\.order_key\|\|req\.headers\.get\("x-order-key"\),160\)\)/);
  assert.match(edgeSource, /if\(!key\)return json\(\{ok:false,error:"invalid_order_key"\},400\)/);
  assert.equal((edgeSource.match(/public_order_key:key,/g) || []).length, 2);
  assert.match(edgeSource, /from "\.\/order_key_contract\.ts"/);
});
