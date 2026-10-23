export const REVENUE_MESH_VERSION = 15;

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
  fee_schedule_verified?: boolean | null;
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

  if (candidate.fee_schedule_verified !== true) blockers.push("submission_fee_unverified");

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


const RECONCILIATION_PROTECTED_STATUSES = new Set([
  "PAID",
  "CLAIMED",
  "IN_PROGRESS",
  "DELIVERED",
  "AWAITING_ACCEPTANCE",
]);

/**
 * Decide whether a previously READY opportunity should be changed to STALE.
 * Invalid/missing deadlines and protected operational states are deliberately
 * left untouched. This is a classification helper; callers still use a
 * conditional UPDATE so concurrent state changes cannot be overwritten.
 */
export function shouldReconcileExpiredOpportunity(
  candidate: {
    deadline?: Date | string | null;
    gate_decision?: string | null;
    status?: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (String(candidate.gate_decision ?? "").trim().toUpperCase() !== "READY_FOR_REVIEW") {
    return false;
  }

  const status = String(candidate.status ?? "").trim().toUpperCase();
  // Only the known, UI-qualified candidate state may be reconciled. Fail closed
  // for unknown/future states, rather than relying on an ever-growing denylist.
  if (status !== "QUALIFIED" || RECONCILIATION_PROTECTED_STATUSES.has(status)) {
    return false;
  }

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return false;

  const rawDeadline = candidate.deadline;
  if (rawDeadline === null || rawDeadline === undefined || rawDeadline === "") return false;
  const deadline = rawDeadline instanceof Date ? rawDeadline : new Date(rawDeadline);
  if (!Number.isFinite(deadline.getTime())) return false;

  return deadline.getTime() <= now.getTime();
}


export type PersistedRevenueGateDecision =
  | "READY_FOR_REVIEW"
  | "DISCOVERY_ONLY"
  | "BLOCKED_UPFRONT_COST"
  | "BLOCKED_PAYOUT"
  | "BLOCKED_KYC_OR_REGION"
  | "STALE"
  | "DUPLICATE_OR_TEST";

export type InternalRevenueGateDecision = PersistedRevenueGateDecision | "BLOCKED_ELIGIBILITY_OR_NET";

/** Map internal qualification failures to the existing database CHECK constraint vocabulary. */
export function toPersistedRevenueGateDecision(
  decision: InternalRevenueGateDecision,
): PersistedRevenueGateDecision {
  return decision === "BLOCKED_ELIGIBILITY_OR_NET" ? "BLOCKED_KYC_OR_REGION" : decision;
}
