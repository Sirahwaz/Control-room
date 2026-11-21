import { assertEquals } from "jsr:@std/assert@1";
import { isReusableTaskmarketProof, isSupportedRevenueAsset, resolveTaskmarketPayoutRail } from "./taskmarket_rail.ts";
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

Deno.test("BountyBook public-page fixture is not misrepresented as a live API response", () => {
  assertEquals(bountyBookFixture.displayed_reward_usd, 5);
  assertEquals(bountyBookFixture.chain_id, 8453);
  assertEquals(bountyBookFixture.displayed_escrow_label, "secured in escrow");
  assertEquals(bountyBookQualificationEvidence(bountyBookFixture), {
    claimFee: 0,
    submissionFee: 0,
    feeScheduleVerified: false,
  });
});

Deno.test("BountyBook budget alone gives no provider-reported fee/net and does not prove API schema or escrow funding", () => {
  const evidence = bountyBookQualificationEvidence({
    id: "job-budget-only",
    budget_usdc: "25",
    chain_id: 8453,
  });
  assertEquals(evidence.platformFee, undefined);
  assertEquals(evidence.providerNetRewardUsd, undefined);
  assertEquals(evidence.feeScheduleVerified, false);
  assertEquals(evidence.escrowFunded, undefined);
  assertEquals(evidence.providerReportsPaid, undefined);
});

Deno.test("BountyBook candidate-shaped shared-pool fields stay untrusted without an observed API schema", () => {
  const raw = {
    id: "job-split",
    budget_usdc: "100",
    platform_fee_usdc: "4",
    agent_receives_usdc: "96",
    award_count: 4,
    reward_is_shared_pool: true,
  };
  const feeEvidence = bountyBookQualificationEvidence(raw);
  const genericEvidence = extractQualificationEvidence(raw, "bountybook_api");
  assertEquals(feeEvidence, {
    claimFee: 0,
    submissionFee: 0,
    feeScheduleVerified: false,
  });
  assertEquals(genericEvidence, {});
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

Deno.test("Taskmarket chainId 8453 maps only to Base USDC", () => {
  assertEquals(resolveTaskmarketPayoutRail({ chainId: "8453", description: "Standard funded bounty" }), {
    chainId: 8453, asset: "USDC", network: "Base", supportedRail: true, verifier: "base",
    externalPayout: false, nativeRewardAmount: null, nativeRewardAsset: null,
  });
});

Deno.test("Taskmarket chainId 4217 maps to Tempo OUSD, never Base USDC", () => {
  assertEquals(resolveTaskmarketPayoutRail({ chainId: "4217", description: "Standard funded bounty" }), {
    chainId: 4217, asset: "OUSD", network: "Tempo", supportedRail: true, verifier: "tempo",
    externalPayout: false, nativeRewardAmount: null, nativeRewardAsset: null,
  });
  assertEquals(isSupportedRevenueAsset("OUSD"), true);
});

Deno.test("unknown Taskmarket chain fails closed without inventing an asset", () => {
  assertEquals(resolveTaskmarketPayoutRail({ chainId: "999999", description: "Unknown chain" }), {
    chainId: 999999, asset: null, network: "chain:999999", supportedRail: false, verifier: null,
    externalPayout: false, nativeRewardAmount: null, nativeRewardAsset: null,
  });
  assertEquals(isSupportedRevenueAsset("FLAPJAX"), false);
});

Deno.test("explicit off-platform token reward overrides the Taskmarket USDC listing deposit", () => {
  const description = `Payout:
- FLAPJAX only: 100,000 FLAPJAX on BSC per accepted answer.
No per-worker USDC release. The USDC reward on this task is a listing deposit, not a per-worker payout.
The FLAPJAX payout is paid off-platform by FlapJax, not by Taskmarket.`;
  assertEquals(resolveTaskmarketPayoutRail({ chainId: "8453", description }), {
    chainId: 8453, asset: "FLAPJAX", network: "BSC", supportedRail: false, verifier: null,
    externalPayout: true, nativeRewardAmount: 100000, nativeRewardAsset: "FLAPJAX",
  });
});

Deno.test("fresh exact Taskmarket proof can be reused only for the same task, tx, rail and amount", () => {
  const now = Date.parse("2026-11-21T07:00:00.000Z");
  const tx = "0x" + "a".repeat(64);
  const taskId = "0x" + "b".repeat(64);
  const base = {
    proof: { verified: true, confirmations: 12, tx_hash: tx, task_id: taskId, asset: "USDC", network: "Base", net_reward_atomic: "1100000" },
    storedExternalId: taskId, currentExternalId: taskId,
    storedAmount: 1.1, currentAmount: 1.1, currentAmountAtomic: "1100000",
    storedAsset: "USDC", currentAsset: "USDC",
    storedNetwork: "Base", currentNetwork: "Base",
    storedTxHash: tx, currentTxHash: tx,
    storedProofStatus: "verified_task_escrow", storedEscrowFunded: true,
    storedCheckedAt: new Date(now - 60_000).toISOString(), nowMs: now,
  };
  assertEquals(isReusableTaskmarketProof(base), true);
  assertEquals(isReusableTaskmarketProof({ ...base, currentAmountAtomic: "1100001" }), false);
  assertEquals(isReusableTaskmarketProof({ ...base, currentTxHash: "0x" + "c".repeat(64) }), false);
  assertEquals(isReusableTaskmarketProof({ ...base, proof: { ...base.proof, confirmations: 11 } }), false);
  assertEquals(isReusableTaskmarketProof({ ...base, storedCheckedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }), false);
});
