import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MidadContinuityLedger } from '../mobile/factory/x/continuity-ledger/worker.mjs';
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


class LocalLedgerCursor {
  constructor(rows = []) { this.rows = rows; }
  toArray() { return this.rows; }
}

class LocalLedgerStorage {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.sql = {
      exec: (query, ...args) => {
        const read = /\\b(SELECT|RETURNING)\\b/i.test(query);
        if (!args.length && !read) {
          this.db.exec(query);
          return new LocalLedgerCursor();
        }
        const statement = this.db.prepare(query);
        if (read) return new LocalLedgerCursor(statement.all(...args));
        statement.run(...args);
        return new LocalLedgerCursor();
      },
    };
  }
  transactionSync(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.db.close(); }
}

test('end-to-end: GitHub ephemeral runner enrolls against the real Continuity Ledger contract and completes one task', async () => {
  const storage = new LocalLedgerStorage();
  const adminKey = 'local-test-admin-key-for-continuity-integration-001';
  const ledger = new MidadContinuityLedger({ storage }, {
    MIDAD_LEDGER_ADMIN_KEY: adminKey,
  });
  const adminHeaders = {
    authorization: 'Bearer ' + adminKey,
    'content-type': 'application/json',
  };

  try {
    const enrollmentResponse = await ledger.fetch(new Request('https://ledger.test/v1/nodes/enroll', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        node_id: 'midad-github-hosted-runner',
        owner_id: 'owner-123',
        consent_confirmed: true,
        capabilities: [...RUNNER_CAPABILITIES],
      }),
    }));
    assert.equal(enrollmentResponse.status, 201);
    const enrollment = await enrollmentResponse.json();
    assert.equal(enrollment.ok, true);

    const enqueueResponse = await ledger.fetch(new Request('https://ledger.test/v1/tasks/enqueue', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        task_id: 'integration-task-001',
        owner_id: 'owner-123',
        idempotency_key: 'integration:public-probe:001',
        payload: {
          schema: 'midad-public-probe-v1',
          operation: 'GET_EXAMPLE_DOMAIN',
        },
        workload: 'SINGLE',
        required_capabilities: ['midad.public-read-only-probe'],
        min_cpu_cores: 0,
        min_memory_mb: 0,
        units: 1,
        estimated_seconds_per_unit: 15,
        max_cost_usd: 0,
        retry_mode: 'AT_LEAST_ONCE_IDEMPOTENT',
        max_attempts: 3,
      }),
    }));
    assert.equal(enqueueResponse.status, 201);
    assert.equal((await enqueueResponse.json()).state, 'QUEUED');

    const ledgerFetch = async (url, init) => ledger.fetch(new Request(url, init));
    const run = await runContinuityRunner({
      ledgerUrl: 'https://ledger.test',
      nodeId: 'midad-github-hosted-runner',
      ownerId: 'owner-123',
      nodeToken: enrollment.enrollment_token,
    }, {
      fetchImpl: ledgerFetch,
      probeFetch: async (url, options) => {
        assert.equal(String(url), 'https://example.com/');
        assert.equal(options.method, 'GET');
        assert.equal(options.redirect, 'error');
        return new Response('<html>Example Domain</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      },
    });

    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.task_id, 'integration-task-001');
    assert.equal(run.evidence.source_host, 'example.com');
    assert.equal(run.evidence.http_status, 200);
    assert.match(run.evidence.content_sha256, /^[a-f0-9]{64}$/);

    const row = storage.db.prepare(
      'SELECT status,attempt,result_json,checkpoint_json FROM continuity_tasks WHERE task_id=?'
    ).get('integration-task-001');
    assert.equal(row.status, 'COMPLETED');
    assert.equal(row.attempt, 1);
    assert.equal(JSON.parse(row.checkpoint_json).phase, 'PUBLIC_PROBE_STARTED');
    assert.equal(JSON.parse(row.result_json).content_sha256, run.evidence.content_sha256);

    const events = storage.db.prepare(
      'SELECT event_type FROM continuity_events WHERE task_id=? ORDER BY event_id'
    ).all('integration-task-001').map(event => event.event_type);
    assert.deepEqual(events, ['TASK_ENQUEUED', 'TASK_CLAIMED', 'CHECKPOINT_SAVED', 'TASK_COMPLETED']);
  } finally {
    storage.close();
  }
});
