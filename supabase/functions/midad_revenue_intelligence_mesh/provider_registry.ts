/**
 * Provider registry primitives for the MIDAD revenue-intelligence mesh.
 *
 * Existing hand-written adapters remain available. New public JSON providers
 * can be added through midad_income_sources metadata with parser
 * "mapped_json", an HTTPS official_domain, and a reviewed field map.
 *
 * This module only normalizes public listings. It never certifies a reward,
 * task escrow, commission, region/KYC status, or payout receipt.
 */
export type RevenueParserKey =
  | "taskmarket"
  | "basedagents"
  | "bountybook"
  | "chain_bounties"
  | "immunefi_public_json"
  | "official_airdrop_json"
  | "superteam"
  | "mapped_json";

export type ProviderSourceConfig = {
  slug?: unknown;
  url?: unknown;
  api_url?: unknown;
  official_domain?: unknown;
  parser_key?: unknown;
  max_items?: unknown;
  field_map?: unknown;
  revenue_lane?: unknown;
  official_program_url?: unknown;
  official_terms_url?: unknown;
  official_terms_verified?: unknown;
  crypto_payout_confirmed?: unknown;
  payout_asset?: unknown;
  payout_network?: unknown;
  commission_model?: unknown;
  commission_rate_percent?: unknown;
  payout_schedule?: unknown;
  upfront_cost_verified?: unknown;
  claim_bond_verified?: unknown;
};

const REGISTERED_PARSERS = new Set<RevenueParserKey>([
  "taskmarket",
  "basedagents",
  "bountybook",
  "chain_bounties",
  "immunefi_public_json",
  "official_airdrop_json",
  "superteam",
  "mapped_json",
]);

const FIELD_ALIASES: Record<string, string[]> = {
  items: ["items"],
  id: ["id", "external_id"],
  title: ["title"],
  description: ["description"],
  url: ["url", "listing_url"],
  status: ["status"],
  amount: ["amount", "reward_amount", "individual_reward_amount"],
  asset: ["asset", "payout_asset", "reward_asset"],
  network: ["network", "payout_network", "reward_network"],
  deadline: ["deadline", "expires_at"],
  upfront_cost_usd: ["upfront_cost_usd", "upfront_cost"],
  claim_bond_usd: ["claim_bond_usd", "claim_bond"],
  fee_usd: ["fee_usd", "estimated_fee_usd"],
  effort_hours: ["effort_hours", "estimated_effort_hours"],
  tags: ["tags", "skills", "capabilities"],
};

const CRYPTO_ASSETS = new Set([
  "BTC", "USDC", "USDT", "ETH", "SOL", "DAI", "EURC",
  "LTC", "XLM", "XRP", "AVAX", "POL", "POLYX", "XMR",
]);

const TERMINAL_STATES = new Set([
  "closed", "expired", "cancelled", "canceled", "completed", "paid",
  "disabled", "archived", "removed", "rejected", "withdrawn",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 180) return null;
  const parts = value.split(".");
  if (parts.some((part) =>
    !/^[A-Za-z0-9_-]+$/.test(part) ||
    ["__proto__", "prototype", "constructor"].includes(part.toLowerCase())
  )) return null;
  return value;
}

function hostIsUnsafe(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") ||
      host.endsWith(".test") || host.endsWith(".invalid") ||
      host.endsWith(".example") || !host.includes(".")) return true;
  if (host.startsWith("[") || host.includes(":")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..") ||
      host.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return true;
  return false;
}

function parseHttps(value: unknown): URL | null {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:" || url.username || url.password || hostIsUnsafe(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function resolveRevenueParser(value: unknown): RevenueParserKey | null {
  const parser = String(value ?? "").trim().toLowerCase() as RevenueParserKey;
  return REGISTERED_PARSERS.has(parser) ? parser : null;
}

/**
 * Affiliate discovery has different proof semantics from a task-escrow bounty.
 * Official terms can qualify a program for discovery/pre-application review,
 * but never prove account acceptance, payable commissions, or realized revenue.
 */
