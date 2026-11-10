import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MidadContinuityLedger } from '../continuity-ledger/worker.mjs';
import { encryptVaultSecret, decryptVaultSecret, rewrapVaultSecret } from '../continuity-ledger/vault-crypto.mjs';

class Cursor {
  constructor(rows = []) { this.rows = rows; }
  toArray() { return this.rows; }
}

class Storage {
  constructor() {
    this.db = new DatabaseSync(':memory:');
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
  close() { this.db.close(); }
}

const ADMIN = 'test-admin-ledger-key-which-is-over-32-characters';
const OWNER = 'owner-vault-001';
const NODE = 'node-browser-001';
const BINDING = 'proxy-account-example';
const SECRET_REF = 'vault://proxy/example/auth';
const KEY_V1 = Buffer.alloc(32, 17).toString('base64url');
const KEY_V2 = Buffer.alloc(32, 29).toString('base64url');

const setup = (overrides = {}) => {
  const storage = new Storage();
  const env = {
    MIDAD_LEDGER_ADMIN_KEY: ADMIN,
    MIDAD_VAULT_ACTIVE_KEY_VERSION: 'v1',
    MIDAD_VAULT_KEYRING_JSON: JSON.stringify({ v1: KEY_V1 }),
    ...overrides,
  };
  return { storage, env, ledger: new MidadContinuityLedger({ storage }, env) };
};

const post = (path, body, headers = {}) => new Request('https://ledger.test' + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const admin = () => ({ authorization: 'Bearer ' + ADMIN });
const nodeHeaders = (id, token) => ({
  'x-midad-node-id': id,
  authorization: 'Bearer ' + token,
});
const read = async response => ({ status: response.status, body: await response.json() });

async function enrollBrowserNode(ledger, id = NODE, owner = OWNER) {
  const result = await read(await ledger.fetch(post('/v1/nodes/enroll', {
    node_id: id,
    owner_id: owner,
    consent_confirmed: true,
    capabilities: [
      'interactive-browser-execution',
      'persistent-browser-session',
      'encrypted-session-store',
    ],
  }, admin())));
  assert.equal(result.status, 201);
  return result.body.enrollment_token;
}

async function heartbeat(ledger, id, token) {
  return read(await ledger.fetch(post('/v1/nodes/heartbeat', {
    cpu_cores: 2,
    memory_mb: 2048,
    available_slots: 1,
    cost_per_hour_usd: 0,
    cost_estimate_verified: true,
    capabilities: [
      'interactive-browser-execution',
      'persistent-browser-session',
      'encrypted-session-store',
    ],
    agent_version: 'midad-v2.0.0',
    browser_runtime_version: 'chromium-130',
    encrypted_session_store: true,
  }, nodeHeaders(id, token))));
}

function browserTask(taskId = 'browser-task-001', ownerId = OWNER, bindingIds = [BINDING]) {
  return {
    task_id: taskId,
    owner_id: ownerId,
    idempotency_key: 'intent:' + taskId,
    payload: {
      operation: 'open_approved_platform_session',
      credential_binding_ids: bindingIds,
    },
    workload: 'BROWSER_SESSION',
    required_capabilities: [],
    min_cpu_cores: 1,
    min_memory_mb: 512,
    units: 1,
    estimated_seconds_per_unit: 30,
    max_cost_usd: 0,
    retry_mode: 'HUMAN_RECONCILIATION',
    max_attempts: 2,
  };
}

async function storeProxySecret(ledger, ownerId = OWNER, bindingId = BINDING, idempotencyKey = 'store-proxy-0001') {
  return read(await ledger.fetch(post('/v1/vault/secrets/store', {
    owner_id: ownerId,
    binding_id: bindingId,
    secret_ref: SECRET_REF,
    platform_id: 'example',
    host: 'example.com',
    purpose: 'PROXY_AUTH',
    scope: 'AUTOMATION',
    idempotency_key: idempotencyKey,
    secret: {
      username: 'proxy-user-never-store-plaintext',
      password: 'proxy-password-never-store-plaintext',
    },
  }, admin())));
}

async function enqueueAndClaimBrowserTask(ledger, nodeToken, taskValue = browserTask()) {
  const enqueued = await read(await ledger.fetch(post('/v1/tasks/enqueue', taskValue, admin())));
  assert.ok([200, 201].includes(enqueued.status));
  const claimed = await read(await ledger.fetch(post('/v1/tasks/claim', {
    lease_ttl_seconds: 180,
  }, nodeHeaders(NODE, nodeToken))));
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.task.task_id, taskValue.task_id);
  return claimed.body.task;
}

function issueRequest(task, requestId = 'vault-lease-request-001', overrides = {}) {
  return {
    task_id: task.task_id,
    task_lease_token: task.lease_token,
    binding_id: BINDING,
    request_id: requestId,
    host: 'example.com',
    purpose: 'PROXY_AUTH',
    scope: 'AUTOMATION',
    lease_ttl_seconds: 60,
    ...overrides,
  };
}

test('Vault store requires admin authentication and a configured encryption keyring', async () => {
  const noKeyring = setup({ MIDAD_VAULT_KEYRING_JSON: undefined });
  const body = {
    owner_id: OWNER, binding_id: BINDING, secret_ref: SECRET_REF,
    platform_id: 'example', host: 'example.com', purpose: 'PROXY_AUTH',
    scope: 'AUTOMATION', idempotency_key: 'store-no-keyring-01',
    secret: { username: 'user', password: 'pass' },
  };
  const unauthenticated = await read(await noKeyring.ledger.fetch(post('/v1/vault/secrets/store', body)));
  assert.equal(unauthenticated.status, 401);
  const unavailable = await read(await noKeyring.ledger.fetch(post('/v1/vault/secrets/store', body, admin())));
  assert.equal(unavailable.status, 503);
  assert.equal(noKeyring.storage.db.prepare('SELECT COUNT(*) AS n FROM vault_secrets').get().n, 0);
  noKeyring.storage.close();
});

test('Vault stores only envelope-encrypted secret material and lists metadata only', async () => {
  const { storage, ledger } = setup();
  const stored = await storeProxySecret(ledger);
  assert.equal(stored.status, 201);
  assert.equal(stored.body.ok, true);
  assert.equal(stored.body.state, 'ACTIVE');
  const row = storage.db.prepare('SELECT * FROM vault_secrets WHERE owner_id=? AND binding_id=?').get(OWNER, BINDING);
  assert.ok(row.ciphertext_b64);
  assert.ok(row.wrapped_dek_b64);
  const persisted = JSON.stringify(row);
  assert.equal(persisted.includes('proxy-user-never-store-plaintext'), false);
  assert.equal(persisted.includes('proxy-password-never-store-plaintext'), false);
  const events = storage.db.prepare('SELECT event_json FROM vault_events').all();
  assert.equal(JSON.stringify(events).includes('proxy-password-never-store-plaintext'), false);

  const listed = await read(await ledger.fetch(post('/v1/vault/secrets/list', {
    owner_id: OWNER,
    limit: 20,
  }, admin())));
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.items[0].binding_id, BINDING);
  assert.equal(JSON.stringify(listed.body).includes('ciphertext_b64'), false);
  assert.equal(JSON.stringify(listed.body).includes('proxy-password-never-store-plaintext'), false);
  storage.close();
});

