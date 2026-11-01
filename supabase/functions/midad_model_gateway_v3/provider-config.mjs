/**
 * Resolve an OpenAI-compatible model provider from server-side configuration.
 * Secrets are intentionally returned only to the server-side caller.
 */
export function resolveModelProvider(providerSlug, env = {}) {
  const provider = String(providerSlug || "").trim().toLowerCase();
  if (provider === "apmix") {
    const baseUrl = String(env.MIDAD_APMIX_BASE_URL || "https://api.apmix.ai/v1").replace(/\/$/, "");
    const apiKey = String(env.MIDAD_APMIX_API_KEY || "");
    return { provider, baseUrl, apiKey, configured: Boolean(apiKey) };
  }
  if (provider === "openai") {
    const baseUrl = String(env.MIDAD_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const apiKey = String(env.OPENAI_API_KEY || env.MIDAD_OPENAI_API_KEY || "");
    return { provider, baseUrl, apiKey, configured: Boolean(apiKey) };
  }
  throw new Error("unsupported_model_provider");
}
