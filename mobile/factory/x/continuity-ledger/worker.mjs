import { closeBrowserRunSession, runBrowserRunSmoke } from './browser-run-runtime.mjs';
import { dispatchGitHubWorkflow } from './github-dispatch.mjs';
import { initVaultSchema, handleVaultAdmin, handleVaultNode } from './vault-service.mjs';
import { GITHUB_ACTIONS_OIDC_POLICY, verifyGitHubActionsOidcToken } from './github-oidc.mjs';

const WORKLOADS = new Set(['CPU_BATCH', 'WEBGPU_BATCH', 'BROWSER_SESSION', 'SINGLE']);
const SECRET_KEY = /(?:secret|token|password|private[_-]?key|mnemonic|seed|authorization|cookie)/i;
const SECRET_VALUE_PATTERNS = [
  /\b(?:sk-or-|sk-)[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonNegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
function randomHex(size = 32) {
  return [...crypto.getRandomValues(new Uint8Array(size))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function containsSensitive(value, depth = 0) {
  if (depth > 12) return true;
  if (Array.isArray(value)) return value.some(item => containsSensitive(item, depth + 1));
  if (typeof value === 'string') return SECRET_VALUE_PATTERNS.some(pattern => pattern.test(value));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => SECRET_KEY.test(key) || containsSensitive(child, depth + 1));
}
function requiredCapabilities(task) {
  const workload = {
    CPU_BATCH: ['cpu-batch'],
    WEBGPU_BATCH: ['webgpu-compute'],
    BROWSER_SESSION: ['interactive-browser-execution', 'persistent-browser-session', 'encrypted-session-store'],
    SINGLE: ['generic-execution'],
  }[task.workload];
  return [...new Set([...workload, ...task.required_capabilities])];
}
function rows(cursor) {
  return cursor && typeof cursor.toArray === 'function' ? cursor.toArray() : [];
}
function normalizeWakeEvent(value) {
  if (!isRecord(value) || value.v !== 1 || !validId(value.event_id) ||
      !validId(value.task_id) || !validId(value.owner_id)) {
    throw new Error('INVALID_WAKE_EVENT');
  }
  return { v: 1, event_id: value.event_id, task_id: value.task_id, owner_id: value.owner_id };
}

export class MidadContinuityLedger {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS enrolled_nodes (
        node_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, token_hash TEXT NOT NULL,
        consent_confirmed INTEGER NOT NULL CHECK(consent_confirmed=1),
        state TEXT NOT NULL, enrolled_capabilities_json TEXT NOT NULL, capabilities_json TEXT NOT NULL,
        agent_version TEXT, browser_runtime_version TEXT,
        cpu_cores REAL NOT NULL DEFAULT 0, memory_mb INTEGER NOT NULL DEFAULT 0,
        available_slots INTEGER NOT NULL DEFAULT 0, cost_per_hour_usd REAL NOT NULL DEFAULT 0,
        cost_verified INTEGER NOT NULL DEFAULT 0, encrypted_session_store INTEGER NOT NULL DEFAULT 0,
        heartbeat_at_ms INTEGER, revoked_at_ms INTEGER, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS continuity_tasks (
        task_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL, workload TEXT NOT NULL,
        required_capabilities_json TEXT NOT NULL, min_cpu_cores REAL NOT NULL, min_memory_mb INTEGER NOT NULL,
        units INTEGER NOT NULL, estimated_seconds_per_unit REAL NOT NULL, max_cost_usd REAL NOT NULL,
        retry_mode TEXT NOT NULL, max_attempts INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL, available_at_ms INTEGER NOT NULL, lease_owner TEXT,
        lease_token_hash TEXT, lease_expires_at_ms INTEGER, checkpoint_json TEXT, result_json TEXT,
        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS continuity_tasks_claim_idx
        ON continuity_tasks(owner_id,status,available_at_ms,lease_expires_at_ms,created_at_ms);
      CREATE TABLE IF NOT EXISTS continuity_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, event_type TEXT NOT NULL,
        actor_id TEXT NOT NULL, event_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS continuity_events_task_idx ON continuity_events(task_id,event_id);
      CREATE TABLE IF NOT EXISTS continuity_wake_outbox (
        event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, owner_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL, published_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS continuity_wake_outbox_pending_idx
        ON continuity_wake_outbox(published_at_ms,created_at_ms);
    `);
    initVaultSchema(this);
  }
  query(sql, ...args) { return rows(this.sql.exec(sql, ...args)); }
  one(sql, ...args) { return this.query(sql, ...args)[0] ?? null; }
  exec(sql, ...args) { return this.sql.exec(sql, ...args); }
  tx(fn) { return this.ctx.storage.transactionSync(fn); }
  event(taskId, type, actor, data = {}) {
    this.exec('INSERT INTO continuity_events(task_id,event_type,actor_id,event_json,created_at_ms) VALUES(?,?,?,?,?)',
      taskId, type, actor, JSON.stringify(data), Date.now());
  }
  async adminAuth(req) {
    const expected = this.env.MIDAD_LEDGER_ADMIN_KEY;
    const supplied = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (typeof expected !== 'string' || expected.length < 32 || supplied.length < 32) return false;
    return constantTimeEqual(await sha256(supplied), await sha256(expected));
  }
  async nodeAuth(req) {
    const nodeId = req.headers.get('x-midad-node-id') || '';
    const supplied = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!validId(nodeId) || supplied.length < 32) return null;
    const node = this.one('SELECT * FROM enrolled_nodes WHERE node_id=? AND revoked_at_ms IS NULL AND consent_confirmed=1', nodeId);
    if (!node) return null;

    // Existing owner-enrolled nodes keep their established one-time bearer token.
    // The dedicated Actions CPU node is OIDC-only and never accepts the legacy bearer path.
    if (node.node_id !== GITHUB_ACTIONS_OIDC_POLICY.nodeId &&
        constantTimeEqual(await sha256(supplied), node.token_hash)) return node;

    // GitHub OIDC is deliberately limited to the dedicated, CPU-only Actions node.
    if (node.node_id !== GITHUB_ACTIONS_OIDC_POLICY.nodeId ||
        node.owner_id !== GITHUB_ACTIONS_OIDC_POLICY.ownerId ||
        JSON.stringify(JSON.parse(node.enrolled_capabilities_json || '[]')) !== JSON.stringify([GITHUB_ACTIONS_OIDC_POLICY.capability])) {
      return null;
    }
    try {
      const claims = await verifyGitHubActionsOidcToken(supplied);
      if (node.owner_id !== 'github:' + String(claims.repository_owner_id)) return null;
      return node;
    } catch {
      return null;
    }
  }
  async body(req) {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 65536) throw new Error('BODY_TOO_LARGE');
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error('INVALID_JSON'); }
    if (!isRecord(value)) throw new Error('JSON_OBJECT_REQUIRED');
    for (const key of ['payload', 'checkpoint', 'result']) {
      if (isRecord(value[key]) && containsSensitive(value[key])) throw new Error('SENSITIVE_FIELDS_NOT_ALLOWED');
    }
    return value;
  }
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/health') {
      return response(200, {
        ok: true, service: 'midad-continuity-ledger', schema: 2,
        dispatch: this.env.CONTINUITY_WAKE_QUEUE ? 'queue-websocket-wake-with-pull-claim' : 'pull-claim-fallback',
        github_actions_dispatch: [this.env.MIDAD_GITHUB_APP_ID,this.env.MIDAD_GITHUB_INSTALLATION_ID,this.env.MIDAD_GITHUB_APP_PRIVATE_KEY].every(value => typeof value === 'string' && value.length > 0) ? 'configured' : 'not_configured',
        node_auth: 'github-actions-oidc-v1',
      });
    }
    if (req.method === 'GET' && path === '/v1/nodes/wake') {
      const node = await this.nodeAuth(req);
      if (!node) return response(401, { ok: false, error: 'ENROLLED_NODE_AUTH_REQUIRED' });
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return response(426, { ok: false, error: 'WEBSOCKET_UPGRADE_REQUIRED' });
      }
      if (node.state !== 'READY' || !node.heartbeat_at_ms || Date.now() - node.heartbeat_at_ms > 45000 || node.cost_verified !== 1) {
        return response(409, { ok: false, error: 'FRESH_READY_HEARTBEAT_REQUIRED' });
      }
      if (typeof WebSocketPair !== 'function' || typeof this.ctx.acceptWebSocket !== 'function') {
        return response(501, { ok: false, error: 'WEBSOCKET_RUNTIME_UNAVAILABLE' });
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [`owner:${node.owner_id}`, `node:${node.node_id}`]);
      pair[1].serializeAttachment?.({ owner_id: node.owner_id, node_id: node.node_id });
      pair[1].send(JSON.stringify({ type: 'SYNC_REQUIRED', v: 1, owner_id: node.owner_id, pull_claim_required: true }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (req.method !== 'POST') return response(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    let body;
    try { body = await this.body(req); }
    catch (error) { return response(error.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: error.message }); }

    if (path === '/internal/wake') {
      const expected = this.env.MIDAD_WAKE_INTERNAL_KEY;
      const supplied = req.headers.get('x-midad-wake-key') || '';
      if (typeof expected !== 'string' || expected.length < 32 || supplied.length < 32 ||
          !constantTimeEqual(await sha256(supplied), await sha256(expected))) {
        return response(401, { ok: false, error: 'WAKE_INTERNAL_AUTH_REQUIRED' });
      }
      let event;
      try { event = normalizeWakeEvent(body); }
      catch { return response(422, { ok: false, error: 'WAKE_EVENT_INVALID' }); }
      const persisted = this.one(
        'SELECT event_id FROM continuity_wake_outbox WHERE event_id=? AND task_id=? AND owner_id=?',
        event.event_id, event.task_id, event.owner_id
      );
      if (!persisted) return response(404, { ok: false, error: 'WAKE_EVENT_NOT_FOUND' });
      const task = this.one('SELECT workload,status FROM continuity_tasks WHERE task_id=? AND owner_id=?', event.task_id, event.owner_id);
      if (!task) return response(404, { ok: false, error: 'WAKE_TASK_NOT_FOUND' });
      const broadcast = await this.broadcastWake(event);
      const broadcastBody = await broadcast.json();
      return response(200, {
        ok: true,
        event_id: event.event_id,
        delivered: broadcastBody.delivered,
        delivery: broadcastBody.delivery,
        workload: task.workload,
        runner_dispatchable: task.status === 'QUEUED' && task.workload === 'CPU_BATCH',
      });
    }
    if (path.startsWith('/v1/vault/secrets/')) return handleVaultAdmin(this, path, req, body);
    if (['/v1/nodes/enroll', '/v1/nodes/revoke', '/v1/tasks/enqueue'].includes(path)) {
      if (!await this.adminAuth(req)) return response(401, { ok: false, error: 'ADMIN_AUTH_REQUIRED' });
      if (path === '/v1/nodes/enroll') return this.enroll(body);
      if (path === '/v1/nodes/revoke') return this.revoke(body);
      return this.enqueue(body);
    }
    if (path === '/v1/browser/run/smoke' || path === '/v1/browser/run/close') {
      if (!await this.adminAuth(req)) return response(401, { ok: false, error: 'ADMIN_AUTH_REQUIRED' });
      if (!this.env.BROWSER) return response(503, { ok: false, error: 'BROWSER_RUN_BINDING_MISSING' });
      if (path === '/v1/browser/run/smoke') {
        try {
          const result = await runBrowserRunSmoke({
            browserBinding: this.env.BROWSER,
            targetUrl: typeof body.target_url === 'string' ? body.target_url.slice(0, 2048) : '',
            allowedHosts: Array.isArray(body.allowed_hosts) ? body.allowed_hosts : [],
          });
          return response(200, { ok: true, ...result });
        } catch (error) {
          const code = String(error?.message || 'BROWSER_RUN_FAILED').slice(0, 200);
          const invalidInput = /^(TARGET_URL_INVALID|HTTPS_REQUIRED|URL_CREDENTIALS_FORBIDDEN|HTTPS_PORT_NOT_ALLOWED|ALLOWED_HOSTS_REQUIRED|ALLOWED_HOST_INVALID|HOST_NOT_ALLOWLISTED|PUBLIC_HOST_REQUIRED|BROWSER_REDIRECT_HOST_NOT_ALLOWLISTED)$/.test(code);
          return response(invalidInput ? 422 : 502, { ok: false, error: code });
        }
      }
      try {
        const result = await closeBrowserRunSession(this.env.BROWSER, body.session_id);
        return response(200, { ok: true, ...result });
      } catch (error) {
        const code = String(error?.message || 'BROWSER_RUN_CLOSE_FAILED').slice(0, 200);
        return response(code === 'SESSION_ID_INVALID' ? 422 : 502, { ok: false, error: code });
      }
    }
    const node = await this.nodeAuth(req);
    if (!node) return response(401, { ok: false, error: 'ENROLLED_NODE_AUTH_REQUIRED' });
    if (path === '/v1/nodes/heartbeat') return this.heartbeat(node, body);
    if (path === '/v1/tasks/claim') return this.claim(node, body);
    if (path === '/v1/tasks/renew') return this.renew(node, body);
    if (path === '/v1/tasks/checkpoint') return this.checkpoint(node, body);
    if (path === '/v1/tasks/complete') return this.complete(node, body);
    if (path === '/v1/tasks/fail') return this.fail(node, body);
    if (path.startsWith('/v1/vault/leases/')) return handleVaultNode(this, path, node, body);
    return response(404, { ok: false, error: 'NOT_FOUND' });
  }
  async enroll(body) {
    if (!validId(body.node_id) || !validId(body.owner_id) || body.consent_confirmed !== true) {
      return response(422, { ok: false, error: 'NODE_ID_OWNER_AND_EXPLICIT_CONSENT_REQUIRED' });
    }
    if (!Array.isArray(body.capabilities) || body.capabilities.length > 64 ||
        body.capabilities.some(x => typeof x !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(x))) {
      return response(422, { ok: false, error: 'NODE_CAPABILITIES_INVALID' });
    }

    const oidcOnly = body.auth_mode === 'github-actions-oidc';
    if (body.auth_mode !== undefined && !oidcOnly) {
      return response(422, { ok: false, error: 'NODE_AUTH_MODE_INVALID' });
    }
    if ((body.node_id === GITHUB_ACTIONS_OIDC_POLICY.nodeId) !== oidcOnly) {
      return response(422, { ok: false, error: 'CPU_RUNNER_REQUIRES_GITHUB_OIDC_AUTH' });
    }
    if (oidcOnly && (
      body.owner_id !== GITHUB_ACTIONS_OIDC_POLICY.ownerId ||
      body.capabilities.length !== 1 ||
      body.capabilities[0] !== GITHUB_ACTIONS_OIDC_POLICY.capability
    )) {
      return response(422, { ok: false, error: 'GITHUB_OIDC_CPU_NODE_POLICY_MISMATCH' });
    }

    // OIDC node records retain only a random, unusable hash to preserve the common schema.
    // No long-lived bearer token is created, returned, stored in Actions, or logged.
    const token = randomHex();
    const digest = await sha256(token);
    const now = Date.now();
    this.tx(() => {
      this.exec(`INSERT INTO enrolled_nodes
        (node_id,owner_id,token_hash,consent_confirmed,state,enrolled_capabilities_json,capabilities_json,created_at_ms,updated_at_ms)
        VALUES(?,?,?,1,'ENROLLED',?,'[]',?,?)
        ON CONFLICT(node_id) DO UPDATE SET owner_id=excluded.owner_id,token_hash=excluded.token_hash,
          consent_confirmed=1,state='ENROLLED',enrolled_capabilities_json=excluded.enrolled_capabilities_json,
          capabilities_json='[]',agent_version=NULL,browser_runtime_version=NULL,cpu_cores=0,memory_mb=0,
          available_slots=0,cost_per_hour_usd=0,cost_verified=0,encrypted_session_store=0,
          heartbeat_at_ms=NULL,revoked_at_ms=NULL,updated_at_ms=excluded.updated_at_ms`,
        body.node_id, body.owner_id, digest, JSON.stringify([...new Set(body.capabilities)]), now, now);
    });
    for (const socket of this.ctx.getWebSockets?.(`node:${body.node_id}`) || []) {
      try { socket.close(1008, 'node re-enrolled'); } catch {}
    }
    if (oidcOnly) {
      return response(201, {
        ok: true,
        node_id: body.node_id,
        authentication: 'github-actions-oidc',
        token_delivery: 'none',
      });
    }
    return response(201, {
      ok: true,
      node_id: body.node_id,
      enrollment_token: token,
      token_delivery: 'one_time_response_never_persisted_in_plaintext',
    });
  }
  async revoke(body) {
    if (!validId(body.node_id)) return response(422, { ok: false, error: 'NODE_ID_REQUIRED' });
    const now = Date.now();
    this.tx(() => {
      this.exec("UPDATE enrolled_nodes SET state='REVOKED',revoked_at_ms=?,updated_at_ms=? WHERE node_id=?", now, now, body.node_id);
      const active = this.query("SELECT task_id,retry_mode FROM continuity_tasks WHERE status='RUNNING' AND lease_owner=?", body.node_id);
      for (const task of active) {
        const next = task.retry_mode === 'AT_LEAST_ONCE_IDEMPOTENT' ? 'QUEUED' : 'RECONCILIATION_REQUIRED';
        this.exec("UPDATE continuity_tasks SET status=?,lease_owner=NULL,lease_token_hash=NULL,lease_expires_at_ms=NULL,available_at_ms=?,updated_at_ms=? WHERE task_id=? AND status='RUNNING'",
          next, now, now, task.task_id);
        this.event(task.task_id, 'NODE_REVOKED', body.node_id, { next_state: next });
      }
    });
    for (const socket of this.ctx.getWebSockets?.(`node:${body.node_id}`) || []) {
      try { socket.close(1008, 'node revoked'); } catch {}
    }
    return response(200, { ok: true, node_id: body.node_id, state: 'REVOKED' });
  }
  async scheduleWakeOutbox() {
    if (typeof this.env.CONTINUITY_WAKE_QUEUE?.send !== 'function' ||
        typeof this.ctx.storage.setAlarm !== 'function') return false;
    if (!this.one('SELECT event_id FROM continuity_wake_outbox WHERE published_at_ms IS NULL LIMIT 1')) return false;
    try {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return true;
    } catch {
      return false;
    }
  }
  async alarm() {
    const queue = this.env.CONTINUITY_WAKE_QUEUE;
    if (typeof queue?.send !== 'function') return;
    const pending = this.query(
      'SELECT event_id,task_id,owner_id FROM continuity_wake_outbox WHERE published_at_ms IS NULL ORDER BY created_at_ms,event_id LIMIT 50'
    );
    for (const event of pending) {
      try {
        await queue.send({ v: 1, event_id: event.event_id, task_id: event.task_id, owner_id: event.owner_id });
        this.tx(() => this.exec(
          'UPDATE continuity_wake_outbox SET published_at_ms=? WHERE event_id=? AND published_at_ms IS NULL',
          Date.now(), event.event_id
        ));
      } catch (error) {
        if (typeof this.ctx.storage.setAlarm === 'function') {
          await this.ctx.storage.setAlarm(Date.now() + 30000);
        }
        throw error;
      }
    }
    if (this.one('SELECT event_id FROM continuity_wake_outbox WHERE published_at_ms IS NULL LIMIT 1') &&
        typeof this.ctx.storage.setAlarm === 'function') {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }
  broadcastWake(value) {
    const event = normalizeWakeEvent(value);
    const sockets = this.ctx.getWebSockets?.(`owner:${event.owner_id}`) || [];
    let delivered = 0;
    const payload = JSON.stringify({
      type: 'TASK_AVAILABLE', v: 1, event_id: event.event_id,
      task_id: event.task_id, owner_id: event.owner_id,
      wake_only: true, pull_claim_required: true,
    });
    for (const socket of sockets) {
      try { socket.send(payload); delivered += 1; }
      catch { try { socket.close(1011, 'wake delivery failed'); } catch {} }
    }
    return response(200, { ok: true, event_id: event.event_id, delivered, delivery: 'best_effort_wake_hint' });
  }
  async enqueue(body) {
    if (!validId(body.task_id) || !validId(body.owner_id) ||
        typeof body.idempotency_key !== 'string' || body.idempotency_key.length < 8 || body.idempotency_key.length > 200 ||
        !WORKLOADS.has(body.workload) || !isRecord(body.payload) ||
        !Number.isInteger(body.units) || body.units < 1 || body.units > 1000000 ||
        !nonNegative(body.estimated_seconds_per_unit) || body.estimated_seconds_per_unit <= 0 ||
        !nonNegative(body.max_cost_usd) || !nonNegative(body.min_cpu_cores ?? 0) ||
        !Number.isInteger(body.min_memory_mb ?? 0) || (body.min_memory_mb ?? 0) < 0) {
      return response(422, { ok: false, error: 'TASK_CONTRACT_INVALID' });
    }
    const required = Array.isArray(body.required_capabilities) ? [...new Set(body.required_capabilities)] : [];
    if (required.length > 32 || required.some(x => typeof x !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(x))) {
      return response(422, { ok: false, error: 'REQUIRED_CAPABILITIES_INVALID' });
    }
    const retry = body.workload !== 'BROWSER_SESSION' && body.retry_mode === 'AT_LEAST_ONCE_IDEMPOTENT'
      ? 'AT_LEAST_ONCE_IDEMPOTENT' : 'HUMAN_RECONCILIATION';
    const attempts = Number.isInteger(body.max_attempts) ? Math.max(1, Math.min(3, body.max_attempts)) : 3;
    const normalized = {
      task_id: body.task_id, owner_id: body.owner_id, idempotency_key: body.idempotency_key,
      payload: body.payload, workload: body.workload, required_capabilities: required,
      min_cpu_cores: body.min_cpu_cores ?? 0, min_memory_mb: body.min_memory_mb ?? 0,
      units: body.units, estimated_seconds_per_unit: body.estimated_seconds_per_unit,
      max_cost_usd: body.max_cost_usd, retry_mode: retry, max_attempts: attempts,
    };
    const payloadHash = await sha256(canonical(normalized));
    const now = Date.now();
    const wakeEventId = randomHex(16);
    let existing;
    this.tx(() => {
      existing = this.one('SELECT * FROM continuity_tasks WHERE idempotency_key=?', body.idempotency_key);
      if (existing) return;
      this.exec(`INSERT INTO continuity_tasks
        (task_id,owner_id,idempotency_key,payload_hash,payload_json,workload,required_capabilities_json,
         min_cpu_cores,min_memory_mb,units,estimated_seconds_per_unit,max_cost_usd,retry_mode,max_attempts,
         attempt,status,available_at_ms,created_at_ms,updated_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'QUEUED',?,?,?)`,
        body.task_id, body.owner_id, body.idempotency_key, payloadHash, JSON.stringify(body.payload),
        body.workload, JSON.stringify(required), normalized.min_cpu_cores, normalized.min_memory_mb,
        body.units, body.estimated_seconds_per_unit, body.max_cost_usd, retry, attempts, now, now, now);
      this.event(body.task_id, 'TASK_ENQUEUED', 'admin', { workload: body.workload, units: body.units });
      if (typeof this.env.CONTINUITY_WAKE_QUEUE?.send === 'function') {
        this.exec(
          'INSERT INTO continuity_wake_outbox(event_id,task_id,owner_id,created_at_ms,published_at_ms) VALUES(?,?,?,?,NULL)',
          wakeEventId, body.task_id, body.owner_id, now
        );
      }
    });
    await this.scheduleWakeOutbox();
    if (existing) {
      if (existing.payload_hash !== payloadHash) return response(409, { ok: false, error: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' });
      return response(200, { ok: true, task_id: existing.task_id, idempotent: true, state: existing.status });
    }
    return response(201, { ok: true, task_id: body.task_id, state: 'QUEUED', idempotent: false });
  }
  async heartbeat(node, body) {
    const cpu = Number(body.cpu_cores), memory = Number(body.memory_mb), slots = Number(body.available_slots);
    const cost = Number(body.cost_per_hour_usd ?? 0), caps = Array.isArray(body.capabilities) ? [...new Set(body.capabilities)] : [];
    const version = typeof body.agent_version === 'string' ? body.agent_version : '';
    const browserVersion = typeof body.browser_runtime_version === 'string' ? body.browser_runtime_version : null;
    const allowed = JSON.parse(node.enrolled_capabilities_json || '[]');
    if (!Number.isFinite(cpu) || cpu < 0 || cpu > 1024 || !Number.isInteger(memory) || memory < 0 || memory > 1000000000 ||
        !Number.isInteger(slots) || slots < 0 || slots > 1024 || !nonNegative(cost) || body.cost_estimate_verified !== true ||
        !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(version) ||
        caps.length > 64 || caps.some(x => typeof x !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(x) || !allowed.includes(x)) ||
        (browserVersion !== null && !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(browserVersion))) {
      return response(422, { ok: false, error: 'RESOURCE_PROBE_OR_ENROLLED_CAPABILITY_INVALID' });
    }
    const now = Date.now();
    this.tx(() => {
      this.exec(`UPDATE enrolled_nodes SET state='READY',capabilities_json=?,agent_version=?,browser_runtime_version=?,
        cpu_cores=?,memory_mb=?,available_slots=?,cost_per_hour_usd=?,cost_verified=1,
        encrypted_session_store=?,heartbeat_at_ms=?,updated_at_ms=?
        WHERE node_id=? AND revoked_at_ms IS NULL`,
        JSON.stringify(caps), version, browserVersion, cpu, memory, slots, cost,
        body.encrypted_session_store === true ? 1 : 0, now, now, node.node_id);
    });
    return response(200, { ok: true, node_id: node.node_id, state: 'READY', heartbeat_at: new Date(now).toISOString() });
  }
  async claim(node, body) {
    if (body.task_id !== undefined && !validId(body.task_id)) {
      return response(422, { ok: false, error: 'TASK_ID_INVALID' });
    }
    if (body.workload !== undefined && !WORKLOADS.has(body.workload)) {
      return response(422, { ok: false, error: 'WORKLOAD_INVALID' });
    }
    const ttl = Number.isInteger(body.lease_ttl_seconds) ? Math.max(15, Math.min(300, body.lease_ttl_seconds)) : 90;
    const token = randomHex(), tokenHash = await sha256(token), now = Date.now();
    let claimed = null, quarantined = 0;
    this.tx(() => {
      const n = this.one('SELECT * FROM enrolled_nodes WHERE node_id=? AND revoked_at_ms IS NULL AND consent_confirmed=1', node.node_id);
      if (!n || n.state !== 'READY' || !n.heartbeat_at_ms || now - n.heartbeat_at_ms > 45000 || n.cost_verified !== 1) return;
      const active = this.one("SELECT COUNT(*) AS n FROM continuity_tasks WHERE lease_owner=? AND status='RUNNING' AND lease_expires_at_ms>?", node.node_id, now);
      if (Number(active?.n || 0) >= n.available_slots) return;
      const candidates = body.task_id
        ? (body.workload
          ? this.query(`SELECT * FROM continuity_tasks
              WHERE owner_id=? AND task_id=? AND workload=? AND ((status='QUEUED' AND available_at_ms<=?) OR (status='RUNNING' AND lease_expires_at_ms<=?))
              ORDER BY available_at_ms ASC,created_at_ms ASC LIMIT 1`, n.owner_id, body.task_id, body.workload, now, now)
          : this.query(`SELECT * FROM continuity_tasks
              WHERE owner_id=? AND task_id=? AND ((status='QUEUED' AND available_at_ms<=?) OR (status='RUNNING' AND lease_expires_at_ms<=?))
              ORDER BY available_at_ms ASC,created_at_ms ASC LIMIT 1`, n.owner_id, body.task_id, now, now))
        : (body.workload
          ? this.query(`SELECT * FROM continuity_tasks
              WHERE owner_id=? AND workload=? AND ((status='QUEUED' AND available_at_ms<=?) OR (status='RUNNING' AND lease_expires_at_ms<=?))
              ORDER BY available_at_ms ASC,created_at_ms ASC LIMIT 100`, n.owner_id, body.workload, now, now)
          : this.query(`SELECT * FROM continuity_tasks
              WHERE owner_id=? AND ((status='QUEUED' AND available_at_ms<=?) OR (status='RUNNING' AND lease_expires_at_ms<=?))
              ORDER BY available_at_ms ASC,created_at_ms ASC LIMIT 100`, n.owner_id, now, now));
      for (const candidate of candidates) {
        if (candidate.status === 'RUNNING' && candidate.retry_mode !== 'AT_LEAST_ONCE_IDEMPOTENT') {
          this.exec("UPDATE continuity_tasks SET status='RECONCILIATION_REQUIRED',lease_owner=NULL,lease_token_hash=NULL,lease_expires_at_ms=NULL,updated_at_ms=? WHERE task_id=? AND status='RUNNING'",
            now, candidate.task_id);
          this.event(candidate.task_id, 'LEASE_EXPIRED_RECONCILIATION_REQUIRED', node.node_id, {});
          quarantined += 1;
          continue;
        }
        if (candidate.attempt >= candidate.max_attempts) {
          this.exec("UPDATE continuity_tasks SET status='FAILED',lease_owner=NULL,lease_token_hash=NULL,lease_expires_at_ms=NULL,updated_at_ms=? WHERE task_id=?",
            now, candidate.task_id);
          this.event(candidate.task_id, 'ATTEMPT_LIMIT_REACHED', node.node_id, {});
          continue;
        }
        const required = requiredCapabilities({
          workload: candidate.workload,
          required_capabilities: JSON.parse(candidate.required_capabilities_json || '[]'),
        });
        const actual = JSON.parse(n.capabilities_json || '[]');
        if (!required.every(cap => actual.includes(cap))) continue;
        if (n.cpu_cores < candidate.min_cpu_cores || n.memory_mb < candidate.min_memory_mb) continue;
        if (candidate.workload === 'BROWSER_SESSION' && (n.encrypted_session_store !== 1 || !n.browser_runtime_version)) continue;
        const cost = n.cost_per_hour_usd * candidate.units * candidate.estimated_seconds_per_unit / 3600;
        if (cost > candidate.max_cost_usd) continue;
        const expires = now + ttl * 1000;
        const result = this.one(`UPDATE continuity_tasks SET status='RUNNING',attempt=attempt+1,lease_owner=?,
          lease_token_hash=?,lease_expires_at_ms=?,updated_at_ms=? WHERE task_id=? AND status=? RETURNING *`,
          node.node_id, tokenHash, expires, now, candidate.task_id, candidate.status);
        if (!result) continue;
        this.event(candidate.task_id, candidate.status === 'RUNNING' ? 'LEASE_RECLAIMED' : 'TASK_CLAIMED',
          node.node_id, { attempt: result.attempt, lease_expires_at_ms: expires });
        claimed = result;
        break;
      }
    });
    if (!claimed) return response(200, { ok: true, task: null, reason: quarantined ? 'RECONCILIATION_REQUIRED' : 'NO_ELIGIBLE_TASK' });
    return response(200, { ok: true, task: {
      task_id: claimed.task_id, owner_id: claimed.owner_id,
      workload: claimed.workload, payload: JSON.parse(claimed.payload_json),
      attempt: claimed.attempt, lease_expires_at: new Date(claimed.lease_expires_at_ms).toISOString(), lease_token: token,
    } });
  }
  async validateLease(node, body) {
    if (!validId(body.task_id) || typeof body.lease_token !== 'string' || body.lease_token.length !== 64) return null;
    const digest = await sha256(body.lease_token);
    return this.one(`SELECT t.* FROM continuity_tasks t JOIN enrolled_nodes n ON n.node_id=t.lease_owner
      WHERE t.task_id=? AND t.status='RUNNING' AND t.lease_owner=? AND t.lease_token_hash=?
      AND t.lease_expires_at_ms>? AND n.revoked_at_ms IS NULL AND n.consent_confirmed=1 AND n.state='READY'`,
      body.task_id, node.node_id, digest, Date.now());
  }
  async renew(node, body) {
    const task = await this.validateLease(node, body);
    if (!task) return response(409, { ok: false, error: 'LEASE_INVALID_OR_EXPIRED' });
    const ttl = Number.isInteger(body.lease_ttl_seconds) ? Math.max(15, Math.min(300, body.lease_ttl_seconds)) : 90;
    const now = Date.now(), expires = now + ttl * 1000;
    let updated;
    this.tx(() => {
      updated = this.one(`UPDATE continuity_tasks SET lease_expires_at_ms=?,updated_at_ms=?
        WHERE task_id=? AND status='RUNNING' AND lease_owner=? AND lease_token_hash=? AND lease_expires_at_ms>? RETURNING task_id`,
        expires, now, task.task_id, node.node_id, task.lease_token_hash, now);
      if (updated) this.event(task.task_id, 'LEASE_RENEWED', node.node_id, { lease_expires_at_ms: expires });
    });
    return updated ? response(200, { ok: true, lease_expires_at: new Date(expires).toISOString() }) :
      response(409, { ok: false, error: 'LEASE_INVALID_OR_EXPIRED' });
  }
  async checkpoint(node, body) {
    const task = await this.validateLease(node, body);
    if (!task) return response(409, { ok: false, error: 'LEASE_INVALID_OR_EXPIRED' });
    if (!isRecord(body.checkpoint) || JSON.stringify(body.checkpoint).length > 32768) return response(422, { ok: false, error: 'CHECKPOINT_INVALID' });
    const now = Date.now();
    let saved;
    this.tx(() => {
      saved = this.one(`UPDATE continuity_tasks SET checkpoint_json=?,updated_at_ms=? WHERE task_id=? AND status='RUNNING'
        AND lease_owner=? AND lease_token_hash=? AND lease_expires_at_ms>? RETURNING task_id`,
        JSON.stringify(body.checkpoint), now, task.task_id, node.node_id, task.lease_token_hash, now);
      if (saved) this.event(task.task_id, 'CHECKPOINT_SAVED', node.node_id, { checkpoint_keys: Object.keys(body.checkpoint).slice(0, 32) });
    });
    return saved ? response(200, { ok: true, task_id: task.task_id, checkpoint_saved: true }) :
      response(409, { ok: false, error: 'LEASE_INVALID_OR_EXPIRED' });
  }
  async complete(node, body) {
    const task = await this.validateLease(node, body);
    if (!task) return response(409, { ok: false, error: 'LEASE_INVALID_OR_EXPIRED' });
    if (body.result !== undefined && (!isRecord(body.result) || JSON.stringify(body.result).length > 32768)) return response(422, { ok: false, error: 'RESULT_INVALID' });
    const now = Date.now();
    let updated;
    this.tx(() => {
      updated = this.one(`UPDATE continuity_tasks SET status='COMPLETED',result_json=?,lease_owner=NULL,lease_token_hash=NULL,
        lease_expires_at_ms=NULL,updated_at_ms=? WHERE task_id=? AND status='RUNNING' AND lease_owner=?
        AND lease_token_hash=? AND lease_expires_at_ms>? RETURNING task_id`,
        JSON.stringify(body.result ?? {}), now, task.task_id, node.node_id, task.lease_token_hash, now);
      if (updated) this.event(task.task_id, 'TASK_COMPLETED', node.node_id, {});
    });
    return updated ? response(200, { ok: true, task_id: task.task_id, state: 'COMPLETED' }) :
      response(409, { ok: false, error: 'LEASE_INVALID_OR_EXPIRED' });
  }
  async fail(node, body) {
    const task = await this.validateLease(node, body);
    if (!task) return response(409, { ok: false, error: 'LEASE_INVALID_OR_EXPIRED' });
    const retryable = body.retryable === true && task.retry_mode === 'AT_LEAST_ONCE_IDEMPOTENT' && task.attempt < task.max_attempts;
    const state = retryable ? 'QUEUED' : (task.retry_mode === 'AT_LEAST_ONCE_IDEMPOTENT' ? 'FAILED' : 'RECONCILIATION_REQUIRED');
    const now = Date.now();
    let updated;
    this.tx(() => {
      updated = this.one(`UPDATE continuity_tasks SET status=?,available_at_ms=?,lease_owner=NULL,lease_token_hash=NULL,
        lease_expires_at_ms=NULL,updated_at_ms=? WHERE task_id=? AND status='RUNNING' AND lease_owner=?
        AND lease_token_hash=? AND lease_expires_at_ms>? RETURNING task_id`,
        state, now, now, task.task_id, node.node_id, task.lease_token_hash, now);
      if (updated) this.event(task.task_id, state, node.node_id, { reason: String(body.reason || 'unspecified').slice(0, 200) });
    });
    return updated ? response(200, { ok: true, task_id: task.task_id, state }) :
      response(409, { ok: false, error: 'LEASE_INVALID_OR_EXPIRED' });
  }
}

export default {
  async fetch(request, env) {
    if (!env.CONTINUITY_LEDGER) return response(503, { ok: false, error: 'LEDGER_BINDING_MISSING' });
    const id = env.CONTINUITY_LEDGER.idFromName('midad-global-continuity-ledger-v1');
    return env.CONTINUITY_LEDGER.get(id).fetch(request);
  },
  async queue(batch, env) {
    if (!env.CONTINUITY_LEDGER || typeof env.MIDAD_WAKE_INTERNAL_KEY !== 'string' ||
        env.MIDAD_WAKE_INTERNAL_KEY.length < 32) {
      for (const message of batch.messages || []) { try { message.retry(); } catch {} }
      return { delivered: 0, retried: (batch.messages || []).length, pull_fallback: 0 };
    }
    let delivered = 0, retried = 0, pullFallback = 0;
    for (const message of batch.messages || []) {
      try {
        const event = normalizeWakeEvent(message.body);
        const id = env.CONTINUITY_LEDGER.idFromName('midad-global-continuity-ledger-v1');
        const stub = env.CONTINUITY_LEDGER.get(id);
        const result = await stub.fetch(new Request('https://ledger.internal/internal/wake', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-midad-wake-key': env.MIDAD_WAKE_INTERNAL_KEY },
          body: JSON.stringify(event),
        }));
        if (!result.ok) throw new Error('WAKE_DISPATCH_REJECTED');
        const wakeResult = await result.json();
        if (wakeResult.runner_dispatchable === true) {
          const dispatch = await dispatchGitHubWorkflow(event, env);
          if (dispatch.dispatched !== true) {
            if (dispatch.reason === 'GITHUB_APP_NOT_CONFIGURED') {
              // The authenticated wake has already reached the ledger/WebSocket.
              // Let the enrolled scheduled pull runner provide the free fallback.
              pullFallback += 1;
            } else {
              throw new Error(dispatch.reason || 'GITHUB_ACTIONS_DISPATCH_NOT_CONFIRMED');
            }
          }
        }
        message.ack();
        delivered += 1;
      } catch {
        try { message.retry(); } catch {}
        retried += 1;
      }
    }
    return { delivered, retried, pull_fallback: pullFallback };
  },
};
