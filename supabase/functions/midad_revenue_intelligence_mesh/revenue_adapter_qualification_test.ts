import { assertEquals } from "jsr:@std/assert@1";
import { extractQualificationEvidence } from "./revenue_adapter_qualification.ts";

Deno.test("maps explicit region, KYC, identity and individual payout fields without guessing", () => {
  assertEquals(
    extractQualificationEvidence({
      region_eligible: true,
      kyc_status: "not_required",
      identity_eligible: true,
      individual_reward_usd: 32,
      payout_split_count: 4,
      reward_is_shared_pool: true,
      submission_fee_usd: 1.5,
      fee_schedule_verified: true,
      fee_schedule_evidence_url: "https://docs.taskmarket.dev/concepts/fees-payments",
    }, "taskmarket_api"),
    {
      regionEligible: true,
      kyc: "not_required",
      identityEligible: true,
      individualRewardUsd: 32,
      payoutSplitCount: 4,
      rewardIsSharedPool: true,
      submissionFee: 1.5,
      feeScheduleVerified: true,
    },
  );
});

Deno.test("does not infer region eligibility from a country or region label", () => {
  assertEquals(
    extractQualificationEvidence({ region: "France", country: "FR", kyc: false, identity: "verified" }, "taskmarket_api"),
    {},
  );
});

Deno.test("maps explicit KYC required as a blocker-compatible status, not as eligible", () => {
  assertEquals(
    extractQualificationEvidence({ kycStatus: "required", regionEligible: true, identityEligible: true }, "superteam_agent_api"),
    { regionEligible: true, kyc: "required", identityEligible: true },
  );
});

Deno.test("requires explicit fee-schedule assertion and official provider-domain evidence", () => {
  assertEquals(
    extractQualificationEvidence({
      feeScheduleVerified: true,
      feeScheduleEvidenceUrl: "https://fees.example.net/taskmarket",
      submissionFeeUsd: 2,
    }, "taskmarket_api"),
    { submissionFee: 2 },
  );
  assertEquals(
    extractQualificationEvidence({
      feeScheduleVerified: true,
      feeScheduleEvidenceUrl: "https://docs.taskmarket.dev/concepts/fees-payments",
      submissionFeeUsd: 2,
    }, "taskmarket_api"),
    { submissionFee: 2, feeScheduleVerified: true },
  );
});

Deno.test("does not treat an unverified listing claim as a verified fee schedule", () => {
  assertEquals(
    extractQualificationEvidence({
      submission_fee_usd: 0,
      fee_schedule_verified: false,
      fee_schedule_evidence_url: "https://docs.taskmarket.dev/concepts/fees-payments",
    }, "taskmarket_api"),
    { submissionFee: 0 },
  );
});

Deno.test("only maps a split payout when a per-recipient amount is explicitly present", () => {
  assertEquals(
    extractQualificationEvidence({ rewardPoolUsd: 500, payoutSplitCount: 5, rewardIsSharedPool: true }, "bountybook_api"),
    { payoutSplitCount: 5, rewardIsSharedPool: true },
  );
  assertEquals(
    extractQualificationEvidence({ rewardPoolUsd: 500, payoutSplitCount: 5, individualRewardUsd: 100 }, "bountybook_api"),
    { individualRewardUsd: 100, payoutSplitCount: 5 },
  );
});
