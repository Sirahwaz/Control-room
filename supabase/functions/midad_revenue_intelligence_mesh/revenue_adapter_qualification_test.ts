import { assertEquals } from "jsr:@std/assert@1";
import { bountyBookQualificationEvidence, extractQualificationEvidence, taskmarketOfficialFeeEvidence } from "./revenue_adapter_qualification.ts";

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
      region: "eligible",
      kyc: "not_required",
      identityEligible: true,
      identity: "eligible",
      individualRewardUsd: 32,
      payoutSplitCount: 4,
      rewardIsSharedPool: true,
      submissionFee: 1.5,
      feeScheduleVerified: true,
      feeScheduleEvidenceUrl: "https://docs.taskmarket.dev/concepts/fees-payments",
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
    { regionEligible: true, region: "eligible", kyc: "required", identityEligible: true, identity: "eligible" },
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
    { submissionFee: 2, feeScheduleVerified: true, feeScheduleEvidenceUrl: "https://docs.taskmarket.dev/concepts/fees-payments" },
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

Deno.test("maps explicit denials into the persisted gate fields", () => {
  assertEquals(
    extractQualificationEvidence({ region_eligible: false, identity_eligible: false }, "taskmarket_api"),
    { regionEligible: false, region: "ineligible", identityEligible: false, identity: "ineligible" },
  );
});

Deno.test("existing Taskmarket feed shape alone does not prove region, KYC, identity, or fee schedule", () => {
  assertEquals(
    extractQualificationEvidence({
      id: "task-1",
      netReward: 12500000,
      expiryTime: 1790000000,
      escrowTxHash: "0x1234",
      stakeRequired: false,
      status: "open",
      phase: "active",
      submissionWindowOpen: true,
      tags: ["typescript"],
    }, "taskmarket_api"),
    {},
  );
});

Deno.test("existing BasedAgents feed shape alone does not prove individual payout or eligibility", () => {
  assertEquals(
    extractQualificationEvidence({
      task_id: "based-1",
      bounty_amount: 100000000,
      bounty_token: "USDC",
      bounty_network: "eip155:8453",
      required_capabilities: ["api"],
      claimed_by_agent_id: null,
    }, "basedagents_api"),
    {},
  );
});

Deno.test("existing BountyBook feed shape does not certify fee schedule or eligibility", () => {
  assertEquals(
    extractQualificationEvidence({
      id: "bb-1",
      budget_usdc: 200,
      chain_id: "8453",
      status: "open",
      flagged: false,
      tags: ["typescript"],
      estimated_minutes: 60,
    }, "bountybook_api"),
    {},
  );
});

Deno.test("an Immunefi listing boolean is not assumed to establish KYC eligibility", () => {
  assertEquals(
    extractQualificationEvidence({ kyc: true, maxBounty: 1000, project: "Example" }, "immunefi"),
    {},
  );
});

Deno.test("an explicitly disclosed claim fee is mapped, but does not verify the full fee schedule", () => {
  assertEquals(
    extractQualificationEvidence({
      claimFeeUsd: 1.25,
      claim_fee_usd: 9,
      region: "EU",
    }, "official_airdrop_json"),
    { claimFee: 1.25 },
  );
});

Deno.test("Taskmarket bounty submission fee remains unverified without worker-specific allowance data", () => {
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "bounty" }), {});
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "bounty", workerSubmissionCount: 1 }).submissionFee, 0);
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "bounty", workerSubmissionCount: 5 }).submissionFee, 0.001);
});

Deno.test("Taskmarket pitch and auction modes account for the official 0.001 USDC action fee", () => {
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "pitch" }).submissionFee, 0.001);
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "auction" }).submissionFee, 0.001);
});

Deno.test("unknown Taskmarket mode does not inherit a free-submission fee", () => {
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "future_mode" }), {});
});

Deno.test("Taskmarket award metadata identifies a split payout without inventing a per-worker share", () => {
  assertEquals(
    extractQualificationEvidence({ awardCount: 3, netReward: "10000000" }, "taskmarket_api"),
    { payoutSplitCount: 3 },
  );
  assertEquals(
    extractQualificationEvidence({ awards: [{ workerPayment: "7000000" }, { workerPayment: "3000000" }] }, "taskmarket_api"),
    { payoutSplitCount: 2 },
  );
});


Deno.test("BountyBook derives the documented four-percent platform fee and zero claim/submission fees from gross budget", () => {
  assertEquals(
    bountyBookQualificationEvidence({ budget_usdc: "25", chain_id: 8453 }),
    {
      platformFee: 1,
      providerNetRewardUsd: 24,
      claimFee: 0,
      submissionFee: 0,
      feeScheduleVerified: true,
      feeScheduleEvidenceUrl: "https://www.bountybook.ai/job/a55bd7d2-b6a0-4bfc-80b5-f788d0ff312d",
    },
  );
});

Deno.test("BountyBook only verifies the four-percent policy when explicit fee and provider net agree with gross", () => {
  assertEquals(
    bountyBookQualificationEvidence({
      budget_usdc: "100",
      platform_fee_usdc: "4",
      agent_receives_usdc: "96",
    }).feeScheduleVerified,
    true,
  );
  assertEquals(
    bountyBookQualificationEvidence({
      budget_usdc: "100",
      platform_fee_usdc: "4",
      agent_receives_usdc: "90",
    }).feeScheduleVerified,
    false,
  );
});

Deno.test("BountyBook does not invent a fee amount or mark its schedule verified without a gross reward", () => {
  assertEquals(
    bountyBookQualificationEvidence({ platform_fee_usdc: "4", agent_receives_usdc: "96" }).feeScheduleVerified,
    false,
  );
});
