/**
 * MIDAD multi-engine policy: Kitesurf is an optional remote renderer, never
 * silently selected for private content. Actual Kitesurf deployment is injected.
 */
const REMOTE_ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i;
const PRIVATE_HINTS = /password|token|secret|payment|bank|wallet|account|private|credential/i;

export const KITESURF_ENGINE = Object.freeze({
  id: "cloudflare-kitesurf",
  kind: "remote-renderer",
  experimental: true,
  source: "https://github.com/cloudflare/kitesurf",
});

export function createMidadEnginePolicy({ nativeEngine, kitesurfClient, remoteEnabled = false } = {}) {
  const localReady = !!nativeEngine && typeof nativeEngine.navigate === "function";
  const remoteReady = !!kitesurfClient && typeof kitesurfClient.render === "function" &&
    typeof kitesurfClient.inspect === "function" && remoteEnabled;

  const status = () => Object.freeze({
    preferred: "native",
    native: { ready: localReady, mode: "local" },
    kitesurf: { ready: remoteReady, experimental: true, mode: "remote", gated: !remoteEnabled },
    fallback: "native",
  });

  const select = ({ url, contentClassification = "public", explicitRemoteConsent = false } = {}) => {
    if (typeof url !== "string" || url.length > 2048) return { engine: null, reason: "url_invalid" };
    let parsed;
    try { parsed = new URL(url); } catch { return { engine: null, reason: "url_invalid" }; }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return { engine: null, reason: "url_scheme_blocked" };
    }
    const sensitive = contentClassification === "private" || contentClassification === "sensitive" ||
      PRIVATE_HINTS.test(parsed.pathname + parsed.search);
    if (sensitive) return localReady ? { engine: "native", reason: "private_content_local_only" } :
      { engine: null, reason: "private_content_and_native_unavailable" };
    if (!localReady) return remoteReady && explicitRemoteConsent ?
      { engine: "kitesurf", reason: "native_unavailable_remote_consent" } :
      { engine: null, reason: "native_unavailable_remote_not_authorized" };
    if (remoteReady && explicitRemoteConsent) return { engine: "kitesurf", reason: "explicit_remote_consent" };
    return { engine: "native", reason: remoteReady ? "remote_consent_required" : "native_fallback" };
  };

  const render = async (request) => {
    const choice = select(request);
    if (!choice.engine) throw new Error(choice.reason);
    if (choice.engine === "native") return nativeEngine.navigate(request.url);
    return kitesurfClient.render({ url: request.url, policy: "consented-public-content-only" });
  };

  const inspect = async (request) => {
    const choice = select(request);
    if (!choice.engine) throw new Error(choice.reason);
    if (choice.engine === "native") return nativeEngine.inspect?.(request) ?? nativeEngine.navigate(request.url);
    return kitesurfClient.inspect({ url: request.url, policy: "consented-public-content-only" });
  };

  return Object.freeze({ status, select, render, inspect });
}

export function validateKitesurfEndpoint(value) {
  if (typeof value !== "string" || value.length > 256 || !REMOTE_ORIGIN.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.origin === value.replace(/\/$/, "");
  } catch { return false; }
}
