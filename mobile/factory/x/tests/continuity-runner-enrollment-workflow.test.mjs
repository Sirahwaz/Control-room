import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../../', import.meta.url);
const enrollWorkflow = readFileSync(new URL('.github/workflows/midad-mncf-enroll-cpu-runner.yml', root), 'utf8');
const runnerWorkflow = readFileSync(new URL('.github/workflows/midad-mncf-ephemeral-runner.yml', root), 'utf8');
const deployWorkflow = readFileSync(new URL('.github/workflows/midad-continuity-cloudflare-deploy.yml', root), 'utf8');
const bootstrapRequest = JSON.parse(readFileSync(new URL('.github/mncf/cpu-runner-enrollment-request.json', root), 'utf8'));

test('CPU runner enrollment is explicitly owner-scoped, consent-gated and protected by the production environment', () => {
  assert.ok(enrollWorkflow.includes('owner_id:'));
  assert.ok(enrollWorkflow.includes('required: true'));
  assert.ok(enrollWorkflow.includes("consent !== 'I_APPROVE_CPU_NODE_ENROLLMENT'"));
  assert.ok(enrollWorkflow.includes("if: github.ref == 'refs/heads/main'"));
  assert.ok(enrollWorkflow.includes('environment: cloudflare-production'));
  assert.ok(enrollWorkflow.includes('MIDAD_LEDGER_ADMIN_KEY: ${{ secrets.MIDAD_LEDGER_ADMIN_KEY }}'));
  assert.ok(enrollWorkflow.includes("ownerId !== 'github:116122510'"));
});

test('CPU runner uses short-lived GitHub OIDC and never calls the repository Secrets API', () => {
  assert.ok(enrollWorkflow.includes("auth_mode: 'github-actions-oidc'"));
  assert.ok(enrollWorkflow.includes("enrolled.authentication !== 'github-actions-oidc'"));
  assert.ok(enrollWorkflow.includes("enrolled.token_delivery !== 'none'"));
  assert.ok(enrollWorkflow.includes("node_auth === 'github-actions-oidc-v1'"));
  assert.equal(enrollWorkflow.includes('/actions/secrets'), false);
  assert.equal(enrollWorkflow.includes('/actions/variables'), false);
  assert.equal(enrollWorkflow.includes('libsodium'), false);
  assert.equal(enrollWorkflow.includes('MIDAD_CONTINUITY_RUNNER_NODE_TOKEN'), false);
  assert.ok(runnerWorkflow.includes('id-token: write'));
  assert.ok(runnerWorkflow.includes('ACTIONS_ID_TOKEN_REQUEST_URL'));
  assert.ok(runnerWorkflow.includes('MIDAD_CONTINUITY_OWNER_ID'));
  assert.equal(runnerWorkflow.includes('MIDAD_CONTINUITY_RUNNER_NODE_TOKEN'), false);
});

test('bootstrap enqueues only a bounded zero-cost CPU smoke task and dispatches the exact runner task', () => {
  assert.ok(enrollWorkflow.includes('node_id: nodeId,'));
  assert.ok(enrollWorkflow.includes('owner_id: ownerId,'));
  assert.ok(enrollWorkflow.includes("capabilities: ['cpu-batch']"));
  assert.ok(enrollWorkflow.includes("payload: { operation: 'RUNNER_SMOKE', input: {} }"));
  assert.ok(enrollWorkflow.includes("workload: 'CPU_BATCH'"));
  assert.ok(enrollWorkflow.includes('max_cost_usd: 0'));
  assert.ok(enrollWorkflow.includes('max_attempts: 1'));
  assert.ok(enrollWorkflow.includes('midad-mncf-ephemeral-runner.yml/dispatches'));
  assert.ok(enrollWorkflow.includes("authentication: 'github-actions-oidc'"));
});

test('Cloudflare Worker deploy runs after a reviewed main merge and validates the OIDC health marker', () => {
  assert.ok(deployWorkflow.includes('  push:'));
  assert.ok(deployWorkflow.includes('branches: [main]'));
  assert.ok(deployWorkflow.includes("if: inputs.operation == 'deploy' || github.event_name == 'push'"));
  assert.ok(deployWorkflow.includes("health.node_auth !== 'github-actions-oidc-v1'"));
  assert.ok(deployWorkflow.includes("health.oidc_subject_policy !== 'legacy-and-immutable-v5-cloudflare-manual-redirect'"));
  assert.ok(deployWorkflow.includes('for attempt in $(seq 1 85)'));
  assert.ok(enrollWorkflow.includes("health?.oidc_subject_policy === 'legacy-and-immutable-v5-cloudflare-manual-redirect'"));
  assert.ok(enrollWorkflow.includes('attempt <= 64'));
  assert.ok(deployWorkflow.includes('DEPLOY_CONFIRMATION'));
  assert.ok(deployWorkflow.includes('for attempt in $(seq 1 85)'));
  assert.ok(deployWorkflow.includes('health.oidc_subject_policy === \'legacy-and-immutable-v5-cloudflare-manual-redirect\''));
});

test('one-time bootstrap request matches the explicitly approved owner and zero-cost CPU scope', () => {
  assert.deepEqual(bootstrapRequest, {
    request_id: 'MNCF-CPU-BOOTSTRAP-20261112-002',
    owner_id: 'github:116122510',
    consent: 'I_APPROVE_CPU_NODE_ENROLLMENT',
    requested_capability: 'cpu-batch',
    task: 'RUNNER_SMOKE',
    max_cost_usd: 0,
    authorization_source: 'explicit_user_confirmation',
    trigger_attempt: 4,
    retry_of_run_id: '43299128578',
    retry_reason: 'github_oidc_replaces_github_secrets_api',
  });
});

test('bootstrap workflow can run only for the main-branch approved request file or explicit manual consent', () => {
  assert.ok(enrollWorkflow.includes('push:'));
  assert.ok(enrollWorkflow.includes('.github/mncf/cpu-runner-enrollment-request.json'));
  assert.ok(enrollWorkflow.includes("process.env.MIDAD_EVENT_NAME === 'push'"));
  assert.ok(enrollWorkflow.includes("request?.request_id !== 'MNCF-CPU-BOOTSTRAP-20261112-002'"));
  assert.ok(enrollWorkflow.includes("request?.retry_of_run_id !== '43299128578'"));
  assert.ok(enrollWorkflow.includes("request?.max_cost_usd !== 0"));
  assert.ok(enrollWorkflow.includes("request?.authorization_source !== 'explicit_user_confirmation'"));
});
