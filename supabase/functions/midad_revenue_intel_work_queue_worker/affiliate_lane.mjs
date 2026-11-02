const CRYPTO_ASSETS = new Set([
  "BTC", "USDC", "USDT", "ETH", "SOL", "DAI", "EURC",
  "LTC", "XMR", "XLM", "XRP", "POL", "POLYX", "AVAX",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseOfficialHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || !host.includes(".") || host.includes("..") || host.includes(":")) return null;
    if (host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") ||
        host.endsWith(".test") || host.endsWith(".invalid") ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
    return { url, host };
  } catch {
    return null;
  }
}

/**
 * Affiliate terms must remain on the official program host or one of its
 * subdomains. A parent-domain comparison is deliberately rejected.
 * This helper validates evidence only; it does not fetch the supplied URL.
 */
export function isSafeOfficialHttpsUrl(candidateUrl, officialProgramUrl) {
  const candidate = parseOfficialHttpsUrl(candidateUrl);
  const official = parseOfficialHttpsUrl(officialProgramUrl);
  if (!candidate || !official) return false;
  return candidate.host === official.host || candidate.host.endsWith("." + official.host);
}

export function isAffiliateProgramTask(task = {}) {
  const evidence = object(task.evidence);
  const affiliateEvidence = object(evidence.affiliate_program || evidence.affiliate);
  const lane = String(task.revenue_lane ?? task.lane ?? evidence.revenue_lane ?? evidence.lane ?? affiliateEvidence.revenue_lane ?? "")
    .trim().toLowerCase().replace(/[ -]+/g, "_");
  const taskType = String(task.task_type || "").trim().toLowerCase();
  const source = String(task.source_slug || "").trim().toLowerCase();
  return ["affiliate", "affiliate_program", "affiliate_commission"].includes(lane) ||
    taskType.includes("affiliate") || source.includes("affiliate");
}

/**
 * This is an evidence gate for operator review only. It never proves account
 * acceptance, a payable commission, a tracking link, or received revenue.
 */
export function evaluateAffiliateProgramEvidence(task = {}, now = Date.now()) {
  const base = object(task.evidence);
  const evidence = {
    ...base,
    ...object(base.affiliate_program),
    ...object(base.affiliate),
  };
  const blockers = [];
  const officialProgramUrl = String(evidence.official_program_url || "");
  const officialTermsUrl = String(evidence.official_terms_url || evidence.official_payout_url || "");

  if (!isSafeOfficialHttpsUrl(officialProgramUrl, officialProgramUrl)) {
    blockers.push("affiliate_official_url_missing_or_insecure");
  }
  if (!isSafeOfficialHttpsUrl(officialTermsUrl, officialProgramUrl)) {
    blockers.push("affiliate_terms_domain_mismatch_or_insecure");
  }
  if (evidence.official_terms_verified !== true) blockers.push("affiliate_official_terms_not_verified");
  if (evidence.crypto_payout_confirmed !== true) blockers.push("affiliate_crypto_payout_not_confirmed");

  const asset = String(evidence.payout_asset || task.compensation_asset || "").trim().toUpperCase();
  const network = String(evidence.payout_network || task.payout_network || "").trim().toLowerCase().replace("eip155:8453", "base");
  if (!CRYPTO_ASSETS.has(asset) || !network || /^(unknown|tbd|n\/a)$/i.test(network)) {
    blockers.push("affiliate_crypto_asset_unverified");
  }

  const commissionModel = String(evidence.commission_model || "").trim();
  const rate = Number(evidence.commission_rate_percent);
  if (!commissionModel && !(Number.isFinite(rate) && rate > 0)) blockers.push("affiliate_commission_model_unverified");

  const payoutSchedule = String(evidence.payout_schedule || evidence.payout_frequency || evidence.payout_trigger || "").trim();
  if (!payoutSchedule) blockers.push("affiliate_payout_schedule_unverified");

  const verifiedAt = Date.parse(String(evidence.verified_at || evidence.last_verified_at || evidence.retrieved_at || ""));
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const freshnessMs = 30 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(nowMs) ||
      verifiedAt > nowMs + 5 * 60 * 1000 || nowMs - verifiedAt > freshnessMs) {
    blockers.push("affiliate_terms_stale_or_unverifiable");
  }

  if (evidence.upfront_cost_verified !== true) blockers.push("affiliate_upfront_cost_unverified");
  if (evidence.claim_bond_verified !== true) blockers.push("affiliate_claim_bond_unverified");

  for (const [field, code, disallowed] of [
    ["upfront_cost_usd", "affiliate_upfront_cost_unverified", "affiliate_upfront_cost_disallowed"],
    ["claim_bond_usd", "affiliate_claim_bond_unverified", "affiliate_claim_bond_disallowed"],
  ]) {
    const raw = task[field] ?? evidence[field];
    if (raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw))) {
      blockers.push(code);
    } else if (Number(raw) !== 0) {
      blockers.push(disallowed);
    }
  }

  const region = String(task.region_gate || evidence.region_gate || "").toLowerCase();
  if (/\b(denied|blocked|ineligible|prohibited|not eligible)\b/.test(region)) {
    blockers.push("affiliate_region_ineligible_or_blocked");
  }
  const kyc = String(task.kyc_gate || evidence.kyc_gate || "").toLowerCase();
  if (/\b(denied|blocked|ineligible|required_but_unavailable)\b/.test(kyc)) {
    blockers.push("affiliate_kyc_ineligible_or_unavailable");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const ready = uniqueBlockers.length === 0;
  return {
    lane: "affiliate",
    ready,
    decision: ready ? "AFFILIATE_PREAPPLICATION_READY" : "AFFILIATE_EVIDENCE_BLOCKED",
    status: ready ? "READY_FOR_OPERATOR_REVIEW" : "BLOCKED",
    blockers: uniqueBlockers,
    official_program_url: officialProgramUrl || null,
    official_terms_url: officialTermsUrl || null,
    payout_asset: asset || null,
    payout_network: network || null,
    commission_model: commissionModel || (Number.isFinite(rate) && rate > 0 ? rate + "%" : null),
    payout_schedule: payoutSchedule || null,
    human_gates_required: [
      "confirm_region_and_KYC_eligibility",
      "accept_legal_terms",
      "create_or_link_affiliate_account",
      "obtain_personal_tracking_link",
      "verify_first_payable_commission_and_onchain_receipt",
    ],
    revenue_realized: false,
    external_action_allowed: false,
    network_requests_performed: 0,
  };
}
