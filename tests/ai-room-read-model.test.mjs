import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStatusCounts } from '../supabase/functions/midad_ai_room_status/status-summary.mjs';
import { buildAgentReadiness } from '../supabase/functions/midad_ai_room_status/agent-readiness.mjs';

const completeMetrics = { signals: 0, opportunities: 12, engine_runs: 4, active_alerts: 0, pending_approvals: 0, pending_human_tasks: 2 };

test('status summary preserves successful zero counts and marks only failed metrics unavailable', () => {
  const summary = summarizeStatusCounts({ signals: { count: 0 }, opportunities: { count: 12 }, engine_runs: { error: { code: 'timeout' } }, active_alerts: { count: 0 } });
  assert.deepEqual(summary.counts, { signals: 0, opportunities: 12, active_alerts: 0 });
  assert.equal(summary.partial, true);
  assert.deepEqual(summary.unavailable_metrics, ['engine_runs']);
});

test('agent readiness is connected only with complete nonnegative metrics and readable registry/events', () => {
  const result = buildAgentReadiness({ metrics: completeMetrics, identities: [{ agent_key: 'orchestrator', status: 'active' }], events: [{ agent_key: 'orchestrator', created_at: '2026-11-02T07:00:00Z' }] });
  assert.equal(result.partial, false);
  assert.equal(result.agents.every(agent => agent.state === 'connected'), true);
  assert.equal(result.guards.mutations, false);
  assert.equal(result.guards.financial_actions, false);
  assert.equal(result.guards.model_calls, false);
  assert.equal(result.evidence.registered_agents, 1);
  assert.equal(result.evidence.recent_events, 1);
});

test('missing metrics or unreadable evidence stays partial rather than verified', () => {
  const result = buildAgentReadiness({ metrics: { ...completeMetrics, pending_human_tasks: null }, unavailableMetrics: ['pending_human_tasks'], identities: null, events: [] });
  assert.equal(result.partial, true);
  assert.equal(result.agents[0].state, 'partial');
  assert.equal(result.connectors.find(x => x.id === 'agent_registry').state, 'unavailable');
});

test('negative metric values fail closed as blocked', () => {
  const result = buildAgentReadiness({ metrics: { ...completeMetrics, signals: -1 }, identities: [], events: [] });
  assert.equal(result.partial, true);
  assert.equal(result.agents[0].state, 'blocked');
  assert.equal(result.checks.find(x => x.id === 'counts_nonnegative').passed, false);
});
