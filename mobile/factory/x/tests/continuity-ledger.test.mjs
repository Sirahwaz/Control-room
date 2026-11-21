import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const actionKey = (taskId, profileId, actionId, operation) => createHash('sha256')
  .update(JSON.stringify({ actionId, operation, profileId, taskId })).digest('hex');

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
const claim = async (ledger,id,token,ttl=90,taskId) => read(await ledger.fetch(post('/v1/tasks/claim',{lease_ttl_seconds:ttl,...(taskId?{task_id:taskId}:{})},nodeHeaders(id,token))));

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
test('concurrent claims for one task grant exactly one live lease across owner nodes', async () => {
  const {storage,ledger}=setup();
  const tokenA=await enroll(ledger,'node-a','owner-a');
  const tokenB=await enroll(ledger,'node-b','owner-a');
  await heartbeat(ledger,'node-a',tokenA);
  await heartbeat(ledger,'node-b',tokenB);
  await enqueue(ledger,task('contended-task'));

  const [claimA,claimB]=await Promise.all([
    claim(ledger,'node-a',tokenA,90,'contended-task'),
    claim(ledger,'node-b',tokenB,90,'contended-task'),
  ]);

  const winners=[claimA,claimB].filter(result => result.body.task !== null);
  assert.equal(winners.length,1,'only one node may acquire the task');
  assert.equal(claimA.status,200);
  assert.equal(claimB.status,200);
  const acquired=winners[0].body.task;
  assert.equal(acquired.task_id,'contended-task');
  assert.equal(acquired.attempt,1);

  const row=storage.db.prepare(
    'SELECT status,attempt,lease_owner,lease_token_hash,lease_expires_at_ms FROM continuity_tasks WHERE task_id=?',
  ).get('contended-task');
  assert.equal(row.status,'RUNNING');
  assert.equal(row.attempt,1);
  assert.equal(row.lease_owner, acquired === claimA.body.task ? 'node-a' : 'node-b');
  assert.ok(row.lease_token_hash);
  assert.ok(row.lease_expires_at_ms > Date.now());

  const loserId=acquired === claimA.body.task ? 'node-b' : 'node-a';
  const loserToken=loserId === 'node-a' ? tokenA : tokenB;
  const rejected=await read(await ledger.fetch(post('/v1/tasks/complete',{
    task_id:'contended-task',lease_token:acquired.lease_token,result:{unexpected:true},
  },nodeHeaders(loserId,loserToken))));
  assert.equal(rejected.status,409);
  assert.equal(storage.db.prepare('SELECT status FROM continuity_tasks WHERE task_id=?').get('contended-task').status,'RUNNING');
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

test('ephemeral dispatch can claim only its requested task without consuming another task', async () => {
  const {storage,ledger}=setup(); const token=await enroll(ledger);
  await heartbeat(ledger,'node-a',token);
  await enqueue(ledger,task('task-first'));
  await enqueue(ledger,task('task-target'));
  const target=await claim(ledger,'node-a',token,90,'task-target');
  assert.equal(target.body.task.task_id,'task-target');
  const first=await claim(ledger,'node-a',token);
  assert.equal(first.body.task.task_id,'task-first');
  storage.close();
});

test('task-specific claim rejects malformed task identifiers', async () => {
  const {storage,ledger}=setup(); const token=await enroll(ledger);
  await heartbeat(ledger,'node-a',token);
  const result=await read(await ledger.fetch(post('/v1/tasks/claim',{
    task_id:'../another-owner',lease_ttl_seconds:90,
  },nodeHeaders('node-a',token))));
  assert.equal(result.status,422);
  assert.equal(result.body.error,'TASK_ID_INVALID');
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
test('lease expiry is exclusive at the exact boundary; stale owner is rejected before reclaim', async () => {
  const {storage,ledger}=setup(); let now=NOW; Date.now=()=>now;
  try {
    const token=await enroll(ledger); await heartbeat(ledger,'node-a',token);
    await enqueue(ledger,task('lease-boundary'));
    const first=await claim(ledger,'node-a',token,15,'lease-boundary');
    assert.equal(first.status,200);
    const expiresAt=Date.parse(first.body.task.lease_expires_at);
    assert.equal(expiresAt,now+15000);

    now=expiresAt;
    const staleComplete=await read(await ledger.fetch(post('/v1/tasks/complete',{
      task_id:'lease-boundary',lease_token:first.body.task.lease_token,result:{stale:true},
    },nodeHeaders('node-a',token))));
    assert.equal(staleComplete.status,409);
    assert.equal(staleComplete.body.error,'LEASE_INVALID_OR_EXPIRED');

    const reclaimed=await claim(ledger,'node-a',token,90,'lease-boundary');
    assert.equal(reclaimed.status,200);
    assert.equal(reclaimed.body.task.attempt,2);
    assert.notEqual(reclaimed.body.task.lease_token,first.body.task.lease_token);
    assert.equal(storage.db.prepare('SELECT status FROM continuity_tasks WHERE task_id=?').get('lease-boundary').status,'RUNNING');
  } finally { Date.now=originalNow; storage.close(); }
});

test('expired lease is reclaimed by exactly one of two eligible workers', async () => {
  const {storage,ledger}=setup(); let now=NOW; Date.now=()=>now;
  try {
    const a=await enroll(ledger,'node-a','owner-a');
    const b=await enroll(ledger,'node-b','owner-a');
    await heartbeat(ledger,'node-a',a);
    await heartbeat(ledger,'node-b',b);
    await enqueue(ledger,task('multi-worker-reclaim'));
    const first=await claim(ledger,'node-a',a,15,'multi-worker-reclaim');
    assert.equal(first.status,200);
    now=Date.parse(first.body.task.lease_expires_at);
    await heartbeat(ledger,'node-a',a);
    await heartbeat(ledger,'node-b',b);

    const [claimA,claimB]=await Promise.all([
      claim(ledger,'node-a',a,90,'multi-worker-reclaim'),
      claim(ledger,'node-b',b,90,'multi-worker-reclaim'),
    ]);
    const winners=[claimA,claimB].filter(x=>x.body.task?.task_id==='multi-worker-reclaim');
    assert.equal(winners.length,1);
    assert.equal(winners[0].body.task.attempt,2);
    assert.notEqual(winners[0].body.task.lease_token,first.body.task.lease_token);
    assert.equal(storage.db.prepare('SELECT status FROM continuity_tasks WHERE task_id=?').get('multi-worker-reclaim').status,'RUNNING');

    const losingNode=claimA.body.task ? 'node-b' : 'node-a';
    const losingToken=claimA.body.task ? b : a;
    const staleFinish=await read(await ledger.fetch(post('/v1/tasks/complete',{
      task_id:'multi-worker-reclaim',lease_token:first.body.task.lease_token,result:{stale:true},
    },nodeHeaders(losingNode,losingToken))));
    assert.equal(staleFinish.status,409);
    assert.equal(storage.db.prepare('SELECT attempt FROM continuity_tasks WHERE task_id=?').get('multi-worker-reclaim').attempt,2);
  } finally { Date.now=originalNow; storage.close(); }
});

test('expired task at max attempts fails closed instead of receiving another lease', async () => {
  const {storage,ledger}=setup(); let now=NOW; Date.now=()=>now;
  try {
    const token=await enroll(ledger); await heartbeat(ledger,'node-a',token);
    await enqueue(ledger,task('max-attempts',{max_attempts:1}));
    const first=await claim(ledger,'node-a',token,15,'max-attempts');
    assert.equal(first.status,200);
    now=Date.parse(first.body.task.lease_expires_at);
    await heartbeat(ledger,'node-a',token);
    const retry=await claim(ledger,'node-a',token,90,'max-attempts');
    assert.equal(retry.status,200);
    assert.equal(retry.body.task,null);
    const row=storage.db.prepare('SELECT status,attempt FROM continuity_tasks WHERE task_id=?').get('max-attempts');
    assert.equal(row.status,'FAILED');
    assert.equal(row.attempt,1);
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


test('workload-scoped pull claims leave unrelated exhausted tasks untouched', async () => {
  const { storage, ledger } = setup();
  try {
    const token = await enroll(ledger, 'cpu-only-node', 'owner-a', ['cpu-batch']);
    await heartbeat(ledger, 'cpu-only-node', token, { capabilities: ['cpu-batch'] });

    await enqueue(ledger, task('webgpu-exhausted', {
      workload: 'WEBGPU_BATCH',
      required_capabilities: ['webgpu-compute'],
      max_attempts: 1,
    }));
    await enqueue(ledger, task('cpu-ready'));
    storage.db.prepare('UPDATE continuity_tasks SET attempt=1 WHERE task_id=?').run('webgpu-exhausted');

    const result = await read(await ledger.fetch(post('/v1/tasks/claim', {
      workload: 'CPU_BATCH',
      lease_ttl_seconds: 90,
    }, nodeHeaders('cpu-only-node', token))));

    assert.equal(result.status, 200);
    assert.equal(result.body.task.task_id, 'cpu-ready');
    assert.equal(
      storage.db.prepare('SELECT status FROM continuity_tasks WHERE task_id=?').get('webgpu-exhausted').status,
      'QUEUED',
      'a CPU-only claim must not fail or otherwise mutate a WebGPU task',
    );
  } finally {
    storage.close();
  }
});

test('claim rejects unsupported workload filters before scanning the queue', async () => {
  const { storage, ledger } = setup();
  try {
    const token = await enroll(ledger);
    const result = await read(await ledger.fetch(post('/v1/tasks/claim', {
      workload: 'ARBITRARY_CODE',
    }, nodeHeaders('node-a', token))));
    assert.equal(result.status, 422);
    assert.equal(result.body.error, 'WORKLOAD_INVALID');
  } finally {
    storage.close();
  }
});



test('reclaimed idempotent task receives its persisted checkpoint with a fresh lease', async () => {
  const { storage, ledger } = setup();
  let now = NOW;
  Date.now = () => now;
  try {
    const token = await enroll(ledger);
    await heartbeat(ledger, 'node-a', token);
    await enqueue(ledger, task('checkpoint-reclaim'));
    const first = await claim(ledger, 'node-a', token, 15, 'checkpoint-reclaim');
    const checkpoint = { stage: 'read-only-inspection', cursor: 7 };
    const saved = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'checkpoint-reclaim',
      lease_token: first.body.task.lease_token,
      checkpoint,
    }, nodeHeaders('node-a', token))));
    assert.equal(saved.status, 200);

    now += 16000;
    await heartbeat(ledger, 'node-a', token);
    const reclaimed = await claim(ledger, 'node-a', token, 90, 'checkpoint-reclaim');
    assert.equal(reclaimed.status, 200);
    assert.equal(reclaimed.body.task.attempt, 2);
    assert.notEqual(reclaimed.body.task.lease_token, first.body.task.lease_token);
    assert.deepEqual(reclaimed.body.task.checkpoint, checkpoint);
  } finally {
    Date.now = originalNow;
    storage.close();
  }
});

test('browser checkpoint binds task and profile, bounds evidence references, and persists only safe metadata', async () => {
  const { storage, ledger } = setup();
  try {
    const token = await enroll(ledger);
    await heartbeat(ledger, 'node-a', token);
    await enqueue(ledger, task('browser-checkpoint', {
      workload: 'BROWSER_SESSION',
      payload: { profile_id: 'profile-a', operation: 'inspect' },
    }));
    const acquired = await claim(ledger, 'node-a', token, 90, 'browser-checkpoint');
    const lease = acquired.body.task.lease_token;
    const checkpoint = {
      taskId: 'browser-checkpoint',
      profileId: 'profile-a',
      state: 'running',
      updatedAt: NOW,
      evidenceRefs: Array.from({ length: 25 }, (_, index) => 'evidence:' + index),
    };
    const saved = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-checkpoint', lease_token: lease, checkpoint,
    }, nodeHeaders('node-a', token))));
    assert.equal(saved.status, 200);
    const persisted = JSON.parse(storage.db.prepare(
      'SELECT checkpoint_json FROM continuity_tasks WHERE task_id=?',
    ).get('browser-checkpoint').checkpoint_json);
    assert.equal(persisted.taskId, 'browser-checkpoint');
    assert.equal(persisted.profileId, 'profile-a');
    assert.equal(persisted.evidenceRefs.length, 20);
    assert.equal(Object.keys(persisted).sort().join(','), 'evidenceRefs,profileId,state,taskId,updatedAt');
  } finally {
    storage.close();
  }
});

