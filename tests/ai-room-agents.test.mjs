import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentReadiness } from "../supabase/functions/midad_ai_room_agents/agent-readiness.mjs";

const metrics = {
  signals: 100,
  opportunities: 20,
  engine_runs: 7,
  active_alerts: 0,
  pending_approvals: 0,
  pending_human_tasks: 3,
};

test("agent readiness exposes three roles over read-only live connectors", () => {
  const result = buildAgentReadiness({
    metrics,
    unavailableMetrics: [],
    identities: [{ agent_key: "midad_control_room", status: "active" }],
    events: [{ agent_key: "midad_mining_scout", event_type: "scan", state: "done", created_at: "2026-10-24T00:00:00Z" }],
    generatedAt: "2026-10-24T12:00:00Z",
  });
  assert.equal(result.scope, "read_only_agent_mesh");
  assert.deepEqual(result.guards, { mutations: false, financial_actions: false, model_calls: false });
  assert.deepEqual(result.agents.map((x) => x.key), ["orchestrator", "reasoner", "verifier"]);
  assert.ok(result.agents.every((x) => ["connected", "partial"].includes(x.state)));
  assert.equal(result.connectors.find((x) => x.id === "supabase_metrics").state, "connected");
  assert.equal(result.checks.every((x) => x.passed), true);
  assert.equal(result.evidence.registered_agents, 1);
  assert.equal(result.evidence.recent_events, 1);
});

test("missing metrics degrade the relevant roles instead of claiming a full connection", () => {
  const result = buildAgentReadiness({
    metrics: { signals: 10, opportunities: null, engine_runs: 2, active_alerts: 0, pending_approvals: 0, pending_human_tasks: 1 },
    unavailableMetrics: ["opportunities"],
    identities: [],
    events: [],
    generatedAt: "2026-10-24T12:00:00Z",
  });
  assert.equal(result.partial, true);
  assert.equal(result.agents.find((x) => x.key === "orchestrator").state, "partial");
  assert.equal(result.agents.find((x) => x.key === "reasoner").state, "partial");
  assert.equal(result.agents.find((x) => x.key === "verifier").state, "partial");
  assert.equal(result.checks.find((x) => x.id === "metrics_complete").passed, false);
});

test("negative or non-numeric counts fail verification and are never normalized into success", () => {
  const result = buildAgentReadiness({
    metrics: { signals: -1, opportunities: "unknown", engine_runs: 2, active_alerts: 0, pending_approvals: 0, pending_human_tasks: 1 },
    unavailableMetrics: ["signals", "opportunities"],
    identities: [],
    events: [],
    generatedAt: "2026-10-24T12:00:00Z",
  });
  assert.equal(result.checks.find((x) => x.id === "counts_nonnegative").passed, false);
  assert.equal(result.guards.mutations, false);
  assert.equal(result.guards.financial_actions, false);
  assert.equal(result.guards.model_calls, false);
});
