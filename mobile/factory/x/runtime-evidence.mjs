import { createHmac, timingSafeEqual } from "node:crypto";

export const RUNTIME_EVIDENCE_SCHEMA = "midad-runtime-evidence-v1";

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("NON_FINITE_RUNTIME_EVIDENCE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map(key =>
      JSON.stringify(key) + ":" + canonicalJson(value[key])
    ).join(",") + "}";
  }
  throw new TypeError("UNSUPPORTED_RUNTIME_EVIDENCE_VALUE");
}

export function signRuntimeEvidenceEnvelope(payload, key) {
  if (typeof key !== "string" || key.length < 32) {
    throw new Error("RUNTIME_EVIDENCE_SIGNING_KEY_REQUIRED");
  }
  const normalized = {
    schema: RUNTIME_EVIDENCE_SCHEMA,
    issued_at: payload?.issued_at,
    providers: payload?.providers,
  };
  return createHmac("sha256", key).update(canonicalJson(normalized)).digest("hex");
}

/**
 * Verify a whole runtime evidence envelope before treating any provider snapshot
 * as trusted. The signing key must come from a protected host environment, never
 * from the request, registry, repository, or evidence file itself.
 */
export function verifyRuntimeEvidenceEnvelope(envelope, key, options = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { ok: false, reason: "RUNTIME_EVIDENCE_ENVELOPE_INVALID", providers: {} };
  }
  if (typeof key !== "string" || key.length < 32) {
    return { ok: false, reason: "RUNTIME_EVIDENCE_SIGNING_KEY_MISSING", providers: {} };
  }
  if (envelope.schema !== RUNTIME_EVIDENCE_SCHEMA ||
      typeof envelope.issued_at !== "string" ||
      !envelope.providers || typeof envelope.providers !== "object" ||
      Array.isArray(envelope.providers) ||
      typeof envelope.signature !== "string" ||
      !/^[a-f0-9]{64}$/.test(envelope.signature)) {
    return { ok: false, reason: "RUNTIME_EVIDENCE_ENVELOPE_INVALID", providers: {} };
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const issuedAt = Date.parse(envelope.issued_at);
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : 300_000;
  if (!Number.isFinite(issuedAt) || issuedAt > now + 5_000) {
    return { ok: false, reason: "RUNTIME_EVIDENCE_TIMESTAMP_INVALID", providers: {} };
  }
  const ageMs = now - issuedAt;
  if (ageMs > maxAgeMs) {
    return { ok: false, reason: "RUNTIME_EVIDENCE_ENVELOPE_STALE", providers: {}, age_ms: ageMs };
  }

  let expected;
  try {
    expected = Buffer.from(signRuntimeEvidenceEnvelope(envelope, key), "hex");
  } catch {
    return { ok: false, reason: "RUNTIME_EVIDENCE_ENVELOPE_INVALID", providers: {} };
  }
  const supplied = Buffer.from(envelope.signature, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return { ok: false, reason: "RUNTIME_EVIDENCE_SIGNATURE_INVALID", providers: {} };
  }

  const providers = {};
  for (const [providerId, snapshot] of Object.entries(envelope.providers)) {
    if (!/^[a-z0-9][a-z0-9._-]{1,100}$/.test(providerId) ||
        !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return { ok: false, reason: "RUNTIME_EVIDENCE_PROVIDER_INVALID", providers: {} };
    }
    providers[providerId] = {
      ...snapshot,
      source: "trusted_runtime_adapter",
      signature_verified: true,
      envelope_issued_at: envelope.issued_at,
    };
  }

  return { ok: true, reason: "RUNTIME_EVIDENCE_VERIFIED", providers, age_ms: ageMs };
}
