export type RevenueCandidate = {
  region_eligible?: boolean | null;
  kyc_status?: string | null;
  identity_eligible?: boolean | null;
  asset?: string | null;
  network?: string | null;
  gross_usd?: number | null;
  individual_reward_usd?: number | null;
  payout_split_count?: number | null;
  reward_is_shared_pool?: boolean | null;
  platform_fee_usd?: number | null;
  network_fee_usd?: number | null;
  claim_fee_usd?: number | null;
  submission_fee_usd?: number | null;
  upfront_cost_usd?: number | null;
  acceptance_probability?: number | null;
  payout_confidence?: number | null;
};

export type RevenueQualification = {
  decision: "READY_FOR_REVIEW" | "BLOCKED";
  blockers: string[];
  gross_usd: number;
  total_costs_usd: number;
  net_usd: number;
  expected_net_usd: number;
  action_authorized: false;
};

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const nonNegative = (value: unknown): number => {
  const n = finite(value);
  return n === null ? 0 : Math.max(0, n);
};

export function qualifyRevenueCandidate(candidate: RevenueCandidate): RevenueQualification {
  const blockers: string[] = [];

  if (candidate.region_eligible !== true) {
    blockers.push("region_eligibility_unverified_or_denied");
  }

  const kyc = String(candidate.kyc_status ?? "").trim().toLowerCase();
  if (!["eligible", "not_required", "eligible_or_not_required", "verified_eligible"].includes(kyc)) {
    blockers.push("kyc_status_unverified_or_ineligible");
  }

  if (candidate.identity_eligible !== true) {
    blockers.push("identity_eligibility_unverified_or_denied");
  }

  const asset = String(candidate.asset ?? "").trim().toUpperCase();
  const network = String(candidate.network ?? "").trim();
  if (!asset || !network) blockers.push("asset_or_network_missing");

  const pool = finite(candidate.gross_usd);
  const share = finite(candidate.individual_reward_usd);
  const splitCount = finite(candidate.payout_split_count);
  const sharedPool = candidate.reward_is_shared_pool === true || (splitCount !== null && splitCount > 1);

  let gross = 0;
  if (share !== null && share >= 0) {
    gross = share;
  } else if (sharedPool || candidate.reward_is_shared_pool === true || (splitCount !== null && splitCount > 1)) {
    blockers.push("individual_payout_share_unverified");
  } else if (pool !== null && pool >= 0) {
    gross = pool;
  } else {
    blockers.push("individual_payout_share_unverified");
  }

  const fees = nonNegative(candidate.platform_fee_usd)
    + nonNegative(candidate.network_fee_usd)
    + nonNegative(candidate.claim_fee_usd)
    + nonNegative(candidate.submission_fee_usd)
    + nonNegative(candidate.upfront_cost_usd);

  if (fees > gross) blockers.push("fees_exceed_individual_reward");
  const net = Math.round((gross - fees) * 1e6) / 1e6;
  const acceptance = finite(candidate.acceptance_probability);
  const confidence = finite(candidate.payout_confidence);
  const probability = acceptance === null ? 0 : Math.max(0, Math.min(1, acceptance));
  const payoutConfidence = confidence === null ? 0 : Math.max(0, Math.min(1, confidence));
  const expected = Math.round(Math.max(0, net) * probability * payoutConfidence * 1e6) / 1e6;

  return {
    decision: blockers.length === 0 ? "READY_FOR_REVIEW" : "BLOCKED",
    blockers: [...new Set(blockers)].sort(),
    gross_usd: Math.round(gross * 1e6) / 1e6,
    total_costs_usd: Math.round(fees * 1e6) / 1e6,
    net_usd: net,
    expected_net_usd: expected,
    action_authorized: false,
  };
}
