import test from "node:test";
import assert from "node:assert/strict";
import { getAdapter, buildFulfillmentPrompt, validateDelivery, validatePaymentGate } from "../../supabase/functions/midad_store_fulfillment/adapter-registry.mjs";

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

const validGateFixture = () => {
  const order = { id: "order-1", product_id: "payment-path-mini-v1", status: "PAID", paid_at: "2026-10-21T10:00:00Z" };
  const intent = { id: "intent-1", status: "paid", reconciliation_status: "matched", paid_at: "2026-10-21T10:00:00Z", received_tx_hash: "0xabc", settlement_asset: "USDC", network: "base", quoted_crypto_amount: 5.000123, metadata: { created_by: "midad_public_checkout_v1", product_id: "payment-path-mini-v1" } };
  const receipt = { id: "receipt-1", matched_payment_intent_id: "intent-1", tx_hash: "0xabc", asset: "USDC", network: "base", amount: 5.000123, mint: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", direction: "inbound" };
  const job = { payment_evidence: { receipt_id: "receipt-1", tx_hash: "0xabc" } };
  return { order, intent, receipts: [receipt], job };
};

test("blocks fulfillment when order is unpaid", () => {
  const fixture = validGateFixture();
  fixture.order.status = "AWAITING_PAYMENT";
  assert.equal(validatePaymentGate(fixture).ok, false);
});

test("blocks fulfillment when payment reconciliation is not matched", () => {
  const fixture = validGateFixture();
  fixture.intent.reconciliation_status = "pending";
  assert.equal(validatePaymentGate(fixture).reason, "verified_paid_store_order_required");
});

test("blocks fulfillment when the matching on-chain receipt is missing", () => {
  const fixture = validGateFixture();
  fixture.receipts = [];
  assert.equal(validatePaymentGate(fixture).reason, "unique_matching_verified_receipt_required");
});

test("blocks fulfillment when duplicate receipts match the same payment", () => {
  const fixture = validGateFixture();
  fixture.receipts.push({ ...fixture.receipts[0], id: "receipt-duplicate" });
  assert.equal(validatePaymentGate(fixture).reason, "unique_matching_verified_receipt_required");
});

test("blocks fulfillment when token contract or exact amount does not match", () => {
  const fixture = validGateFixture();
  fixture.receipts[0].mint = "0xdead";
  assert.equal(validatePaymentGate(fixture).ok, false);
  const second = validGateFixture();
  second.receipts[0].amount = 5;
  assert.equal(validatePaymentGate(second).ok, false);
});

test("accepts only the uniquely matched receipt bound to the payment intent", () => {
  const fixture = validGateFixture();
  assert.equal(validatePaymentGate(fixture).ok, true);
});

test("keeps Solana transaction signatures case-sensitive", () => {
  const fixture = validGateFixture();
  fixture.intent.network = "solana";
  fixture.intent.received_tx_hash = "AbC123";
  fixture.intent.quoted_crypto_amount = 5.000123;
  fixture.receipts[0] = {
    ...fixture.receipts[0],
    tx_hash: "abc123",
    network: "solana",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  };
  fixture.job.payment_evidence.tx_hash = "abc123";
  assert.equal(validatePaymentGate(fixture).ok, false);
});

test("source-dependent products wait for actual source material, not a vague request", () => {
  const adapter = getAdapter("bug-fix-sprint-v1");
  assert.equal(adapter.inputReady("Please fix my code"), false);
  assert.equal(adapter.inputReady("function add(a, b) { return a + b; }\nFailing assertion: assert.equal(add(1, 1), 3)"), true);
});