test('Vault store idempotency replays the same intent and rejects a changed secret payload', async () => {
  const { storage, ledger } = setup();
  const first = await storeProxySecret(ledger, OWNER, BINDING, 'store-idempotent-001');
  const replay = await storeProxySecret(ledger, OWNER, BINDING, 'store-idempotent-001');
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  const changed = await read(await ledger.fetch(post('/v1/vault/secrets/store', {
    owner_id: OWNER,
    binding_id: BINDING,
    secret_ref: SECRET_REF,
    platform_id: 'example',
    host: 'example.com',
    purpose: 'PROXY_AUTH',
    scope: 'AUTOMATION',
    idempotency_key: 'store-idempotent-001',
    secret: { username: 'different-user', password: 'different-password' },
  }, admin())));
  assert.equal(changed.status, 409);
  assert.equal(storage.db.prepare('SELECT COUNT(*) AS n FROM vault_secrets').get().n, 1);
  storage.close();
});

test('Vault lease is task-bound, owner-bound, host/purpose/scope-bound and short-lived', async () => {
  const { storage, ledger } = setup();
  assert.equal((await storeProxySecret(ledger)).status, 201);
  const token = await enrollBrowserNode(ledger);
  assert.equal((await heartbeat(ledger, NODE, token)).status, 200);
  const task = await enqueueAndClaimBrowserTask(ledger, token);
  const issued = await read(await ledger.fetch(post('/v1/vault/leases/issue',
    issueRequest(task), nodeHeaders(NODE, token))));
  assert.equal(issued.status, 200);
  assert.equal(issued.body.ok, true);
  assert.equal(issued.body.lease.secret.username, 'proxy-user-never-store-plaintext');
  assert.equal(issued.body.lease.secret.password, 'proxy-password-never-store-plaintext');
  assert.ok(issued.body.lease.lease_token.length >= 32);
  const remaining = new Date(task.lease_expires_at).getTime() - Date.now();
  assert.ok(new Date(issued.body.lease.expires_at).getTime() <= Date.now() + 60000);
  assert.ok(new Date(issued.body.lease.expires_at).getTime() <= new Date(task.lease_expires_at).getTime());
  assert.ok(remaining > 0);
  const leaseRow = storage.db.prepare('SELECT * FROM vault_leases WHERE lease_id=?').get(issued.body.lease.lease_id);
  assert.equal(leaseRow.node_id, NODE);
  assert.equal(leaseRow.owner_id, OWNER);
  assert.equal(leaseRow.task_id, task.task_id);
  assert.notEqual(leaseRow.token_hash, issued.body.lease.lease_token);
  storage.close();
});

