import { assertEquals, assert } from "jsr:@std/assert@1";

import { qualifyRevenueCandidate } from "./revenue_qualification_gates.ts";

const eligible = {
  region_eligible: true,
  kyc_status: "eligible_or_not_required",
  identity_eligible: true,
  asset: "USDC",
  network: "Base",
  gross_usd: 100,
  platform_fee_usd: 5,
  network_fee_usd: 1,
  claim_fee_usd: 0,
  submission_fee_usd: 2,
  upfront_cost_usd: 0,
  fee_schedule_verified: true,
  acceptance_probability: 0.5,
  payout_confidence: 0.8,
};

Deno.test("unknown region eligibility blocks review", () => {
  const result = qualifyRevenueCandidate({ ...eligible, region_eligible: null });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("region_eligibility_unverified_or_denied"));
});

Deno.test("denied region eligibility blocks review", () => {
  const result = qualifyRevenueCandidate({ ...eligible, region_eligible: false });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("region_eligibility_unverified_or_denied"));
});

Deno.test("unknown KYC blocks review", () => {
  const result = qualifyRevenueCandidate({ ...eligible, kyc_status: "unknown" });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("kyc_status_unverified_or_ineligible"));
});

Deno.test("ineligible KYC blocks review", () => {
  const result = qualifyRevenueCandidate({ ...eligible, kyc_status: "required_but_unavailable" });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("kyc_status_unverified_or_ineligible"));
});

Deno.test("unknown identity eligibility blocks review", () => {
  const result = qualifyRevenueCandidate({ ...eligible, identity_eligible: null });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("identity_eligibility_unverified_or_denied"));
});

Deno.test("denied identity eligibility blocks review", () => {
  const result = qualifyRevenueCandidate({ ...eligible, identity_eligible: false });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("identity_eligibility_unverified_or_denied"));
});

Deno.test("calculates individual net after all fees including submission fee", () => {
  const result = qualifyRevenueCandidate(eligible);
  assertEquals(result.net_usd, 92);
  assertEquals(result.decision, "READY_FOR_REVIEW");
});

Deno.test("does not treat a split reward pool as an individual payout without per-recipient share", () => {
  const result = qualifyRevenueCandidate({ ...eligible, payout_split_count: 4 });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("individual_payout_share_unverified"));
});

Deno.test("uses explicit per-recipient reward share for split payouts", () => {
  const result = qualifyRevenueCandidate({
    ...eligible,
    gross_usd: 400,
    payout_split_count: 4,
    individual_reward_usd: 100,
  });
  assertEquals(result.gross_usd, 100);
  assertEquals(result.net_usd, 92);
  assertEquals(result.decision, "READY_FOR_REVIEW");
});

Deno.test("blocks when fees exceed the individual reward instead of clamping net to zero", () => {
  const result = qualifyRevenueCandidate({ ...eligible, submission_fee_usd: 200 });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("fees_exceed_individual_reward"));
});

Deno.test("unknown or missing split count cannot inflate the expected individual reward", () => {
  const result = qualifyRevenueCandidate({ ...eligible, payout_split_count: null, reward_is_shared_pool: true });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("individual_payout_share_unverified"));
});

Deno.test("blocks when submission fee schedule has not been verified", () => {
  const result = qualifyRevenueCandidate({ ...eligible, fee_schedule_verified: null });
  assertEquals(result.decision, "BLOCKED");
  assert(result.blockers.includes("submission_fee_unverified"));
});
