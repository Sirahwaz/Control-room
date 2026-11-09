import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessProviderRuntime, selectExecutionSubstrate } from "../runtime-readiness.mjs";

const base = new URL("../", import.meta.url);
const providers = JSON.parse(readFileSync(new URL("providers.registry.json", base), "utf8")).providers;
const NOW = "2026-11-09T02:00:00.000Z";

function evidence(overrides = {}) {
  return {
    source: "trusted_runtime_adapter",
    signature_verified: true,
    state: "READY",
    observed_at: NOW,
    capability_handshake: true,
    authenticated: true,
    estimated_cost_usd: 0,
    ...overrides,
  };
}

test("missing or unverified runtime evidence never marks a candidate ready", () => {
  const provider = providers.find(x => x.id === "midad-playwright-worker");
  assert.equal(assessProviderRuntime(provider, null, {}, NOW).ready, false);
  const forged = evidence({ signature_verified: false });
  assert.equal(assessProviderRuntime(provider, forged, {}, NOW).reason, "RUNTIME_EVIDENCE_UNVERIFIED");
});

test("Codespaces is ready only with fresh lifecycle and quota evidence", () => {
  const provider = providers.find(x => x.id === "github-codespaces");
  const good = evidence({
    lifecycle_control: true,
    quota_remaining_minutes: 60,
  });
  assert.equal(assessProviderRuntime(provider, good, { duration_minutes: 20, max_cost_usd: 0 }, NOW).ready, true);
  const noQuota = evidence({ lifecycle_control: true });
  assert.equal(assessProviderRuntime(provider, noQuota, { duration_minutes: 5, max_cost_usd: 0 }, NOW).reason, "CODESPACES_QUOTA_UNVERIFIED");
});

test("persistent VPS control node requires fresh heartbeat and adequate probed resources", () => {
  const provider = providers.find(x => x.id === "midad-vps-control-node");
  const lowMemory = evidence({
    queue_authenticated: true,
    resource_probe: { available_memory_mb: 256, available_disk_mb: 1024 },
  });
  assert.equal(assessProviderRuntime(provider, lowMemory, { min_memory_mb: 512, min_disk_mb: 512 }, NOW).reason, "INSUFFICIENT_MEMORY");
  const stale = evidence({
    observed_at: "2026-11-09T01:58:00.000Z",
    queue_authenticated: true,
    resource_probe: { available_memory_mb: 2048, available_disk_mb: 4096 },
  });
  assert.equal(assessProviderRuntime(provider, stale, { min_memory_mb: 512, min_disk_mb: 512 }, NOW).reason, "HEARTBEAT_STALE");
});

test("Playwright worker requires heartbeat, queue authentication, browser and encrypted session storage", () => {
  const provider = providers.find(x => x.id === "midad-playwright-worker");
  const noHandshake = evidence({
    queue_authenticated: true, browser_installed: true,
    encrypted_session_store: true, available_slots: 1,
    capability_handshake: false,
  });
  assert.equal(assessProviderRuntime(provider, noHandshake, {}, NOW).reason, "CAPABILITY_HANDSHAKE_REQUIRED");
  const ready = evidence({
    queue_authenticated: true, browser_installed: true,
    encrypted_session_store: true, available_slots: 1,
  });
  assert.equal(assessProviderRuntime(provider, ready, {}, NOW).ready, true);
});

test("cost ceilings block otherwise healthy metered runtimes", () => {
  const provider = providers.find(x => x.id === "github-codespaces");
  const paid = evidence({ lifecycle_control: true, quota_remaining_minutes: 90, estimated_cost_usd: 0.01 });
  assert.equal(assessProviderRuntime(provider, paid, { duration_minutes: 5, max_cost_usd: 0 }, NOW).reason, "COST_CEILING_EXCEEDED");
});

test("interactive browser selection never falls back to a metered provider without a matching registered capability", () => {
  const plan = selectExecutionSubstrate({
    capability: "interactive-browser-execution",
    max_cost_usd: 0,
  }, providers, {}, NOW);
  assert.equal(plan.ok, false);
  assert.equal(plan.selected_provider, null);
  assert.deepEqual(plan.candidates.map(x => x.provider_id), ["midad-playwright-worker"]);
  assert.equal(plan.dispatch_allowed, false);
});
