import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../../', import.meta.url);
const enrollWorkflow = readFileSync(
  new URL('.github/workflows/midad-mncf-enroll-cpu-runner.yml', root),
  'utf8',
);
const deployWorkflow = readFileSync(
  new URL('.github/workflows/midad-continuity-cloudflare-deploy.yml', root),
  'utf8',
);
const bootstrapRequest = JSON.parse(readFileSync(
  new URL('.github/mncf/cpu-runner-enrollment-request.json', root),
  'utf8',
));

test('CPU runner enrollment is explicitly owner-scoped and consent-gated', () => {
  assert.match(enrollWorkflow, /owner_id:[\s\S]*required: true[\s\S]*type: string/);
  assert.match(enrollWorkflow, /I_APPROVE_CPU_NODE_ENROLLMENT/);
  assert.match(enrollWorkflow, /consent !== 'I_APPROVE_CPU_NODE_ENROLLMENT'/);
  assert.match(enrollWorkflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(enrollWorkflow, /environment: cloudflare-production/);
  assert.match(enrollWorkflow, /MIDAD_LEDGER_ADMIN_KEY: \$\{\{ secrets\.MIDAD_LEDGER_ADMIN_KEY \}\}/);
});

test('CPU runner enrollment stores the node token as an encrypted Actions secret and never logs it', () => {
  assert.match(enrollWorkflow, /crypto_box_seal\(/);
  assert.match(enrollWorkflow, /\/actions\/secrets\/public-key/);
  assert.ok(enrollWorkflow.includes("'/actions/secrets/' + secretName"));
  assert.match(enrollWorkflow, /::add-mask::/);
  assert.match(enrollWorkflow, /MIDAD_CONTINUITY_RUNNER_NODE_TOKEN/);
  assert.match(enrollWorkflow, /MIDAD_CONTINUITY_LEDGER_URL/);
  assert.match(enrollWorkflow, /MIDAD_CONTINUITY_OWNER_ID/);
  assert.match(enrollWorkflow, /libsodium-wrappers@0\.8\.4/);
  assert.doesNotMatch(enrollWorkflow, /console\.log\(enrollmentToken\)|process\.stdout\.write\(enrollmentToken/);
});

test('bootstrap enqueues only a bounded zero-cost CPU smoke task and dispatches the exact runner task', () => {
  assert.match(enrollWorkflow, /node_id: nodeId,[\s\S]*owner_id: ownerId,[\s\S]*capabilities: \['cpu-batch'\]/);
  assert.match(enrollWorkflow, /payload: \{ operation: 'RUNNER_SMOKE', input: \{\} \}/);
  assert.match(enrollWorkflow, /workload: 'CPU_BATCH'/);
  assert.match(enrollWorkflow, /max_cost_usd: 0/);
  assert.match(enrollWorkflow, /max_attempts: 1/);
  assert.match(enrollWorkflow, /midad-mncf-ephemeral-runner\.yml\/dispatches/);
  assert.match(enrollWorkflow, /inputs: \{ owner_id: ownerId, task_id: taskId, event_id: eventId \}/);
});

test('Cloudflare deployment health verification retries transient 404 while propagation completes', () => {
  assert.match(deployWorkflow, /for attempt in \$\(seq 1 15\)/);
  assert.match(deployWorkflow, /HTTP_STATUS/);
  assert.match(deployWorkflow, /HTTP_STATUS[\s\S]*== "200"/);
  assert.match(deployWorkflow, /sleep 4/);
  assert.match(deployWorkflow, /HEALTH_FILE/);
});

test('authorized one-time bootstrap can run from a reviewed main push without an interactive browser session', () => {
  assert.match(enrollWorkflow, /push:[\s\S]*branches: \[main\][\s\S]*cpu-runner-enrollment-request\.json/);
  assert.match(enrollWorkflow, /readFileSync\([^\n]*cpu-runner-enrollment-request\.json/);
  assert.match(enrollWorkflow, /GITHUB_EVENT_NAME/);
  assert.match(enrollWorkflow, /I_APPROVE_CPU_NODE_ENROLLMENT/);
});

test('one-time bootstrap request matches the explicitly approved owner and zero-cost CPU scope', () => {
  assert.equal(bootstrapRequest.request_id, 'MNCF-CPU-BOOTSTRAP-20261112-001');
  assert.equal(bootstrapRequest.owner_id, 'github:116122510');
  assert.equal(bootstrapRequest.consent, 'I_APPROVE_CPU_NODE_ENROLLMENT');
  assert.equal(bootstrapRequest.requested_capability, 'cpu-batch');
  assert.equal(bootstrapRequest.task, 'RUNNER_SMOKE');
  assert.equal(bootstrapRequest.max_cost_usd, 0);
  assert.equal(bootstrapRequest.authorization_source, 'explicit_user_confirmation');
});

test('the one-time bootstrap trigger reads only the main-branch authorization request file', () => {
  assert.match(enrollWorkflow, /push:[\\s\\S]*branches: \\[main\\][\\s\\S]*cpu-runner-enrollment-request\\.json/);
  assert.match(enrollWorkflow, /GITHUB_EVENT_NAME === 'push'/);
  assert.match(enrollWorkflow, /BOOTSTRAP_REQUEST_NOT_AUTHORIZED/);
  assert.match(enrollWorkflow, /MNCF-CPU-BOOTSTRAP-20261112-001/);
  assert.match(enrollWorkflow, /readFileSync\\('.github\\/mncf\\/cpu-runner-enrollment-request\\.json'/);
});
