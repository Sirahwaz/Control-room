import {
  encryptVaultSecret,
  decryptVaultSecret,
  rewrapVaultSecret,
  deriveVaultLeaseToken,
  readVaultKeyring,
} from './vault-crypto.mjs';

const encoder = new TextEncoder();
const PURPOSES = new Set(['BROWSER_LOGIN', 'AGENT_TASK', 'API_ACCESS', 'PROXY_AUTH']);
const SCOPES = new Set(['BROWSER', 'AUTOMATION', 'INFRASTRUCTURE']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
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
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
function metadata(value) {
  if (!isRecord(value) || !validId(value.owner_id) || !validId(value.binding_id) ||
      typeof value.secret_ref !== 'string' ||
      !/^vault:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{2,180}$/.test(value.secret_ref) ||
      typeof value.platform_id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value.platform_id)) {
    throw new Error('VAULT_METADATA_INVALID');
  }
  const host = String(value.host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || host.includes('*') || host.includes('/') || host.includes(':') ||
      host === 'localhost' ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host)) {
    throw new Error('VAULT_HOST_INVALID');
  }
  const purpose = String(value.purpose || '').toUpperCase();
  const scope = String(value.scope || '').toUpperCase();
  if (!PURPOSES.has(purpose) || !SCOPES.has(scope)) throw new Error('VAULT_PURPOSE_OR_SCOPE_INVALID');
  const allowed = {
    BROWSER_LOGIN: ['BROWSER'],
    AGENT_TASK: ['AUTOMATION'],
    API_ACCESS: ['AUTOMATION', 'INFRASTRUCTURE'],
    PROXY_AUTH: ['AUTOMATION'],
  };
  if (!allowed[purpose].includes(scope)) throw new Error('VAULT_PURPOSE_SCOPE_MISMATCH');
  return {
    owner_id: value.owner_id,
    binding_id: value.binding_id,
    secret_ref: value.secret_ref,
    platform_id: value.platform_id,
    host,
    purpose,
    scope,
  };
}
function metadataFromRow(row) {
  return {
    owner_id: row.owner_id,
    binding_id: row.binding_id,
    secret_ref: row.secret_ref,
    platform_id: row.platform_id,
    host: row.host,
    purpose: row.purpose,
    scope: row.scope,
  };
}
function publicMetadata(row) {
  return {
    owner_id: row.owner_id,
    binding_id: row.binding_id,
    secret_ref: row.secret_ref,
    platform_id: row.platform_id,
    host: row.host,
    purpose: row.purpose,
    scope: row.scope,
    state: row.state,
    key_version: row.key_version,
    created_at: new Date(row.created_at_ms).toISOString(),
    updated_at: new Date(row.updated_at_ms).toISOString(),
    revoked_at: row.revoked_at_ms ? new Date(row.revoked_at_ms).toISOString() : null,
  };
}
function event(ledger, ownerId, bindingId, type, actorId, data = {}, leaseId = null) {
  ledger.exec(
    'INSERT INTO vault_events(owner_id,binding_id,lease_id,event_type,actor_id,event_json,created_at_ms) VALUES(?,?,?,?,?,?,?)',
    ownerId, bindingId, leaseId, type, actorId, JSON.stringify(data), Date.now()
  );
}

