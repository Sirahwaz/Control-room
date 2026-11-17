const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_ID = /^android-[a-z0-9-]{6,64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,100}$/;
const BASE64URL_COORDINATE = /^[A-Za-z0-9_-]{43}$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ALLOWED_CAPABILITIES = new Set([
  "browser.inspect",
  "browser.navigate",
  "browser.click",
  "browser.fill",
  "browser.wait",
]);
const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function failure(error) {
  return { ok: false, error };
}

/**
 * Resolve an owner only from an explicit owner binding on the authenticated
 * session row. Never infer ownership from a global profiles query.
 */
export function validateOwnerSessionBinding(session, nowMs = Date.now()) {
  if (!session || typeof session !== "object" || session.active !== true) {
    return failure("owner_session_inactive");
  }
  if (typeof session.owner_user_id !== "string" || !UUID.test(session.owner_user_id)) {
    return failure("owner_session_not_bound");
  }
  const createdAt = Date.parse(session.created_at);
  if (!Number.isFinite(createdAt) || createdAt > nowMs ||
      nowMs - createdAt > MAX_SESSION_AGE_MS) {
    return failure("owner_session_expired");
  }
  return { ok: true, ownerUserId: session.owner_user_id };
}

/**
 * Validate an untrusted Android pairing intent. Owner identity and challenge
 * values are server-derived and therefore must never be accepted from caller.
 */
export function validatePairingIntent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure("pairing_intent_invalid");
  }
  const allowedKeys = new Set([
    "device_id", "device_label", "idempotency_key",
    "public_key_jwk", "capabilities", "allowed_hosts",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    return failure("pairing_intent_unknown_field");
  }

  if (typeof input.device_id !== "string" || !DEVICE_ID.test(input.device_id)) {
    return failure("device_id_invalid");
  }
  if (typeof input.device_label !== "string" ||
      input.device_label.trim().length < 1 || input.device_label.trim().length > 60) {
    return failure("device_label_invalid");
  }
  if (typeof input.idempotency_key !== "string" ||
      !IDEMPOTENCY_KEY.test(input.idempotency_key)) {
    return failure("idempotency_key_invalid");
  }

  const jwk = input.public_key_jwk;
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk) ||
      jwk.kty !== "EC" || jwk.crv !== "P-256" ||
      typeof jwk.x !== "string" || !BASE64URL_COORDINATE.test(jwk.x) ||
      typeof jwk.y !== "string" || !BASE64URL_COORDINATE.test(jwk.y) ||
      Object.keys(jwk).some((key) => !["kty", "crv", "x", "y", "ext", "key_ops"].includes(key)) ||
      Object.prototype.hasOwnProperty.call(jwk, "d")) {
    return failure("device_public_key_invalid");
  }

  if (!Array.isArray(input.capabilities) || input.capabilities.length < 1 ||
      input.capabilities.length > ALLOWED_CAPABILITIES.size ||
      new Set(input.capabilities).size !== input.capabilities.length ||
      input.capabilities.some((capability) => !ALLOWED_CAPABILITIES.has(capability))) {
    return failure("capability_scope_invalid");
  }

  if (!Array.isArray(input.allowed_hosts) || input.allowed_hosts.length < 1 ||
      input.allowed_hosts.length > 20 ||
      new Set(input.allowed_hosts).size !== input.allowed_hosts.length ||
      input.allowed_hosts.some((host) => {
        if (typeof host !== "string" || host.length > 253 || host !== host.toLowerCase() ||
            host.includes("*") || host.includes("/") || host.includes(":")) return true;
        const labels = host.split(".");
        return labels.length < 2 || labels.some((label) => !HOST_LABEL.test(label));
      })) {
    return failure("host_scope_invalid");
  }

  return {
    ok: true,
    value: {
      device_id: input.device_id,
      device_label: input.device_label.trim(),
      idempotency_key: input.idempotency_key,
      public_key_jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
      capabilities: [...input.capabilities].sort(),
      allowed_hosts: [...input.allowed_hosts].sort(),
    },
  };
}
