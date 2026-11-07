import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = new URL("../", import.meta.url);
const agents = JSON.parse(readFileSync(new URL("agents.registry.json", base), "utf8"));
const bindings = JSON.parse(readFileSync(new URL("agent-bindings.registry.json", base), "utf8"));

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
