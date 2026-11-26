import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuityTask } from './task-envelope.mjs';

const base = {
  schema_version: 1,
  task_id: 'midad_forge:run-123:build',
  source_system: 'midad_forge',
  source_mission_id: 'run-123',
  idempotency_key: 'midad_forge:run-123:build:v1',
  workload: 'CPU_BATCH',
  required_capabilities: ['node24-build', 'cpu-batch'],
  payload: { operation: 'build', target: 'project-1' },
  data_class: 'internal',
  policy_ref: 'midad.policy.fabric.v1',
  evidence_requirements: ['build_report', 'artifact_sha256'],
  units: 1,
  estimated_seconds_per_unit: 30,
  max_cost_usd: 0,
  min_cpu_cores: 1,
  min_memory_mb: 512,
  max_attempts: 2,
};
const context = { ownerId: 'owner-123' };

test('maps a valid source task to the existing Continuity Ledger contract', () => {
  const result = buildContinuityTask(base, context);
  assert.equal(result.ok, true);
  assert.equal(result.task.owner_id, 'owner-123');
  assert.equal(result.task.task_id, base.task_id);
  assert.equal(result.task.idempotency_key, base.idempotency_key);
  assert.equal(result.task.retry_mode, 'HUMAN_RECONCILIATION');
  assert.deepEqual(result.task.payload._midad_fabric, {
    schema_version: 1,
    source_system: 'midad_forge',
    source_mission_id: 'run-123',
    data_class: 'internal',
    policy_ref: 'midad.policy.fabric.v1',
    evidence_requirements: ['build_report', 'artifact_sha256'],
  });
});

test('never accepts owner identity from the untrusted task envelope', () => {
  assert.equal(buildContinuityTask({ ...base, owner_id: 'attacker' }, context).error, 'TASK_FIELD_UNKNOWN');
  assert.equal(buildContinuityTask(base, {}).error, 'TRUSTED_OWNER_REQUIRED');
});

test('requires source-namespaced task and idempotency identifiers', () => {
  assert.equal(buildContinuityTask({ ...base, task_id: 'run-123' }, context).error, 'TASK_ID_NOT_SOURCE_SCOPED');
  assert.equal(buildContinuityTask({ ...base, task_id: 'midad_forge:other-run:build' }, context).error, 'TASK_ID_NOT_SOURCE_SCOPED');
  assert.equal(buildContinuityTask({ ...base, idempotency_key: 'other:run-123' }, context).error, 'IDEMPOTENCY_KEY_NOT_SOURCE_SCOPED');
  assert.equal(buildContinuityTask({ ...base, idempotency_key: 'midad_forge:other-run:build:v1' }, context).error, 'IDEMPOTENCY_KEY_NOT_SOURCE_SCOPED');
});

test('rejects unsupported source systems, workloads and restricted data', () => {
  assert.equal(buildContinuityTask({ ...base, source_system: 'unknown_system' }, context).error, 'SOURCE_SYSTEM_UNSUPPORTED');
  assert.equal(buildContinuityTask({ ...base, workload: 'AGENT_TASK' }, context).error, 'WORKLOAD_UNSUPPORTED');
  assert.equal(buildContinuityTask({ ...base, data_class: 'restricted' }, context).error, 'DATA_CLASS_UNSUPPORTED');
  assert.equal(buildContinuityTask({ ...base, data_class: 'confidential' }, context).error, 'DATA_CLASS_UNSUPPORTED');
});

test('browser sessions always require human reconciliation, even when adapter claims idempotency', () => {
  const result = buildContinuityTask({ ...base, workload: 'BROWSER_SESSION' }, { ...context, retrySafety: 'verified_idempotent', idempotencyVerified: true });
  assert.equal(result.ok, true);
  assert.equal(result.task.retry_mode, 'HUMAN_RECONCILIATION');
});

test('only trusted adapter context can enable idempotent retry', () => {
  assert.equal(buildContinuityTask(base, context).task.retry_mode, 'HUMAN_RECONCILIATION');
  assert.equal(buildContinuityTask(base, { ...context, retrySafety: 'verified_idempotent' }).task.retry_mode, 'HUMAN_RECONCILIATION');
  assert.equal(buildContinuityTask(base, { ...context, retrySafety: 'verified_idempotent', idempotencyVerified: true }).task.retry_mode, 'AT_LEAST_ONCE_IDEMPOTENT');
  assert.equal(buildContinuityTask({ ...base, retry_mode: 'AT_LEAST_ONCE_IDEMPOTENT' }, context).error, 'TASK_FIELD_UNKNOWN');
});

test('rejects credential-like payload keys and values recursively', () => {
  for (const payload of [
    { password: 'x' },
    { nested: { access_token: 'x' } },
    { header: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789' },
    { mnemonic: ['one', 'two'] },
  ]) {
    assert.equal(buildContinuityTask({ ...base, payload }, context).error, 'TASK_PAYLOAD_SENSITIVE');
  }
});

test('rejects caller-supplied reserved metadata and oversized payloads', () => {
  assert.equal(buildContinuityTask({ ...base, payload: { _midad_fabric: {} } }, context).error, 'TASK_PAYLOAD_RESERVED_FIELD');
  assert.equal(buildContinuityTask({ ...base, payload: { data: 'x'.repeat(50000) } }, context).error, 'TASK_PAYLOAD_TOO_LARGE');
});

test('requires explicit approval context for positive cost ceilings', () => {
  assert.equal(buildContinuityTask({ ...base, max_cost_usd: 0.01 }, context).error, 'TASK_COST_APPROVAL_REQUIRED');
  assert.equal(buildContinuityTask({ ...base, max_cost_usd: 0.01 }, { ...context, costApprovalRef: 'approval-123' }).error, 'TASK_COST_APPROVAL_REQUIRED');
  const result = buildContinuityTask({ ...base, max_cost_usd: 0.01 }, { ...context, costApprovalRef: 'approval-123', costApprovalVerified: true });
  assert.equal(result.ok, true);
});

test('bounds attempts, capabilities and resource requirements', () => {
  assert.equal(buildContinuityTask({ ...base, max_attempts: 4 }, context).error, 'TASK_LIMIT_INVALID');
  assert.equal(buildContinuityTask({ ...base, min_memory_mb: 1.5 }, context).error, 'TASK_LIMIT_INVALID');
  assert.equal(buildContinuityTask({ ...base, required_capabilities: Array(33).fill('cpu-batch') }, context).error, 'TASK_CAPABILITIES_INVALID');
});
