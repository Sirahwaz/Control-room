import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.7";
import { buildFulfillmentPrompt, getAdapter, validateDelivery, validatePaymentGate } from "./adapter-registry.mjs";

const URL = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DATABASE_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const db = createClient(URL, KEY);
const sql = DATABASE_URL ? postgres(DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10, ssl: "require", prepare: false }) : null;
const MAX_REPORT_CHARS = 20000;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const clip = (value: unknown, max = 600) => String(value ?? "").slice(0, max);
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

async function vaultSecret(name: string): Promise<string> {
  if (!sql) throw new Error("vault_database_connection_unavailable");
  const rows = await sql`select decrypted_secret from vault.decrypted_secrets where name = ${name} order by created_at desc limit 1`;
  const value = rows[0]?.decrypted_secret;
  if (typeof value !== "string" || !value) throw new Error("vault_secret_unavailable:" + name);
  return value;
}

async function audit(jobId: string, orderId: string, eventType: string, evidence: Record<string, unknown>, hash: string | null = null) {
  const { error } = await db.from("midad_store_fulfillment_evidence").insert({
    job_id: jobId, order_id: orderId, event_type: eventType, evidence, payload_sha256: hash
  });
  if (error && !String(error.message || "").includes("duplicate key")) throw error;
}

async function processOrder(orderId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return json({ ok: false, error: "invalid_order_id" }, 400);
  }
  const { data: job, error: jobError } = await db.from("midad_store_fulfillment_jobs").select("*").eq("order_id", orderId).maybeSingle();
  if (jobError) throw jobError;
  if (!job) return json({ ok: false, error: "fulfillment_job_not_found" }, 404);
  if (job.status === "DELIVERED") return json({ ok: true, idempotent: true, order_id: orderId, status: "DELIVERED", output_sha256: job.output_sha256 });
  if (job.status === "WAITING_FOR_INPUT") return json({ ok: true, order_id: orderId, status: "WAITING_FOR_INPUT", reason: "customer_requirements_missing" });
  if (job.status === "MANUAL_REVIEW") return json({ ok: false, order_id: orderId, status: "MANUAL_REVIEW", error: "product_adapter_unavailable" }, 409);
  if (!["QUEUED", "FAILED"].includes(String(job.status))) return json({ ok: false, order_id: orderId, status: job.status, error: "job_not_claimable" }, 409);

  const { data: order, error: orderError } = await db.from("midad_store_orders")
    .select("id,product_id,status,paid_at,delivered_at,customer_requirements,payment_intent_id,fulfillment_job_id")
    .eq("id", orderId).maybeSingle();
  if (orderError) throw orderError;
  if (!order || String(order.fulfillment_job_id || "") !== String(job.id)) return json({ ok: false, error: "order_job_link_mismatch" }, 409);

  const { data: intent, error: intentError } = await db.from("midad_payment_intents")
    .select("id,status,reconciliation_status,settlement_asset,network,quoted_crypto_amount,wallet_address,received_tx_hash,verified_at,paid_at,metadata")
    .eq("id", order.payment_intent_id).maybeSingle();
  if (intentError) throw intentError;
  if (order.status !== "PAID" || !order.paid_at || !intent || intent.status !== "paid" ||
      intent.reconciliation_status !== "matched" || !intent.paid_at || !intent.received_tx_hash ||
      String(intent.metadata?.created_by || "") !== "midad_public_checkout_v1" ||
      String(intent.metadata?.product_id || "") !== String(order.product_id)) {
    return json({ ok: false, error: "verified_paid_store_order_required" }, 409);
  }

  let receiptQuery: any = db.from("midad_wallet_receipts")
    .select("id,tx_hash,asset,network,amount,mint,direction,matched_payment_intent_id,commitment,evidence,detected_at")
    .eq("matched_payment_intent_id", intent.id).eq("direction", "inbound")
    .eq("asset", intent.settlement_asset).eq("network", intent.network);
  receiptQuery = String(intent.network).toLowerCase() === "base"
    ? receiptQuery.ilike("tx_hash", String(intent.received_tx_hash))
    : receiptQuery.eq("tx_hash", String(intent.received_tx_hash));
  const { data: receipts, error: receiptError } = await receiptQuery.limit(2);
  if (receiptError) throw receiptError;
  const gate = validatePaymentGate({ order, intent, receipts: receipts || [], job });
  if (!gate.ok) return json({ ok: false, error: gate.reason }, 409);

  const adapter = getAdapter(order.product_id);
  if (!adapter || adapter.key !== job.adapter_key) {
    await db.from("midad_store_fulfillment_jobs").update({ status: "MANUAL_REVIEW", last_error: "product_adapter_unavailable", updated_at: new Date().toISOString() }).eq("id", job.id);
    await audit(job.id, order.id, "MANUAL_REVIEW", { reason: "product_adapter_unavailable", product_id: order.product_id });
    return json({ ok: false, status: "MANUAL_REVIEW", error: "product_adapter_unavailable" }, 409);
  }

  const requirements = String(order.customer_requirements || job.input_snapshot?.requirements || "").trim();
  if (!adapter.inputReady(requirements)) {
    await db.from("midad_store_fulfillment_jobs").update({ status: "WAITING_FOR_INPUT", last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ["QUEUED", "FAILED"]);
    await audit(job.id, order.id, "INPUT_REQUIRED", { reason: "customer_requirements_missing", product_id: order.product_id });
    return json({ ok: true, order_id: order.id, status: "WAITING_FOR_INPUT", reason: "customer_requirements_missing" });
  }

  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await db.from("midad_store_fulfillment_jobs")
    .update({ status: "PROCESSING", attempts: Number(job.attempts || 0) + 1, started_at: now, last_error: null, input_snapshot: { product_id: order.product_id, requirements }, updated_at: now })
    .eq("id", job.id).in("status", ["QUEUED", "FAILED"])
    .select("id,attempts").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return json({ ok: false, error: "job_claim_conflict" }, 409);
  const inputHash = await sha256(requirements);
  await audit(job.id, order.id, "PROCESSING_STARTED", { product_id: order.product_id, adapter_key: adapter.key, input_sha256: inputHash, attempt: claimed.attempts }, inputHash);

  try {
    const autonomyKey = await vaultSecret("midad_autonomy_key");
    const prompt = buildFulfillmentPrompt(adapter, requirements);
    const aiResponse = await fetch(URL + "/functions/v1/midad_ai_router", {
      method: "POST",
      headers: { "content-type": "application/json", "x-midad-autonomy-key": autonomyKey },
      body: JSON.stringify({ task_class: "research_compression", ai_mode: "revenue", request_ref: "store-" + order.id + "-" + adapter.key, prompt, max_output_tokens: 6000, temperature: 0.2 }),
      signal: AbortSignal.timeout(75000)
    });
    const aiText = await aiResponse.text();
    let ai: any = {};
    try { ai = aiText ? JSON.parse(aiText) : {}; } catch { ai = {}; }
    if (!aiResponse.ok || ai?.ok === false) throw new Error("ai_router_failed:" + clip(ai?.error || ai?.state || aiResponse.status));
    const report = String(ai?.answer || ai?.final || ai?.message || "").trim();
    if (!validateDelivery(report, MAX_REPORT_CHARS)) throw new Error("artifact_empty_or_oversized");
    const outputSha = await sha256(report);
    const output = { report, generated_at: new Date().toISOString(), adapter_key: adapter.key, product_id: order.product_id, output_sha256: outputSha };
    const { data: completion, error: completionError } = await db.rpc("midad_complete_store_fulfillment", {
      p_job_id: job.id, p_output: output, p_output_sha256: outputSha,
      p_evidence: { adapter_key: adapter.key, product_id: order.product_id, input_sha256: inputHash, report_chars: report.length, generation_service: "midad_ai_router", no_external_transfer: true }
    });
    if (completionError) throw completionError;
    return json({ ok: true, order_id: order.id, status: "DELIVERED", output_sha256: outputSha, completion });
  } catch (error) {
    const message = clip((error as any)?.message || error);
    const { data: after } = await db.from("midad_store_fulfillment_jobs").select("status,output_sha256").eq("id", job.id).maybeSingle();
    if (after?.status === "DELIVERED") return json({ ok: true, idempotent: true, order_id: order.id, status: "DELIVERED", output_sha256: after.output_sha256 });
    await db.from("midad_store_fulfillment_jobs").update({ status: "FAILED", last_error: message, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "PROCESSING");
    await audit(job.id, order.id, "PROCESSING_FAILED", { error: message, attempt: claimed.attempts });
    return json({ ok: false, order_id: order.id, status: "FAILED", error: message }, 502);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!KEY || req.headers.get("authorization") !== "Bearer " + KEY) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "process_order") return json({ ok: false, error: "unknown_action" }, 400);
    const orderId = String(body?.order_id || "");
    return await processOrder(orderId);
  } catch (error) {
    return json({ ok: false, error: clip((error as any)?.message || error, 1000) }, 500);
  }
});
