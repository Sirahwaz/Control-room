type JsonRecord = Record<string, unknown>;

type QualificationEvidence = {
  regionEligible?: boolean;
  region?: string;
  kyc?: string;
  identityEligible?: boolean;
  identity?: string;
  individualRewardUsd?: number;
  providerNetRewardUsd?: number;
  payoutSplitCount?: number;
  rewardIsSharedPool?: boolean;
  platformFee?: number;
  networkFee?: number;
  claimFee?: number;
  submissionFee?: number;
  feeScheduleVerified?: boolean;
  feeScheduleEvidenceUrl?: string;
  escrowFunded?: boolean;
  providerReportsPaid?: boolean;
  agentSubmissionEligible?: boolean;
  humanClaimRequired?: boolean;
};

const GROUPS = ["eligibility", "requirements", "payout", "reward", "fees", "terms"] as const;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function findField(record: JsonRecord, aliases: string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias) && record[alias] !== null && record[alias] !== undefined) {
      return record[alias];
    }
  }
  for (const key of GROUPS) {
    const group = asRecord(record[key]);
    if (!group) continue;
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(group, alias) && group[alias] !== null && group[alias] !== undefined) {
        return group[alias];
      }
    }
  }
  return undefined;
}

function explicitBoolean(record: JsonRecord, aliases: string[]): boolean | undefined {
  const value = findField(record, aliases);
  return typeof value === "boolean" ? value : undefined;
}

function explicitNumber(record: JsonRecord, aliases: string[]): number | undefined {
  const value = findField(record, aliases);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function normalizedKycStatus(record: JsonRecord): string | undefined {
  const value = findField(record, ["kycStatus", "kyc_status"]);
  if (typeof value !== "string") return undefined;
  const status = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  if (["not_required", "not_applicable", "none"].includes(status)) return "not_required";
  if (["eligible", "verified", "verified_eligible", "approved", "passed"].includes(status)) return "eligible";
  if (status === "required") return "required";
  if (["pending", "unknown", "rejected", "failed", "ineligible", "unverified"].includes(status)) return status;
  return undefined;
}

function officialHostsForSource(sourceSlug: string): string[] {
  const slug = sourceSlug.toLowerCase();
  if (slug.includes("taskmarket")) return ["taskmarket.dev"];
  if (slug.includes("basedagents")) return ["basedagents.ai"];
  if (slug.includes("bountybook")) return ["bountybook.ai"];
  if (slug.includes("superteam")) return ["superteam.fun"];
  if (slug.includes("immunefi")) return ["immunefi.com"];
  if (slug.includes("basebounty")) return ["basebounty.app"];
  if (slug.includes("nadbounty")) return ["nadbounty.app"];
  if (slug.includes("arcbounty")) return ["arcbounty.app"];
  return [];
}

function isOfficialProviderUrl(value: unknown, sourceSlug: string): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return officialHostsForSource(sourceSlug).some((domain) => host === domain || host.endsWith("." + domain));
  } catch {
    return false;
  }
}

/**
 * Extract only explicitly named, typed evidence from a provider response.
 * Region/country labels, free-text descriptions and booleans with ambiguous
 * meanings are not interpreted as proof of eligibility. Fee schedules require
 * both an explicit provider assertion and an HTTPS URL on that provider's domain.
 */
export function extractQualificationEvidence(raw: unknown, sourceSlug: string): QualificationEvidence {
  const record = asRecord(raw);
  if (!record) return {};
  const out: QualificationEvidence = {};

  const regionEligible = explicitBoolean(record, ["regionEligible", "region_eligible"]);
  if (regionEligible !== undefined) {
    out.regionEligible = regionEligible;
    out.region = regionEligible ? "eligible" : "ineligible";
  }

  const identityEligible = explicitBoolean(record, ["identityEligible", "identity_eligible"]);
  if (identityEligible !== undefined) {
    out.identityEligible = identityEligible;
    out.identity = identityEligible ? "eligible" : "ineligible";
  }

  const kyc = normalizedKycStatus(record);
  if (kyc !== undefined) out.kyc = kyc;

  const individualRewardUsd = explicitNumber(record, ["individualRewardUsd", "individual_reward_usd", "perRecipientRewardUsd", "per_recipient_reward_usd"]);
  if (individualRewardUsd !== undefined) out.individualRewardUsd = individualRewardUsd;

  let payoutSplitCount = explicitNumber(record, ["payoutSplitCount", "payout_split_count", "splitCount", "split_count", "awardCount", "award_count"]);
  if (payoutSplitCount === undefined && Array.isArray(record.awards)) payoutSplitCount = record.awards.length;
  if (payoutSplitCount !== undefined && payoutSplitCount > 0) out.payoutSplitCount = payoutSplitCount;

  const sharedPool = explicitBoolean(record, ["rewardIsSharedPool", "reward_is_shared_pool"]);
  if (sharedPool !== undefined) out.rewardIsSharedPool = sharedPool;

  const platformFee = explicitNumber(record, ["platformFeeUsd", "platform_fee_usd"]);
  if (platformFee !== undefined) out.platformFee = platformFee;

  const networkFee = explicitNumber(record, ["networkFeeUsd", "network_fee_usd"]);
  if (networkFee !== undefined) out.networkFee = networkFee;

  const claimFee = explicitNumber(record, ["claimFeeUsd", "claim_fee_usd"]);
  if (claimFee !== undefined) out.claimFee = claimFee;

  const submissionFee = explicitNumber(record, ["submissionFeeUsd", "submission_fee_usd"]);
  if (submissionFee !== undefined) out.submissionFee = submissionFee;

  const feeScheduleVerified = explicitBoolean(record, ["feeScheduleVerified", "fee_schedule_verified"]);
  const feeScheduleUrl = findField(record, ["feeScheduleEvidenceUrl", "fee_schedule_evidence_url"]);
  if (feeScheduleVerified === true && isOfficialProviderUrl(feeScheduleUrl, sourceSlug)) {
    out.feeScheduleVerified = true;
    out.feeScheduleEvidenceUrl = String(feeScheduleUrl).trim();
  }

  return out;
}

