import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { dispatchGitHubWorkflow } from '../continuity-ledger/github-dispatch.mjs';
import { executeTaskPayload, runEphemeralTask } from '../ephemeral-runner.mjs';
import { readFile } from 'node:fs/promises';

const APP_ID = '123456';
const INSTALLATION_ID = '654321';
const EVENT = {
  v: 1,
  event_id: 'evt-00000001',
  task_id: 'task-00000001',
  owner_id: 'owner-00000001',
};
const b64url = value => Buffer.from(value).toString('base64url');
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const runnerOidcKeyPair = await webcrypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const runnerOidcJwk = {
  ...await webcrypto.subtle.exportKey('jwk', runnerOidcKeyPair.publicKey),
  kid: 'midad-dispatch-runner-test-key',
  alg: 'RS256',
  use: 'sig',
};
async function signedRunnerOidcToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: runnerOidcJwk.kid }));
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'midad-continuity-ledger',
    sub: 'repo:Sirahwaz/Control-room:ref:refs/heads/main',
    repository: 'Sirahwaz/Control-room',
    repository_id: '1377540065',
    repository_owner: 'Sirahwaz',
    repository_owner_id: '116122510',
    ref: 'refs/heads/main',
    workflow_ref: 'Sirahwaz/Control-room/.github/workflows/midad-mncf-ephemeral-runner.yml@refs/heads/main',
    event_name: 'workflow_dispatch',
    iat: now - 5,
    nbf: now - 5,
    exp: now + 300,
  };
  const payload = b64url(JSON.stringify(claims));
  const message = header + '.' + payload;
  const signature = await webcrypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    runnerOidcKeyPair.privateKey,
    new TextEncoder().encode(message),
  );
  return message + '.' + Buffer.from(signature).toString('base64url');
}
function toPem(bytes, label = 'PRIVATE KEY') {
  const b64 = Buffer.from(bytes).toString('base64').match(/.{1,64}/g).join('\n');
  return '-----BEGIN ' + label + '-----\n' + b64 + '\n-----END ' + label + '-----';
}
function readDerElement(bytes, offset) {
  const tag = bytes[offset];
  let cursor = offset + 1;
  let length = bytes[cursor++];
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[cursor++];
  }
  return { tag, start: cursor, end: cursor + length, next: cursor + length };
}
function extractPkcs1FromPkcs8(bytes) {
  const outer = readDerElement(bytes, 0);
  let cursor = outer.start;
  cursor = readDerElement(bytes, cursor).next;
  cursor = readDerElement(bytes, cursor).next;
  const privateOctet = readDerElement(bytes, cursor);
  assert.equal(privateOctet.tag, 0x04);
  return bytes.slice(privateOctet.start, privateOctet.end);
}
async function keyFixture() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
    true,
    ['sign','verify'],
  );
  const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
  return {
    pem: toPem(pkcs8),
    pkcs1Pem: toPem(extractPkcs1FromPkcs8(pkcs8), 'RSA PRIVATE KEY'),
    publicKey: pair.publicKey,
  };
}
function decodePart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

test('GitHub dispatch is explicitly disabled when no App credentials are configured', async () => {
  const result = await dispatchGitHubWorkflow(EVENT, {});
  assert.deepEqual(result, { dispatched: false, reason: 'GITHUB_APP_NOT_CONFIGURED' });
});

test('partial GitHub App configuration fails closed instead of silently degrading', async () => {
  await assert.rejects(
    () => dispatchGitHubWorkflow(EVENT, { MIDAD_GITHUB_APP_ID: APP_ID }),
    /GITHUB_APP_CONFIGURATION_INCOMPLETE/,
  );
});

test('dispatch validates event identifiers before making any network request', async () => {
  let calls = 0;
  await assert.rejects(
    () => dispatchGitHubWorkflow({ ...EVENT, owner_id: 'owner/attacker' }, {
      MIDAD_GITHUB_APP_ID: APP_ID,
      MIDAD_GITHUB_INSTALLATION_ID: INSTALLATION_ID,
      MIDAD_GITHUB_APP_PRIVATE_KEY: 'unused',
    }, async () => { calls += 1; return new Response('{}', { status: 500 }); }),
    /WAKE_EVENT_INVALID/,
  );
  assert.equal(calls, 0);
});

