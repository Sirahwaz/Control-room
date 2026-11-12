import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { MidadContinuityLedger } from '../continuity-ledger/worker.mjs';
import { GITHUB_ACTIONS_OIDC_POLICY, verifyGitHubActionsOidcToken } from '../continuity-ledger/github-oidc.mjs';
import { runEphemeralTask } from '../ephemeral-runner.mjs';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'midad-test-key', alg: 'RS256', use: 'sig' };
const nowSeconds = () => Math.floor(Date.now() / 1000);
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function signedToken(overrides = {}, signingKey = privateKey) {
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: jwk.kid });
  const claims = {
    iss: GITHUB_ACTIONS_OIDC_POLICY.issuer,
    aud: GITHUB_ACTIONS_OIDC_POLICY.audience,
    sub: 'repo:Sirahwaz/Control-room:ref:refs/heads/main',
    repository: 'Sirahwaz/Control-room',
    repository_id: '1377540065',
    repository_owner: 'Sirahwaz',
    repository_owner_id: '116122510',
    ref: 'refs/heads/main',
    workflow_ref: GITHUB_ACTIONS_OIDC_POLICY.workflowRef,
    event_name: 'workflow_dispatch',
    iat: nowSeconds() - 5,
    nbf: nowSeconds() - 5,
    exp: nowSeconds() + 300,
    ...overrides,
  };
  const payload = b64(claims);
  const message = header + '.' + payload;
  return message + '.' + sign('RSA-SHA256', Buffer.from(message), signingKey).toString('base64url');
}

