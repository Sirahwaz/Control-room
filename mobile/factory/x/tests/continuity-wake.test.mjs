import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import wakeWorker, { MidadContinuityLedger } from '../continuity-ledger/worker.mjs';

class Cursor {
  constructor(rows = []) { this.rows = rows; }
  toArray() { return this.rows; }
}
class Storage {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.alarms = [];
    this.sql = { exec: (query, ...args) => {
      if (!args.length) { this.db.exec(query); return new Cursor(); }
      const statement = this.db.prepare(query);
      if (/\b(SELECT|RETURNING)\b/i.test(query)) return new Cursor(statement.all(...args));
      statement.run(...args);
      return new Cursor();
    }};
  }
  transactionSync(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async setAlarm(at) { this.alarms.push(Number(at)); }
  close() { this.db.close(); }
}
class Context {
  constructor(storage = new Storage()) {
    this.storage = storage;
    this.sockets = [];
  }
  acceptWebSocket(socket, tags = []) {
    this.sockets.push({ socket, tags });
  }
  getWebSockets(tag) {
    return this.sockets.filter(entry => entry.tags.includes(tag)).map(entry => entry.socket);
  }
}
class Socket {
  constructor() { this.sent = []; this.closed = []; }
  send(value) { this.sent.push(value); }
  close(code, reason) { this.closed.push({ code, reason }); }
  serializeAttachment(value) { this.attachment = value; }
}
const ADMIN = 'test-admin-ledger-key-which-is-over-32-characters';
const WAKE_KEY = 'test-internal-wake-key-which-is-over-32-characters';
const setup = (overrides = {}) => {
  const storage = new Storage();
  const ctx = new Context(storage);
  const env = { MIDAD_LEDGER_ADMIN_KEY: ADMIN, MIDAD_WAKE_INTERNAL_KEY: WAKE_KEY, ...overrides };
  return { storage, ctx, env, ledger: new MidadContinuityLedger(ctx, env) };
};
const post = (path, body, headers = {}) => new Request('https://ledger.test' + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const admin = () => ({ authorization: 'Bearer ' + ADMIN });
const read = async response => ({ status: response.status, body: await response.json() });
const task = (id = 'wake-task-001') => ({
  task_id: id, owner_id: 'owner-a', idempotency_key: 'idem:' + id,
  payload: { operation: 'compute', input: { count: 12 } }, workload: 'CPU_BATCH',
  required_capabilities: [], min_cpu_cores: 0, min_memory_mb: 0, units: 1,
  estimated_seconds_per_unit: 1, max_cost_usd: 0, retry_mode: 'AT_LEAST_ONCE_IDEMPOTENT',
});
const wake = (overrides = {}) => ({
  v: 1, event_id: 'evt-000001', task_id: 'wake-task-001', owner_id: 'owner-a', ...overrides,
});

test('enqueue writes a durable wake outbox entry and alarm publishes it exactly once after confirmation', async () => {
  const queue = { messages: [], async send(message) { this.messages.push(message); } };
  const { storage, ledger, ctx } = setup({ CONTINUITY_WAKE_QUEUE: queue });
  const created = await read(await ledger.fetch(post('/v1/tasks/enqueue', task(), admin())));
  assert.equal(created.status, 201);
  assert.equal(ctx.storage.alarms.length, 1);

  const pending = storage.db.prepare('SELECT event_id,task_id,owner_id,published_at_ms FROM continuity_wake_outbox').get();
  assert.equal(pending.task_id, 'wake-task-001');
  assert.equal(pending.owner_id, 'owner-a');
  assert.equal(pending.published_at_ms, null);

  await ledger.alarm();
  assert.equal(queue.messages.length, 1);
  assert.deepEqual(queue.messages[0], {
    v: 1, event_id: pending.event_id, task_id: 'wake-task-001', owner_id: 'owner-a',
  });
  assert.ok(storage.db.prepare('SELECT published_at_ms FROM continuity_wake_outbox').get().published_at_ms);

  await ledger.alarm();
  assert.equal(queue.messages.length, 1, 'published events are not sent again on the next alarm');
  storage.close();
});

test('pull-only fallback does not accumulate wake outbox rows when Queue is not configured', async () => {
  const { storage, ledger, ctx } = setup();
  const created = await read(await ledger.fetch(post('/v1/tasks/enqueue', task(), admin())));
  assert.equal(created.status, 201);
  assert.equal(storage.db.prepare('SELECT COUNT(*) AS n FROM continuity_wake_outbox').get().n, 0);
  assert.equal(ctx.storage.alarms.length, 0);
  storage.close();
});

test('a failed Queue send leaves the outbox pending and schedules a retry', async () => {
  const queue = { async send() { throw new Error('temporary queue outage'); } };
  const { storage, ledger, ctx } = setup({ CONTINUITY_WAKE_QUEUE: queue });
  await ledger.fetch(post('/v1/tasks/enqueue', task(), admin()));
  await assert.rejects(() => ledger.alarm(), /temporary queue outage/);
  assert.equal(storage.db.prepare('SELECT published_at_ms FROM continuity_wake_outbox').get().published_at_ms, null);
  assert.ok(ctx.storage.alarms.length >= 2);
  storage.close();
});

test('wake broadcast is owner-scoped and contains no task payload', async () => {
  const { storage, ctx, ledger } = setup();
  const ownerSocket = new Socket();
  const otherOwnerSocket = new Socket();
  ctx.acceptWebSocket(ownerSocket, ['owner:owner-a', 'node:node-a']);
  ctx.acceptWebSocket(otherOwnerSocket, ['owner:owner-b', 'node:node-b']);

  const result = await read(await ledger.broadcastWake(wake()));
  assert.equal(result.body.delivered, 1);
  assert.equal(ownerSocket.sent.length, 1);
  assert.equal(otherOwnerSocket.sent.length, 0);
  assert.deepEqual(JSON.parse(ownerSocket.sent[0]), {
    type: 'TASK_AVAILABLE', v: 1, event_id: 'evt-000001',
    task_id: 'wake-task-001', owner_id: 'owner-a',
    wake_only: true, pull_claim_required: true,
  });
  storage.close();
});

test('internal wake endpoint rejects public callers without the dedicated wake key', async () => {
  const { storage, ledger } = setup();
  const denied = await read(await ledger.fetch(post('/internal/wake', wake())));
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error, 'WAKE_INTERNAL_AUTH_REQUIRED');
  const allowed = await read(await ledger.fetch(post('/internal/wake', wake(), {
    'x-midad-wake-key': WAKE_KEY,
  })));
  assert.equal(allowed.status, 200);
  storage.close();
});

