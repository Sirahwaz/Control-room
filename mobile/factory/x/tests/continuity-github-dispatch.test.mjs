import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { dispatchGitHubWorkflow } from '../continuity-ledger/github-dispatch.mjs';
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
function toPem(bytes) {
  const b64 = Buffer.from(bytes).toString('base64').match(/.{1,64}/g).join('\n');
  return '-----BEGIN PRIVATE KEY-----\n' + b64 + '\n-----END PRIVATE KEY-----';
}
async function keyFixture() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
    true,
    ['sign','verify'],
  );
  return {
    pem: toPem(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)),
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
      assert.deepEqual(body.permissions, { actions: 'write' });
      return new Response(JSON.stringify({
        token: 'ghs_test_installation_token_not_a_real_secret',
        permissions: { actions: 'write' },
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
    MIDAD_GITHUB_APP_PRIVATE_KEY: keys.pem,
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
  }, fetchMock), /GITHUB_APP_ACTIONS_WRITE_REQUIRED/);
  assert.equal(dispatchCalled, false);
});

test('non-204 workflow dispatch response is surfaced as a retryable failure', async () => {
  const keys = await keyFixture();
  const fetchMock = async url => String(url).includes('/access_tokens')
    ? new Response(JSON.stringify({ token: 'ghs_test', permissions: { actions: 'write' } }), { status: 201 })
    : new Response(JSON.stringify({ message: 'rate limit' }), { status: 429 });
  await assert.rejects(() => dispatchGitHubWorkflow(EVENT, {
    MIDAD_GITHUB_APP_ID: APP_ID,
    MIDAD_GITHUB_INSTALLATION_ID: INSTALLATION_ID,
    MIDAD_GITHUB_APP_PRIVATE_KEY: keys.pem,
  }, fetchMock), /GITHUB_WORKFLOW_DISPATCH_FAILED_429/);
});

test('ephemeral runner workflow is manual-dispatch only, least privilege and does not expose tokens', async () => {
  const workflow = await readFile(new URL('../../../../.github/workflows/midad-mncf-ephemeral-runner.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /MIDAD_CONTINUITY_RUNNER_NODE_TOKEN/);
  assert.match(workflow, /midad-ephemeral-runner\.mjs/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write|contents:\s*write|id-token:\s*write/);
  assert.doesNotMatch(workflow, /echo .*MIDAD_CONTINUITY_RUNNER_NODE_TOKEN|printf .*MIDAD_CONTINUITY_RUNNER_NODE_TOKEN/);
});
