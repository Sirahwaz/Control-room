import { buildProviderHeaders } from "./provider-config.mjs";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function containsWhitespace(value) {
  const input = String(value || "");
  return input.split("").some((char) => char === " " || char === "\t" || char === "\n" || char === "\r");
}

function keyFormat(raw) {
  const value = String(raw || "").trim();
  if (value.toLowerCase().startsWith("bearer sk-or-v1-")) return "BEARER_WRAPPED_OPENROUTER";
  if (value.startsWith("sk-or-v1-")) return "OPENROUTER_V1_PREFIX";
  if (value.startsWith("sk-or-")) return "OPENROUTER_OTHER_PREFIX";
  if (value.startsWith("sb_secret_")) return "SUPABASE_SECRET_KEY";
  if (value.startsWith("sk-proj-")) return "OPENAI_PROJECT_KEY";
  if (value.startsWith("AIza")) return "GOOGLE_API_KEY";
  return value ? "OTHER_OR_UNRECOGNIZED" : "MISSING";
}

export async function runOpenRouterAuthCheck(providerConfig, fetchImpl = fetch) {
  if (providerConfig?.provider !== "openrouter") {
    return { statusCode: 400, body: { ok: false, state: "BLOCKED", error: "auth_check_requires_openrouter_provider" } };
  }
  const rawApiKey = String(providerConfig.apiKey || "");
  if (!providerConfig.configured || !rawApiKey.trim()) {
    return {
      statusCode: 503,
      body: { ok: false, state: "PENDING", provider: "openrouter", api_key_valid: false, error: "model_provider_secret_missing" }
    };
  }

  const started = Date.now();
  let headers;
  let authHeaderAttached = false;
  try {
    headers = buildProviderHeaders(providerConfig);
    const authorization = String(new Headers(headers).get("authorization") || "").trim();
    authHeaderAttached = authorization.toLowerCase().startsWith("bearer ") && authorization.slice(7).trim().length > 0;
  } catch {
    return {
      statusCode: 502,
      body: {
        ok: false, state: "FAILED", provider: "openrouter", api_key_valid: false,
        auth_header_attached: false, api_key_format: keyFormat(rawApiKey),
        api_key_has_whitespace: containsWhitespace(rawApiKey),
        error: "openrouter_auth_header_invalid", latency_ms: Date.now() - started
      }
    };
  }

  try {
    const response = await fetchImpl(`${providerConfig.baseUrl}/key`, {
      method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(15000)
    });
    const payload = await response.json().catch(() => ({}));
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    const valid = Boolean(response.ok && typeof data.label === "string" && data.label.length > 0);
    const daily = data.free_model_daily_requests && typeof data.free_model_daily_requests === "object" ? data.free_model_daily_requests : {};
    const rate = data.rate_limit && typeof data.rate_limit === "object" ? data.rate_limit : {};
    return {
      statusCode: valid ? 200 : 502,
      body: {
        ok: valid, state: valid ? "VERIFIED" : "FAILED", provider: "openrouter",
        api_key_valid: valid, auth_header_attached: authHeaderAttached,
        api_key_format: keyFormat(rawApiKey), api_key_has_whitespace: containsWhitespace(rawApiKey),
        provider_http_status: response.status, redirected: response.status >= 300 && response.status < 400,
        free_tier: typeof data.is_free_tier === "boolean" ? data.is_free_tier : null,
        free_model_daily_requests: {
          limit: finiteNumber(daily.limit), remaining: finiteNumber(daily.remaining), used: finiteNumber(daily.used)
        },
        rate_limit: { requests: finiteNumber(rate.requests), interval: typeof rate.interval === "string" ? rate.interval : null },
        latency_ms: Date.now() - started
      }
    };
  } catch {
    return {
      statusCode: 502,
      body: {
        ok: false, state: "FAILED", provider: "openrouter", api_key_valid: false,
        auth_header_attached: authHeaderAttached, api_key_format: keyFormat(rawApiKey),
        api_key_has_whitespace: containsWhitespace(rawApiKey),
        error: "openrouter_auth_check_exception", latency_ms: Date.now() - started
      }
    };
  }
}