test('browser checkpoint rejects a task or profile identity mismatch', async () => {
  const { storage, ledger } = setup();
  try {
    const token = await enroll(ledger);
    await heartbeat(ledger, 'node-a', token);
    await enqueue(ledger, task('browser-checkpoint-mismatch', {
      workload: 'BROWSER_SESSION',
      payload: { profile_id: 'profile-a', operation: 'inspect' },
    }));
    const acquired = await claim(ledger, 'node-a', token, 90, 'browser-checkpoint-mismatch');
    const lease = acquired.body.task.lease_token;
    const result = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-checkpoint-mismatch', lease_token: lease,
      checkpoint: {
        taskId: 'browser-checkpoint-mismatch', profileId: 'profile-b',
        state: 'running', updatedAt: NOW, evidenceRefs: [],
      },
    }, nodeHeaders('node-a', token))));
    assert.equal(result.status, 422);
    assert.equal(result.body.error, 'CHECKPOINT_IDENTITY_MISMATCH');
    assert.equal(storage.db.prepare(
      'SELECT checkpoint_json FROM continuity_tasks WHERE task_id=?',
    ).get('browser-checkpoint-mismatch').checkpoint_json, null);
  } finally {
    storage.close();
  }
});

test('browser checkpoint rejects terminal states, invalid timestamps, and raw evidence URLs', async () => {
  const { storage, ledger } = setup();
  try {
    const token = await enroll(ledger);
    await heartbeat(ledger, 'node-a', token);
    await enqueue(ledger, task('browser-checkpoint-invalid', {
      workload: 'BROWSER_SESSION',
      payload: { profile_id: 'profile-a', operation: 'inspect' },
    }));
    const acquired = await claim(ledger, 'node-a', token, 90, 'browser-checkpoint-invalid');
    const lease = acquired.body.task.lease_token;
    const base = { taskId: 'browser-checkpoint-invalid', profileId: 'profile-a', updatedAt: NOW, evidenceRefs: [] };
    for (const checkpoint of [
      { ...base, state: 'completed' },
      { ...base, state: 'failed' },
      { ...base, state: 'running', updatedAt: 'not-a-timestamp' },
      { ...base, state: 'paused', evidenceRefs: ['https://example.com/private/path'] },
    ]) {
      const result = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
        task_id: 'browser-checkpoint-invalid', lease_token: lease, checkpoint,
      }, nodeHeaders('node-a', token))));
      assert.equal(result.status, 422);
    }
    assert.equal(storage.db.prepare(
      'SELECT checkpoint_json FROM continuity_tasks WHERE task_id=?',
    ).get('browser-checkpoint-invalid').checkpoint_json, null);
  } finally {
    storage.close();
  }
});


