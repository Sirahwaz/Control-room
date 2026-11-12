import { pathToFileURL } from 'node:url';

const WORKER_ORIGIN = 'https://midad-continuity-ledger.midadbot.workers.dev';
const JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const POLICY_MARKER = 'legacy-and-immutable-v5-jwks-cache';
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

function fail(code) {
  throw new Error(code);
}

function normalizePublicJwks(document) {
  if (!Array.isArray(document?.keys) || document.keys.length < 1 || document.keys.length > 32) {
    fail('GITHUB_OIDC_JWKS_INVALID');
  }
  const seenKids = new Set();
  return document.keys.map(key => {
    if (!key || typeof key !== 'object' || Array.isArray(key) ||
        PRIVATE_JWK_FIELDS.some(field => Object.hasOwn(key, field)) ||
        key.kty !== 'RSA' || key.alg !== 'RS256' || key.use !== 'sig' ||
        typeof key.kid !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(key.kid) ||
        typeof key.n !== 'string' || !/^[A-Za-z0-9_-]{256,2048}$/.test(key.n) ||
        typeof key.e !== 'string' || !/^[A-Za-z0-9_-]{2,16}$/.test(key.e) ||
        seenKids.has(key.kid)) {
      fail('GITHUB_OIDC_JWKS_INVALID');
    }
    seenKids.add(key.kid);
    return { kty: 'RSA', alg: 'RS256', use: 'sig', kid: key.kid, n: key.n, e: key.e };
  });
}

/**
 * Fetch GitHub's official public signing keys on a trusted GitHub Actions runner
 * and synchronize only public RSA JWK fields to the admin-protected Continuity Worker.
 * No token or secret material is logged or returned.
 */
export async function syncGitHubActionsOidcJwks({
  origin = process.env.MIDAD_CONTINUITY_LEDGER_URL || WORKER_ORIGIN,
  adminKey = process.env.MIDAD_LEDGER_ADMIN_KEY || '',
  fetchImpl = fetch,
} = {}) {
  let worker;
  try { worker = new URL(origin); } catch { fail('MIDAD_LEDGER_URL_INVALID'); }
  if (worker.protocol !== 'https:' || worker.hostname !== new URL(WORKER_ORIGIN).hostname ||
      worker.username || worker.password || worker.port || worker.search || worker.hash) {
    fail('MIDAD_LEDGER_URL_INVALID');
  }
  if (typeof adminKey !== 'string' || adminKey.length < 32) fail('LEDGER_ADMIN_KEY_MISSING');

  let healthResponse;
  try {
    healthResponse = await fetchImpl(origin + '/health', {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    fail('LEDGER_HEALTH_UNAVAILABLE');
  }
  if (!healthResponse.ok) fail('LEDGER_HEALTH_UNAVAILABLE');
  let health;
  try { health = await healthResponse.json(); } catch { fail('LEDGER_HEALTH_INVALID'); }
  if (health?.ok !== true || health?.service !== 'midad-continuity-ledger' ||
      health?.node_auth !== 'github-actions-oidc-v1' ||
      health?.oidc_subject_policy !== POLICY_MARKER) {
    fail('LEDGER_OIDC_POLICY_NOT_READY');
  }

  let jwksResponse;
  try {
    jwksResponse = await fetchImpl(JWKS_URL, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    fail('GITHUB_OIDC_JWKS_SOURCE_UNAVAILABLE');
  }
  if (!jwksResponse.ok) fail('GITHUB_OIDC_JWKS_SOURCE_UNAVAILABLE');
  let document;
  try { document = await jwksResponse.json(); } catch { fail('GITHUB_OIDC_JWKS_INVALID'); }
  const keys = normalizePublicJwks(document);

  let syncResponse;
  try {
    syncResponse = await fetchImpl(origin + '/internal/oidc/jwks', {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: 'Bearer ' + adminKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ keys }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    fail('LEDGER_JWKS_SYNC_UNAVAILABLE');
  }
  let result;
  try { result = await syncResponse.json(); } catch { fail('LEDGER_JWKS_SYNC_RESPONSE_INVALID'); }
  if (!syncResponse.ok || result?.ok !== true || result?.key_count !== keys.length) {
    fail('LEDGER_JWKS_SYNC_REJECTED');
  }
  return { ok: true, key_count: keys.length, expires_at_ms: result.expires_at_ms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await syncGitHubActionsOidcJwks();
    process.stdout.write(JSON.stringify({
      status: 'GITHUB_OIDC_JWKS_SYNCED',
      key_count: result.key_count,
      expires_at_ms: result.expires_at_ms,
    }) + '\n');
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)
      ? error.message
      : 'GITHUB_OIDC_JWKS_SYNC_FAILED';
    process.stderr.write(code + '\n');
    process.exitCode = 1;
  }
}
