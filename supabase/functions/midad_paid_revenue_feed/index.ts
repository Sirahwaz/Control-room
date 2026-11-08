import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { Hono } from "npm:hono";
import { paymentMiddleware, x402ResourceServer } from "npm:@x402/hono";
import { ExactEvmScheme } from "npm:@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "npm:@x402/core/server";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const sql = DB_URL ? postgres(DB_URL, { max: 2, idle_timeout: 5, connect_timeout: 10, ssl: "require", prepare: false }) : null;
const VERSION = "1.0.0";
const NETWORK = "eip155:8453";
const PAY_TO = "0xdf20c8058E03aB1c6A79968B6f72bc25EA067345";
const PRICE = "$0.01";
const FACILITATOR = "https://facilitator.openx402.ai";
const app = new Hono();
const BASE_PATH = "/functions/v1/midad_paid_revenue_feed";
function db() { if (!sql) throw new Error("database_unavailable"); return sql; }
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR });
const resourceServer = new x402ResourceServer(facilitatorClient).register("eip155:*", new ExactEvmScheme());

app.get(BASE_PATH + "/health", (c) => c.json({
  ok: true,
  service: "midad_paid_revenue_feed",
  version: VERSION,
  payment: { protocol: "x402", asset: "USDC", network: NETWORK, price_per_request: PRICE },
  data_mode: "cached public opportunity records only",
  no_customer_or_private_data: true
}));

app.get(BASE_PATH + "/.well-known/x402", (c) => c.json({
  protocol: "x402",
  version: 2,
  service: "MIDAD Revenue Intelligence Feed",
  description: "Evidence-labelled crypto-income opportunities with task-level payout verification and explicit cost/eligibility gates.",
  routes: [{
    method: "GET",
    path: "/functions/v1/midad_paid_revenue_feed/api/opportunities",
    price: PRICE,
    asset: "USDC",
    network: NETWORK,
    mime_type: "application/json",
    data_freshness: "latest stored public-source scan",
    no_claim_guarantee: true
  }],
  facilitator: FACILITATOR,
  notes: [
    "This is a public, read-only feed, not an investment recommendation or guarantee of income.",
    "Platform budgets are not treated as paid income; task-level payout proof status is displayed per record.",
    "No data from private chats, customer records, secrets, wallet signing requests or internal credentials is returned."
  ]
}));

app.use(
  BASE_PATH + "/api/opportunities",
  paymentMiddleware(
    {
      "GET /functions/v1/midad_paid_revenue_feed/api/opportunities": {
        accepts: [{
          scheme: "exact",
          price: PRICE,
          network: NETWORK,
          payTo: PAY_TO
        }],
        description: "Read the latest MIDAD evidence-labelled crypto-income opportunity feed. Includes payout-proof status, upfront-cost gates, deadlines and freshness.",
        mimeType: "application/json"
      }
    },
    resourceServer
  )
);

app.get(BASE_PATH + "/api/opportunities", async (c) => {
  try {
    const rows = await db()`
      SELECT source_slug, external_id, title, description, url, external_status,
             compensation_amount, compensation_asset, payout_network, payout_class,
             payout_proof_status, payout_confidence, escrow_funded,
             payment_tx_hash, payout_proof_url, payout_proof_checked_at,
             upfront_cost_usd, claim_bond_usd, estimated_fee_usd, estimated_net_usd,
             deadline, region_gate, kyc_gate, identity_gate,
             fit_score, payout_score, freshness_score, competition_score,
             priority_score, gate_decision, gate_reasons, status, next_action,
             required_capabilities, first_seen_at, last_seen_at, last_verified_at
      FROM public.midad_revenue_intel_opportunities
      WHERE last_seen_at > now() - interval '72 hours'
        AND gate_decision NOT IN ('STALE','DUPLICATE_OR_TEST')
      ORDER BY
        CASE gate_decision
          WHEN 'READY_FOR_REVIEW' THEN 0
          WHEN 'DISCOVERY_ONLY' THEN 1
          WHEN 'BLOCKED_PAYOUT' THEN 2
          WHEN 'BLOCKED_UPFRONT_COST' THEN 3
          WHEN 'BLOCKED_KYC_OR_REGION' THEN 4
          ELSE 5
        END,
        priority_score DESC, last_seen_at DESC
      LIMIT 20
    `;
    const byGate = rows.reduce((acc:Record<string,number>,r:any) => {
      const key=String(r.gate_decision||"UNKNOWN");
      acc[key]=(acc[key]||0)+1;
      return acc;
    },{});
    return c.json({
      schema_version: "midad-revenue-feed-v1",
      generated_at: new Date().toISOString(),
      count: rows.length,
      summary: byGate,
      pricing: { protocol: "x402", amount: "0.01", asset: "USDC", network: NETWORK },
      disclaimer: "A listing or escrow signal is not a guaranteed personal payout. READY_FOR_REVIEW means evidence-based review is possible, not that this API claims the job. Do not pay claim bonds or fees unless explicitly reflected in the gate fields.",
      opportunities: rows
    });
  } catch (_e) {
    return c.json({
      error: "feed_temporarily_unavailable",
      message: "The cached public opportunity feed is temporarily unavailable. No opportunity claim or external action was attempted."
    }, 503);
  }
});

app.all("*", (c) => c.json({error:"route_not_found",method:c.req.method,pathname:new URL(c.req.url).pathname},404));
Deno.serve((req) => {
  const incoming = new URL(req.url);
  const externalPath = incoming.pathname.startsWith("/functions/v1/")
    ? incoming.pathname
    : "/functions/v1" + incoming.pathname;
  const canonical = new URL(externalPath + incoming.search, "https://froegigfmpmvtecztfbf.supabase.co");
  return app.fetch(new Request(canonical, req));
});