test('browser action checkpoint validates task-bound idempotency and stores safe completed result', async () => {
  const { storage, ledger } = setup();
  try {
    const token = await enroll(ledger);
    await heartbeat(ledger, 'node-a', token);
    await enqueue(ledger, task('browser-action-checkpoint', {
      workload: 'BROWSER_SESSION',
      payload: { profile_id: 'profile-a', operator_command: { action: 'inspect', account_id: 'profile-a' } },
    }));
    const acquired = await claim(ledger, 'node-a', token, 90, 'browser-action-checkpoint');
    const lease = acquired.body.task.lease_token;
    const action = {
      actionId: 'action-1',
      idempotencyKey: actionKey('browser-action-checkpoint', 'profile-a', 'action-1', 'inspect'),
      operation: 'inspect',
      status: 'succeeded',
      result: { status: 'INSPECTED', action: 'inspect', title: 'Dashboard' },
    };
    const saved = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-checkpoint', lease_token: lease,
      checkpoint: {
        taskId: 'browser-action-checkpoint', profileId: 'profile-a',
        state: 'running', updatedAt: NOW, evidenceRefs: [], action,
      },
    }, nodeHeaders('node-a', token))));
    assert.equal(saved.status, 200);
    const persisted = JSON.parse(storage.db.prepare(
      'SELECT checkpoint_json FROM continuity_tasks WHERE task_id=?',
    ).get('browser-action-checkpoint').checkpoint_json);
    assert.deepEqual(persisted.action, action);
  } finally {
    storage.close();
  }
});

