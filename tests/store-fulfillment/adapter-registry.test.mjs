import test from "node:test";
import assert from "node:assert/strict";
import { getAdapter, buildFulfillmentPrompt, validateDelivery } from "../../supabase/functions/midad_store_fulfillment/adapter-registry.mjs";

test("rejects unknown product IDs instead of selecting a generic adapter", () => {
  assert.equal(getAdapter("not-a-real-product"), null);
});

test("all eight storefront products map to explicit, distinct adapters", () => {
  const ids = ["payment-path-mini-v1", "miner-microscope-v1", "opportunity-radar-v1", "research-revenue-sprint-v1", "bug-fix-sprint-v1", "data-rescue-pack-v1", "decision-research-brief-v1", "code-health-review-v1"];
  const adapters = ids.map(getAdapter);
  assert.ok(adapters.every(Boolean));
  assert.equal(new Set(adapters.map(x => x.key)).size, ids.length);
  assert.equal(getAdapter("bug-fix-sprint-v1").requiresSourceMaterial, true);
  assert.equal(getAdapter("data-rescue-pack-v1").requiresSourceMaterial, true);
});

test("does not enqueue delivery when customer requirements are missing", () => {
  const adapter = getAdapter("payment-path-mini-v1");
  assert.equal(adapter.inputReady(""), false);
  assert.equal(adapter.inputReady("   "), false);
  assert.equal(adapter.inputReady("Review the checkout webhook"), true);
});

test("prompt preserves product scope and forbids fabricated execution evidence", () => {
  const adapter = getAdapter("bug-fix-sprint-v1");
  const prompt = buildFulfillmentPrompt(adapter, "The failing test is assert.equal(add(1, 1), 3)");
  assert.match(prompt, /Bug Fix Sprint/);
  assert.match(prompt, /Do not claim tests were run/);
  assert.match(prompt, /assert\.equal/);
});

test("delivery validation rejects empty or oversized artifacts", () => {
  assert.equal(validateDelivery("", 20000), false);
  assert.equal(validateDelivery("ok", 20000), true);
  assert.equal(validateDelivery("x".repeat(20001), 20000), false);
});
