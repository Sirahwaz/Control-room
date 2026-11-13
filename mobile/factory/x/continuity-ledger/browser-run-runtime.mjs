const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;
let nextCdpCommandId = 0;

function publicHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!HOST_PATTERN.test(host) || !host.includes('.')) return false;
  if (/^(?:localhost|.*\.(?:localhost|local|internal|test|invalid))$/.test(host)) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
  return true;
}

function normalizeAllowedHosts(allowedHosts) {
  if (!Array.isArray(allowedHosts) || allowedHosts.length < 1 || allowedHosts.length > 50) {
    throw new Error('ALLOWED_HOSTS_REQUIRED');
  }
  const normalized = [...new Set(allowedHosts.map(value => String(value || '').trim().toLowerCase()))];
  for (const host of normalized) {
    const candidate = host.startsWith('*.') ? host.slice(2) : host;
    if (!publicHostname(candidate)) throw new Error('ALLOWED_HOST_INVALID');
    if (host.includes('*') && !host.startsWith('*.')) throw new Error('ALLOWED_HOST_INVALID');
  }
  return normalized;
}

function hostAllowed(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  return allowedHosts.some(pattern => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix) && host !== pattern.slice(2);
    }
    return host === pattern;
  });
}

export function validateBrowserRunTarget(targetUrl, allowedHosts = []) {
  let url;
  try { url = new URL(String(targetUrl || '')); }
  catch { throw new Error('TARGET_URL_INVALID'); }
  if (url.protocol !== 'https:') throw new Error('HTTPS_REQUIRED');
  if (url.username || url.password) throw new Error('URL_CREDENTIALS_FORBIDDEN');
  if (url.port && url.port !== '443') throw new Error('HTTPS_PORT_NOT_ALLOWED');
  const allowlist = normalizeAllowedHosts(allowedHosts);
  if (!hostAllowed(url.hostname, allowlist)) throw new Error('HOST_NOT_ALLOWLISTED');
  if (!publicHostname(url.hostname)) throw new Error('PUBLIC_HOST_REQUIRED');
  return url.toString();
}

function sendCdpCommand(socket, method, params = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const id = ++nextCdpCommandId;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('CDP_COMMAND_TIMEOUT:' + method));
    }, timeoutMs);
    const onClose = () => {
      cleanup();
      reject(new Error('CDP_CONNECTION_CLOSED:' + method));
    };
    const onMessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.id !== id) return;
      cleanup();
      if (message.error) reject(new Error('CDP_COMMAND_FAILED:' + method));
      else resolve(message.result ?? {});
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    try { socket.send(JSON.stringify({ id, method, params })); }
    catch (error) { cleanup(); reject(error); }
  });
}

function assertBinding(binding) {
  if (!binding || typeof binding.acquire !== 'function' ||
      typeof binding.connectSession !== 'function' ||
      typeof binding.getLiveView !== 'function' ||
      typeof binding.closeSession !== 'function') {
    throw new Error('BROWSER_RUN_BINDING_MISSING');
  }
}

function normalizeEvidence(value, fallbackUrl) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BROWSER_PAGE_EVIDENCE_INVALID');
  }
  const title = String(value.title ?? '').slice(0, 200);
  const textPreview = String(value.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1400);
  let url;
  try { url = new URL(String(value.url || fallbackUrl)); }
  catch { throw new Error('BROWSER_PAGE_URL_INVALID'); }
  if (url.protocol !== 'https:') throw new Error('BROWSER_PAGE_URL_INVALID');
  return { title, url: url.toString(), text_preview: textPreview };
}

