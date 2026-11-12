import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../../', import.meta.url);
const enrollWorkflow = readFileSync(new URL('.github/workflows/midad-mncf-enroll-cpu-runner.yml', root), 'utf8');
const deployWorkflow = readFileSync(new URL('.github/workflows/midad-continuity-cloudflare-deploy.yml', root), 'utf8');
const bootstrapRequest = JSON.parse(readFileSync(new URL('.github/mncf/cpu-runner-enrollment-request.json', root), 'utf8'));

test('CPU runner enrollment is explicitly owner-scoped and consent-gated', () => {
  assert.match(enrollWorkflow, /owner_id:[\s\S]*required: true[\s\S]*type: string/);
  assert.ok(enrollWorkflow.includes("consent !== 'I_APPROVE_CPU_NODE_ENROLLMENT'"));
  assert.ok(enrollWorkflow.includes("if: github.ref == 'refs/heads/main'"));
  assert.ok(enrollWorkflow.includes('environment: cloudflare-production'));
  assert.ok(enrollWorkflow.includes('MIDAD_LEDGER_ADMIN_KEY: ${{ secrets.MIDAD_LEDGER_ADMIN_KEY }}'));
});

test('CPU runner enrollment stores the node token as an encrypted Actions secret and never logs it', () => {
  assert.ok(enrollWorkflow.includes('crypto_box_seal('));
  assert.ok(enrollWorkflow.includes('/actions/secrets/public-key'));
  assert.ok(enrollWorkflow.includes("'/actions/secrets/' + secretName"));
  assert.ok(enrollWorkflow.includes('::add-mask::'));
  assert.ok(enrollWorkflow.includes('MIDAD_CONTINUITY_RUNNER_NODE_TOKEN'));
  assert.ok(enrollWorkflow.includes('MIDAD_CONTINUITY_LEDGER_URL'));
  assert.ok(enrollWorkflow.includes('MIDAD_CONTINUITY_OWNER_ID'));
  assert.ok(enrollWorkflow.includes('libsodium-wrappers@0.8.4'));
  assert.doesNotMatch(enrollWorkflow, /console\.log\(enrollmentToken\)|process\.stdout\.write\(enrollmentToken/);
});

test('bootstrap enqueues only a bounded zero-cost CPU smoke task and dispatches the exact runner task', () => {
  assert.match(enrollWorkflow, /node_id: nodeId,[\s\S]*owner_id: ownerId,[\s\S]*capabilities: \['cpu-batch'\]/);
  assert.ok(enrollWorkflow.includes("payload: { operation: 'RUNNER_SMOKE', input: {} }"));
  assert.ok(enrollWorkflow.includes("workload: 'CPU_BATCH'"));
  assert.ok(enrollWorkflow.includes('max_cost_usd: 0'));
  assert.ok(enrollWorkflow.includes('max_attempts: 1'));
  assert.ok(enrollWorkflow.includes('midad-mncf-ephemeral-runner.yml/dispatches'));
});

test('Cloudflare deployment health verification retries transient 404 while propagation completes', () => {
  assert.ok(deployWorkflow.includes('for attempt in $(seq 1 15)'));
  assert.ok(deployWorkflow.includes('HTTP_STATUS'));
  assert.ok(deployWorkflow.includes('== "200"'));
  assert.ok(deployWorkflow.includes('sleep 4'));
  assert.ok(deployWorkflow.includes('HEALTH_FILE'));
});

test('one-time bootstrap request matches the explicitly approved owner and zero-cost CPU scope', () => {
  assert.deepEqual(bootstrapRequest, {
    request_id: 'MNCF-CPU-BOOTSTRAP-20261112-001',
    owner_id: 'github:116122510',
    consent: 'I_APPROVE_CPU_NODE_ENROLLMENT',
    requested_capability: 'cpu-batch',
    task: 'RUNNER_SMOKE',
    max_cost_usd: 0,
    authorization_source: 'explicit_user_confirmation',
    trigger_attempt: 2,
    retry_of_run_id: '43297274266',
    retry_reason: 'first_attempt_failed_before_enrollment',
  });
});

test('the bootstrap runs only for the main-branch request file and validates the approval marker', () => {
  assert.ok(enrollWorkflow.includes('push:\n    branches: [main]\n    paths:\n      - ".github/mncf/cpu-runner-enrollment-request.json"'));
  assert.ok(enrollWorkflow.includes("process.env.GITHUB_EVENT_NAME === 'push'"));
  assert.ok(enrollWorkflow.includes("const bootstrapRequestPath = `${process.env.GITHUB_WORKSPACE}/.github/mncf/cpu-runner-enrollment-request.json`;"));
  assert.ok(enrollWorkflow.includes("JSON.parse(readFileSync(bootstrapRequestPath, 'utf8'))"));
  assert.ok(enrollWorkflow.includes("bootstrapRequest?.trigger_attempt !== 2"));
  assert.ok(enrollWorkflow.includes("bootstrapRequest?.retry_of_run_id !== '43297274266'"));
  assert.ok(enrollWorkflow.includes("bootstrapRequest?.request_id !== 'MNCF-CPU-BOOTSTRAP-20261112-001'"));
  assert.ok(enrollWorkflow.includes("bootstrapRequest?.max_cost_usd !== 0"));
});

test('bootstrap request is resolved from the checked-out workspace even after npm switches to a temp directory', () => {
  assert.ok(enrollWorkflow.includes("const bootstrapRequestPath = `${process.env.GITHUB_WORKSPACE}/.github/mncf/cpu-runner-enrollment-request.json`;"));
  assert.ok(enrollWorkflow.includes("JSON.parse(readFileSync(bootstrapRequestPath, 'utf8'))"));
  assert.ok(enrollWorkflow.includes('cd "$RUNNER_TEMP/midad-cpu-enrollment"'));
});
