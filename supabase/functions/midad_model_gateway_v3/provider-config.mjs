const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const MIDAD_REFERER = "https://sirahwaz.github.io/Control-room/";
const MIDAD_TITLE = "MIDAD AI";
function stripTrailingSlashes(value) {
  let result = String(value || "");
  while (result.endsWith("/")) result = result.slice(0, -1);
  return result;
}
export function resolveModelProvider(providerSlug, env = {}) {
  const provider = String(providerSlug || "").trim().toLowerCase();
  if (provider === "apmix") {
    const baseUrl = stripTrailingSlashes(env.MIDAD_APMIX_BASE_URL || "https://api.apmix.ai/v1");
    const apiKey = String(env.MIDAD_APMIX_API_KEY || "");
    return { provider, baseUrl, apiKey, configured: Boolean(apiKey) };
  }
  if (provider === "openai") {
    const baseUrl = stripTrailingSlashes(env.MIDAD_OPENAI_BASE_URL || "https://api.openai.com/v1");
    const apiKey = String(env.OPENAI_API_KEY || env.MIDAD_OPENAI_API_KEY || "");
    return { provider, baseUrl, apiKey, configured: Boolean(apiKey) };
  }
  if (provider === "openrouter") {
    const baseUrl = stripTrailingSlashes(env.MIDAD_OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL);
    const apiKey = String(env.MIDAD_OPENROUTER_API_KEY || "");
    return { provider, baseUrl, apiKey, configured: Boolean(apiKey) };
  }
  if (provider === "gemini") {
    const baseUrl = stripTrailingSlashes(env.MIDAD_GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL);
    const apiKey = String(env.MIDAD_GEMINI_API_KEY || "");
    return { provider, baseUrl, apiKey, configured: Boolean(apiKey) };
  }
  throw new Error("unsupported_model_provider");
}
export function buildProviderHeaders(providerConfig, { contentType = false } = {}) {
  const headers = { authorization: `Bearer ${String(providerConfig?.apiKey || "")}`, accept: "application/json" };
  if (contentType) headers["content-type"] = "application/json";
  if (providerConfig?.provider === "openrouter") {
    headers["HTTP-Referer"] = MIDAD_REFERER;
    headers["X-Title"] = MIDAD_TITLE;
  }
  if (providerConfig?.provider === "gemini") {
    headers["x-goog-api-client"] = "midad-ai-model-gateway/3.0";
  }
  return headers;
}
