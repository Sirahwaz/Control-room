import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  RUNNER_CAPABILITIES,
  validateRunnerConfig,
  validateClaimedProbeTask,
  executePublicProbe,
  runContinuityRunner,
} from '../compute/mncf/runtime/continuity-github-runner.mjs';

const token = 'a'.repeat(64);
const config = {
  ledgerUrl: 'https://midad-continuity-ledger.example.workers.dev',
  nodeId: 'midad-github-hosted-runner',
  ownerId: 'owner-123',
  nodeToken: token,
};

function task(overrides = {}) {
  return {
    task_id: 'task-123',
    owner_id: 'owner-123',
    workload: 'SINGLE',
    payload: {
      schema: 'midad-public-probe-v1',
      operation: 'GET_EXAMPLE_DOMAIN',
    },
    attempt: 1,
    lease_token: 'b'.repeat(64),
    ...overrides,
  };
}

function mockResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('runner config accepts only HTTPS ledger origins and a 64-hex node token', () => {
  assert.deepEqual(validateRunnerConfig(config), {
    ledgerUrl: config.ledgerUrl,
    nodeId: config.nodeId,
    ownerId: config.ownerId,
    nodeToken: token,
  });
  assert.throws(() => validateRunnerConfig({ ...config, ledgerUrl: 'http://ledger.example' }));
  assert.throws(() => validateRunnerConfig({ ...config, ledgerUrl: 'https://user:pass@ledger.example' }));
  assert.throws(() => validateRunnerConfig({ ...config, nodeToken: 'short-token' }));
  assert.throws(() => validateRunnerConfig({ ...config, nodeId: '../other-node' }));
});

test('runner advertises only its enrolled generic and read-only probe capabilities', () => {
  assert.deepEqual(RUNNER_CAPABILITIES, [
    'generic-execution',
    'midad.public-read-only-probe',
  ]);
});

test('accepts the exact public probe task contract and rejects arbitrary execution payloads', () => {
  assert.equal(validateClaimedProbeTask(task(), 'owner-123').task_id, 'task-123');
  assert.throws(() => validateClaimedProbeTask(task({ owner_id: 'other-owner' }), 'owner-123'));
  assert.throws(() => validateClaimedProbeTask(task({ workload: 'CPU_BATCH' }), 'owner-123'));
  assert.throws(() => validateClaimedProbeTask(task({ payload: { command: 'rm -rf /' } }), 'owner-123'));
  assert.throws(() => validateClaimedProbeTask(task({
    payload: { schema: 'midad-public-probe-v1', operation: 'GET_EXAMPLE_DOMAIN', url: 'https://attacker.test' }
  }), 'owner-123'));
  assert.throws(() => validateClaimedProbeTask(task({ lease_token: 'not-a-lease' }), 'owner-123'));
  assert.throws(() => validateClaimedProbeTask(task({ attempt: 4 }), 'owner-123'));
});

test('public probe uses a fixed HTTPS target, GET-only and no redirects, and returns only bounded evidence', async () => {
  const body = '<html>Example Domain</html>';
  let observed;
  const result = await executePublicProbe({
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(observed.url, 'https://example.com/');
  assert.equal(observed.options.method, 'GET');
  assert.equal(observed.options.redirect, 'error');
  assert.equal(result.http_status, 200);
  assert.equal(result.source_host, 'example.com');
  assert.equal(result.bytes_read, Buffer.byteLength(body));
  assert.equal(result.content_sha256, createHash('sha256').update(body).digest('hex'));
  assert.equal('body' in result, false);
  assert.equal('text' in result, false);
});

test('public probe rejects redirects and non-200 responses', async () => {
  await assert.rejects(() => executePublicProbe({
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }),
  }));
  await assert.rejects(() => executePublicProbe({
    fetchImpl: async () => new Response('unavailable', { status: 503 }),
  }));
});

test('public probe refuses bodies larger than its fixed response budget', async () => {
  const large = 'x'.repeat(70 * 1024);
  await assert.rejects(() => executePublicProbe({
    fetchImpl: async () => new Response(large, { status: 200 }),
  }), /RESPONSE_LIMIT_EXCEEDED/);
});

