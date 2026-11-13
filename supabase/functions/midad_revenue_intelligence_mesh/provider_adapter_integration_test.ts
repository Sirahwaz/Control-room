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
import { normalizeTaskmarketRail, isSupportedBaseUsdcRail, isSupportedTempoOusdRail, isSupportedTaskmarketCryptoAsset, isFreshVerifiedTempoProof } from "../_shared/taskmarket-rail.mjs";

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


Deno.test("Taskmarket chainId maps to the exact Base/USDC and Tempo/OUSD rails", () => {
  const base = normalizeTaskmarketRail({ chainId: 8453 });
  assertEquals(base, { chainId: 8453, asset: "USDC", network: "Base", supportedForBaseVerifier: true });
  const tempo = normalizeTaskmarketRail({ chainId: 4217 });
  assertEquals(tempo, { chainId: 4217, asset: "OUSD", network: "Tempo", supportedForBaseVerifier: false });
  assertEquals(isSupportedBaseUsdcRail(base), true);
  assertEquals(isSupportedTempoOusdRail(tempo), true);
  assertEquals(isSupportedTaskmarketCryptoAsset("OUSD"), true);
});

Deno.test("unknown Taskmarket chain IDs remain unsupported and never default to Base", () => {
  const rail = normalizeTaskmarketRail({ chainId: 421614 });
  assertEquals(rail, { chainId: 421614, asset: null, network: "421614", supportedForBaseVerifier: false });
  assertEquals(isSupportedBaseUsdcRail(rail), false);
  assertEquals(isSupportedTempoOusdRail(rail), false);
  assertEquals(isSupportedTaskmarketCryptoAsset("NOT_A_TOKEN"), false);
});

Deno.test("Tempo proof reuse requires exact fresh task, transaction, OUSD amount and 12 confirmations", () => {
  const taskId = "0x" + "a".repeat(64);
  const txHash = "0x" + "b".repeat(64);
  const now = Date.parse("2026-11-13T08:30:00.000Z");
  const checkedAt = new Date(now - 60_000).toISOString();
  const proof = {
    verified: true, chain_id: 4217, network: "Tempo", asset: "OUSD",
    task_id: taskId, tx_hash: txHash, reward_atomic: "220000",
    confirmations: 12, required_confirmations: 12, checked_at: checkedAt,
  };
  const input = {
    status: "verified_task_escrow", paymentTxHash: txHash, checkedAt,
    proof, taskId, txHash, amount: 0.22, now,
  };
  assertEquals(isFreshVerifiedTempoProof(input), true);
  assertEquals(isFreshVerifiedTempoProof({ ...input, proof: { ...proof, confirmations: 11 } }), false);
  assertEquals(isFreshVerifiedTempoProof({ ...input, txHash: "0x" + "c".repeat(64) }), false);
  assertEquals(isFreshVerifiedTempoProof({ ...input, amount: 0.23 }), false);
  const stale = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
  assertEquals(isFreshVerifiedTempoProof({ ...input, checkedAt: stale, proof: { ...proof, checked_at: stale } }), false);
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