export function evaluateAffiliateDiscovery(candidateValue: unknown): {
  decision: string;
  status: string;
  payoutState: string;
  next: string;
  reasons: string[];
} {
  const candidate = asRecord(candidateValue) || {};
  const evidenceMeta = asRecord(candidate.evidenceMeta) || {};
  const affiliate = asRecord(evidenceMeta.affiliate) || {};
  const asset = String(affiliate.payout_asset || candidate.asset || "").trim().toUpperCase();
  const network = String(affiliate.payout_network || candidate.network || "").trim().toLowerCase();
  const cost = numberValue(candidate.cost) ?? 0;
  const bond = numberValue(candidate.bond) ?? 0;
  const hasCommission = Boolean(String(affiliate.commission_model || "").trim()) ||
    (Number.isFinite(Number(affiliate.commission_rate_percent)) && Number(affiliate.commission_rate_percent) > 0);

  if (cost > 0 || bond > 0) {
    return {
      decision: "BLOCKED_UPFRONT_COST",
      status: "BLOCKED",
      payoutState: "blocked",
      next: "no_spend_policy_block",
      reasons: [cost > 0 ? "upfront_cost_required" : "claim_bond_required"],
    };
  }
  const officialDomain = evidenceMeta.official_domain;
  const officialUrlsVerified =
    isSafeOfficialProviderUrl(affiliate.official_program_url, officialDomain) &&
    isSafeOfficialProviderUrl(affiliate.official_terms_url, officialDomain);
  if (affiliate.official_terms_verified !== true || !officialUrlsVerified) {
    return { decision: "BLOCKED_PAYOUT", status: "BLOCKED", payoutState: "blocked", next: "verify_affiliate_official_terms", reasons: ["affiliate_official_terms_not_verified"] };
  }
  if (affiliate.crypto_payout_confirmed !== true || !CRYPTO_ASSETS.has(asset) || !network || network === "unknown") {
    return { decision: "BLOCKED_PAYOUT", status: "BLOCKED", payoutState: "blocked", next: "verify_affiliate_crypto_payout", reasons: ["affiliate_crypto_payout_not_verified"] };
  }
  if (affiliate.upfront_cost_verified !== true || affiliate.claim_bond_verified !== true) {
    return { decision: "BLOCKED_PAYOUT", status: "BLOCKED", payoutState: "blocked", next: "verify_affiliate_zero_cost_terms", reasons: ["affiliate_upfront_cost_or_bond_not_verified"] };
  }
  if (!hasCommission || !String(affiliate.payout_schedule || "").trim()) {
    return { decision: "BLOCKED_PAYOUT", status: "BLOCKED", payoutState: "blocked", next: "verify_affiliate_commission_terms", reasons: ["affiliate_commission_or_payout_schedule_not_verified"] };
  }
  return {
    decision: "DISCOVERY_ONLY",
    status: "DISCOVERED",
    payoutState: "official_program_terms",
    next: "affiliate_preapplication_review",
    reasons: ["official_affiliate_terms_verified_for_preapplication_only", "acceptance_tracking_payable_commission_and_receipt_not_proven"],
  };
}

export function isSafeOfficialProviderUrl(value: unknown, officialDomainValue: unknown): boolean {
  const url = parseHttps(value);
  const officialDomain = String(officialDomainValue ?? "").trim().toLowerCase().replace(/\\.$/, "");
  if (!url || !officialDomain || officialDomain.includes("/") ||
      officialDomain.includes(":") || officialDomain.includes("@") ||
      hostIsUnsafe(officialDomain)) return false;
  const host = url.hostname.toLowerCase().replace(/\\.$/, "");
  return host === officialDomain || host.endsWith("." + officialDomain);
}

/**
 * Validate a mapped JSON adapter's source boundary before network access.
 * The configured official domain is the trust anchor; a fixed provider name
 * allowlist is deliberately not required.
 */
export function isSafeMappedJsonSource(sourceValue: unknown): boolean {
  const source = asRecord(sourceValue);
  if (!source || resolveRevenueParser(source.parser_key) !== "mapped_json") return false;

  const feedUrl = parseHttps(source.api_url ?? source.url);
  const officialDomain = String(source.official_domain ?? "").trim().toLowerCase()
    .replace(/\.$/, "");
  if (!feedUrl || !officialDomain || officialDomain.includes("/") ||
      officialDomain.includes(":") || officialDomain.includes("@") ||
      hostIsUnsafe(officialDomain)) return false;

  const host = feedUrl.hostname.toLowerCase().replace(/\.$/, "");
  if (host !== officialDomain && !host.endsWith("." + officialDomain)) return false;

  const fieldMap = asRecord(source.field_map);
  if (!fieldMap) return false;
  for (const [key, path] of Object.entries(fieldMap)) {
    if (!Object.prototype.hasOwnProperty.call(FIELD_ALIASES, key)) continue;
    if (safePath(path) === null) return false;
  }
  return safePath(fieldMap.items) !== null &&
    safePath(fieldMap.id) !== null &&
    safePath(fieldMap.title) !== null;
}

