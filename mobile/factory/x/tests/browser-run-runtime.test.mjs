import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBrowserRunTarget,
  runBrowserRunSmoke,
  closeBrowserRunSession,
  createBrowserRunLiveView,
} from '../continuity-ledger/browser-run-runtime.mjs';
import browserRunWorker from '../continuity-ledger/worker.mjs';

function fakeBinding({ scriptStatus = 200, resultUrl = 'https://example.com/' } = {}) {
  const calls = [];
  const binding = {
    async acquire(options) {
      calls.push(['acquire', options]);
      return { sessionId: 'browser-session-1', targets: [{ id: 'target-1', type: 'page' }] };
    },
    async script(code, options) {
      calls.push(['script', code, options]);
      const body = scriptStatus === 200
        ? { success: true, result: {
            title: 'Example Domain',
            url: resultUrl,
            text: 'Example Domain. This domain is for use in documentation examples.',
          } }
        : { success: false, error: 'SCRIPT_EXECUTION_FAILED' };
      return Response.json(body, {
        status: scriptStatus,
        headers: {
          'cf-browser-session-id': 'browser-session-1',
          'cf-browser-target-id': 'target-1',
        },
      });
    },
    async getLiveView(sessionId, options) {
      calls.push(['getLiveView', sessionId, options]);
      return { devtoolsFrontendUrl: 'https://live.browser.run/ui/view?mode=' + options.mode + '&wss=live.browser.run/api/fake?jwt=ephemeral' };
    },
    async closeSession(sessionId) {
      calls.push(['closeSession', sessionId]);
      return 'closed';
    },
  };
  return { binding, calls };
}

test('accepts only exact allowlisted public HTTPS hostnames', () => {
  assert.equal(
    validateBrowserRunTarget('https://example.com/docs', ['example.com']),
    'https://example.com/docs',
  );
  assert.throws(() => validateBrowserRunTarget('http://example.com', ['example.com']), /HTTPS_REQUIRED/);
  assert.throws(() => validateBrowserRunTarget('https://example.com.attacker.test', ['example.com']), /HOST_NOT_ALLOWLISTED/);
  assert.throws(() => validateBrowserRunTarget('https://user:pass@example.com', ['example.com']), /URL_CREDENTIALS_FORBIDDEN/);
});

test('fails closed when the Cloudflare Browser Run binding is missing', async () => {
  await assert.rejects(
    runBrowserRunSmoke({ browserBinding: null, targetUrl: 'https://example.com/' }),
    /BROWSER_RUN_BINDING_MISSING/,
  );
});

