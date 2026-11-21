import test from "node:test";
import assert from "node:assert/strict";
import { createMidadEnginePolicy, validateKitesurfEndpoint } from "./kitesurf-engine-policy.mjs";

const native = { navigate: async (url) => ({ engine: "native", url }), inspect: async () => ({ local: true }) };
const remote = { render: async (x) => ({ engine: "remote", ...x }), inspect: async (x) => ({ remote: true, ...x }) };

test("native is default and remote requires explicit consent", () => {
  const p = createMidadEnginePolicy({ nativeEngine: native, kitesurfClient: remote, remoteEnabled: true });
  assert.equal(p.select({ url: "https://example.com" }).engine, "native");
  assert.equal(p.select({ url: "https://example.com", explicitRemoteConsent: true }).engine, "kitesurf");
});
test("private/sensitive requests remain local", () => {
  const p = createMidadEnginePolicy({ nativeEngine: native, kitesurfClient: remote, remoteEnabled: true });
  assert.equal(p.select({ url: "https://example.com", contentClassification: "private", explicitRemoteConsent: true }).engine, "native");
  assert.equal(p.select({ url: "https://example.com/wallet", explicitRemoteConsent: true }).engine, "native");
});
test("remote is disabled by default and cannot silently fallback to remote", () => {
  const p = createMidadEnginePolicy({ nativeEngine: native, kitesurfClient: remote });
  assert.equal(p.status().kitesurf.ready, false);
  assert.equal(p.select({ url: "https://example.com", explicitRemoteConsent: true }).engine, "native");
});
test("fail closed when native missing and remote not consented", () => {
  const p = createMidadEnginePolicy({ kitesurfClient: remote, remoteEnabled: true });
  assert.equal(p.select({ url: "https://example.com" }).engine, null);
  assert.equal(p.select({ url: "https://example.com", explicitRemoteConsent: true }).engine, "kitesurf");
});
test("reject invalid URLs and endpoint schemes", () => {
  const p = createMidadEnginePolicy({ nativeEngine: native });
  assert.equal(p.select({ url: "javascript:alert(1)" }).engine, null);
  assert.equal(validateKitesurfEndpoint("http://worker.example"), false);
  assert.equal(validateKitesurfEndpoint("https://worker.example"), true);
  assert.equal(validateKitesurfEndpoint("https://user:pass@worker.example"), false);
});
