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
import {
  isTaskmarketHighCompetitionLowValue,
  normalizeTaskmarketRail,
  shouldPreserveVerifiedTaskmarketProof,
  taskmarketPurchaseRequirement,
  taskmarketRegionGate,
} from "./taskmarket_rail.ts";

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


Deno.test("Taskmarket chainId maps Base USDC and Tempo OUSD without defaulting unknown chains to Base", () => {
  assertEquals(normalizeTaskmarketRail({ chainId: 8453 }), {
    chainId: 8453, asset: "USDC", network: "Base", supported: true,
  });
  assertEquals(normalizeTaskmarketRail({ chain_id: "4217" }), {
    chainId: 4217, asset: "OUSD", network: "Tempo", supported: true,
  });
  assertEquals(normalizeTaskmarketRail({ chainId: 1 }), {
    chainId: 1, asset: null, network: "1", supported: false,
  });
  assertEquals(normalizeTaskmarketRail({}), {
    chainId: null, asset: null, network: "unknown", supported: false,
  });
});

Deno.test("Taskmarket purchase-required listings are blocked with a conservative minimum cost", () => {
  const requirement = taskmarketPurchaseRequirement({
    title: "Shop Lumen House",
    description: "Buy the Manifest Kit, buy an Interface Check, buy any NFT and buy the $1 Help Map pass. Entrants pay their own purchase and network costs. Save your receipt.",
  });
  assertEquals(requirement, { required: true, costFloorUsd: 1, costFloorKnown: true });
  assertEquals(taskmarketPurchaseRequirement({ title: "Write API documentation", description: "Deliver a short report." }), {
    required: false, costFloorUsd: null, costFloorKnown: false,
  });
});

Deno.test("Taskmarket U.S.-purchaser restriction is not treated as globally eligible", () => {
  assertEquals(taskmarketRegionGate({ description: "The Help Map pass is currently for eligible U.S. purchasers." }), "US-only");
  assertEquals(taskmarketRegionGate({ description: "Open to all developers." }), "unknown");
});

Deno.test("Taskmarket high-competition low-value threshold blocks 50+ submissions at 25 or less", () => {
  assertEquals(isTaskmarketHighCompetitionLowValue({ sourceSlug: "taskmarket_api", competition: 80, amount: 10 }), true);
  assertEquals(isTaskmarketHighCompetitionLowValue({ sourceSlug: "taskmarket_api", competition: 49, amount: 10 }), false);
  assertEquals(isTaskmarketHighCompetitionLowValue({ sourceSlug: "taskmarket_api", competition: 80, amount: 100 }), false);
  assertEquals(isTaskmarketHighCompetitionLowValue({ sourceSlug: "other", competition: 80, amount: 10 }), false);
});

Deno.test("Taskmarket independently verified escrow is preserved only for the exact same task rail and transaction", () => {
  const existing = {
    payout_proof_status: "verified_task_escrow",
    escrow_funded: true,
    payment_tx_hash: "0xabc",
    compensation_asset: "OUSD",
    payout_network: "Tempo",
    independent_payout_check: {
      verified: true,
      tx_hash: "0xabc",
      asset: "OUSD",
      network: "Tempo",
      confirmations: 12,
    },
  };
  assertEquals(shouldPreserveVerifiedTaskmarketProof(existing, { tx: "0xabc", asset: "OUSD", network: "Tempo" }), true);
  assertEquals(shouldPreserveVerifiedTaskmarketProof(existing, { tx: "0xdef", asset: "OUSD", network: "Tempo" }), false);
  assertEquals(shouldPreserveVerifiedTaskmarketProof(existing, { tx: "0xabc", asset: "USDC", network: "Base" }), false);
  assertEquals(shouldPreserveVerifiedTaskmarketProof({
    ...existing,
    independent_payout_check: { ...existing.independent_payout_check, confirmations: 11 },
  }, { tx: "0xabc", asset: "OUSD", network: "Tempo" }), false);
});