test('creates a guarded Cloudflare browser session and returns verified page evidence plus live view', async () => {
  const { binding, calls } = fakeBinding();
  const result = await runBrowserRunSmoke({
    browserBinding: binding,
    targetUrl: 'https://example.com/',
    allowedHosts: ['example.com'],
    keepAliveMs: 300000,
    liveViewUrlExpiresInMs: 300000,
    liveViewMode: 'tab',
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.runtime, 'cloudflare-browser-run');
  assert.equal(result.session_id, 'browser-session-1');
  assert.equal(result.target_id, 'target-1');
  assert.equal(result.title, 'Example Domain');
  assert.match(result.text_preview, /documentation examples/);
  assert.equal(result.url, 'https://example.com/');
  assert.equal(result.live_view_url, 'https://live.browser.run/ui/view?mode=tab&wss=live.browser.run/api/fake?jwt=ephemeral');
  assert.deepEqual(calls[0], ['acquire', {
    keepAlive: 300000,
    targets: true,
    liveViewUrlExpiresInMs: 300000,
    guardrails: { allowedDomains: ['example.com'] },
  }]);
  const scriptCall = calls.find(([name]) => name === 'script');
  assert.ok(scriptCall, 'browser automation runs through the Browser Run script API');
  assert.match(scriptCall[1], /page\.goto/);
  assert.deepEqual(scriptCall[2], {
    sessionId: 'browser-session-1',
    targetId: 'target-1',
    library: 'playwright',
    timeout: 30000,
  });
  assert.equal(calls.some(([name]) => name === 'connectSession'), false,
    'the runtime does not open a manual CDP WebSocket');
  assert.equal(calls.some(([name]) => name === 'closeSession'), false,
    'successful smoke leaves the short-lived browser session available for live testing');
});

test('closes an acquired session when the Browser Run script endpoint fails', async () => {
  const { binding, calls } = fakeBinding({ scriptStatus: 502 });
  await assert.rejects(
    runBrowserRunSmoke({
      browserBinding: binding,
      targetUrl: 'https://example.com/',
      allowedHosts: ['example.com'],
      keepAliveMs: 300000,
      liveViewUrlExpiresInMs: 300000,
      liveViewMode: 'tab',
    }),
    /BROWSER_SCRIPT_HTTP_502/,
  );
  assert.deepEqual(calls.filter(([name]) => name === 'closeSession'), [
    ['closeSession', 'browser-session-1'],
  ]);
});

test('rejects a script result redirected outside the exact allowlist and closes its session', async () => {
  const { binding, calls } = fakeBinding({ resultUrl: 'https://evil.example/' });
  await assert.rejects(
    runBrowserRunSmoke({
      browserBinding: binding,
      targetUrl: 'https://example.com/',
      allowedHosts: ['example.com'],
      keepAliveMs: 300000,
      liveViewUrlExpiresInMs: 300000,
      liveViewMode: 'tab',
    }),
    /BROWSER_REDIRECT_HOST_NOT_ALLOWLISTED/,
  );
  assert.deepEqual(calls.filter(([name]) => name === 'closeSession'), [
    ['closeSession', 'browser-session-1'],
  ]);
});

test('closes a Browser Run session through the provider binding', async () => {
  const { binding, calls } = fakeBinding();
  const result = await closeBrowserRunSession(binding, 'browser-session-1');
  assert.equal(result.status, 'CLOSED');
  assert.deepEqual(calls, [['closeSession', 'browser-session-1']]);
});

test('invalid session identifiers cannot trigger provider operations', async () => {
  const { binding, calls } = fakeBinding();
  await assert.rejects(closeBrowserRunSession(binding, '../unexpected'), /SESSION_ID_INVALID/);
  assert.equal(calls.length, 0);
});


test('creates a fresh interactive tab Live View URL for an owned Browser Run session', async () => {
  const { binding, calls } = fakeBinding();
  const result = await createBrowserRunLiveView(binding, 'browser-session-1', 'target-1', 'tab');
  assert.equal(result.live_view_url, 'https://live.browser.run/ui/view?mode=tab&wss=live.browser.run/api/fake?jwt=ephemeral');
  assert.deepEqual(calls, [['getLiveView', 'browser-session-1', { targetId: 'target-1', mode: 'tab' }]]);
});

test('rejects malformed session and target identifiers before minting a Live View URL', async () => {
  const { binding, calls } = fakeBinding();
  await assert.rejects(createBrowserRunLiveView(binding, '../bad', 'target-1', 'tab'), /SESSION_ID_INVALID/);
  await assert.rejects(createBrowserRunLiveView(binding, 'browser-session-1', '../bad', 'tab'), /TARGET_ID_INVALID/);
  assert.equal(calls.length, 0);
});

test('Browser Mesh CORS preflight permits only the two packaged MIDAD origins', async () => {
  const allowed = await browserRunWorker.fetch(new Request(
    'https://midad-continuity-ledger.midadbot.workers.dev/v1/browser/ui/start',
    { method: 'OPTIONS', headers: { origin: 'https://appassets.androidplatform.net' } },
  ), {});
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
  assert.equal(allowed.headers.get('access-control-allow-methods'), 'POST,OPTIONS');

  const blocked = await browserRunWorker.fetch(new Request(
    'https://midad-continuity-ledger.midadbot.workers.dev/v1/browser/ui/start',
    { method: 'OPTIONS', headers: { origin: 'https://untrusted.example' } },
  ), {});
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
});

test('Browser Mesh UI POST requests fail closed without a Durable Object binding', async () => {
  const result = await browserRunWorker.fetch(new Request(
    'https://midad-continuity-ledger.midadbot.workers.dev/v1/browser/ui/status',
    {
      method: 'POST',
      headers: { origin: 'https://sirahwaz.github.io', 'content-type': 'application/json' },
      body: JSON.stringify({ session_token: 'A'.repeat(48) }),
    },
  ), {});
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('access-control-allow-origin'), 'https://sirahwaz.github.io');
});