test('Vault lease retries are idempotent only for the same request id and active task lease', async () => {
  const { storage, ledger } = setup();
  await storeProxySecret(ledger);
  const token = await enrollBrowserNode(ledger);
  await heartbeat(ledger, NODE, token);
  const task = await enqueueAndClaimBrowserTask(ledger, token);
  const request = issueRequest(task, 'vault-request-replay-001');
  const first = await read(await ledger.fetch(post('/v1/vault/leases/issue', request, nodeHeaders(NODE, token))));
  const replay = await read(await ledger.fetch(post('/v1/vault/leases/issue', request, nodeHeaders(NODE, token))));
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.lease.lease_id, first.body.lease.lease_id);
  assert.equal(replay.body.lease.lease_token, first.body.lease.lease_token);
  assert.deepEqual(replay.body.lease.secret, first.body.lease.secret);
  const collision = await read(await ledger.fetch(post('/v1/vault/leases/issue',
    issueRequest(task, 'vault-request-replay-001', { host: 'other.example' }), nodeHeaders(NODE, token))));
  assert.equal(collision.status, 409);
  storage.close();
});

test('Vault denies binding ids not declared in the claimed browser task', async () => {
  const { storage, ledger } = setup();
  await storeProxySecret(ledger);
  const token = await enrollBrowserNode(ledger);
  await heartbeat(ledger, NODE, token);
  const task = await enqueueAndClaimBrowserTask(ledger, token, browserTask('task-no-binding', OWNER, []));
  const issued = await read(await ledger.fetch(post('/v1/vault/leases/issue', issueRequest(task),
    nodeHeaders(NODE, token))));
  assert.equal(issued.status, 403);
  assert.equal(issued.body.error, 'VAULT_BINDING_NOT_AUTHORIZED_FOR_TASK');
  storage.close();
});

test('Vault does not issue secrets across owner boundaries or mismatched route scopes', async () => {
  const { storage, ledger } = setup();
  await storeProxySecret(ledger, 'owner-a', BINDING);
  const token = await enrollBrowserNode(ledger, 'node-owner-b', 'owner-b');
  await heartbeat(ledger, 'node-owner-b', token);
  const taskValue = browserTask('task-owner-b', 'owner-b', [BINDING]);
  const enqueued = await read(await ledger.fetch(post('/v1/tasks/enqueue', taskValue, admin())));
  assert.equal(enqueued.status, 201);
  const claimed = await read(await ledger.fetch(post('/v1/tasks/claim', { lease_ttl_seconds: 180 },
    nodeHeaders('node-owner-b', token))));
  const issued = await read(await ledger.fetch(post('/v1/vault/leases/issue',
    issueRequest(claimed.body.task), nodeHeaders('node-owner-b', token))));
  assert.equal(issued.status, 404);
  assert.equal(issued.body.error, 'VAULT_BINDING_NOT_FOUND');
  storage.close();
});

test('Vault revocation disables future lease issuance and revokes active leases', async () => {
  const { storage, ledger } = setup();
  await storeProxySecret(ledger);
  const token = await enrollBrowserNode(ledger);
  await heartbeat(ledger, NODE, token);
  const task = await enqueueAndClaimBrowserTask(ledger, token);
  const issued = await read(await ledger.fetch(post('/v1/vault/leases/issue',
    issueRequest(task, 'vault-revoke-request-001'), nodeHeaders(NODE, token))));
  assert.equal(issued.status, 200);
  const revoked = await read(await ledger.fetch(post('/v1/vault/secrets/revoke', {
    owner_id: OWNER,
    binding_id: BINDING,
    idempotency_key: 'revoke-proxy-0001',
  }, admin())));
  assert.equal(revoked.status, 200);
  assert.equal(storage.db.prepare('SELECT state FROM vault_leases WHERE lease_id=?')
    .get(issued.body.lease.lease_id).state, 'REVOKED');
  const again = await read(await ledger.fetch(post('/v1/vault/leases/issue',
    issueRequest(task, 'vault-after-revoke-001'), nodeHeaders(NODE, token))));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'VAULT_SECRET_REVOKED');
  storage.close();
});

