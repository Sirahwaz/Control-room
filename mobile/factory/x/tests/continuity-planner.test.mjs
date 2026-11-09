import test from 'node:test';
import assert from 'node:assert/strict';
import { planContinuityTask } from '../continuity-planner.mjs';

const NOW = Date.parse('2026-11-09T03:30:00.000Z');

function node(id, overrides = {}) {
  return {
    id,
    enrolled: true,
    consent: true,
    authenticated: true,
    state: 'READY',
    runtime_class: 'persistent_worker',
    heartbeat_at: new Date(NOW - 5_000).toISOString(),
    capabilities: ['cpu-batch'],
    cpu_cores: 2,
    memory_mb: 2048,
    available_slots: 2,
    cost_per_hour_usd: 0,
    reliability_score: 0.95,
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    task_id: 'mesh-job-001',
    idempotency_key: 'intent:mesh-job-001',
    workload: 'CPU_BATCH',
    units: 10,
    shard_size: 2,
    allow_sharding: true,
    max_shards: 16,
    estimated_seconds_per_unit: 30,
    max_cost_usd: 0,
    min_memory_mb: 512,
    min_cpu_cores: 1,
    ...overrides,
  };
}

test('never schedules a device that has not explicitly enrolled and consented', () => {
  const result = planContinuityTask(task(), [node('phone-1', { consent: false })], { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.assignments.length, 0);
});

test('rejects stale worker heartbeats instead of trusting an online label', () => {
  const result = planContinuityTask(task(), [node('worker-1', {
    heartbeat_at: new Date(NOW - 120_000).toISOString(),
  })], { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'NO_ELIGIBLE_EXECUTOR');
});

test('splits CPU batches into deterministic idempotent checkpointable shards', () => {
  const nodes = [
    node('node-a', { cpu_cores: 4, available_slots: 2 }),
    node('node-b', { cpu_cores: 2, available_slots: 1 }),
  ];
  const first = planContinuityTask(task(), nodes, { now: NOW });
  const second = planContinuityTask(task(), nodes, { now: NOW });
  assert.equal(first.status, 'PLAN_READY');
  assert.equal(first.assignments.length, 5);
  assert.deepEqual(first.assignments, second.assignments);
  assert.deepEqual(first.assignments.map(x => [x.unit_start, x.unit_end]), [[0,2],[2,4],[4,6],[6,8],[8,10]]);
  assert.equal(new Set(first.assignments.map(x => x.idempotency_key)).size, 5);
  assert.ok(first.assignments.every(x => x.checkpoint_key));
  assert.ok(new Set(first.assignments.map(x => x.node_id)).size > 1);
});

test('keeps a browser session on one opted-in executor with encrypted session storage', () => {
  const browserTask = task({
    workload: 'BROWSER_SESSION',
    units: 20,
    allow_sharding: true,
    required_capabilities: ['interactive-browser-execution'],
  });
  const missingStore = node('browser-1', {
    capabilities: ['interactive-browser-execution'],
    encrypted_session_store: false,
  });
  const blocked = planContinuityTask(browserTask, [missingStore], { now: NOW });
  assert.equal(blocked.status, 'BLOCKED');

  const ready = node('browser-2', {
    capabilities: ['interactive-browser-execution', 'persistent-browser-session', 'encrypted-session-store'],
    encrypted_session_store: true,
  });
  const plan = planContinuityTask(browserTask, [ready], { now: NOW });
  assert.equal(plan.status, 'PLAN_READY');
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].unit_start, 0);
  assert.equal(plan.assignments[0].unit_end, 20);
});

test('never exceeds the caller cost ceiling or silently upgrades to paid compute', () => {
  const result = planContinuityTask(task({ max_cost_usd: 0 }), [node('metered', {
    cost_per_hour_usd: 0.25,
  })], { now: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.assignments.length, 0);
});

test('requires real WebGPU capability for GPU workloads', () => {
  const result = planContinuityTask(task({
    workload: 'WEBGPU_BATCH',
    required_capabilities: ['webgpu-compute'],
  }), [node('cpu-only')], { now: NOW });
  assert.equal(result.status, 'BLOCKED');
});

test('returns a durable retry and lease contract but never dispatches by itself', () => {
  const result = planContinuityTask(task(), [node('worker-1')], { now: NOW, leaseTtlSeconds: 90 });
  assert.equal(result.status, 'PLAN_READY');
  assert.equal(result.recovery.max_attempts, 3);
  assert.equal(result.recovery.lease.ttl_seconds, 90);
  assert.equal(result.recovery.retry_mode, 'AT_LEAST_ONCE_IDEMPOTENT');
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.execution_performed, false);
});

test('rejects missing idempotency keys and malformed workloads fail-closed', () => {
  assert.equal(planContinuityTask(task({ idempotency_key: '' }), [node('worker-1')], { now: NOW }).reason,
    'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(planContinuityTask(task({ workload: 'UNBOUNDED_GPU' }), [node('worker-1')], { now: NOW }).reason,
    'WORKLOAD_UNSUPPORTED');
});

test('uses bounded but different freshness windows for ephemeral runners and persistent nodes', () => {
  const ephemeral = node('actions-runner', {
    runtime_class: 'github_actions',
    heartbeat_at: new Date(NOW - 120_000).toISOString(),
  });
  const persistent = node('persistent-node', {
    heartbeat_at: new Date(NOW - 120_000).toISOString(),
  });
  const ephemeralPlan = planContinuityTask(task({ allow_sharding: false }), [ephemeral], { now: NOW });
  const persistentPlan = planContinuityTask(task({ allow_sharding: false }), [persistent], { now: NOW });
  assert.equal(ephemeralPlan.status, 'PLAN_READY');
  assert.equal(persistentPlan.status, 'BLOCKED');
});

test('prefers a zero-cost eligible worker over a metered worker', () => {
  const result = planContinuityTask(task({ max_cost_usd: 1 }), [
    node('metered', { cost_per_hour_usd: 0.1 }),
    node('free', { cost_per_hour_usd: 0 }),
  ], { now: NOW });
  assert.equal(result.status, 'PLAN_READY');
  assert.ok(result.assignments.every(assignment => assignment.node_id === 'free'));
  assert.equal(result.estimated_cost_usd, 0);
});
