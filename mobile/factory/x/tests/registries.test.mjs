import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = new URL("../", import.meta.url);
const agents = JSON.parse(readFileSync(new URL("agents.registry.json", base), "utf8"));
const bindings = JSON.parse(readFileSync(new URL("agent-bindings.registry.json", base), "utf8"));
const providers = JSON.parse(readFileSync(new URL("providers.registry.json", base), "utf8")).providers;
const capabilities = JSON.parse(readFileSync(new URL("capabilities.registry.json", base), "utf8")).capabilities;
const adapters = JSON.parse(readFileSync(new URL("adapters.registry.json", base), "utf8")).adapters;

test("Factory X agent and binding identifiers are unique", () => {
  const agentIds = agents.agents.map(x => x.id);
  const bindingIds = bindings.bindings.map(x => x.agent);
  assert.equal(new Set(agentIds).size, agentIds.length);
  assert.equal(new Set(bindingIds).size, bindingIds.length);
});

test("every declared agent has exactly one tool binding", () => {
  const ids = new Set(agents.agents.map(x => x.id));
  const bound = new Set(bindings.bindings.map(x => x.agent));
  assert.deepEqual([...ids].filter(x => !bound.has(x)), []);
  assert.deepEqual([...bound].filter(x => !ids.has(x)), []);
});

test("parallelism remains bounded at the existing limit", () => {
  assert.equal(agents.concurrency_model, "dynamic_bounded_parallelism");
  assert.equal(agents.max_parallel_agents, 32);
});

test("wallet behavior role is limited to public evidence and paper analysis", () => {
  const agent = agents.agents.find(x => x.id === "wallet-behavior-agent");
  const binding = bindings.bindings.find(x => x.agent === "wallet-behavior-agent");
  assert.ok(agent);
  assert.ok(agent.inputs.includes("public_wallet_transactions"));
  assert.ok(agent.outputs.includes("paper_backtest_report"));
  assert.ok(binding);
  assert.equal(binding.action, "analyze_public_wallet_behavior");
  assert.equal(binding.primary, "supabase");
});

test("negotiation role is draft-only with a human-gate fallback", () => {
  const agent = agents.agents.find(x => x.id === "offer-negotiation-agent");
  const binding = bindings.bindings.find(x => x.agent === "offer-negotiation-agent");
  assert.ok(agent.outputs.includes("approval_requirements"));
  assert.equal(binding.action, "prepare_nonbinding_offer");
  assert.equal(binding.fallback, "human-gate");
});

test("media role exposes cost and rights evidence", () => {
  const agent = agents.agents.find(x => x.id === "media-production-agent");
  const binding = bindings.bindings.find(x => x.agent === "media-production-agent");
  assert.ok(agent.inputs.includes("credit_budget"));
  assert.ok(agent.outputs.includes("cost_report"));
  assert.ok(agent.outputs.includes("voice_and_rights_report"));
  assert.equal(binding.primary, "heygen");
  assert.equal(binding.fallback, "openart");
});

test("hybrid execution substrates are registered without implying runtime readiness", () => {
  const capabilityIds = new Set(capabilities.map(x => x.id));
  for (const id of ["ephemeral-dev-workspace", "persistent-worker-runtime", "durable-task-dispatch"]) {
    assert.ok(capabilityIds.has(id), `missing execution capability: ${id}`);
  }

  const codespaces = providers.find(x => x.id === "github-codespaces");
  assert.ok(codespaces);
  assert.equal(codespaces.status, "discover_on_need");
  assert.equal(codespaces.runtime_class, "ephemeral");
  assert.equal(codespaces.requires_quota_check, true);
  assert.equal(codespaces.always_on_worker, false);

  const vps = providers.find(x => x.id === "midad-vps-control-node");
  assert.ok(vps);
  assert.equal(vps.status, "verification_required");
  assert.equal(vps.runtime_class, "persistent_control");
  assert.equal(vps.resource_probe_required, true);

  const browser = providers.find(x => x.id === "midad-playwright-worker");
  assert.ok(browser);
  assert.equal(browser.status, "verification_required");
  assert.equal(browser.health_requirements.heartbeat_max_age_seconds, 45);
  assert.equal(browser.health_requirements.capability_handshake, true);
});

test("unverified execution adapters stay fail-closed and cannot dispatch", () => {
  for (const id of [
    "github-codespaces-pending",
    "midad-vps-supervisor-pending",
    "midad-playwright-worker-pending",
  ]) {
    const adapter = adapters.find(x => x.id === id);
    assert.ok(adapter, `missing pending adapter: ${id}`);
    assert.equal(adapter.status, "PENDING");
    assert.equal(adapter.execution, "none");
  }
});