test('runner heartbeats, claims once, checkpoints and completes the task without exposing its lease token', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ path, body, authorization: init.headers.authorization });
    if (path.endsWith('/heartbeat')) return mockResponse({ ok: true, state: 'READY' });
    if (path.endsWith('/claim')) return mockResponse({ ok: true, task: task() });
    if (path.endsWith('/checkpoint')) return mockResponse({ ok: true, checkpoint_saved: true });
    if (path.endsWith('/complete')) return mockResponse({ ok: true, state: 'COMPLETED' });
    throw new Error('UNEXPECTED_ENDPOINT');
  };
  const result = await runContinuityRunner(config, { fetchImpl });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.task_id, 'task-123');
  assert.deepEqual(calls.map(x => x.path.split('/').at(-1)), ['heartbeat', 'claim', 'checkpoint', 'complete']);
  assert.ok(calls.every(x => x.authorization === `Bearer ${token}`));
  assert.equal(JSON.stringify(result).includes('b'.repeat(64)), false);
  assert.equal(calls.at(-1).body.result.source_host, 'example.com');
});

test('runner returns IDLE without sending completion when there is no eligible task', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path.split('/').at(-1));
    if (path.endsWith('/heartbeat')) return mockResponse({ ok: true, state: 'READY' });
    if (path.endsWith('/claim')) return mockResponse({ ok: true, task: null });
    throw new Error('UNEXPECTED_ENDPOINT');
  };
  const result = await runContinuityRunner(config, { fetchImpl });
  assert.equal(result.status, 'IDLE');
  assert.deepEqual(calls, ['heartbeat', 'claim']);
});

test('runner reports transient read-only probe failures as retryable', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ endpoint: path.split('/').at(-1), body });
    if (path.endsWith('/heartbeat')) return mockResponse({ ok: true, state: 'READY' });
    if (path.endsWith('/claim')) return mockResponse({ ok: true, task: task() });
    if (path.endsWith('/checkpoint')) return mockResponse({ ok: true });
    if (path.endsWith('/fail')) return mockResponse({ ok: true, state: 'QUEUED' });
    throw new Error('NETWORK_UNAVAILABLE');
  };
  const result = await runContinuityRunner(config, {
    fetchImpl,
    probeFetch: async () => { throw new Error('TRANSIENT_NETWORK_FAILURE'); },
  });
  assert.equal(result.status, 'RETRY_QUEUED');
  assert.equal(calls.at(-1).endpoint, 'fail');
  assert.equal(calls.at(-1).body.retryable, true);
  assert.equal(calls.at(-1).body.task_id, 'task-123');
});


test('runner rejects an out-of-contract task without executing it or making it retryable', async () => {
  const calls = [];
  let probeCalled = false;
  const fetchImpl = async (url, init) => {
    const endpoint = new URL(url).pathname.split('/').at(-1);
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ endpoint, body });
    if (endpoint === 'heartbeat') return mockResponse({ ok: true, state: 'READY' });
    if (endpoint === 'claim') return mockResponse({
      ok: true,
      task: task({ payload: { command: 'node -e process.exit(0)' } }),
    });
    if (endpoint === 'fail') return mockResponse({ ok: true, state: 'FAILED' });
    throw new Error('UNEXPECTED_ENDPOINT');
  };
  const result = await runContinuityRunner(config, {
    fetchImpl,
    probeFetch: async () => { probeCalled = true; throw new Error('MUST_NOT_RUN'); },
  });
  assert.equal(result.status, 'REJECTED_TASK');
  assert.equal(probeCalled, false);
  assert.equal(calls.at(-1).endpoint, 'fail');
  assert.equal(calls.at(-1).body.retryable, false);
  assert.equal(calls.at(-1).body.reason, 'TASK_CONTRACT_REJECTED');
});

test('runner bounds Cloudflare ledger responses before JSON parsing', async () => {
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    return new Response('x'.repeat(70 * 1024), { status: 200 });
  };
  await assert.rejects(() => runContinuityRunner(config, { fetchImpl }), /RESPONSE_LIMIT_EXCEEDED/);
  assert.equal(count, 1);
});
