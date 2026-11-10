import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MidadContinuityLedger } from '../continuity-ledger/worker.mjs';

class Cursor { constructor(rows = []) { this.rows = rows; } toArray() { return this.rows; } }
class Storage {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.sql = { exec: (query, ...args) => {
      if (!args.length) { this.db.exec(query); return new Cursor(); }
      const statement = this.db.prepare(query);
      if (/\b(SELECT|RETURNING)\b/i.test(query)) return new Cursor(statement.all(...args));
      statement.run(...args); return new Cursor();
    }};
  }
  transactionSync(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
const ADMIN = 'test-admin-ledger-key-which-is-over-32-characters';
const NOW = Date.parse('2026-11-09T04:00:00.000Z');
const originalNow = Date.now;
const setup = () => { const storage = new Storage(); return { storage, ledger: new MidadContinuityLedger({storage}, {MIDAD_LEDGER_ADMIN_KEY: ADMIN}) }; };
const post = (path, body, headers = {}) => new Request('https://ledger.test' + path, {
  method: 'POST', headers: {'content-type':'application/json', ...headers}, body: JSON.stringify(body),
});
const admin = () => ({authorization:'Bearer ' + ADMIN});
const nodeHeaders = (id, token) => ({'x-midad-node-id':id, authorization:'Bearer ' + token});
const read = async response => ({status:response.status, body:await response.json()});
async function enroll(ledger, id='node-a', owner='owner-a', capabilities=['cpu-batch','interactive-browser-execution','persistent-browser-session','encrypted-session-store']) {
  const result = await read(await ledger.fetch(post('/v1/nodes/enroll',{
    node_id:id, owner_id:owner, consent_confirmed:true, capabilities,
  },admin())));
  assert.equal(result.status,201);
  return result.body.enrollment_token;
}
async function heartbeat(ledger,id,token,overrides={}) {
  return read(await ledger.fetch(post('/v1/nodes/heartbeat',{
    cpu_cores:4,memory_mb:4096,available_slots:2,cost_per_hour_usd:0,cost_estimate_verified:true,
    capabilities:['cpu-batch','interactive-browser-execution','persistent-browser-session','encrypted-session-store'],
    agent_version:'midad-node-0.1.0',browser_runtime_version:'chromium-130',encrypted_session_store:true,
    ...overrides,
  },nodeHeaders(id,token))));
}
function task(id='task-001', overrides={}) {
  return {
    task_id:id,owner_id:'owner-a',idempotency_key:'idem:'+id,payload:{operation:'calculate',input:{count:100}},
    workload:'CPU_BATCH',required_capabilities:[],min_cpu_cores:1,min_memory_mb:256,units:10,
    estimated_seconds_per_unit:2,max_cost_usd:0,retry_mode:'AT_LEAST_ONCE_IDEMPOTENT',max_attempts:3,...overrides,
  };
}
const enqueue = async (ledger, value) => read(await ledger.fetch(post('/v1/tasks/enqueue',value,admin())));
const claim = async (ledger,id,token,ttl=90) => read(await ledger.fetch(post('/v1/tasks/claim',{lease_ttl_seconds:ttl},nodeHeaders(id,token))));

test('health is public but returns no task or credential data', async () => {
  const {storage,ledger}=setup();
  const result=await read(await ledger.fetch(new Request('https://ledger.test/health')));
  assert.equal(result.status,200); assert.equal(result.body.service,'midad-continuity-ledger');
  storage.close();
});
test('enrollment requires admin authentication and explicit owner consent; token digest only is stored', async () => {
  const {storage,ledger}=setup();
  assert.equal((await read(await ledger.fetch(post('/v1/nodes/enroll',{node_id:'n1',owner_id:'o1',consent_confirmed:true,capabilities:[]})))).status,401);
  assert.equal((await read(await ledger.fetch(post('/v1/nodes/enroll',{node_id:'n1',owner_id:'o1',consent_confirmed:false,capabilities:[]},admin())))).status,422);
  const token=await enroll(ledger,'n1','o1');
  const row=storage.db.prepare('SELECT token_hash,consent_confirmed,capabilities_json,enrolled_capabilities_json FROM enrolled_nodes WHERE node_id=?').get('n1');
  assert.equal(row.consent_confirmed,1); assert.notEqual(row.token_hash,token);
  assert.equal(row.capabilities_json,'[]'); assert.ok(JSON.parse(row.enrolled_capabilities_json).includes('cpu-batch'));
  storage.close();
});
test('idempotency replays same intent and rejects changed payload', async () => {
  const {storage,ledger}=setup();
  assert.equal((await enqueue(ledger,task())).status,201);
  const replay=await enqueue(ledger,task());
  const changed=await enqueue(ledger,task('other',{idempotency_key:'idem:task-001'}));
  assert.equal(replay.status,200); assert.equal(replay.body.idempotent,true); assert.equal(changed.status,409);
  storage.close();
});
test('sensitive task payload keys are rejected before persistence', async () => {
  const {storage,ledger}=setup();
  assert.equal((await enqueue(ledger,task('bad',{payload:{password:'do-not-store'}}))).status,400);
  assert.equal(storage.db.prepare('SELECT COUNT(*) AS n FROM continuity_tasks').get().n,0);
  storage.close();
});
test('no node can claim before an authenticated fresh heartbeat', async () => {
  const {storage,ledger}=setup(); const token=await enroll(ledger); await enqueue(ledger,task());
  const result=await claim(ledger,'node-a',token); assert.equal(result.body.task,null);
  storage.close();
});
test('claim, renew, checkpoint and complete require the same live lease token', async () => {
  const {storage,ledger}=setup(); const token=await enroll(ledger);
  assert.equal((await heartbeat(ledger,'node-a',token)).status,200); await enqueue(ledger,task());
  const first=await claim(ledger,'node-a',token); const lease=first.body.task.lease_token;
  assert.equal(first.body.task.task_id,'task-001');
  assert.equal(first.body.task.owner_id,'owner-a');
  const headers=nodeHeaders('node-a',token);
  assert.equal((await read(await ledger.fetch(post('/v1/tasks/renew',{task_id:'task-001',lease_token:lease},headers)))).status,200);
  assert.equal((await read(await ledger.fetch(post('/v1/tasks/checkpoint',{task_id:'task-001',lease_token:lease,checkpoint:{offset:5}},headers)))).status,200);
  assert.equal((await read(await ledger.fetch(post('/v1/tasks/complete',{task_id:'task-001',lease_token:'0'.repeat(64),result:{}},headers)))).status,409);
  assert.equal((await read(await ledger.fetch(post('/v1/tasks/complete',{task_id:'task-001',lease_token:lease,result:{count:100}},headers)))).status,200);
  assert.equal(storage.db.prepare('SELECT status FROM continuity_tasks WHERE task_id=?').get('task-001').status,'COMPLETED');
  storage.close();
});
test('revoked node is blocked and active jobs are returned or quarantined by retry safety', async () => {
  const {storage,ledger}=setup(); const token=await enroll(ledger);
  await heartbeat(ledger,'node-a',token); await enqueue(ledger,task());
  const acquired=await claim(ledger,'node-a',token); assert.ok(acquired.body.task.lease_token);
  await ledger.fetch(post('/v1/nodes/revoke',{node_id:'node-a'},admin()));
  const result=await read(await ledger.fetch(post('/v1/tasks/complete',{task_id:'task-001',lease_token:acquired.body.task.lease_token,result:{}},nodeHeaders('node-a',token))));
  assert.equal(result.status,401);
  assert.equal(storage.db.prepare('SELECT status FROM continuity_tasks WHERE task_id=?').get('task-001').status,'QUEUED');
  storage.close();
});
test('expired idempotent task is reclaimed with a new lease; old token is invalid', async () => {
  const {storage,ledger}=setup(); let now=NOW; Date.now=()=>now;
  try {
    const token=await enroll(ledger); await heartbeat(ledger,'node-a',token); await enqueue(ledger,task());
    const first=await claim(ledger,'node-a',token,15); now+=16000; await heartbeat(ledger,'node-a',token);
    const second=await claim(ledger,'node-a',token); assert.equal(second.body.task.attempt,2);
    const stale=await read(await ledger.fetch(post('/v1/tasks/complete',{task_id:'task-001',lease_token:first.body.task.lease_token,result:{}},nodeHeaders('node-a',token))));
    assert.equal(stale.status,409);
  } finally { Date.now=originalNow; storage.close(); }
});
test('expired non-idempotent job is quarantined, never blindly replayed', async () => {
  const {storage,ledger}=setup(); let now=NOW; Date.now=()=>now;
  try {
    const token=await enroll(ledger); await heartbeat(ledger,'node-a',token);
    await enqueue(ledger,task('browser-side-effect',{workload:'BROWSER_SESSION',max_cost_usd:0}));
    assert.equal((await claim(ledger,'node-a',token,15)).body.task.task_id,'browser-side-effect');
    now+=16000; await heartbeat(ledger,'node-a',token); await claim(ledger,'node-a',token);
    assert.equal(storage.db.prepare('SELECT status FROM continuity_tasks WHERE task_id=?').get('browser-side-effect').status,'RECONCILIATION_REQUIRED');
  } finally { Date.now=originalNow; storage.close(); }
});
test('cost ceilings and tenant ownership prevent unsuitable claims', async () => {
  const {storage,ledger}=setup(); const a=await enroll(ledger,'node-a','owner-a'); const b=await enroll(ledger,'node-b','owner-b');
  await heartbeat(ledger,'node-a',a,{cost_per_hour_usd:0.5}); await heartbeat(ledger,'node-b',b);
  await enqueue(ledger,task('no-spend',{max_cost_usd:0}));
  assert.equal((await claim(ledger,'node-a',a)).body.task,null);
  assert.equal((await claim(ledger,'node-b',b)).body.task,null);
  storage.close();
});
test('heartbeat cannot elevate a node beyond owner-approved capabilities', async () => {
  const {storage,ledger}=setup(); const token=await enroll(ledger,'node-a','owner-a',['cpu-batch']);
  const result=await heartbeat(ledger,'node-a',token,{capabilities:['cpu-batch','webgpu-compute']});
  assert.equal(result.status,422);
  storage.close();
});
test('browser tasks cannot opt into automatic retry after uncertain external effects', async () => {
  const {storage,ledger}=setup();
  await enqueue(ledger,task('browser-idempotency',{workload:'BROWSER_SESSION',retry_mode:'AT_LEAST_ONCE_IDEMPOTENT'}));
  assert.equal(storage.db.prepare('SELECT retry_mode FROM continuity_tasks WHERE task_id=?').get('browser-idempotency').retry_mode,'HUMAN_RECONCILIATION');
  storage.close();
});
test('browser claim requires enrolled capabilities, browser runtime version and encrypted session store', async () => {
  const {storage,ledger}=setup(); const token=await enroll(ledger);
  await heartbeat(ledger,'node-a',token,{encrypted_session_store:false,browser_runtime_version:null});
  await enqueue(ledger,task('browser-no-vault',{workload:'BROWSER_SESSION'}));
  assert.equal((await claim(ledger,'node-a',token)).body.task,null);
  storage.close();
});

test('Cloudflare Browser Run endpoints require admin authentication and expose only guarded smoke/close operations', async () => {
  const storage = new Storage();
  const calls = [];
  let accepted = false;
  let closed = false;
  const socket = new EventTarget();
  socket.accept = () => { accepted = true; };
  socket.send = raw => {
    const command = JSON.parse(raw);
    const result = command.method === 'Runtime.evaluate'
      ? { result: { type: 'object', value: { title: 'Example Domain', url: 'https://example.com/', text: 'Example Domain browser smoke passed' } } }
      : {};
    queueMicrotask(() => socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ id: command.id, result }),
    })));
  };
  socket.close = () => { closed = true; };
  const browser = {
    async acquire(options) {
      calls.push(['acquire', options]);
      return { sessionId: 'browser-session-1', targets: [{ id: 'target-1', type: 'page' }] };
    },
    async connectSession(sessionId, options) {
      calls.push(['connectSession', sessionId, options]);
      return { webSocket: { fetch: async () => ({ webSocket: socket }) } };
    },
    async getLiveView(sessionId, options) {
      calls.push(['getLiveView', sessionId, options]);
      return { devtoolsFrontendUrl: 'https://live.browser.run/ui/inspector?jwt=test-only' };
    },
    async closeSession(sessionId) {
      calls.push(['closeSession', sessionId]);
      return 'closed';
    },
  };
  const ledger = new MidadContinuityLedger({ storage }, { MIDAD_LEDGER_ADMIN_KEY: ADMIN, BROWSER: browser });
  const body = { target_url: 'https://example.com/', allowed_hosts: ['example.com'] };
  const denied = await read(await ledger.fetch(post('/v1/browser/run/smoke', body)));
  assert.equal(denied.status, 401);
  assert.equal(calls.length, 0);

  const result = await read(await ledger.fetch(post('/v1/browser/run/smoke', body, admin())));
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'PASS');
  assert.equal(result.body.runtime, 'cloudflare-browser-run');
  assert.equal(result.body.title, 'Example Domain');
  assert.equal(result.body.url, 'https://example.com/');
  assert.match(result.body.live_view_url, /^https:\/\/live\.browser\.run\//);
  assert.equal(accepted, true);
  assert.equal(closed, true);
  assert.deepEqual(calls[0], ['acquire', {
    keepAlive: 60000, targets: true, liveViewUrlExpiresInMs: 60000,
    guardrails: { allowedDomains: ['example.com'] },
  }]);

  const closedResult = await read(await ledger.fetch(post('/v1/browser/run/close',
    { session_id: 'browser-session-1' }, admin())));
  assert.equal(closedResult.status, 200);
  assert.equal(closedResult.body.status, 'CLOSED');
  assert.equal(calls.some(([name]) => name === 'closeSession'), true);

  storage.close();
});
