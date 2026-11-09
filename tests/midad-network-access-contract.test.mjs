import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(fs.readFileSync(path.join(root, "contracts/midad-network-access.schema.json"), "utf8"));

function walk(value, pathParts = []) {
  const found = [];
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    found.push({ key, path: [...pathParts, key].join(".") });
    found.push(...walk(child, [...pathParts, key]));
  }
  return found;
}

test("network access contract is versioned and has explicit resource collections", () => {
  assert.equal(schema.properties.contract_version.const, "midad.network-access/v1");
  for (const key of ["proxy_profiles", "routing_rules", "credential_bindings", "defaults"]) {
    assert.ok(schema.required.includes(key), `missing required top-level contract field: ${key}`);
  }
});

test("proxy profile contract supports direct, HTTP(S), SOCKS5 and managed routes without inline credentials", () => {
  const profile = schema.$defs.proxyProfile;
  assert.ok(profile.properties.mode.enum.includes("DIRECT"));
  assert.ok(profile.properties.mode.enum.includes("HTTP"));
  assert.ok(profile.properties.mode.enum.includes("HTTPS"));
  assert.ok(profile.properties.mode.enum.includes("SOCKS5"));
  assert.ok(profile.properties.mode.enum.includes("MANAGED_GATEWAY"));
  const profileKeys = walk(profile).map(x => x.key);
  for (const forbidden of ["password", "username", "secret_value", "token_value", "private_key"]) {
    assert.ok(!profileKeys.includes(forbidden), `inline credential field forbidden: ${forbidden}`);
  }
  assert.ok(profile.properties.auth_secret_ref);
});

test("routing rules are scoped to explicit hostnames and runtime classes", () => {
  const rule = schema.$defs.routingRule;
  assert.ok(rule.required.includes("hosts"));
  assert.ok(rule.required.includes("scopes"));
  assert.deepEqual(rule.properties.scopes.items.enum, ["BROWSER", "AUTOMATION", "INFRASTRUCTURE"]);
  assert.match(rule.properties.hosts.items.description, /Exact hostnames only/);
});

test("route failure defaults to fail-closed and never silently falls back to direct", () => {
  const defaults = schema.$defs.defaultPolicy;
  assert.equal(defaults.properties.on_no_match.default, "BLOCK");
  assert.equal(defaults.properties.on_route_failure.default, "BLOCK");
  const profile = schema.$defs.proxyProfile;
  assert.ok(profile.properties.health_policy.properties.on_failure.enum.includes("BLOCK"));
  assert.ok(profile.properties.health_policy.properties.on_failure.enum.includes("NEXT_PROXY_ONLY"));
  assert.ok(!profile.properties.health_policy.properties.on_failure.default?.includes("DIRECT"));
});

test("vault bindings contain references and scopes, never secret material", () => {
  const binding = schema.$defs.credentialBinding;
  assert.ok(binding.required.includes("secret_ref"));
  assert.ok(binding.required.includes("host"));
  assert.ok(binding.required.includes("scope"));
  const keys = walk(binding).map(x => x.key);
  for (const forbidden of ["password", "secret_value", "token_value", "private_key", "credential_value"]) {
    assert.ok(!keys.includes(forbidden), `vault binding must not expose ${forbidden}`);
  }
});
