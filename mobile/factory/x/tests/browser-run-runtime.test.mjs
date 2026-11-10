import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBrowserRunTarget,
  runBrowserRunSmoke,
  closeBrowserRunSession,
} from '../continuity-ledger/browser-run-runtime.mjs';

class FakeSocket extends EventTarget {
  accepted = false;
  closed = false;
  accept() { this.accepted = true; }
  send(raw) {
    const command = JSON.parse(raw);
    let result = {};
    if (command.method === 'Runtime.evaluate') {
      result = { result: { type: 'object', value: {
        title: 'Example Domain',
        url: 'https://example.com/',
        text: 'Example Domain. This domain is for use in documentation examples.',
      } } };
    }
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ id: command.id, result }),
    })));
  }
  close() { this.closed = true; this.dispatchEvent(new Event('close')); }
}

function fakeBinding() {
  const socket = new FakeSocket();
  const calls = [];
  const binding = {
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
      return { devtoolsFrontendUrl: 'https://live.browser.run/inspector?token=ephemeral' };
    },
    async closeSession(sessionId) {
      calls.push(['closeSession', sessionId]);
      return 'closed';
    },
  };
  return { binding, calls, socket };
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
  const { binding, calls, socket } = fakeBinding();
  const result = await runBrowserRunSmoke({
    browserBinding: binding,
    targetUrl: 'https://example.com/',
    allowedHosts: ['example.com'],
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.runtime, 'cloudflare-browser-run');
  assert.equal(result.session_id, 'browser-session-1');
  assert.equal(result.title, 'Example Domain');
  assert.match(result.text_preview, /documentation examples/);
  assert.equal(result.url, 'https://example.com/');
  assert.equal(result.live_view_url, 'https://live.browser.run/inspector?token=ephemeral');
  assert.equal(socket.accepted, true);
  assert.equal(socket.closed, true);
  assert.deepEqual(calls[0], ['acquire', {
    keepAlive: 60000,
    targets: true,
    liveViewUrlExpiresInMs: 60000,
    guardrails: { allowedDomains: ['example.com'] },
  }]);
  assert.equal(calls.some(([name]) => name === 'closeSession'), false,
    'successful smoke leaves the short-lived browser session available for live testing');
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
