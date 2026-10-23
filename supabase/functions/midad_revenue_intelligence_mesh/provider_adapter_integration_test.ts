import { assertEquals } from "jsr:@std/assert@1";
import { extractQualificationEvidence } from "./revenue_adapter_qualification.ts";
import {
  basedAgentsQualificationEvidence,
  bountyBookQualificationEvidence,
  superteamQualificationEvidence,
  taskmarketOfficialFeeEvidence,
} from "./revenue_adapter_qualification.ts";
import {
  basedAgentsFixture,
  bountyBookFixture,
  superteamFixture,
  taskmarketFixture,
} from "./provider_adapter_fixtures.ts";

Deno.test("Taskmarket public task submissionCount is not the worker's free-submission count", () => {
  assertEquals(taskmarketOfficialFeeEvidence(taskmarketFixture), {});
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "bounty" }), {});
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "bounty", workerSubmissionCount: 2 }).submissionFee, 0);
});

Deno.test("Taskmarket fixture: sixth and later bounty/benchmark submissions incur 0.001 USDC", () => {
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "bounty", workerSubmissionCount: 5 }).submissionFee, 0.001);
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "benchmark", workerSubmissionCount: 8 }).submissionFee, 0.001);
});

Deno.test("Taskmarket pitch and auction actions carry the documented 0.001 USDC action fee", () => {
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "pitch" }).submissionFee, 0.001);
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "auction" }).submissionFee, 0.001);
});

Deno.test("BasedAgents task fixture does not infer the user's region, KYC or identity from a listing", () => {
  assertEquals(basedAgentsQualificationEvidence(basedAgentsFixture), {
    escrowFunded: true,
  });
});

Deno.test("BasedAgents missing task-specific escrow evidence stays unknown", () => {
  assertEquals(basedAgentsQualificationEvidence({
    task_id: "unfunded-unknown",
    bounty_amount: 10000000,
    bounty_token: "USDC",
    bounty_network: "eip155:8453",
  }), {});
});

Deno.test("BountyBook fixture maps the official 4% platform fee, free claim/submission, and provider payout fields", () => {
  assertEquals(bountyBookQualificationEvidence(bountyBookFixture), {
    platformFee: 1,
    providerNetRewardUsd: 24,
    claimFee: 0,
    submissionFee: 0,
    feeScheduleVerified: true,
    feeScheduleEvidenceUrl: "https://www.bountybook.ai/job/a55bd7d2-b6a0-4bfc-80b5-f788d0ff312d",
    providerReportsPaid: false,
  });
});

Deno.test("BountyBook gross budget derives fee estimate but does not prove escrow funding or payout", () => {
  const evidence = bountyBookQualificationEvidence({
    id: "job-budget-only",
    budget_usdc: "25",
    chain_id: 8453,
  });
  assertEquals(evidence.platformFee, 1);
  assertEquals(evidence.providerNetRewardUsd, 24);
  assertEquals(evidence.feeScheduleVerified, true);
  assertEquals(evidence.escrowFunded, undefined);
  assertEquals(evidence.providerReportsPaid, undefined);
});

Deno.test("BountyBook shared reward pool is not converted into an individual payout", () => {
  const raw = {
    id: "job-split",
    budget_usdc: "100",
    platform_fee_usdc: "4",
    agent_receives_usdc: "96",
    award_count: 4,
    reward_is_shared_pool: true,
  };
  const feeEvidence = bountyBookQualificationEvidence(raw);
  const eligibilityEvidence = extractQualificationEvidence(raw, "bountybook_api");
  assertEquals(feeEvidence.individualRewardUsd, undefined);
  assertEquals(eligibilityEvidence.payoutSplitCount, 4);
  assertEquals(eligibilityEvidence.rewardIsSharedPool, true);
});

Deno.test("Superteam fixture respects explicit agentAccess but records human payout claim requirement", () => {
  assertEquals(superteamQualificationEvidence(superteamFixture), {
    agentSubmissionEligible: true,
    humanClaimRequired: true,
  });
});

Deno.test("Superteam human-only listing is not agent eligible", () => {
  assertEquals(superteamQualificationEvidence({ agentAccess: "HUMAN_ONLY" }), {
    agentSubmissionEligible: false,
    humanClaimRequired: false,
  });
});

Deno.test("Superteam listing reward is not proof of payout or region/KYC/identity eligibility", () => {
  assertEquals(superteamQualificationEvidence({
    compensation: { amount: 100, asset: "USDC", network: "Solana" },
  }), {});
});