function getPath(value: unknown, pathValue: unknown): unknown {
  const path = safePath(pathValue);
  if (path === null) return undefined;
  let current: unknown = value;
  for (const segment of path.split(".")) {
    const record = asRecord(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, segment)) return undefined;
    current = record[segment];
  }
  return current;
}

function mappedValue(record: unknown, fieldMap: Record<string, unknown>, key: string): unknown {
  for (const alias of FIELD_ALIASES[key] || [key]) {
    const path = fieldMap[alias];
    if (path !== undefined) return getPath(record, path);
  }
  return undefined;
}

function textValue(value: unknown, limit: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, limit);
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const normalized = String(value).replace(/[,$\s]/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function dateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value as string | number);
  return Number.isFinite(date.getTime()) ? date : null;
}

function candidateHttps(value: unknown): string | null {
  const url = parseHttps(value);
  return url ? url.toString() : null;
}

/**
 * A small concurrency-limited mapper used by discovery. It preserves result
 * order and propagates worker failures so callers must handle each source's
 * failure independently.
 */
export async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  if (typeof worker !== "function") throw new TypeError("worker must be a function");

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function drain(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => drain()));
  return results;
}

/**
 * Normalize a source configured through registry metadata. Provider-supplied
 * payout flags and eligibility assertions are retained only inside raw data;
 * they are never promoted to independent proof or eligibility decisions.
 */