function normalizeLiveView(value) {
  let url;
  try { url = new URL(String(value?.devtoolsFrontendUrl || '')); }
  catch { throw new Error('BROWSER_LIVE_VIEW_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.hostname !== 'live.browser.run') {
    throw new Error('BROWSER_LIVE_VIEW_URL_INVALID');
  }
  return url.toString();
}

export async function runBrowserRunSmoke({
  browserBinding,
  targetUrl,
  allowedHosts = [],
  keepAliveMs = 60000,
  liveViewUrlExpiresInMs = 60000,
  liveViewMode = 'devtools',
} = {}) {
  assertBinding(browserBinding);
  if (!Number.isInteger(keepAliveMs) || keepAliveMs < 10000 || keepAliveMs > 1200000) {
    throw new Error('BROWSER_KEEP_ALIVE_INVALID');
  }
  if (!Number.isInteger(liveViewUrlExpiresInMs) || liveViewUrlExpiresInMs < 60000 || liveViewUrlExpiresInMs > 3600000) {
    throw new Error('BROWSER_LIVE_VIEW_TTL_INVALID');
  }
  if (!['tab', 'full', 'devtools'].includes(liveViewMode)) {
    throw new Error('BROWSER_LIVE_VIEW_MODE_INVALID');
  }
  const normalizedUrl = validateBrowserRunTarget(targetUrl, allowedHosts);
  const normalizedHosts = normalizeAllowedHosts(allowedHosts);
  let sessionId = null;
  let socket = null;
  let keepSession = false;
  try {
    const session = await browserBinding.acquire({
      keepAlive: keepAliveMs,
      targets: true,
      liveViewUrlExpiresInMs,
      guardrails: { allowedDomains: normalizedHosts },
    });
    sessionId = session?.sessionId;
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      throw new Error('BROWSER_SESSION_ID_INVALID');
    }
    const target = Array.isArray(session.targets)
      ? session.targets.find(item => item?.type === 'page' && typeof item.id === 'string' && SESSION_ID_PATTERN.test(item.id))
      : null;
    if (!target) throw new Error('BROWSER_PAGE_TARGET_MISSING');

    const connection = await browserBinding.connectSession(sessionId, { targetId: target.id });
    if (!connection?.webSocket || typeof connection.webSocket.fetch !== 'function') {
      throw new Error('BROWSER_WEBSOCKET_FETCHER_MISSING');
    }
    const websocketResponse = await connection.webSocket.fetch('https://browser-binding.invalid', {
      headers: { Upgrade: 'websocket' },
    });
    socket = websocketResponse?.webSocket;
    if (!socket || typeof socket.accept !== 'function' || typeof socket.send !== 'function') {
      throw new Error('BROWSER_RUN_WEBSOCKET_MISSING');
    }
    socket.accept();
    await sendCdpCommand(socket, 'Page.enable');
    await sendCdpCommand(socket, 'Runtime.enable');
    await sendCdpCommand(socket, 'Page.navigate', { url: normalizedUrl });
    const evaluated = await sendCdpCommand(socket, 'Runtime.evaluate', {
      expression: '({ title: document.title, url: location.href, text: (document.body?.innerText || "").slice(0, 1400) })',
      returnByValue: true,
      awaitPromise: true,
    });
    const evidence = normalizeEvidence(evaluated?.result?.value, normalizedUrl);
    if (!hostAllowed(new URL(evidence.url).hostname, normalizedHosts)) {
      throw new Error('BROWSER_REDIRECT_HOST_NOT_ALLOWLISTED');
    }
    const liveView = await browserBinding.getLiveView(sessionId, {
      targetId: target.id,
      mode: liveViewMode,
    });
    const liveViewUrl = normalizeLiveView(liveView);
    keepSession = true;
    return {
      status: 'PASS',
      runtime: 'cloudflare-browser-run',
      session_id: sessionId,
      target_id: target.id,
      title: evidence.title,
      url: evidence.url,
      text_preview: evidence.text_preview,
      live_view_url: liveViewUrl,
    };
  } finally {
    try { socket?.close(); } catch {}
    if (sessionId && !keepSession) {
      try { await browserBinding.closeSession(sessionId); } catch {}
    }
  }
}

export async function closeBrowserRunSession(browserBinding, sessionId) {
  if (!browserBinding || typeof browserBinding.closeSession !== 'function') {
    throw new Error('BROWSER_RUN_BINDING_MISSING');
  }
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('SESSION_ID_INVALID');
  }
  const result = await browserBinding.closeSession(sessionId);
  const state = typeof result === 'string' ? result : result?.status;
  return {
    status: state === 'closed' || state === 'CLOSED' ? 'CLOSED' : 'CLOSING',
    session_id: sessionId,
  };
}

export async function createBrowserRunLiveView(browserBinding, sessionId, targetId, mode = 'tab') {
  if (!browserBinding || typeof browserBinding.getLiveView !== 'function') {
    throw new Error('BROWSER_RUN_BINDING_MISSING');
  }
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('SESSION_ID_INVALID');
  }
  if (typeof targetId !== 'string' || !SESSION_ID_PATTERN.test(targetId)) {
    throw new Error('TARGET_ID_INVALID');
  }
  if (!['tab', 'full', 'devtools'].includes(mode)) {
    throw new Error('BROWSER_LIVE_VIEW_MODE_INVALID');
  }
  const liveView = await browserBinding.getLiveView(sessionId, { targetId, mode });
  return { live_view_url: normalizeLiveView(liveView) };
}