test('GitHub App JWT is signed and workflow dispatch carries identifiers only', async () => {
  const keys = await keyFixture();
  const requests = [];
  const fetchMock = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url) === `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`) {
      assert.equal(init.method, 'POST');
      const jwt = String(init.headers.authorization).replace(/^Bearer\s+/i, '');
      const [header, payload, signature] = jwt.split('.');
      assert.deepEqual(decodePart(header), { alg: 'RS256', typ: 'JWT' });
      const claims = decodePart(payload);
      assert.equal(claims.iss, APP_ID);
      assert.ok(claims.exp > claims.iat && claims.exp - claims.iat <= 600);
      const valid = await webcrypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        keys.publicKey,
        Buffer.from(signature, 'base64url'),
        new TextEncoder().encode(header + '.' + payload),
      );
      assert.equal(valid, true, 'App JWT signature must verify');
      const body = JSON.parse(init.body);
      assert.deepEqual(body.repositories, ['Control-room']);
      assert.deepEqual(body.permissions, { actions: 'write' });
      return new Response(JSON.stringify({
        token: 'ghs_test_installation_token_not_a_real_secret',
        permissions: { actions: 'write', metadata: 'read' },
      }), { status: 201 });
    }
    assert.equal(
      String(url),
      'https://api.github.com/repos/Sirahwaz/Control-room/actions/workflows/midad-mncf-ephemeral-runner.yml/dispatches',
    );
    assert.equal(init.method, 'POST');
    assert.match(init.headers.authorization, /Bearer ghs_test_installation_token/);
    const body = JSON.parse(init.body);
    assert.equal(body.ref, 'main');
    assert.deepEqual(body.inputs, {
      event_id: EVENT.event_id,
      task_id: EVENT.task_id,
      owner_id: EVENT.owner_id,
    });
    assert.equal(JSON.stringify(body).includes('payload'), false);
    assert.equal(JSON.stringify(body).includes('token'), false);
    return new Response(null, { status: 204 });
  };

  const result = await dispatchGitHubWorkflow(EVENT, {
    MIDAD_GITHUB_APP_ID: APP_ID,
    MIDAD_GITHUB_INSTALLATION_ID: INSTALLATION_ID,
    MIDAD_GITHUB_APP_PRIVATE_KEY: keys.pkcs1Pem,
  }, fetchMock);

  assert.equal(result.dispatched, true);
  assert.equal(result.workflow, 'midad-mncf-ephemeral-runner.yml');
  assert.equal(result.ref, 'main');
  assert.equal(requests.length, 2);
});

test('GitHub App installation must grant Actions write before workflow dispatch', async () => {
  const keys = await keyFixture();
  let dispatchCalled = false;
  const fetchMock = async (url) => {
    if (String(url).includes('/access_tokens')) {
      return new Response(JSON.stringify({
        token: 'ghs_read_only',
        permissions: { contents: 'read' },
      }), { status: 201 });
    }
    dispatchCalled = true;
    return new Response(null, { status: 204 });
  };
  await assert.rejects(() => dispatchGitHubWorkflow(EVENT, {
    MIDAD_GITHUB_APP_ID: APP_ID,
    MIDAD_GITHUB_INSTALLATION_ID: INSTALLATION_ID,
    MIDAD_GITHUB_APP_PRIVATE_KEY: keys.pem,
  }, fetchMock), /GITHUB_APP_ACTIONS_WRITE_ONLY_REQUIRED/);
  assert.equal(dispatchCalled, false);
});

test('non-204 workflow dispatch response is surfaced as a retryable failure', async () => {
  const keys = await keyFixture();
  const fetchMock = async url => String(url).includes('/access_tokens')
    ? new Response(JSON.stringify({ token: 'ghs_test_installation_token_1234567890', permissions: { actions: 'write' } }), { status: 201 })
    : new Response(JSON.stringify({ message: 'rate limit' }), { status: 429 });
  await assert.rejects(() => dispatchGitHubWorkflow(EVENT, {
    MIDAD_GITHUB_APP_ID: APP_ID,
    MIDAD_GITHUB_INSTALLATION_ID: INSTALLATION_ID,
    MIDAD_GITHUB_APP_PRIVATE_KEY: keys.pem,
  }, fetchMock), /GITHUB_WORKFLOW_DISPATCH_FAILED_429/);
});

