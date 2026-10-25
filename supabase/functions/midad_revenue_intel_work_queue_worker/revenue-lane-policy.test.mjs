import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRevenueLane,
  evaluateAffiliateProgramEvidence,
} from "./revenue-lane-policy.mjs";

function verifiedAffiliate(overrides = {}) {
  return {
    task_type: "affiliate_program_eligibility_review",
    source_slug: "trezor_affiliate",
    payout_class: "affiliate_commission",
    url: "https://trezor.io/affiliate",
    compensation_asset: "BTC",
    payout_network: "bitcoin",
    upfront_cost_usd: 0,
    claim_bond_usd: 0,
    evidence: {
      revenue_lane: "affiliate",
      official_program_url: "https://trezor.io/affiliate",
      official_terms_url: "https://trezor.io/affiliate",
      official_terms_verified: true,
      crypto_payout_confirmed: true,
      commission_model: "commission per qualified sale",
      commission_rate_percent: 15,
      payout_asset: "BTC",
      payout_network: "bitcoin",
      payout_schedule: "monthly",
      verified_at: "2026-10-25T12:00:00.000Z",
    },
    ...overrides,
  };
}

test("affiliate program is classified as its own lane, not a task-escrow bounty", () => {
  assert.equal(classifyRevenueLane(verifiedAffiliate()), "affiliate");
  assert.equal(classifyRevenueLane({
    source_slug: "taskmarket_api",
    task_type: "independent_payment_proof",
    payout_class: "C1_TASK_ESCROW",
  }), "crypto_bounty");
});

test("verified crypto affiliate terms pass only to operator review without claiming revenue", () => {
  const result = evaluateAffiliateProgramEvidence(
    verifiedAffiliate(),
    new Date("2026-10-25T13:00:00.000Z"),
  );
  assert.equal(result.ready, true);
  assert.equal(result.decision, "AFFILIATE_PREAPPLICATION_READY");
  assert.equal(result.status, "READY_FOR_OPERATOR_REVIEW");
  assert.equal(result.external_action_allowed, false);
  assert.equal(result.revenue_realized, false);
  assert.ok(result.human_gates_required.includes("confirm_region_and_KYC_eligibility"));
});

test("affiliate proof does not require a task-specific escrow transaction hash", () => {
  const task = verifiedAffiliate();
  delete task.payment_tx_hash;
  task.payout_proof_status = "official_program_terms";
  const result = evaluateAffiliateProgramEvidence(task, new Date("2026-10-25T13:00:00.000Z"));
  assert.equal(result.ready, true);
  assert.notEqual(result.blockers.includes("task_specific_independent_payout_proof_missing"), true);
});

test("missing official crypto payout proof blocks affiliate lane with its own reason", () => {
  const task = verifiedAffiliate({
    evidence: {
      ...verifiedAffiliate().evidence,
      crypto_payout_confirmed: false,
    },
  });
  const result = evaluateAffiliateProgramEvidence(task, new Date("2026-10-25T13:00:00.000Z"));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("affiliate_crypto_payout_not_confirmed"));
  assert.ok(!result.blockers.includes("task_specific_independent_payout_proof_missing"));
});

test("stale official terms are blocked instead of silently treated as eligible", () => {
  const task = verifiedAffiliate({
    evidence: {
      ...verifiedAffiliate().evidence,
      verified_at: "2026-08-01T00:00:00.000Z",
    },
  });
  const result = evaluateAffiliateProgramEvidence(task, new Date("2026-10-25T13:00:00.000Z"));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("affiliate_terms_stale_or_unverifiable"));
});

test("affiliate official URLs must use HTTPS and the same official trust boundary", () => {
  const insecure = verifiedAffiliate({
    url: "http://trezor.io/affiliate",
    evidence: {
      ...verifiedAffiliate().evidence,
      official_program_url: "http://trezor.io/affiliate",
    },
  });
  assert.ok(evaluateAffiliateProgramEvidence(insecure, new Date("2026-10-25T13:00:00.000Z")).blockers.includes("affiliate_official_url_missing_or_insecure"));

  const spoofed = verifiedAffiliate({
    evidence: {
      ...verifiedAffiliate().evidence,
      official_terms_url: "https://trezor.io.attacker.example/terms",
    },
  });
  assert.ok(evaluateAffiliateProgramEvidence(spoofed, new Date("2026-10-25T13:00:00.000Z")).blockers.includes("affiliate_terms_domain_mismatch"));
});

test("unknown cost and any upfront cost fail closed", () => {
  const unknown = verifiedAffiliate({ upfront_cost_usd: null });
  assert.ok(evaluateAffiliateProgramEvidence(unknown, new Date("2026-10-25T13:00:00.000Z")).blockers.includes("affiliate_upfront_cost_unverified"));

  const paid = verifiedAffiliate({ upfront_cost_usd: 1 });
  assert.ok(evaluateAffiliateProgramEvidence(paid, new Date("2026-10-25T13:00:00.000Z")).blockers.includes("affiliate_upfront_cost_disallowed"));
});

test("missing or fiat payout asset cannot pass the crypto-only affiliate gate", () => {
  const task = verifiedAffiliate({
    compensation_asset: "EUR",
    evidence: {
      ...verifiedAffiliate().evidence,
      payout_asset: "EUR",
    },
  });
  const result = evaluateAffiliateProgramEvidence(task, new Date("2026-10-25T13:00:00.000Z"));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("affiliate_crypto_asset_unverified"));
});

test("affiliate qualification is provider-agnostic and accepts a different official trust boundary", () => {
  const task = verifiedAffiliate({
    source_slug: "vendorx_partner_program",
    url: "https://vendorx.dev/partners",
    evidence: {
      ...verifiedAffiliate().evidence,
      official_program_url: "https://vendorx.dev/partners",
      official_terms_url: "https://partners.vendorx.dev/affiliate-terms",
      payout_asset: "USDC",
      payout_network: "base",
      verified_at: "2026-10-25T12:00:00.000Z",
    },
    compensation_asset: "USDC",
    payout_network: "base",
  });
  const result = evaluateAffiliateProgramEvidence(task, new Date("2026-10-25T13:00:00.000Z"));
  assert.equal(classifyRevenueLane(task), "affiliate");
  assert.equal(result.ready, true);
  assert.equal(result.payout_asset, "USDC");
  assert.equal(result.payout_network, "base");
});
