import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/midad-migration-readiness.yml', import.meta.url), 'utf8');
const fn = fs.readFileSync(new URL('../supabase/functions/midad-task-executor/index.ts', import.meta.url), 'utf8');

test('scheduler is daily and manually dispatchable with least-privilege permissions', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron:\s*["']30 12 \* \* \*["']/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write|id-token:\s*write/);
});

test('workflow runs repository tests before calling the executor', () => {
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node --test tests\/midad-migration-readiness\.test\.mjs/);
  assert.ok(workflow.indexOf('node --test') < workflow.indexOf('Request guarded readiness evaluation'));
});

test('workflow requires external secrets and does not print their values', () => {
  assert.match(workflow, /secrets\.MIDAD_SCHEDULER_TOKEN/);
  assert.match(workflow, /secrets\.MIDAD_EXECUTOR_URL/);
  assert.doesNotMatch(workflow, /echo.*\$MIDAD_SCHEDULER_TOKEN/);
});

test('executor authenticates and fails closed on invalid requests', () => {
  assert.match(fn, /authorization/);
  assert.match(fn, /unauthorized/);
  assert.match(fn, /unknown_task/);
  assert.match(fn, /body\.mode !== "status"/);
});

test('executor selects the private registry schema explicitly', () => {
  assert.match(fn, /"Accept-Profile": "midad_ops"/);
});

test('readiness checks cover registry, task configuration, and migration blockers', () => {
  for (const checkId of [
    'target_registry',
    'task_configuration',
    'executor_configuration',
    'source_project_boundary',
    'source_project_health',
    'migration_inventory',
    'backup_restore_validation',
    'cutover_approval'
  ]) assert.ok(fn.includes(checkId), `missing readiness check: ${checkId}`);
  assert.match(fn, /overall: blockedChecks.length === 0 \? "ready" : "blocked"/);
});

test('readiness evidence is persisted through a service-role-only RPC with idempotency', () => {
  assert.match(fn, /\/rpc\/record_readiness_run/);
  assert.match(fn, /Content-Profile": "midad_ops"/);
  assert.match(fn, /idempotency_key/);
  assert.match(fn, /run_id/);
});

test('executor never activates tasks or writes to the source project', () => {
  assert.match(fn, /execution: "not_started"/);
  assert.match(fn, /task\.status/);
  assert.doesNotMatch(fn, /PATCH|DELETE|PUT/);
  const taskRead = fn.slice(fn.indexOf('const taskUrl'), fn.indexOf('const tasks ='));
  assert.doesNotMatch(taskRead, /method:/);
  assert.match(fn, /record_readiness_run/);
  assert.match(fn, /source_project_contacted: false, source_writes_attempted: false/);
});