test('Vault key rotation rewraps data keys without rewriting plaintext or losing lease capability', async () => {
  const { storage, env, ledger } = setup();
  await storeProxySecret(ledger);
  env.MIDAD_VAULT_KEYRING_JSON = JSON.stringify({ v1: KEY_V1, v2: KEY_V2 });
  env.MIDAD_VAULT_ACTIVE_KEY_VERSION = 'v2';
  const rewrapped = await read(await ledger.fetch(post('/v1/vault/secrets/rewrap', {
    limit: 20,
  }, admin())));
  assert.equal(rewrapped.status, 200);
  assert.equal(rewrapped.body.rewrapped, 1);
  const row = storage.db.prepare('SELECT key_version FROM vault_secrets WHERE owner_id=? AND binding_id=?')
    .get(OWNER, BINDING);
  assert.equal(row.key_version, 'v2');

  env.MIDAD_VAULT_KEYRING_JSON = JSON.stringify({ v2: KEY_V2 });
  const token = await enrollBrowserNode(ledger);
  await heartbeat(ledger, NODE, token);
  const task = await enqueueAndClaimBrowserTask(ledger, token);
  const issued = await read(await ledger.fetch(post('/v1/vault/leases/issue',
    issueRequest(task, 'vault-rotated-request-001'), nodeHeaders(NODE, token))));
  assert.equal(issued.status, 200);
  assert.equal(issued.body.lease.secret.password, 'proxy-password-never-store-plaintext');
  storage.close();
});


test('Vault AES-GCM ciphertext is bound to its owner, binding and exact host metadata', async () => {
  const env = {
    MIDAD_VAULT_ACTIVE_KEY_VERSION: 'v1',
    MIDAD_VAULT_KEYRING_JSON: JSON.stringify({ v1: KEY_V1 }),
  };
  const metadata = {
    owner_id: OWNER,
    binding_id: BINDING,
    secret_ref: SECRET_REF,
    platform_id: 'example',
    host: 'example.com',
    purpose: 'PROXY_AUTH',
    scope: 'AUTOMATION',
  };
  const secret = { username: 'proxy-user', password: 'proxy-password' };
  const encrypted = await encryptVaultSecret(secret, metadata, env);
  assert.deepEqual(await decryptVaultSecret(encrypted, metadata, env), secret);
  await assert.rejects(
    () => decryptVaultSecret(encrypted, { ...metadata, host: 'other.example' }, env),
    /VAULT_DECRYPTION_FAILED/,
  );
  const tampered = { ...encrypted, ciphertext_b64: encrypted.ciphertext_b64.slice(0, -1) + (encrypted.ciphertext_b64.endsWith('A') ? 'B' : 'A') };
  await assert.rejects(() => decryptVaultSecret(tampered, metadata, env));
});

test('Vault DEK rewrap preserves ciphertext and remains decryptable after retiring the old KEK', async () => {
  const metadata = {
    owner_id: OWNER,
    binding_id: BINDING,
    secret_ref: SECRET_REF,
    platform_id: 'example',
    host: 'example.com',
    purpose: 'PROXY_AUTH',
    scope: 'AUTOMATION',
  };
  const secret = { username: 'rotation-user', password: 'rotation-password' };
  const v1 = {
    MIDAD_VAULT_ACTIVE_KEY_VERSION: 'v1',
    MIDAD_VAULT_KEYRING_JSON: JSON.stringify({ v1: KEY_V1 }),
  };
  const encrypted = await encryptVaultSecret(secret, metadata, v1);
  const rotation = {
    MIDAD_VAULT_ACTIVE_KEY_VERSION: 'v2',
    MIDAD_VAULT_KEYRING_JSON: JSON.stringify({ v1: KEY_V1, v2: KEY_V2 }),
  };
  const rewrapped = await rewrapVaultSecret(encrypted, metadata, rotation);
  assert.equal(rewrapped.key_version, 'v2');
  assert.equal(rewrapped.ciphertext_b64, encrypted.ciphertext_b64);
  assert.equal(rewrapped.nonce_b64, encrypted.nonce_b64);
  const v2Only = {
    MIDAD_VAULT_ACTIVE_KEY_VERSION: 'v2',
    MIDAD_VAULT_KEYRING_JSON: JSON.stringify({ v2: KEY_V2 }),
  };
  assert.deepEqual(await decryptVaultSecret(rewrapped, metadata, v2Only), secret);
});
