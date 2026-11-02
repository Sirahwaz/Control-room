import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAffiliateProgramEvidence,
  isAffiliateProgramTask,
  isSafeOfficialHttpsUrl,
} from "./affiliate_lane.mjs";

function verifiedAffiliate(overrides = {}) {
  return {
    task_type: "affiliate_program_eligibility_review",
    source_slug: "trezor_affiliate",
    url: "https://trezor.io/affiliate",
    upfront_cost_usd: 0,
    claim_bond_usd: 0,
    evidence: {
      affiliate: {
        official_program_url: "https://trezor.io/affiliate",
        official_terms_url: "https://partners.trezor.io/affiliate-terms",
        official_terms_verified: true,
        crypto_payout_confirmed: true,
        payout_asset: "BTC",
        payout_network: "bitcoin",
        commission_model: "commission per qualified sale",
        commission_rate_percent: 15,
        payout_schedule: "monthly",
        upfront_cost_verified: true,
        claim_bond_verified: true,
        upfront_cost_usd: 0,
        claim_bond_usd: 0,
        verified_at: "2026-11-02T12:00:00.000Z",
      },
    },
    ...overrides,
  };
}

test("affiliate classification is explicit and does not absorb ordinary bounties", () => {
  assert.equal(isAffiliateProgramTask(verifiedAffiliate()), true);
  assert.equal(isAffiliateProgramTask({ source_slug: "taskmarket_api", task_type: "independent_payment_proof" }), false);
});

test("official terms accept same host or a child subdomain only", () => {
  assert.equal(isSafeOfficialHttpsUrl("https://trezor.io/terms", "https://trezor.io/affiliate"), true);
  assert.equal(isSafeOfficialHttpsUrl("https://partners.trezor.io/terms", "https://trezor.io/affiliate"), true);
  assert.equal(isSafeOfficialHttpsUrl("https://io/terms", "https://trezor.io/affiliate"), false);
  assert.equal(isSafeOfficialHttpsUrl("https://trezor.io.attacker.example/terms", "https://trezor.io/affiliate"), false);
  assert.equal(isSafeOfficialHttpsUrl("http://trezor.io/terms", "https://trezor.io/affiliate"), false);
  assert.equal(isSafeOfficialHttpsUrl("https://user:pass@trezor.io/terms", "https://trezor.io/affiliate"), false);
  assert.equal(isSafeOfficialHttpsUrl("https://trezor.io:8443/terms", "https://trezor.io/affiliate"), false);
  assert.equal(isSafeOfficialHttpsUrl("https://127.0.0.1/terms", "https://127.0.0.1/affiliate"), false);
  assert.equal(isSafeOfficialHttpsUrl("https://localhost/terms", "https://localhost/affiliate"), false);
});

test("verified crypto affiliate terms reach operator review only, never realized revenue", () => {
  const result = evaluateAffiliateProgramEvidence(verifiedAffiliate(), Date.parse("2026-11-02T13:00:00.000Z"));
  assert.equal(result.ready, true);
  assert.equal(result.decision, "AFFILIATE_PREAPPLICATION_READY");
  assert.equal(result.status, "READY_FOR_OPERATOR_REVIEW");
  assert.equal(result.external_action_allowed, false);
  assert.equal(result.revenue_realized, false);
  assert.ok(result.human_gates_required.includes("obtain_personal_tracking_link"));
});

test("missing or stale payout evidence blocks affiliate review", () => {
  const missing = verifiedAffiliate({ evidence: { affiliate: { ...verifiedAffiliate().evidence.affiliate, crypto_payout_confirmed: false } } });
  const stale = verifiedAffiliate({ evidence: { affiliate: { ...verifiedAffiliate().evidence.affiliate, verified_at: "2026-09-01T00:00:00.000Z" } } });
  assert.ok(evaluateAffiliateProgramEvidence(missing, Date.parse("2026-11-02T13:00:00.000Z")).blockers.includes("affiliate_crypto_payout_not_confirmed"));
  assert.ok(evaluateAffiliateProgramEvidence(stale, Date.parse("2026-11-02T13:00:00.000Z")).blockers.includes("affiliate_terms_stale_or_unverifiable"));
});

test("unknown or positive upfront cost and claim bond fail closed", () => {
  const unknown = verifiedAffiliate({ upfront_cost_usd: null });
  const paid = verifiedAffiliate({ claim_bond_usd: 2 });
  assert.ok(evaluateAffiliateProgramEvidence(unknown, Date.parse("2026-11-02T13:00:00.000Z")).blockers.includes("affiliate_upfront_cost_unverified"));
  assert.ok(evaluateAffiliateProgramEvidence(paid, Date.parse("2026-11-02T13:00:00.000Z")).blockers.includes("affiliate_claim_bond_disallowed"));
});

test("affiliate task classification is evidence-driven and region or KYC denials block", () => {
  const denied = verifiedAffiliate({ region_gate: "denied" });
  const result = evaluateAffiliateProgramEvidence(denied, Date.parse("2026-11-02T13:00:00.000Z"));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("affiliate_region_ineligible_or_blocked"));
});