test('re-enrollment closes a wake socket tied to the previous node credential', async () => {
  const { storage, ctx, ledger } = setup();
  const socket = new Socket();
  ctx.acceptWebSocket(socket, ['owner:owner-a', 'node:node-a']);
  const enrolled = await read(await ledger.fetch(post('/v1/nodes/enroll', {
    node_id: 'node-a', owner_id: 'owner-a', consent_confirmed: true, capabilities: ['cpu-batch'],
  }, admin())));
  assert.equal(enrolled.status, 201);
  assert.deepEqual(socket.closed, [{ code: 1008, reason: 'node re-enrolled' }]);
  storage.close();
});

test('node revocation closes that node wake sockets immediately', async () => {
  const { storage, ctx, ledger } = setup();
  const socket = new Socket();
  ctx.acceptWebSocket(socket, ['owner:owner-a', 'node:node-a']);
  const result = await read(await ledger.fetch(post('/v1/nodes/revoke', { node_id: 'node-a' }, admin())));
  assert.equal(result.status, 200);
  assert.deepEqual(socket.closed, [{ code: 1008, reason: 'node revoked' }]);
  storage.close();
});

test('Queue consumer forwards validated wake hints to the Durable Object and acknowledges success', async () => {
  const seen = [];
  const acknowledgements = [];
  const ns = {
    idFromName(name) { return name; },
    get(id) {
      return { async fetch(request) {
        seen.push({ id, request, body: await request.json() });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }};
    },
  };
  const message = {
    body: wake(),
    ack() { acknowledgements.push('ack'); },
    retry() { acknowledgements.push('retry'); },
  };
  const result = await wakeWorker.queue({ messages: [message] }, {
    CONTINUITY_LEDGER: ns, MIDAD_WAKE_INTERNAL_KEY: WAKE_KEY,
  });
  assert.equal(result.delivered, 1);
  assert.deepEqual(acknowledgements, ['ack']);
  assert.equal(seen[0].request.url, 'https://ledger.internal/internal/wake');
  assert.equal(seen[0].request.headers.get('x-midad-wake-key'), WAKE_KEY);
  assert.deepEqual(seen[0].body, wake());
});

test('Queue consumer retries malformed and transiently failed messages', async () => {
  const actions = [];
  const messages = [
    { body: { ...wake(), owner_id: '../invalid' }, ack() { actions.push('bad-ack'); }, retry() { actions.push('bad-retry'); } },
    { body: wake(), ack() { actions.push('retry-ack'); }, retry() { actions.push('retry-retry'); } },
  ];
  const ns = {
    idFromName(name) { return name; },
    get() { return { async fetch() { return new Response('unavailable', { status: 503 }); } }; },
  };
  const result = await wakeWorker.queue({ messages }, {
    CONTINUITY_LEDGER: ns, MIDAD_WAKE_INTERNAL_KEY: WAKE_KEY,
  });
  assert.equal(result.retried, 2);
  assert.deepEqual(actions, ['bad-retry', 'retry-retry']);
});
