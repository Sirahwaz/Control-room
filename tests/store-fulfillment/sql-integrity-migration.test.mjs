import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../../supabase/migrations/20261021113000_midad_store_fulfillment_integrity_hardening.sql", import.meta.url);
const sql = await readFile(migrationUrl, "utf8");
const enqueue = sql.split("create or replace function public.midad_enqueue_store_fulfillment_after_verified_payment()")[1]?.split("$function$;")[0] || "";
const complete = sql.split("create or replace function public.midad_complete_store_fulfillment(")[1]?.split("$function$;")[0] || "";

test("candidate migration defines both hardened functions", () => {
  assert.ok(enqueue.length > 1000, "enqueue trigger definition must be present");
  assert.ok(complete.length > 1000, "atomic completion RPC definition must be present");
});

test("completion function recomputes SHA-256 and rejects a mismatched digest", () => {
  assert.match(complete, /encode\s*\(\s*extensions\.digest\(v_report,\s*'sha256'\),\s*'hex'\s*\)\s*<>\s*p_output_sha256/i);
  assert.match(complete, /fulfillment_sha256_mismatch/);
});

test("completion enforces canonical Base USDC and Solana USDC/USDT mints", () => {
  for (const mint of [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
  ]) assert.ok(complete.includes(mint), `missing canonical mint: ${mint}`);
  assert.match(complete, /unsupported_canonical_token/);
  assert.match(complete, /coalesce\(r\.mint,''\)\s*=\s*v_expected_mint/i);
  assert.match(complete, /lower\(coalesce\(r\.mint,''\)\)\s*=\s*lower\(v_expected_mint\)/i);
});

test("completion binds order, job and checkout product to the same payment intent", () => {
  assert.match(complete, /v_order\.payment_intent_id\s+is distinct from\s+v_job\.payment_intent_id/i);
  assert.match(complete, /v_order\.product_id\s+is distinct from\s+v_job\.product_id/i);
  assert.match(complete, /v_intent\.metadata->>'product_id'/i);
  assert.match(complete, /midad_public_checkout_v1/);
});

test("enqueue trigger rejects unsupported token routes and filters receipts by canonical mint", () => {
  assert.match(enqueue, /if v_expected_mint is null then return new/i);
  assert.match(enqueue, /r\.matched_payment_intent_id\s*=\s*v_intent\.id/i);
  assert.match(enqueue, /coalesce\(r\.mint,''\)/i);
  assert.match(enqueue, /v_intent\.metadata->>'product_id'/i);
});

test("receipt tx hash comparison is Base case-insensitive but exact on non-Base networks", () => {
  for (const fn of [enqueue, complete]) {
    assert.match(fn, /case when lower\(v_intent\.network\)\s*=\s*'base'\s+then lower\(r\.tx_hash\)\s*=\s*lower\(v_intent\.received_tx_hash\)\s+else r\.tx_hash\s*=\s*v_intent\.received_tx_hash end/i);
  }
});

test("completion requires exactly one receipt and inbound direction before delivery writes", () => {
  assert.match(complete, /if v_receipt_count <> 1 then/i);
  assert.match(complete, /r\.direction\s*=\s*'inbound'/i);
  assert.ok(complete.indexOf("if v_receipt_count <> 1 then") < complete.indexOf("update public.midad_store_fulfillment_jobs"));
});