test('browser action checkpoint rejects a mismatched idempotency key and secret result fields', async () => {
  const { storage, ledger } = setup();
  try {
    const token = await enroll(ledger);
    await heartbeat(ledger, 'node-a', token);
    await enqueue(ledger, task('browser-action-invalid', {
      workload: 'BROWSER_SESSION',
      payload: { profile_id: 'profile-a', operator_command: { action: 'inspect', account_id: 'profile-a' } },
    }));
    const acquired = await claim(ledger, 'node-a', token, 90, 'browser-action-invalid');
    const base = {
      actionId: 'action-1',
      idempotencyKey: '0'.repeat(64),
      operation: 'inspect',
      status: 'succeeded',
      result: { status: 'INSPECTED' },
    };
    const mismatch = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-invalid', lease_token: acquired.body.task.lease_token,
      checkpoint: {
        taskId: 'browser-action-invalid', profileId: 'profile-a',
        state: 'running', updatedAt: NOW, evidenceRefs: [], action: base,
      },
    }, nodeHeaders('node-a', token))));
    assert.equal(mismatch.status, 422);
    assert.equal(mismatch.body.error, 'ACTION_CHECKPOINT_IDEMPOTENCY_KEY_MISMATCH');
    const secret = { ...base, idempotencyKey: actionKey('browser-action-invalid', 'profile-a', 'action-1', 'inspect'), result: { access_token: 'never-store' } };
    const rejected = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-invalid', lease_token: acquired.body.task.lease_token,
      checkpoint: {
        taskId: 'browser-action-invalid', profileId: 'profile-a',
        state: 'running', updatedAt: NOW, evidenceRefs: [], action: secret,
      },
    }, nodeHeaders('node-a', token))));
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, 'SENSITIVE_FIELDS_NOT_ALLOWED');
    const signedUrl = {
      ...base,
      idempotencyKey: actionKey('browser-action-invalid', 'profile-a', 'action-1', 'inspect'),
      result: { status: 'INSPECTED', url: 'https://example.com/?access_token=not-safe' },
    };
    const urlRejected = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-invalid', lease_token: acquired.body.task.lease_token,
      checkpoint: {
        taskId: 'browser-action-invalid', profileId: 'profile-a',
        state: 'running', updatedAt: NOW, evidenceRefs: [], action: signedUrl,
      },
    }, nodeHeaders('node-a', token))));
    assert.equal(urlRejected.status, 422);
    assert.equal(urlRejected.body.error, 'ACTION_CHECKPOINT_RESULT_INVALID');
  } finally {
    storage.close();
  }
});

