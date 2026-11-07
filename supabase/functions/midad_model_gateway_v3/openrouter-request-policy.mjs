const SAFE_PROVIDER_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_PRICE_PROOF_AGE_MS = 24 * 60 * 60 * 1000;
function normalizeProviderAllowlist(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string").map((item) => item.trim().toLowerCase()).filter((item) => SAFE_PROVIDER_SLUG.test(item)))].slice(0, 20);
}
function hasFreshZeroPriceProof(metadata, now) {
  if (String(metadata?.price_input_per_token ?? "") !== "0") return false;
  if (String(metadata?.price_output_per_token ?? "") !== "0") return false;
  const verifiedAt = Date.parse(String(metadata?.free_price_verified_at ?? ""));
  if (!Number.isFinite(verifiedAt)) return false;
  const age = now - verifiedAt;
  return age >= 0 && age <= MAX_PRICE_PROOF_AGE_MS;
}
export function buildOpenRouterRequestPolicy({routeMetadata = {},budgetClass = "free",configuredModel = "",requestedModel = undefined,dataClass = undefined,now = Date.now()} = {}) {
  const model = String(configuredModel || "").trim();
  const requestModel = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (String(budgetClass || "").trim().toLowerCase() !== "free") return {ok:false,error:"openrouter_paid_budget_disabled"};
  if (requestModel && requestModel !== model) return {ok:false,error:"openrouter_model_override_not_allowed"};
  const verifiedFreePricing = model.endsWith(":free") || hasFreshZeroPriceProof(routeMetadata, now);
  if (!verifiedFreePricing) return {ok:false,error:"openrouter_free_price_proof_missing_or_stale"};
  const configuredProfile = String(routeMetadata?.privacy_profile || "").trim().toLowerCase();
  const privacyProfile = configuredProfile === "public_sanitized"
    ? "public_sanitized"
    : configuredProfile === "sanitized_safety_retention"
      ? "sanitized_safety_retention"
      : "sensitive";
  const only = normalizeProviderAllowlist(routeMetadata?.provider_only);
  if (privacyProfile === "sanitized_safety_retention") {
    const normalizedDataClass = String(dataClass || "").trim().toLowerCase();
    if (normalizedDataClass !== "public" && normalizedDataClass !== "sanitized") {
      return {ok:false,error:"openrouter_safety_retention_requires_public_or_sanitized_data"};
    }
    const provider = {allow_fallbacks:false,data_collection:"deny",zdr:false};
    if (only.length) provider.only = only;
    return {ok:true,model,privacyProfile,verifiedFreePricing,provider};
  }
  if (privacyProfile === "public_sanitized" && only.length === 0) return {ok:false,error:"openrouter_public_provider_allowlist_required"};
  const provider = privacyProfile === "public_sanitized"
    ? {allow_fallbacks:true,data_collection:"allow",sort:"price",only}
    : {allow_fallbacks:false,data_collection:"deny",zdr:true};
  if (only.length && privacyProfile !== "public_sanitized") provider.only = only;
  return {ok:true,model,privacyProfile,verifiedFreePricing,provider};
}
