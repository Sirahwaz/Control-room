import test from "node:test";
import assert from "node:assert/strict";
import {
  validateBrowserPluginManifest,
  transitionBrowserPlugin,
  createBrowserPluginGrant,
} from "./plugin-runtime-contract.mjs";

const base = {
  schemaVersion: 1,
  id: "com.midad.extractor",
  name: "MIDAD Extractor",
  version: "1.0.0",
  description: "Extracts permitted public page content.",
  entrypoint: "./plugin.js",
  integrity: "a".repeat(64),
  capabilities: ["browser.inspect", "browser.capture"],
  origins: ["https://example.com"],
  permissions: [],
};

test("accepts a local declarative plugin manifest with bounded capabilities", () => {
  const result = validateBrowserPluginManifest(base);
  assert.equal(result.ok, true);
  assert.equal(result.manifest.id, base.id);
});

test("rejects remote entrypoints, traversal and wildcard origins", () => {
  for (const patch of [
    { entrypoint: "https://evil.example/plugin.js" },
    { entrypoint: "../outside.js" },
    { origins: ["https://*.example.com"] },
    { origins: ["*"] },
  ]) {
    assert.equal(validateBrowserPluginManifest({ ...base, ...patch }).ok, false);
  }
});

test("rejects unknown capabilities and sensitive browser permissions", () => {
  assert.equal(validateBrowserPluginManifest({ ...base, capabilities: ["browser.root"] }).error, "plugin_capability_invalid");
  for (const permission of ["cookies", "debugger", "nativeMessaging", "webRequest", "browsingData"]) {
    assert.equal(validateBrowserPluginManifest({ ...base, permissions: [permission] }).ok, false);
  }
});

test("requires explicit human gate for mutating capabilities", () => {
  assert.equal(validateBrowserPluginManifest({
    ...base, capabilities: ["browser.click"], approval: { mode: "none" },
  }).error, "plugin_mutation_gate_required");
  assert.equal(validateBrowserPluginManifest({
    ...base, capabilities: ["browser.click"], approval: { mode: "per_action_human" },
  }).ok, true);
});

test("grant is scoped to plugin, owner, origin, capabilities and expiry", () => {
  const result = createBrowserPluginGrant({
    manifest: base, ownerId: "owner-123", now: 1000, ttlMs: 60_000,
    requestedCapabilities: ["browser.inspect"], origin: "https://example.com",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.grant.capabilities, ["browser.inspect"]);
  assert.equal(result.grant.expiresAt, 61_000);
  assert.equal(createBrowserPluginGrant({
    manifest: base, ownerId: "owner-123", now: 1000, ttlMs: 999_999,
    requestedCapabilities: ["browser.inspect"], origin: "https://example.com",
  }).error, "plugin_grant_ttl_invalid");
});

test("grant refuses capabilities and origins outside the signed manifest scope", () => {
  assert.equal(createBrowserPluginGrant({
    manifest: base, ownerId: "owner-123", now: 1000, ttlMs: 10_000,
    requestedCapabilities: ["browser.fill"], origin: "https://example.com",
  }).error, "plugin_capability_not_declared");
  assert.equal(createBrowserPluginGrant({
    manifest: base, ownerId: "owner-123", now: 1000, ttlMs: 10_000,
    requestedCapabilities: ["browser.inspect"], origin: "https://other.example",
  }).error, "plugin_origin_not_declared");
});

test("plugin lifecycle blocks invalid transitions and supports revoke", () => {
  assert.equal(transitionBrowserPlugin("installed", "enable").state, "enabled");
  assert.equal(transitionBrowserPlugin("enabled", "disable").state, "disabled");
  assert.equal(transitionBrowserPlugin("disabled", "revoke").state, "revoked");
  assert.equal(transitionBrowserPlugin("revoked", "enable").error, "plugin_transition_invalid");
  assert.equal(transitionBrowserPlugin("installed", "execute").error, "plugin_transition_invalid");
});