export function initVaultSchema(ledger) {
  ledger.sql.exec(`
    CREATE TABLE IF NOT EXISTS vault_secrets (
      owner_id TEXT NOT NULL, binding_id TEXT NOT NULL, secret_ref TEXT NOT NULL,
      platform_id TEXT NOT NULL, host TEXT NOT NULL, purpose TEXT NOT NULL, scope TEXT NOT NULL,
      state TEXT NOT NULL, key_version TEXT NOT NULL,
      ciphertext_b64 TEXT NOT NULL, nonce_b64 TEXT NOT NULL,
      wrapped_dek_b64 TEXT NOT NULL, wrap_nonce_b64 TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, revoked_at_ms INTEGER,
      PRIMARY KEY(owner_id,binding_id), UNIQUE(owner_id,secret_ref)
    );
    CREATE INDEX IF NOT EXISTS vault_secrets_owner_state_idx ON vault_secrets(owner_id,state,binding_id);
    CREATE TABLE IF NOT EXISTS vault_operations (
      owner_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL, entity_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
      PRIMARY KEY(owner_id,operation,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS vault_leases (
      lease_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, node_id TEXT NOT NULL,
      task_id TEXT NOT NULL, binding_id TEXT NOT NULL, request_id TEXT NOT NULL,
      request_hash TEXT NOT NULL, host TEXT NOT NULL, purpose TEXT NOT NULL, scope TEXT NOT NULL,
      key_version TEXT NOT NULL, token_hash TEXT NOT NULL, state TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, released_at_ms INTEGER,
      UNIQUE(owner_id,node_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS vault_leases_binding_state_idx ON vault_leases(owner_id,binding_id,state,expires_at_ms);
    CREATE TABLE IF NOT EXISTS vault_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL,
      binding_id TEXT NOT NULL, lease_id TEXT, event_type TEXT NOT NULL,
      actor_id TEXT NOT NULL, event_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL
    );
  `);
}

