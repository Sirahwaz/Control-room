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
test('workflow requires external secrets and does not print them', () => {
  assert.match(workflow, /secrets\.MIDAD_SCHEDULER_TOKEN/);
  assert.match(workflow, /secrets\.MIDAD_EXECUTOR_URL/);
  assert.doesNotMatch(workflow, /echo.*MIDAD_SCHEDULER_TOKEN/);
});
test('executor authenticates and fails closed on non-active tasks', () => {
  assert.match(fn, /authorization/);
  assert.match(fn, /task\.status !== "active"/);
  assert.match(fn, /execution: "not_started"/);
});
test('executor is limited to status mode until readiness checks are verified', () => {
  assert.match(fn, /body\.mode !== "status"/);
  assert.match(fn, /readiness_checks_not_yet_implemented/);
});