export function normalizeMappedJsonFeed(
  body: unknown,
  sourceValue: ProviderSourceConfig,
  now: Date | number = new Date(),
): any[] {
  const source = asRecord(sourceValue);
  if (!source || !isSafeMappedJsonSource(source)) return [];
  const fieldMap = asRecord(source.field_map);
  if (!fieldMap) return [];
  const feedItems = getPath(body, fieldMap.items);
  if (!Array.isArray(feedItems)) return [];

  const itemLimitRaw = Number(source.max_items ?? 50);
  const itemLimit = Number.isFinite(itemLimitRaw)
    ? Math.max(1, Math.min(50, Math.trunc(itemLimitRaw)))
    : 50;
  const observedAt = now instanceof Date
    ? now.toISOString()
    : new Date(now).toISOString();
  const apiUrl = candidateHttps(source.api_url ?? source.url);
  if (!apiUrl) return [];

  const results: any[] = [];
  for (const item of feedItems.slice(0, itemLimit)) {
    const id = textValue(mappedValue(item, fieldMap, "id"), 256);
    const title = textValue(mappedValue(item, fieldMap, "title"), 500);
    if (!id || !title) continue;

    const mappedUrl = mappedValue(item, fieldMap, "url");
    const rawListingUrl = mappedUrl === undefined || mappedUrl === null || mappedUrl === ""
      ? candidateHttps(source.official_program_url) || apiUrl
      : candidateHttps(mappedUrl);
    const listingUrl = isSafeOfficialProviderUrl(rawListingUrl, source.official_domain)
      ? candidateHttps(rawListingUrl)
      : null;
    if (!listingUrl) continue;

    const status = textValue(mappedValue(item, fieldMap, "status"), 100) || "unknown";
    if (TERMINAL_STATES.has(status.toLowerCase())) continue;

    const revenueLane = String(source.revenue_lane ?? "").trim().toLowerCase() === "affiliate"
      ? "affiliate"
      : "crypto_task";
    const reportedAsset = textValue(mappedValue(item, fieldMap, "asset"), 24).toUpperCase();
    const registryAsset = revenueLane === "affiliate"
      ? textValue(source.payout_asset, 24).toUpperCase()
      : "";
    const payoutAssetValue = registryAsset || reportedAsset;
    const asset = CRYPTO_ASSETS.has(payoutAssetValue) ? payoutAssetValue : null;
    const registryNetwork = revenueLane === "affiliate"
      ? textValue(source.payout_network, 48)
      : "";
    const network = registryNetwork || textValue(mappedValue(item, fieldMap, "network"), 48) || "unknown";
    const amount = numberValue(mappedValue(item, fieldMap, "amount"));
    const cost = numberValue(mappedValue(item, fieldMap, "upfront_cost_usd"));
    const bond = numberValue(mappedValue(item, fieldMap, "claim_bond_usd"));
    const fee = numberValue(mappedValue(item, fieldMap, "fee_usd"));
    const effortHours = numberValue(mappedValue(item, fieldMap, "effort_hours"));
    const mappedDeadline = dateValue(mappedValue(item, fieldMap, "deadline"));
    const deadline = mappedDeadline && mappedDeadline.getTime() > 0 ? mappedDeadline : null;
    const rawTags = mappedValue(item, fieldMap, "tags");
    const tags = Array.isArray(rawTags)
      ? rawTags.map((tag) => textValue(tag, 100)).filter(Boolean).slice(0, 40)
      : typeof rawTags === "string"
        ? rawTags.split(/[,;|]/).map((tag) => tag.trim().slice(0, 100)).filter(Boolean).slice(0, 40)
        : [];

    const description = textValue(mappedValue(item, fieldMap, "description"), 6000);
    const test = /\b(?:do not claim|selfaudit|compatibility probe|test task|synthetic test)\b/i
      .test(title + " " + description);
    const officialProgramUrl = candidateHttps(source.official_program_url);
    const officialTermsUrl = candidateHttps(source.official_terms_url);
    const officialTermsVerified = String(source.official_terms_verified).toLowerCase() === "true" &&
      isSafeOfficialProviderUrl(officialProgramUrl, source.official_domain) &&
      isSafeOfficialProviderUrl(officialTermsUrl, source.official_domain);
    const affiliateEvidence = revenueLane === "affiliate" ? {
      official_program_url: officialProgramUrl,
      official_terms_url: officialTermsUrl,
      official_terms_verified: officialTermsVerified,
      crypto_payout_confirmed: String(source.crypto_payout_confirmed).toLowerCase() === "true",
      payout_asset: textValue(source.payout_asset, 24).toUpperCase() || asset,
      payout_network: textValue(source.payout_network, 48) || network,
      commission_model: textValue(source.commission_model, 180),
      commission_rate_percent: numberValue(source.commission_rate_percent),
      payout_schedule: textValue(source.payout_schedule, 100),
      upfront_cost_verified: String(source.upfront_cost_verified).toLowerCase() === "true",
      claim_bond_verified: String(source.claim_bond_verified).toLowerCase() === "true",
      verified_at: textValue(asRecord(sourceValue)?.verified_at, 80),
    } : undefined;

    results.push({
      sourceSlug: textValue(source.slug, 100),
      sourceUrl: apiUrl,
      externalId: id,
      title,
      description,
      url: listingUrl,
      externalStatus: status,
      amount: amount !== null && amount > 0 ? amount : null,
      asset,
      network,
      payoutClass: revenueLane === "affiliate"
        ? "C2_PROGRAM_CONDITIONAL_CRYPTO"
        : "C2_PROGRAM_CONDITIONAL_CRYPTO",
      payoutProofStatus: "unverified",
      payoutConfidence: 0,
      paymentProof: false,
      escrowFunded: null,
      tx: null,
      payoutProofUrl: null,
      cost: cost ?? 0,
      bond: bond ?? 0,
      fee: fee ?? 0,
      effortHours: effortHours !== null && effortHours > 0 ? effortHours : null,
      deadline,
      region: "unknown",
      regionEligible: null,
      kyc: "unknown",
      identity: "unknown",
      identityEligible: null,
      caps: tags,
      tags,
      competition: 0,
      test,
      notes: [
        "Generic mapped JSON feed is discovery evidence only; payout and eligibility are not independently verified.",
        "No provider-supplied paymentProof/payoutVerified field is promoted to verified escrow or payment.",
        "Upfront-cost, claim-bond, KYC and region requirements must be independently confirmed before review; no external action is permitted.",
      ],
      revenueLane,
      evidenceMeta: {
        revenue_lane: revenueLane,
        official_domain: String(source.official_domain || ""),
        official_program_url: candidateHttps(source.official_program_url),
        official_terms_url: candidateHttps(source.official_terms_url),
        affiliate: affiliateEvidence,
        observed_at: observedAt,
        cost_evidence_present: cost !== null,
        claim_bond_evidence_present: bond !== null,
      },
      raw: item,
      httpStatus: 200,
      contentHash: null,
    });
  }
  return results;
}
