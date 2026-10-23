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

/**
 * BountyBook's official job pages state that the platform deducts a 4% fee
 * and that claiming/submitting are free. This page is retained as first-party
 * policy evidence; it is not a complete OpenAPI/schema document.
 */
export const BOUNTYBOOK_FEE_EVIDENCE_URL = "https://www.bountybook.ai/job/a55bd7d2-b6a0-4bfc-80b5-f788d0ff312d";
const BOUNTYBOOK_PLATFORM_FEE_RATE = 0.04;
const roundUsd = (amount: number) => Math.round(amount * 1_000_000) / 1_000_000;
const closeUsd = (left: number, right: number) => Math.abs(left - right) <= 0.000001;

/**
 * Use the published 4% fee policy only when the job's gross reward and any
 * provider-reported net amount are internally consistent. Fee fields are
 * estimates from a public job record; they do not prove escrow funding,
 * individual payout splitting, user eligibility or payment settlement.
 */
export function bountyBookQualificationEvidence(raw: unknown): QualificationEvidence {
  const record = asRecord(raw);
  if (!record) return {};

  const out: QualificationEvidence = {};
  const gross = explicitNumber(record, ["budget_usdc", "budgetUsdc", "gross_reward_usdc", "grossRewardUsd"]);
  const explicitPlatformFee = explicitNumber(record, ["platform_fee_usdc", "platformFeeUsd", "platform_fee_usd"]);
  const explicitNet = explicitNumber(record, ["agent_receives_usdc", "netRewardUsd", "net_reward_usd"]);
  const expectedFee = gross === undefined ? undefined : roundUsd(gross * BOUNTYBOOK_PLATFORM_FEE_RATE);
  const expectedNet = gross !== undefined && explicitPlatformFee !== undefined
    ? roundUsd(gross - explicitPlatformFee)
    : undefined;

  // Keep provider-reported values separate from arithmetic estimates. The
  // public page documents the 4% policy, but the API response schema was not
  // retrievable in this audit; a gross budget alone must not masquerade as an
  // observed platform_fee_usdc or agent_receives_usdc field.
  if (explicitPlatformFee !== undefined) out.platformFee = explicitPlatformFee;

  const individualReward = explicitNumber(record, ["individualRewardUsd", "individual_reward_usd", "perRecipientRewardUsd", "per_recipient_reward_usd"]);
  if (individualReward !== undefined) out.individualRewardUsd = individualReward;

  if (explicitNet !== undefined) out.providerNetRewardUsd = explicitNet;

  // Official BountyBook job pages state both actions are free. Keep these
  // separate from the platform fee deducted from the reward.
  out.claimFee = 0;
  out.submissionFee = 0;

  const platformFeeMatches = expectedFee !== undefined
    && explicitPlatformFee !== undefined
    && closeUsd(explicitPlatformFee, expectedFee);
  const netMatches = expectedNet !== undefined
    && explicitNet !== undefined
    && closeUsd(explicitNet, expectedNet);

  // Explicit false is deliberate: do not let the general evidence extractor
  // or a page-derived gross budget turn an unverified API mapping into a pass.
  // The schedule is only marked verified when gross, fee and net are all
  // present as provider fields and mutually consistent with the official 4%.
  out.feeScheduleVerified = gross !== undefined && platformFeeMatches && netMatches;
  if (out.feeScheduleVerified) out.feeScheduleEvidenceUrl = BOUNTYBOOK_FEE_EVIDENCE_URL;

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
