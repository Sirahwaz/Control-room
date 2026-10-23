type JsonRecord = Record<string, unknown>;

type QualificationEvidence = {
  regionEligible?: boolean;
  kyc?: string;
  identityEligible?: boolean;
  individualRewardUsd?: number;
  payoutSplitCount?: number;
  rewardIsSharedPool?: boolean;
  platformFee?: number;
  networkFee?: number;
  claimFee?: number;
  submissionFee?: number;
  feeScheduleVerified?: boolean;
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
  if (regionEligible !== undefined) out.regionEligible = regionEligible;

  const identityEligible = explicitBoolean(record, ["identityEligible", "identity_eligible"]);
  if (identityEligible !== undefined) out.identityEligible = identityEligible;

  const kyc = normalizedKycStatus(record);
  if (kyc !== undefined) out.kyc = kyc;

  const individualRewardUsd = explicitNumber(record, ["individualRewardUsd", "individual_reward_usd", "perRecipientRewardUsd", "per_recipient_reward_usd"]);
  if (individualRewardUsd !== undefined) out.individualRewardUsd = individualRewardUsd;

  const payoutSplitCount = explicitNumber(record, ["payoutSplitCount", "payout_split_count", "splitCount", "split_count"]);
  if (payoutSplitCount !== undefined) out.payoutSplitCount = payoutSplitCount;

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
  }

  return out;
}
