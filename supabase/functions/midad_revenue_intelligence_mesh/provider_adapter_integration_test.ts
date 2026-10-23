import { assertEquals } from "jsr:@std/assert@1";
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

Deno.test("Taskmarket fixture: first five bounty/benchmark submissions are free only when count is known", () => {
  assertEquals(taskmarketOfficialFeeEvidence(taskmarketFixture), {
    submissionFee: 0,
    feeScheduleVerified: true,
    feeScheduleEvidenceUrl: "https://docs.taskmarket.dev/concepts/fees-payments",
  });
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "bounty" }), {});
});

Deno.test("Taskmarket fixture: sixth and later bounty/benchmark submissions incur 0.001 USDC", () => {
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "bounty", submissionCount: 5 }).submissionFee, 0.001);
  assertEquals(taskmarketOfficialFeeEvidence({ mode: "benchmark", submissionCount: 8 }).submissionFee, 0.001);
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

Deno.test("BountyBook fixture maps explicit fee and payout fields without assuming the platform fee percentage", () => {
  assertEquals(bountyBookQualificationEvidence(bountyBookFixture), {
    platformFee: 1,
    individualRewardUsd: 24,
    payoutIsSettled: false,
  });
});

Deno.test("BountyBook budget alone does not prove funded escrow or an individual net payout", () => {
  assertEquals(bountyBookQualificationEvidence({
    id: "job-budget-only",
    budget_usdc: "25",
    chain_id: 8453,
  }), {});
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
