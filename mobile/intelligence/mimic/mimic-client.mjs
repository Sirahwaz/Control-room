import { adaptChainIntelligenceProfile } from "./chain-intelligence-adapter.mjs";

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const CHAIN_ID = /^\d{1,8}$/;
const PROFILE_OFFSET = 50;
const DEFAULT_TIMEOUT_MS = 15000;

function jwtRole(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3 || !parts.every(Boolean)) return null;
  const segment = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let buffer = 0, bits = 0, decoded = "";
  for (const char of segment) {
    if (char === "=") break;
    const value = alphabet.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      decoded += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  try { return JSON.parse(decoded).role ?? null; }
  catch { return null; }
}

function resolveConfig(config) {
  if (!config || typeof config !== "object") throw new Error("MIMIC_PUBLIC_CONFIG_MISSING");
  let url;
  try { url = new URL(String(config.supabaseUrl ?? "")); }
  catch { throw new Error("INVALID_SUPABASE_URL"); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("INVALID_SUPABASE_URL");
  }
  const publishableKey = String(config.publishableKey ?? "").trim();
  if (!publishableKey.startsWith("sb_publishable_") || publishableKey.length < 20) {
    throw new Error("PUBLISHABLE_KEY_REQUIRED");
  }
  const anonJwt = String(config.anonJwt ?? "").trim();
  if (jwtRole(anonJwt) !== "anon") throw new Error("PUBLIC_ANON_JWT_REQUIRED");
  return { endpoint: url.origin + "/functions/v1/midad_chain_intelligence", publishableKey, anonJwt };
}

export async function fetchPublicWalletFingerprint({
  walletAddress,
  chainId,
  config,
  fetchImpl = globalThis.fetch,
  observedAt = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const address = String(walletAddress ?? "").trim();
  if (!EVM_ADDRESS.test(address)) throw new TypeError("INVALID_EVM_WALLET_ADDRESS");
  const chain = String(chainId ?? "").trim();
  if (!CHAIN_ID.test(chain)) throw new TypeError("INVALID_EXPECTED_CHAIN_ID");
  if (typeof fetchImpl !== "function") throw new Error("MIMIC_FETCH_UNAVAILABLE");
  const resolved = resolveConfig(config);
  if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) < 1000 || Number(timeoutMs) > 60000) {
    throw new RangeError("INVALID_MIMIC_TIMEOUT");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeoutMs));
  let response;
  try {
    response = await fetchImpl(resolved.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: resolved.publishableKey,
        authorization: "Bearer " + resolved.anonJwt
      },
      body: JSON.stringify({ action: "profile", address, chainid: chain, page: 1, offset: PROFILE_OFFSET }),
      signal: controller.signal
    });
  } catch {
    if (controller.signal.aborted) throw new Error("CHAIN_INTELLIGENCE_TIMEOUT");
    throw new Error("CHAIN_INTELLIGENCE_REQUEST_FAILED");
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok) throw new Error("CHAIN_INTELLIGENCE_HTTP_" + Number(response?.status || 0));
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error("CHAIN_INTELLIGENCE_INVALID_JSON"); }
  return adaptChainIntelligenceProfile(payload, {
    walletAddress: address,
    chainId: chain,
    observedAt,
    maxRecords: PROFILE_OFFSET
  });
}