async function store(ledger, body) {
  let meta;
  try {
    meta = metadata(body);
    readVaultKeyring(ledger.env);
  } catch (error) {
    const code = String(error?.message || 'VAULT_CONFIGURATION_INVALID');
    return response(code === 'VAULT_KEYRING_NOT_CONFIGURED' ? 503 : 422, { ok: false, error: code });
  }
  if (!isRecord(body.secret)) return response(422, { ok: false, error: 'VAULT_SECRET_OBJECT_REQUIRED' });
  const serialized = JSON.stringify(body.secret);
  if (encoder.encode(serialized).byteLength > 16384) return response(413, { ok: false, error: 'VAULT_SECRET_TOO_LARGE' });
  const idempotency = body.idempotency_key;
  if (typeof idempotency !== 'string' || idempotency.length < 8 || idempotency.length > 200) {
    return response(422, { ok: false, error: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  const requestHash = await sha256(canonical({ metadata: meta, secret: body.secret }));
  const prior = ledger.one(
    'SELECT request_hash,entity_id FROM vault_operations WHERE owner_id=? AND operation=? AND idempotency_key=?',
    meta.owner_id, 'STORE', idempotency
  );
  if (prior) {
    if (prior.request_hash !== requestHash) return response(409, { ok: false, error: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' });
    const existing = ledger.one('SELECT * FROM vault_secrets WHERE owner_id=? AND binding_id=?', meta.owner_id, prior.entity_id);
    if (!existing) return response(409, { ok: false, error: 'VAULT_IDEMPOTENCY_RECORD_INCONSISTENT' });
    return response(200, { ok: true, idempotent: true, state: existing.state, secret: publicMetadata(existing) });
  }
  let encrypted;
  try { encrypted = await encryptVaultSecret(body.secret, meta, ledger.env); }
  catch (error) {
    const code = String(error?.message || 'VAULT_ENCRYPTION_FAILED');
    return response(code === 'VAULT_KEYRING_NOT_CONFIGURED' ? 503 : 422, { ok: false, error: code });
  }
  const now = Date.now();
  let saved = null, conflict = null, replay = false;
  try {
    ledger.tx(() => {
      const raced = ledger.one(
        'SELECT request_hash,entity_id FROM vault_operations WHERE owner_id=? AND operation=? AND idempotency_key=?',
        meta.owner_id, 'STORE', idempotency
      );
      if (raced) {
        if (raced.request_hash !== requestHash) conflict = 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH';
        else { saved = ledger.one('SELECT * FROM vault_secrets WHERE owner_id=? AND binding_id=?', meta.owner_id, raced.entity_id); replay = true; }
        return;
      }
      const existing = ledger.one('SELECT * FROM vault_secrets WHERE owner_id=? AND binding_id=?', meta.owner_id, meta.binding_id);
      if (existing && existing.state !== 'REVOKED') { conflict = 'VAULT_BINDING_ALREADY_EXISTS'; return; }
      const otherRef = ledger.one(
        'SELECT binding_id,state FROM vault_secrets WHERE owner_id=? AND secret_ref=? AND binding_id<>?',
        meta.owner_id, meta.secret_ref, meta.binding_id
      );
      if (otherRef && otherRef.state !== 'REVOKED') { conflict = 'VAULT_REFERENCE_ALREADY_BOUND'; return; }
      saved = ledger.one(`INSERT INTO vault_secrets
        (owner_id,binding_id,secret_ref,platform_id,host,purpose,scope,state,key_version,
         ciphertext_b64,nonce_b64,wrapped_dek_b64,wrap_nonce_b64,created_at_ms,updated_at_ms,revoked_at_ms)
        VALUES(?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,NULL)
        ON CONFLICT(owner_id,binding_id) DO UPDATE SET
          secret_ref=excluded.secret_ref,platform_id=excluded.platform_id,host=excluded.host,
          purpose=excluded.purpose,scope=excluded.scope,state='ACTIVE',key_version=excluded.key_version,
          ciphertext_b64=excluded.ciphertext_b64,nonce_b64=excluded.nonce_b64,
          wrapped_dek_b64=excluded.wrapped_dek_b64,wrap_nonce_b64=excluded.wrap_nonce_b64,
          updated_at_ms=excluded.updated_at_ms,revoked_at_ms=NULL
        WHERE vault_secrets.state='REVOKED'
        RETURNING *`,
        meta.owner_id, meta.binding_id, meta.secret_ref, meta.platform_id, meta.host,
        meta.purpose, meta.scope, encrypted.key_version, encrypted.ciphertext_b64,
        encrypted.nonce_b64, encrypted.wrapped_dek_b64, encrypted.wrap_nonce_b64, now, now
      );
      if (!saved) { conflict = 'VAULT_BINDING_ALREADY_EXISTS'; return; }
      ledger.exec(
        'INSERT INTO vault_operations(owner_id,operation,idempotency_key,request_hash,entity_id,created_at_ms) VALUES(?,?,?,?,?,?)',
        meta.owner_id, 'STORE', idempotency, requestHash, meta.binding_id, now
      );
      event(ledger, meta.owner_id, meta.binding_id, 'SECRET_STORED', 'admin', {
        platform_id: meta.platform_id, host: meta.host, purpose: meta.purpose,
        scope: meta.scope, key_version: encrypted.key_version,
      });
    });
  } catch {
    return response(409, { ok: false, error: 'VAULT_STORE_CONFLICT' });
  }
  if (conflict) return response(409, { ok: false, error: conflict });
  if (!saved) return response(500, { ok: false, error: 'VAULT_STORE_FAILED' });
  return response(replay ? 200 : 201, { ok: true, idempotent: replay, state: saved.state, secret: publicMetadata(saved) });
}

async function list(ledger, body) {
  if (!validId(body.owner_id)) return response(422, { ok: false, error: 'OWNER_ID_REQUIRED' });
  const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(100, body.limit)) : 50;
  const cursor = typeof body.cursor === 'string' && body.cursor ? body.cursor : '';
  const items = ledger.query(
    'SELECT * FROM vault_secrets WHERE owner_id=? AND binding_id>? ORDER BY binding_id ASC LIMIT ?',
    body.owner_id, cursor, limit
  );
  return response(200, {
    ok: true,
    items: items.map(publicMetadata),
    next_cursor: items.length === limit ? items[items.length - 1].binding_id : null,
  });
}

async function revoke(ledger, body) {
  if (!validId(body.owner_id) || !validId(body.binding_id) ||
      typeof body.idempotency_key !== 'string' || body.idempotency_key.length < 8 || body.idempotency_key.length > 200) {
    return response(422, { ok: false, error: 'VAULT_REVOKE_CONTRACT_INVALID' });
  }
  const requestHash = await sha256(canonical({ owner_id: body.owner_id, binding_id: body.binding_id }));
  const previous = ledger.one(
    'SELECT request_hash FROM vault_operations WHERE owner_id=? AND operation=? AND idempotency_key=?',
    body.owner_id, 'REVOKE', body.idempotency_key
  );
  if (previous) return previous.request_hash === requestHash
    ? response(200, { ok: true, idempotent: true, state: 'REVOKED' })
    : response(409, { ok: false, error: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' });
  const existing = ledger.one('SELECT state FROM vault_secrets WHERE owner_id=? AND binding_id=?', body.owner_id, body.binding_id);
  if (!existing) return response(404, { ok: false, error: 'VAULT_BINDING_NOT_FOUND' });
  const now = Date.now();
  ledger.tx(() => {
    ledger.exec('UPDATE vault_secrets SET state=\'REVOKED\',revoked_at_ms=?,updated_at_ms=? WHERE owner_id=? AND binding_id=?',
      now, now, body.owner_id, body.binding_id);
    ledger.exec("UPDATE vault_leases SET state='REVOKED' WHERE owner_id=? AND binding_id=? AND state='ACTIVE'",
      body.owner_id, body.binding_id);
    ledger.exec(
      'INSERT INTO vault_operations(owner_id,operation,idempotency_key,request_hash,entity_id,created_at_ms) VALUES(?,?,?,?,?,?)',
      body.owner_id, 'REVOKE', body.idempotency_key, requestHash, body.binding_id, now
    );
    event(ledger, body.owner_id, body.binding_id, 'SECRET_REVOKED', 'admin');
  });
  return response(200, { ok: true, idempotent: false, state: 'REVOKED' });
}

async function rewrap(ledger, body) {
  let keyring;
  try { keyring = readVaultKeyring(ledger.env); }
  catch (error) { return response(503, { ok: false, error: String(error?.message || 'VAULT_KEYRING_NOT_CONFIGURED') }); }
  const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(100, body.limit)) : 50;
  const candidates = ledger.query(
    "SELECT * FROM vault_secrets WHERE state='ACTIVE' AND key_version<>? ORDER BY owner_id,binding_id LIMIT ?",
    keyring.activeVersion, limit
  );
  let rewrapped = 0;
  for (const row of candidates) {
    let result;
    try { result = await rewrapVaultSecret(row, metadataFromRow(row), ledger.env); }
    catch { return response(409, { ok: false, error: 'VAULT_OLD_KEY_VERSION_UNAVAILABLE', rewrapped }); }
    const now = Date.now();
    ledger.tx(() => {
      ledger.exec(
        "UPDATE vault_secrets SET key_version=?,wrapped_dek_b64=?,wrap_nonce_b64=?,updated_at_ms=? WHERE owner_id=? AND binding_id=? AND state='ACTIVE'",
        result.key_version, result.wrapped_dek_b64, result.wrap_nonce_b64, now, row.owner_id, row.binding_id
      );
      event(ledger, row.owner_id, row.binding_id, 'SECRET_KEY_REWRAPPED', 'admin', {
        from_key_version: row.key_version, to_key_version: result.key_version,
      });
    });
    rewrapped += 1;
  }
  return response(200, {
    ok: true, rewrapped,
    remaining: ledger.one("SELECT COUNT(*) AS n FROM vault_secrets WHERE state='ACTIVE' AND key_version<>?", keyring.activeVersion)?.n || 0,
  });
}

async function issue(ledger, node, body) {
  if (!validId(body.task_id) || typeof body.task_lease_token !== 'string' ||
      body.task_lease_token.length !== 64 || !validId(body.binding_id) ||
      typeof body.request_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(body.request_id)) {
    return response(422, { ok: false, error: 'VAULT_LEASE_CONTRACT_INVALID' });
  }
  const task = await ledger.validateLease(node, { task_id: body.task_id, lease_token: body.task_lease_token });
  if (!task) return response(409, { ok: false, error: 'TASK_LEASE_INVALID_OR_EXPIRED' });
  const now = Date.now();
  if (node.state !== 'READY' || node.revoked_at_ms !== null ||
      !node.heartbeat_at_ms || now - node.heartbeat_at_ms > 45000 || node.cost_verified !== 1) {
    return response(409, { ok: false, error: 'FRESH_READY_NODE_REQUIRED' });
  }
  if (task.workload !== 'BROWSER_SESSION' || node.encrypted_session_store !== 1 ||
      !node.browser_runtime_version ||
      !['interactive-browser-execution', 'persistent-browser-session', 'encrypted-session-store']
        .every(capability => JSON.parse(node.capabilities_json || '[]').includes(capability))) {
    return response(403, { ok: false, error: 'VAULT_BROWSER_RUNTIME_REQUIRED' });
  }
  let payload;
  try { payload = JSON.parse(task.payload_json || '{}'); }
  catch { return response(409, { ok: false, error: 'TASK_PAYLOAD_INVALID' }); }
  if (!Array.isArray(payload.credential_binding_ids) || !payload.credential_binding_ids.includes(body.binding_id)) {
    return response(403, { ok: false, error: 'VAULT_BINDING_NOT_AUTHORIZED_FOR_TASK' });
  }
  let host;
  try {
    host = metadata({
      owner_id: task.owner_id, binding_id: body.binding_id,
      secret_ref: 'vault://lease/placeholder', platform_id: 'lease',
      host: body.host, purpose: body.purpose, scope: body.scope,
    }).host;
  } catch (error) {
    return response(422, { ok: false, error: String(error?.message || 'VAULT_ROUTE_INVALID') });
  }
  const secret = ledger.one(
    'SELECT * FROM vault_secrets WHERE owner_id=? AND binding_id=?',
    task.owner_id, body.binding_id
  );
  if (!secret) return response(404, { ok: false, error: 'VAULT_BINDING_NOT_FOUND' });
  if (secret.state !== 'ACTIVE') return response(409, { ok: false, error: 'VAULT_SECRET_REVOKED' });
  if (secret.host !== host || secret.purpose !== String(body.purpose).toUpperCase() ||
      secret.scope !== String(body.scope).toUpperCase()) {
    return response(403, { ok: false, error: 'VAULT_BINDING_SCOPE_MISMATCH' });
  }
  const ttl = Number.isInteger(body.lease_ttl_seconds) ? body.lease_ttl_seconds : 60;
  if (ttl < 30 || ttl > 300) return response(422, { ok: false, error: 'VAULT_LEASE_TTL_INVALID' });
  const expiresAt = Math.min(now + ttl * 1000, task.lease_expires_at_ms);
  if (expiresAt <= now) return response(409, { ok: false, error: 'TASK_LEASE_EXPIRED' });
  const requestHash = await sha256(canonical({
    owner_id: task.owner_id, node_id: node.node_id, task_id: task.task_id,
    binding_id: body.binding_id, request_id: body.request_id, host,
    purpose: secret.purpose, scope: secret.scope,
  }));
  const previous = ledger.one(
    'SELECT * FROM vault_leases WHERE owner_id=? AND node_id=? AND request_id=?',
    task.owner_id, node.node_id, body.request_id
  );
  if (previous) {
    if (previous.request_hash !== requestHash) return response(409, { ok: false, error: 'VAULT_LEASE_IDEMPOTENCY_MISMATCH' });
    if (previous.state !== 'ACTIVE' || previous.expires_at_ms <= now) return response(409, { ok: false, error: 'VAULT_LEASE_NO_LONGER_ACTIVE' });
    const token = await deriveVaultLeaseToken(previous, ledger.env);
    if (!constantTimeEqual(await sha256(token), previous.token_hash)) return response(409, { ok: false, error: 'VAULT_LEASE_TOKEN_INVALID' });
    let secretValue;
    try { secretValue = await decryptVaultSecret(secret, metadataFromRow(secret), ledger.env); }
    catch { return response(503, { ok: false, error: 'VAULT_DECRYPTION_UNAVAILABLE' }); }
    return response(200, {
      ok: true, idempotent: true,
      lease: { lease_id: previous.lease_id, lease_token: token, expires_at: new Date(previous.expires_at_ms).toISOString(), secret: secretValue },
    });
  }
  const lease = {
    lease_id: crypto.randomUUID().replace(/-/g, ''),
    owner_id: task.owner_id, node_id: node.node_id, task_id: task.task_id,
    binding_id: body.binding_id, request_id: body.request_id, request_hash: requestHash,
    host, purpose: secret.purpose, scope: secret.scope, key_version: secret.key_version,
    expires_at_ms: expiresAt,
  };
  let token, secretValue;
  try {
    token = await deriveVaultLeaseToken(lease, ledger.env);
    secretValue = await decryptVaultSecret(secret, metadataFromRow(secret), ledger.env);
  } catch {
    return response(503, { ok: false, error: 'VAULT_CRYPTO_UNAVAILABLE' });
  }
  lease.token_hash = await sha256(token);
  lease.state = 'ACTIVE';
  lease.created_at_ms = now;
  let raced = false;
  try {
    ledger.tx(() => {
      if (ledger.one('SELECT lease_id FROM vault_leases WHERE owner_id=? AND node_id=? AND request_id=?',
        task.owner_id, node.node_id, body.request_id)) { raced = true; return; }
      ledger.exec(`INSERT INTO vault_leases
        (lease_id,owner_id,node_id,task_id,binding_id,request_id,request_hash,host,purpose,scope,
         key_version,token_hash,state,expires_at_ms,created_at_ms,released_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,NULL)`,
        lease.lease_id, lease.owner_id, lease.node_id, lease.task_id, lease.binding_id, lease.request_id,
        lease.request_hash, lease.host, lease.purpose, lease.scope, lease.key_version,
        lease.token_hash, lease.expires_at_ms, lease.created_at_ms);
      event(ledger, lease.owner_id, lease.binding_id, 'SECRET_LEASE_ISSUED', node.node_id, {
        task_id: lease.task_id, request_id: lease.request_id, host, purpose: lease.purpose,
        scope: lease.scope, expires_at_ms: lease.expires_at_ms,
      }, lease.lease_id);
    });
  } catch {
    return response(409, { ok: false, error: 'VAULT_LEASE_STORE_CONFLICT' });
  }
  if (raced) return response(409, { ok: false, error: 'VAULT_LEASE_REQUEST_RACE' });
  return response(200, {
    ok: true, idempotent: false,
    lease: { lease_id: lease.lease_id, lease_token: token, expires_at: new Date(expiresAt).toISOString(), secret: secretValue },
  });
}

async function release(ledger, node, body) {
  if (typeof body.lease_id !== 'string' || !/^[a-f0-9]{32}$/.test(body.lease_id) ||
      typeof body.lease_token !== 'string' || body.lease_token.length < 32) {
    return response(422, { ok: false, error: 'VAULT_LEASE_RELEASE_CONTRACT_INVALID' });
  }
  const lease = ledger.one('SELECT * FROM vault_leases WHERE lease_id=? AND node_id=?', body.lease_id, node.node_id);
  if (!lease) return response(404, { ok: false, error: 'VAULT_LEASE_NOT_FOUND' });
  if (lease.state !== 'ACTIVE' || lease.expires_at_ms <= Date.now()) {
    return response(409, { ok: false, error: 'VAULT_LEASE_NO_LONGER_ACTIVE' });
  }
  const expected = await deriveVaultLeaseToken(lease, ledger.env);
  if (!constantTimeEqual(expected, body.lease_token) ||
      !constantTimeEqual(await sha256(body.lease_token), lease.token_hash)) {
    return response(401, { ok: false, error: 'VAULT_LEASE_TOKEN_INVALID' });
  }
  const now = Date.now();
  ledger.tx(() => {
    ledger.exec("UPDATE vault_leases SET state='RELEASED',released_at_ms=? WHERE lease_id=? AND state='ACTIVE'",
      now, lease.lease_id);
    event(ledger, lease.owner_id, lease.binding_id, 'SECRET_LEASE_RELEASED', node.node_id, {
      task_id: lease.task_id, expires_at_ms: lease.expires_at_ms,
    }, lease.lease_id);
  });
  return response(200, { ok: true, lease_id: lease.lease_id, state: 'RELEASED' });
}

export async function handleVaultAdmin(ledger, path, req, body) {
  if (!await ledger.adminAuth(req)) return response(401, { ok: false, error: 'ADMIN_AUTH_REQUIRED' });
  if (path === '/v1/vault/secrets/store') return store(ledger, body);
  if (path === '/v1/vault/secrets/list') return list(ledger, body);
  if (path === '/v1/vault/secrets/revoke') return revoke(ledger, body);
  if (path === '/v1/vault/secrets/rewrap') return rewrap(ledger, body);
  return response(404, { ok: false, error: 'NOT_FOUND' });
}

export async function handleVaultNode(ledger, path, node, body) {
  if (path === '/v1/vault/leases/issue') return issue(ledger, node, body);
  if (path === '/v1/vault/leases/release') return release(ledger, node, body);
  return response(404, { ok: false, error: 'NOT_FOUND' });
}