const TASKMARKET_FEE_SCHEDULE_URL = "https://docs.taskmarket.dev/concepts/fees-payments";

/**
 * Taskmarket's official fee schedule was checked on 2026-10-23.
 * Bounty/benchmark submissions are free for a worker's first five submissions
 * to a task, then 0.001 USDC each. The public task's submissionCount is a
 * task-wide total, not the current worker's count; do not use it as a proxy.
 * Unknown modes or missing worker-specific counts remain unverified.
 */
export function taskmarketOfficialFeeEvidence(raw: unknown): QualificationEvidence {
  const record = asRecord(raw);
  if (!record) return {};
  const mode = typeof record.mode === "string" ? record.mode.trim().toLowerCase() : "";
  let submissionFeeUsd: number | undefined;
  if (["bounty", "benchmark"].includes(mode)) {
    const count = explicitNumber(record, ["workerSubmissionCount", "worker_submission_count", "mySubmissionCount", "my_submission_count"]);
    if (count === undefined) return extractQualificationEvidence(record, "taskmarket_api");
    submissionFeeUsd = count < 5 ? 0 : 0.001;
  } else if (mode === "claim") submissionFeeUsd = 0;
  else if (["pitch", "auction"].includes(mode)) submissionFeeUsd = 0.001;
  if (submissionFeeUsd === undefined) return extractQualificationEvidence(record, "taskmarket_api");
  return extractQualificationEvidence({
    ...record,
    submissionFeeUsd,
    feeScheduleVerified: true,
    feeScheduleEvidenceUrl: TASKMARKET_FEE_SCHEDULE_URL,
  }, "taskmarket_api");
}


/** BasedAgents task-level funding evidence only; never infer user eligibility from task metadata. */
export function basedAgentsQualificationEvidence(raw: unknown): QualificationEvidence {
  const record = asRecord(raw);
  if (!record) return {};
  const escrow = asRecord(record.escrow);
  if (!escrow) return {};
  if (escrow.funded === true || String(escrow.status ?? "").toLowerCase() === "funded") {
    return { escrowFunded: true };
  }
  if (escrow.funded === false || ["unfunded", "failed", "refunded"].includes(String(escrow.status ?? "").toLowerCase())) {
    return { escrowFunded: false };
  }
  return {};
}

/** Map only explicit BountyBook amounts/statuses; do not infer a flat percentage fee. */
export function bountyBookQualificationEvidence(raw: unknown): QualificationEvidence {
  const record = asRecord(raw);
  if (!record) return {};
  const out: QualificationEvidence = {};
  const platformFee = explicitNumber(record, ["platform_fee_usdc", "platformFeeUsd", "platform_fee_usd"]);
  if (platformFee !== undefined) out.platformFee = platformFee;
  const individualReward = explicitNumber(record, ["individualRewardUsd", "individual_reward_usd", "perRecipientRewardUsd", "per_recipient_reward_usd"]);
  if (individualReward !== undefined) out.individualRewardUsd = individualReward;
  const providerNetReward = explicitNumber(record, ["agent_receives_usdc", "netRewardUsd", "net_reward_usd"]);
  if (providerNetReward !== undefined) out.providerNetRewardUsd = providerNetReward;
  const payoutStatus = String(record.payout_status ?? "").trim().toLowerCase();
  const payoutTx = record.payout_tx_hash;
  if (payoutStatus === "paid" && typeof payoutTx === "string" && /^0x[a-f0-9]{64}$/i.test(payoutTx)) {
    out.providerReportsPaid = true;
  } else if (["none", "pending", "refunded", "unpaid"].includes(payoutStatus)) {
    out.providerReportsPaid = false;
  }
  return out;
}

/** Superteam's listing-level agentAccess is not KYC, identity verification or regional eligibility. */
export function superteamQualificationEvidence(raw: unknown): QualificationEvidence {
  const record = asRecord(raw);
  if (!record || typeof record.agentAccess !== "string") return {};
  const access = record.agentAccess.trim().toUpperCase();
  if (["AGENT_ALLOWED", "AGENT_ONLY"].includes(access)) {
    return { agentSubmissionEligible: true, humanClaimRequired: true };
  }
  if (["HUMAN_ONLY", "HUMAN_ALLOWED"].includes(access)) {
    return { agentSubmissionEligible: false, humanClaimRequired: false };
  }
  return {};
}
