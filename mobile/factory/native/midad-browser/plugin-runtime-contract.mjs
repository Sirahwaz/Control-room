const CAPABILITIES = new Set([
  "browser.inspect",
  "browser.capture",
  "browser.navigate",
  "browser.wait",
  "browser.click",
  "browser.fill",
  "browser.download",
]);
const MUTATING = new Set(["browser.click", "browser.fill", "browser.download"]);
const FORBIDDEN_PERMISSIONS = new Set([
  "cookies", "browsingData", "debugger", "nativeMessaging", "webRequest",
  "webRequestBlocking", "history", "downloads", "proxy", "privacy",
]);
const STATES = new Set(["installed", "enabled", "disabled", "revoked"]);

function fail(error) { return { ok: false, error }; }

function validOrigin(value) {
  if (typeof value !== "string" || value.length > 255) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      url.origin === value && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

function validEntrypoint(value) {
  return typeof value === "string" && value.length <= 160 &&
    /^\.\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.js$/.test(value) &&
    !value.includes("..") && !value.includes("//");
}

/**
 * Validate a declarative plugin descriptor. This does not execute plugin code,
 * verify a publisher signature, or grant runtime access.
 */
export function validateBrowserPluginManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("plugin_manifest_invalid");
  const allowed = new Set([
    "schemaVersion", "id", "name", "version", "description", "entrypoint",
    "integrity", "capabilities", "origins", "permissions", "approval",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return fail("plugin_manifest_unknown_field");
  if (input.schemaVersion !== 1 ||
      typeof input.id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+){1,7}$/.test(input.id) ||
      typeof input.name !== "string" || !input.name.trim() || input.name.length > 80 ||
      typeof input.description !== "string" || input.description.length > 500 ||
      typeof input.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version) ||
      !validEntrypoint(input.entrypoint) ||
      typeof input.integrity !== "string" || !/^[a-f0-9]{64}$/i.test(input.integrity)) {
    return fail("plugin_manifest_invalid");
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.length < 1 ||
      input.capabilities.length > CAPABILITIES.size ||
      new Set(input.capabilities).size !== input.capabilities.length ||
      input.capabilities.some((item) => !CAPABILITIES.has(item))) {
    return fail("plugin_capability_invalid");
  }
  if (!Array.isArray(input.origins) || input.origins.length < 1 || input.origins.length > 20 ||
      new Set(input.origins).size !== input.origins.length ||
      input.origins.some((origin) => !validOrigin(origin))) {
    return fail("plugin_origin_invalid");
  }
  if (!Array.isArray(input.permissions) || input.permissions.length > 10 ||
      input.permissions.some((permission) => typeof permission !== "string" ||
        FORBIDDEN_PERMISSIONS.has(permission) || !["activeTab", "scripting", "storage"].includes(permission))) {
    return fail("plugin_permission_invalid");
  }
  if (input.capabilities.some((item) => MUTATING.has(item)) &&
      input.approval?.mode !== "per_action_human") {
    return fail("plugin_mutation_gate_required");
  }
  if (input.approval !== undefined &&
      (!input.approval || Object.keys(input.approval).some((key) => key !== "mode") ||
       !["per_action_human", "read_only"].includes(input.approval.mode))) {
    return fail("plugin_approval_policy_invalid");
  }
  return { ok: true, manifest: Object.freeze({
    ...input,
    capabilities: [...input.capabilities],
    origins: [...input.origins],
    permissions: [...input.permissions],
  }) };
}

/**
 * Mint a short-lived in-memory grant only after the host's human-consent UI
 * confirms this exact plugin scope. Persistence and signature verification
 * belong to the trusted host, not this pure contract.
 */
export function createBrowserPluginGrant({
  manifest, ownerId, now = Date.now(), ttlMs = 30_000,
  requestedCapabilities, origin,
}) {
  const validated = validateBrowserPluginManifest(manifest);
  if (!validated.ok) return validated;
  if (typeof ownerId !== "string" || !ownerId.trim() || ownerId.length > 128) return fail("plugin_owner_invalid");
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 120_000) {
    return fail("plugin_grant_ttl_invalid");
  }
  if (!Array.isArray(requestedCapabilities) || requestedCapabilities.length < 1 ||
      requestedCapabilities.some((capability) => !validated.manifest.capabilities.includes(capability))) {
    return fail("plugin_capability_not_declared");
  }
  if (!validated.manifest.origins.includes(origin)) return fail("plugin_origin_not_declared");
  return {
    ok: true,
    grant: Object.freeze({
      pluginId: validated.manifest.id,
      ownerId,
      origin,
      capabilities: [...new Set(requestedCapabilities)],
      issuedAt: now,
      expiresAt: now + ttlMs,
      approvalMode: validated.manifest.approval?.mode || "read_only",
    }),
  };
}

export function transitionBrowserPlugin(state, action) {
  if (!STATES.has(state)) return fail("plugin_state_invalid");
  const transitions = {
    install: { absent: "installed" },
    enable: { installed: "enabled", disabled: "enabled" },
    disable: { enabled: "disabled", installed: "disabled" },
    revoke: { installed: "revoked", enabled: "revoked", disabled: "revoked" },
  };
  const next = transitions[action]?.[state];
  return next ? { ok: true, state: next } : fail("plugin_transition_invalid");
}

export const BROWSER_PLUGIN_CAPABILITIES = Object.freeze([...CAPABILITIES]);