test('ephemeral runner workflow supports dispatch and five-minute scheduled pull fallback with least privilege', async () => {
  const workflow = await readFile(new URL('../../../../.github/workflows/midad-mncf-ephemeral-runner.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron:\s*["']\*\/5 \* \* \* \*["']/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /MIDAD_CONTINUITY_RUNNER_NODE_TOKEN/);
  assert.ok(workflow.includes('id-token: write'));
  assert.match(workflow, /node mobile\/factory\/x\/ephemeral-runner\.mjs/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write|contents:\s*write/);
});

test('ephemeral runner executes only bounded allowlisted CPU operations', () => {
  assert.deepEqual(executeTaskPayload({ operation: 'SUM_INTEGERS', input: { values: [1,2,3] } }), {
    operation: 'SUM_INTEGERS', count: 3, sum: 6,
  });
  assert.equal(executeTaskPayload({ operation: 'HASH_TEXT', input: { text: 'midad' } }).sha256.length, 64);
  assert.equal(executeTaskPayload({ operation: 'RUNNER_SMOKE' }).node_id, 'github-actions-cpu-batch');
  assert.throws(() => executeTaskPayload({ operation: 'RUN_SHELL', input: { command: 'id' } }), /TASK_OPERATION_NOT_ALLOWLISTED/);
  assert.throws(() => executeTaskPayload({ operation: 'SUM_INTEGERS', input: { values: ['1'] } }), /SUM_INPUT_INVALID/);
  assert.throws(() => executeTaskPayload({ operation: 'SUM_INTEGERS', input: { values: [1], command: 'whoami' } }), /SUM_INPUT_INVALID/);
  assert.throws(() => executeTaskPayload({ operation: 'HASH_TEXT', input: { text: 'safe', command: 'whoami' } }), /HASH_INPUT_INVALID/);
  assert.throws(() => executeTaskPayload({ operation: 'RUNNER_SMOKE', input: { command: 'whoami' } }), /RUNNER_SMOKE_INPUT_INVALID/);
});

test('ephemeral runner rejects non-origin HTTPS ledger URLs and non-hex node tokens before network access', async () => {
  const baseEnv = {
    MIDAD_CONTINUITY_LEDGER_URL: 'https://ledger.example.workers.dev',
    MIDAD_CONTINUITY_OWNER_ID: 'github:116122510',
    MIDAD_INPUT_OWNER_ID: 'github:116122510',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/runner-test',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'r'.repeat(64),
    MIDAD_TASK_ID: 'task-00000001',
    MIDAD_EVENT_ID: 'evt-00000001',
  };
  for (const ledgerUrl of [
    'https://ledger.example.workers.dev/path',
    'https://ledger.example.workers.dev:8443',
    'https://user:pass@ledger.example.workers.dev',
    'https://ledger.example.workers.dev?debug=1',
    'http://ledger.example.workers.dev',
  ]) {
    let calls = 0;
    await assert.rejects(() => runEphemeralTask({
      env: { ...baseEnv, MIDAD_CONTINUITY_LEDGER_URL: ledgerUrl },
      fetchImpl: async () => { calls += 1; return new Response('{}'); },
    }), /LEDGER_URL_MUST_BE_HTTPS_ORIGIN/);
    assert.equal(calls, 0, 'invalid ledger URL must be rejected before sending node credentials');
  }
  let calls = 0;
  await assert.rejects(() => runEphemeralTask({
    env: { ...baseEnv, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://untrusted.example/oidc' },
    fetchImpl: async () => { calls += 1; return new Response('{}'); },
  }), /GITHUB_OIDC_TOKEN_REQUEST_URL_INVALID/);
  assert.equal(calls, 0, 'an untrusted OIDC endpoint must be rejected before network access');
});

test('ephemeral runner heartbeats, claims the exact task, checkpoints evidence and completes it', async () => {
  const requests = [];
  const leaseToken = 'c'.repeat(64);
  const oidcToken = await signedRunnerOidcToken();
  const fetchMock = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'pipelines.actions.githubusercontent.com') {
      assert.equal(parsed.searchParams.get('audience'), 'midad-continuity-ledger');
      return new Response(JSON.stringify({ value: oidcToken }), { status: 200 });
    }
    if (parsed.hostname === 'token.actions.githubusercontent.com') {
      return new Response(JSON.stringify({ keys: [runnerOidcJwk] }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), init, body });
    if (parsed.pathname.endsWith('/v1/nodes/heartbeat')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (parsed.pathname.endsWith('/v1/tasks/claim')) return new Response(JSON.stringify({
      ok: true,
      task: {
        task_id: 'task-00000001',
        owner_id: 'github:116122510',
        workload: 'CPU_BATCH',
        payload: { operation: 'SUM_INTEGERS', input: { values: [4,5,6] } },
        attempt: 1,
        lease_token: leaseToken,
      },
    }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, state: 'COMPLETED' }), { status: 200 });
  };
  const result = await runEphemeralTask({
    env: {
      MIDAD_CONTINUITY_LEDGER_URL: 'https://ledger.example.workers.dev',
      MIDAD_CONTINUITY_OWNER_ID: 'github:116122510',
      MIDAD_INPUT_OWNER_ID: 'github:116122510',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/runner-test',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'r'.repeat(64),
      MIDAD_TASK_ID: 'task-00000001',
      MIDAD_EVENT_ID: 'evt-00000001',
    },
    fetchImpl: fetchMock,
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.evidence.task_id, 'task-00000001');
  assert.equal(requests.length, 4);
  assert.equal(requests[0].body.capabilities.includes('cpu-batch'), true);
  assert.equal(requests[1].body.task_id, 'task-00000001');
  assert.equal(requests[1].body.workload, 'CPU_BATCH');
  assert.equal(requests[1].body.lease_ttl_seconds, 180);
  assert.equal(requests[2].body.checkpoint.schema, 'midad-ephemeral-runner-evidence-v1');
  assert.equal(requests[3].body.result.summary.sum, 15);
  assert.ok(requests.every(x => x.init.redirect === 'error'));
  assert.ok(requests.every(x => x.init.signal instanceof AbortSignal));
  assert.ok(requests.every(x => x.init.headers.authorization === 'Bearer ' + oidcToken));
  assert.equal(JSON.stringify(result).includes('a'.repeat(64)), false);
});

test('ephemeral runner rejects owner mismatch before accessing the ledger', async () => {
  let calls = 0;
  await assert.rejects(() => runEphemeralTask({
    env: {
      MIDAD_CONTINUITY_LEDGER_URL: 'https://ledger.example.workers.dev',
      MIDAD_CONTINUITY_OWNER_ID: 'github:116122510',
      MIDAD_INPUT_OWNER_ID: 'github:116122511',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/runner-test',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'r'.repeat(64),
      MIDAD_TASK_ID: 'task-00000001',
      MIDAD_EVENT_ID: 'evt-00000001',
    },
    fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  }), /OWNER_ID_INPUT_MISMATCH/);
  assert.equal(calls, 0);
});

test('ephemeral workflow uses task-targeted workflow dispatch and read-only permissions', async () => {
  const workflow = await readFile(new URL('../../../../.github/workflows/midad-mncf-ephemeral-runner.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /task_id:/);
  assert.match(workflow, /event_id:/);
  assert.match(workflow, /owner_id:/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /node mobile\/factory\/x\/ephemeral-runner\.mjs/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write|contents:\s*write/);
  assert.doesNotMatch(workflow, /persist-credentials:\s*true/);
});


test('installation token with additional repository permissions is rejected before dispatch', async () => {
  const keys = await keyFixture();
  let dispatchCalled = false;
  const fetchMock = async url => String(url).includes('/access_tokens')
    ? new Response(JSON.stringify({
        token: 'ghs_overprivileged_token_1234567890',
        permissions: { actions: 'write', contents: 'read', metadata: 'read' },
      }), { status: 201 })
    : (dispatchCalled = true, new Response(null, { status: 204 }));
  await assert.rejects(() => dispatchGitHubWorkflow(EVENT, {
    MIDAD_GITHUB_APP_ID: APP_ID,
    MIDAD_GITHUB_INSTALLATION_ID: INSTALLATION_ID,
    MIDAD_GITHUB_APP_PRIVATE_KEY: keys.pem,
  }, fetchMock), /GITHUB_APP_ACTIONS_WRITE_ONLY_REQUIRED/);
  assert.equal(dispatchCalled, false);
});


test('scheduled pull runner claims one owner-scoped CPU task without a dispatch event id', async () => {
  const calls = [];
  const leaseToken = 'd'.repeat(64);
  const oidcToken = 'header.' + 'p'.repeat(120) + '.' + 's'.repeat(120);
  const result = await runEphemeralTask({
    env: {
      MIDAD_CONTINUITY_LEDGER_URL: 'https://ledger.example.workers.dev',
      MIDAD_CONTINUITY_OWNER_ID: 'github:116122510',
      MIDAD_INPUT_OWNER_ID: 'github:116122510',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/runner-test',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'r'.repeat(64),
    },
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'pipelines.actions.githubusercontent.com') {
        return new Response(JSON.stringify({ value: oidcToken }), { status: 200 });
      }
      if (parsed.hostname === 'token.actions.githubusercontent.com') {
        return new Response(JSON.stringify({ keys: [runnerOidcJwk] }), { status: 200 });
      }
      const path = parsed.pathname;
      const body = JSON.parse(init.body);
      calls.push({ path, body, init });
      if (path.endsWith('/heartbeat')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (path.endsWith('/claim')) return new Response(JSON.stringify({
        ok: true,
        task: {
          task_id: 'task-from-owner-queue',
          owner_id: 'github:116122510',
          workload: 'CPU_BATCH',
          payload: { operation: 'RUNNER_SMOKE' },
          attempt: 1,
          lease_token: leaseToken,
        },
      }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, state: 'COMPLETED' }), { status: 200 });
    },
  });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.task_id, 'task-from-owner-queue');
  assert.equal(calls.find(call => call.path.endsWith('/claim')).body.task_id, undefined);
  assert.equal(calls.find(call => call.path.endsWith('/claim')).body.workload, 'CPU_BATCH');
  assert.equal(result.evidence.event_id, undefined);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.init.headers.authorization === 'Bearer ' + oidcToken));
});
