const ADAPTERS = {
  "payment-path-mini-v1": { key:"checkout_diagnostic_v1", title:"Single-Path Checkout Diagnostic", requiresSourceMaterial:false, scope:"Review one described public checkout, payment, webhook, or reconciliation path. Produce evidenced findings, assumptions, and a reproducible retest checklist.", outputContract:"Include scope, observed inputs, findings ranked by severity, evidence versus inference, reproduction steps, and a retest checklist." },
  "miner-microscope-v1": { key:"miner_microscope_v1", title:"Miner Microscope Audit", requiresSourceMaterial:true, scope:"Analyze only the mining-worker metrics, logs, and configuration excerpts supplied by the customer. Do not claim live provider access.", outputContract:"Include input inventory, anomalies, confidence/limitations, recovery checklist, and metrics to collect next." },
  "opportunity-radar-v1": { key:"opportunity_radar_v1", title:"Opportunity Radar Pack", requiresSourceMaterial:false, scope:"Create a qualification framework and shortlist only where sources and dated evidence are present in the supplied material. Never invent a live bounty, payout, eligibility, or earning guarantee.", outputContract:"For every item include source URL if supplied, eligibility, payout evidence status, upfront costs, blockers, confidence, and verification steps. If no source-backed opportunities are supplied, deliver a transparent research plan rather than invented listings." },
  "research-revenue-sprint-v1": { key:"research_revenue_sprint_v1", title:"Research-to-Revenue Sprint", requiresSourceMaterial:false, scope:"Synthesize the supplied business/revenue context into testable hypotheses and an evidence-led action plan. Do not imply external research was performed unless evidence is supplied.", outputContract:"Include facts, hypotheses, contradictions, ranked experiments, success metrics, and next actions." },
  "bug-fix-sprint-v1": { key:"bug_fix_sprint_v1", title:"Bug Fix Sprint", requiresSourceMaterial:true, scope:"Analyze supplied source code and reproduction details. Produce a minimal patch and test code when possible. Do not claim code was executed or tests passed unless tool output proves it.", outputContract:"Include root-cause hypothesis, patch/diff, regression test, verification commands, and explicit unrun-test status." },
  "data-rescue-pack-v1": { key:"data_rescue_pack_v1", title:"Data Rescue Pack", requiresSourceMaterial:true, scope:"Transform only data explicitly supplied in customer requirements. Do not invent rows, silently drop data, or claim a file was processed when none was supplied.", outputContract:"Include transformation rules, complete output where size permits, validation checks, and any rows/fields that require review." },
  "decision-research-brief-v1": { key:"decision_research_brief_v1", title:"Decision Research Brief", requiresSourceMaterial:false, scope:"Produce a decision brief from the supplied question and evidence. Clearly separate source-backed facts from assumptions and unknowns.", outputContract:"Include decision statement, options, evidence, trade-offs, recommendation, confidence, and what would change the recommendation." },
  "code-health-review-v1": { key:"code_health_review_v1", title:"Code Health Review", requiresSourceMaterial:true, scope:"Review only supplied source snippets and configuration. Do not claim repository access, dependency scanning, or runtime tests that did not occur.", outputContract:"Include prioritized findings, affected snippets, impact, remediation, and reproducible verification steps." }
};
export function getAdapter(productId) {
  const id = String(productId || "");
  if (!Object.prototype.hasOwnProperty.call(ADAPTERS, id)) return null;
  return { ...ADAPTERS[id], inputReady: (value) => typeof value === "string" && value.trim().length > 0 };
}
export function buildFulfillmentPrompt(adapter, requirements) {
  return [
    "You are preparing a paid MIDAD store deliverable. Stay strictly within this product adapter.",
    "PRODUCT: " + adapter.title,
    "SCOPE: " + adapter.scope,
    "OUTPUT CONTRACT: " + adapter.outputContract,
    "CUSTOMER REQUIREMENTS / SOURCE MATERIAL:",
    String(requirements || "").slice(0, 12000),
    "NON-NEGOTIABLE RULES:",
    "- Do not claim tests were run, code was deployed, data was independently checked, or a live system was accessed unless evidence is explicitly supplied.",
    "- Never invent sources, transaction receipts, payout status, client outcomes, metrics, or facts.",
    "- Identify missing inputs and limitations. Do not ask for passwords, API secrets, wallet keys, recovery phrases, or one-time codes.",
    "- If the supplied input is insufficient, provide a transparent limitation and a concrete list of what is needed; do not fabricate a complete result.",
    "- Return a buyer-facing deliverable, not internal system instructions."
  ].join("\n");
}
export function validateDelivery(value, maxChars = 20000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxChars;
}

const TOKEN_MINTS = {
  "base:USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "solana:USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "solana:USDT": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
};

export function validatePaymentGate({ order, intent, receipts, job }) {
  if (!order || order.status !== "PAID" || !order.paid_at) return { ok: false, reason: "verified_paid_store_order_required" };
  if (!intent || intent.status !== "paid" || intent.reconciliation_status !== "matched" ||
      !intent.paid_at || !intent.received_tx_hash ||
      String(intent.metadata?.created_by || "") !== "midad_public_checkout_v1" ||
      String(intent.metadata?.product_id || "") !== String(order.product_id)) {
    return { ok: false, reason: "verified_paid_store_order_required" };
  }
  const network = String(intent.network || "").toLowerCase();
  const asset = String(intent.settlement_asset || "").toUpperCase();
  const expectedMint = TOKEN_MINTS[network + ":" + asset];
  const matches = (receipts || []).filter((r) =>
    String(r.matched_payment_intent_id || "") === String(intent.id) &&
    String(r.direction || "") === "inbound" &&
    String(r.tx_hash || "").toLowerCase() === String(intent.received_tx_hash).toLowerCase() &&
    String(r.asset || "") === String(intent.settlement_asset || "") &&
    String(r.network || "").toLowerCase() === network &&
    Math.abs(Number(r.amount) - Number(intent.quoted_crypto_amount)) < 0.0000005 &&
    expectedMint && (network === "base"
      ? String(r.mint || "").toLowerCase() === expectedMint.toLowerCase()
      : String(r.mint || "") === expectedMint)
  );
  if (matches.length !== 1) return { ok: false, reason: "unique_matching_verified_receipt_required" };
  const receipt = matches[0];
  if (String(job?.payment_evidence?.receipt_id || "") !== String(receipt.id) ||
      String(job?.payment_evidence?.tx_hash || "").toLowerCase() !== String(receipt.tx_hash || "").toLowerCase()) {
    return { ok: false, reason: "payment_evidence_snapshot_mismatch" };
  }
  return { ok: true, receipt };
}