test('browser action checkpoint cannot change identity or regress after success', async () => {
  const { storage, ledger } = setup();
  try {
    const token = await enroll(ledger);
    await heartbeat(ledger, 'node-a', token);
    await enqueue(ledger, task('browser-action-monotonic', {
      workload: 'BROWSER_SESSION',
      payload: { profile_id: 'profile-a', operator_command: { action: 'inspect', account_id: 'profile-a' } },
    }));
    const acquired = await claim(ledger, 'node-a', token, 90, 'browser-action-monotonic');
    const lease = acquired.body.task.lease_token;
    const makeCheckpoint = action => ({
      taskId: 'browser-action-monotonic', profileId: 'profile-a',
      state: 'running', updatedAt: NOW, evidenceRefs: [], action,
    });
    const running = {
      actionId: 'action-1',
      idempotencyKey: actionKey('browser-action-monotonic', 'profile-a', 'action-1', 'inspect'),
      operation: 'inspect', status: 'running',
    };
    const runningSaved = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-monotonic', lease_token: lease, checkpoint: makeCheckpoint(running),
    }, nodeHeaders('node-a', token))));
    assert.equal(runningSaved.status, 200);
    const succeeded = { ...running, status: 'succeeded', result: { status: 'INSPECTED' } };
    const succeededSaved = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-monotonic', lease_token: lease, checkpoint: makeCheckpoint(succeeded),
    }, nodeHeaders('node-a', token))));
    assert.equal(succeededSaved.status, 200);
    const regressed = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-monotonic', lease_token: lease, checkpoint: makeCheckpoint(running),
    }, nodeHeaders('node-a', token))));
    assert.equal(regressed.status, 409);
    assert.equal(regressed.body.error, 'ACTION_CHECKPOINT_REGRESSION');
    const changed = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-monotonic', lease_token: lease,
      checkpoint: makeCheckpoint({
        ...succeeded,
        actionId: 'action-2',
        idempotencyKey: actionKey('browser-action-monotonic', 'profile-a', 'action-2', 'inspect'),
      }),
    }, nodeHeaders('node-a', token))));
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error, 'ACTION_CHECKPOINT_IDENTITY_CHANGED');
  } finally {
    storage.close();
  }
});