function jwksFetch(keys = [jwk]) {
  return async url => {
    assert.equal(new URL(url).href, GITHUB_ACTIONS_OIDC_POLICY.jwksUrl);
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

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
const post = (path, body, headers = {}) => new Request('https://ledger.test' + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const admin = () => ({ authorization: 'Bearer ' + ADMIN });

test('GitHub OIDC accepts only a fresh signed CPU runner token for the exact repository, owner and workflow', async () => {
  const cache = { keys: null, expiresAt: 0 };
  const claims = await verifyGitHubActionsOidcToken(signedToken(), { fetchImpl: jwksFetch(), cache });
  assert.equal(claims.repository_id, '1377540065');
  assert.equal(claims.repository_owner_id, '116122510');
  assert.equal(claims.workflow_ref, GITHUB_ACTIONS_OIDC_POLICY.workflowRef);
});

test('GitHub OIDC rejects wrong workflow, wrong repository, wrong owner, expired token and invalid signature', async () => {
  const cases = [
    signedToken({ workflow_ref: 'Sirahwaz/Control-room/.github/workflows/another.yml@refs/heads/main' }),
    signedToken({ repository_id: '999999999' }),
    signedToken({ repository_owner_id: '999999999' }),
    signedToken({ exp: nowSeconds() - 60 }),
    signedToken({}, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey),
  ];
  for (const token of cases) {
    await assert.rejects(
      verifyGitHubActionsOidcToken(token, { fetchImpl: jwksFetch(), cache: { keys: null, expiresAt: 0 } }),
      /GITHUB_OIDC_(?:CLAIMS_INVALID|SIGNATURE_INVALID|TOKEN_EXPIRED|WORKFLOW_NOT_ALLOWED|REPOSITORY_NOT_ALLOWED|OWNER_NOT_ALLOWED)/,
    );
  }
});

test('OIDC-only CPU enrollment returns no node secret and authenticates the exact GitHub Actions runner', async () => {
  const storage = new Storage();
  const ledger = new MidadContinuityLedger({ storage }, { MIDAD_LEDGER_ADMIN_KEY: ADMIN });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jwksFetch();
  try {
    const enrolled = await ledger.fetch(post('/v1/nodes/enroll', {
      node_id: 'github-actions-cpu-batch',
      owner_id: 'github:116122510',
      consent_confirmed: true,
      capabilities: ['cpu-batch'],
      auth_mode: 'github-actions-oidc',
    }, admin()));
    const enrolledBody = await enrolled.json();
    assert.equal(enrolled.status, 201);
    assert.equal(enrolledBody.authentication, 'github-actions-oidc');
    assert.equal(enrolledBody.token_delivery, 'none');
    assert.equal(Object.hasOwn(enrolledBody, 'enrollment_token'), false);

    const jwt = signedToken();
    const heartbeat = await ledger.fetch(post('/v1/nodes/heartbeat', {
      cpu_cores: 2,
      memory_mb: 2048,
      available_slots: 1,
      cost_per_hour_usd: 0,
      cost_estimate_verified: true,
      capabilities: ['cpu-batch'],
      agent_version: 'midad-actions-test',
      encrypted_session_store: false,
    }, { authorization: 'Bearer ' + jwt, 'x-midad-node-id': 'github-actions-cpu-batch' }));
    assert.equal(heartbeat.status, 200);

    const wrongWorkflow = signedToken({ workflow_ref: 'Sirahwaz/Control-room/.github/workflows/evil.yml@refs/heads/main' });
    const denied = await ledger.fetch(post('/v1/nodes/heartbeat', {
      cpu_cores: 2, memory_mb: 2048, available_slots: 1,
      cost_per_hour_usd: 0, cost_estimate_verified: true,
      capabilities: ['cpu-batch'], agent_version: 'midad-actions-test', encrypted_session_store: false,
    }, { authorization: 'Bearer ' + wrongWorkflow, 'x-midad-node-id': 'github-actions-cpu-batch' }));
    assert.equal(denied.status, 401);

    const health = await (await ledger.fetch(new Request('https://ledger.test/health'))).json();
    assert.equal(health.node_auth, 'github-actions-oidc-v1');
  } finally {
    globalThis.fetch = originalFetch;
    storage.close();
  }
});

test('ephemeral runner obtains an audience-bound GitHub OIDC token and uses it for ledger calls', async () => {
  const oidcToken = signedToken();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (parsed.hostname === 'pipelines.actions.githubusercontent.com') {
      assert.equal(parsed.searchParams.get('audience'), 'midad-continuity-ledger');
      assert.equal(options.headers.authorization, 'Bearer ' + 'r'.repeat(64));
      return new Response(JSON.stringify({ value: oidcToken }), { status: 200 });
    }
    if (parsed.pathname === '/v1/nodes/heartbeat') {
      assert.equal(options.headers.authorization, 'Bearer ' + oidcToken);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (parsed.pathname === '/v1/tasks/claim') {
      assert.equal(options.headers.authorization, 'Bearer ' + oidcToken);
      return new Response(JSON.stringify({ ok: true, task: null, reason: 'NO_ELIGIBLE_TASK' }), { status: 200 });
    }
    throw new Error('UNEXPECTED_RUNNER_REQUEST');
  };

  const result = await runEphemeralTask({
    env: {
      MIDAD_CONTINUITY_LEDGER_URL: 'https://midad-continuity-ledger.midadbot.workers.dev',
      MIDAD_CONTINUITY_OWNER_ID: 'github:116122510',
      MIDAD_INPUT_OWNER_ID: 'github:116122510',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/runner-test?api-version=2.0',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'r'.repeat(64),
    },
    fetchImpl,
  });
  assert.equal(result.status, 'NO_ELIGIBLE_TASK');
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url.pathname, '/v1/nodes/heartbeat');
  assert.equal(calls[2].url.pathname, '/v1/tasks/claim');
});

test('ephemeral runner refuses missing or untrusted GitHub OIDC token request endpoints before ledger access', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('NETWORK_MUST_NOT_BE_REACHED'); };
  await assert.rejects(runEphemeralTask({
    env: {
      MIDAD_CONTINUITY_LEDGER_URL: 'https://midad-continuity-ledger.midadbot.workers.dev',
      MIDAD_CONTINUITY_OWNER_ID: 'github:116122510',
      MIDAD_INPUT_OWNER_ID: 'github:116122510',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://attacker.example/oidc',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'r'.repeat(64),
    },
    fetchImpl,
  }), /GITHUB_OIDC_TOKEN_REQUEST_URL_INVALID/);
  assert.equal(calls, 0);
});