test('browser multi-action checkpoint persists an ordered cursor and rejects regression', async () => {
  const { storage, ledger } = setup();
  try {
    const token = await enroll(ledger);
    await heartbeat(ledger, 'node-a', token);
    await enqueue(ledger, task('browser-action-plan', {
      workload: 'BROWSER_SESSION',
      payload: { profile_id: 'profile-a', action_plan: [
        { action_id: 'step-1', operator_command: { action: 'inspect', account_id: 'profile-a' } },
        { action_id: 'step-2', operator_command: { action: 'status', account_id: 'profile-a' } },
      ] },
    }));
    const acquired = await claim(ledger, 'node-a', token, 90, 'browser-action-plan');
    const lease = acquired.body.task.lease_token;
    const first = {
      actionId: 'step-1',
      idempotencyKey: actionKey('browser-action-plan', 'profile-a', 'step-1', 'inspect'),
      operation: 'inspect', status: 'succeeded', result: { status: 'INSPECTED' },
    };
    const second = {
      actionId: 'step-2',
      idempotencyKey: actionKey('browser-action-plan', 'profile-a', 'step-2', 'status'),
      operation: 'status', status: 'running',
    };
    const makeCheckpoint = (actions, action_cursor) => ({
      taskId: 'browser-action-plan', profileId: 'profile-a',
      state: 'running', updatedAt: NOW, evidenceRefs: [], actions, action_cursor,
    });
    const savedFirst = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-plan', lease_token: lease,
      checkpoint: makeCheckpoint([first, second], 1),
    }, nodeHeaders('node-a', token))));
    assert.equal(savedFirst.status, 200);
    const completedSecond = { ...second, status: 'succeeded', result: { status: 'READY' } };
    const savedSecond = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-plan', lease_token: lease,
      checkpoint: makeCheckpoint([first, completedSecond], 2),
    }, nodeHeaders('node-a', token))));
    assert.equal(savedSecond.status, 200);
    const regressed = await read(await ledger.fetch(post('/v1/tasks/checkpoint', {
      task_id: 'browser-action-plan', lease_token: lease,
      checkpoint: makeCheckpoint([first, second], 1),
    }, nodeHeaders('node-a', token))));
    assert.equal(regressed.status, 409);
    assert.equal(regressed.body.error, 'ACTION_PLAN_CURSOR_REGRESSION');
    const persisted = JSON.parse(storage.db.prepare(
      'SELECT checkpoint_json FROM continuity_tasks WHERE task_id=?',
    ).get('browser-action-plan').checkpoint_json);
    assert.equal(persisted.action_cursor, 2);
    assert.deepEqual(persisted.actions.map(action => action.actionId), ['step-1', 'step-2']);
  } finally {
    storage.close();
  }
});
