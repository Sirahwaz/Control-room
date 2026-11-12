const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const OIDC_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const OIDC_AUDIENCE = 'midad-continuity-ledger';

export const GITHUB_ACTIONS_OIDC_POLICY = Object.freeze({
  issuer: OIDC_ISSUER,
  jwksUrl: OIDC_JWKS_URL,
  audience: OIDC_AUDIENCE,
  repository: 'Sirahwaz/Control-room',
  repositoryId: '1377540065',
  repositoryOwner: 'Sirahwaz',
  repositoryOwnerId: '116122510',
  ref: 'refs/heads/main',
  subject: 'repo:Sirahwaz/Control-room:ref:refs/heads/main',
  immutableSubject: 'repo:Sirahwaz@116122510/Control-room@1377540065:ref:refs/heads/main',
  subjectPolicyVersion: 'legacy-and-immutable-v1',
  workflowRef: 'Sirahwaz/Control-room/.github/workflows/midad-mncf-ephemeral-runner.yml@refs/heads/main',
  nodeId: 'github-actions-cpu-batch',
  ownerId: 'github:116122510',
  capability: 'cpu-batch',
});

const jwksCache = { keys: null, expiresAt: 0 };

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('GITHUB_OIDC_CLAIMS_INVALID');
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
  } catch {
    throw new Error('GITHUB_OIDC_CLAIMS_INVALID');
  }
}

async function loadJwks(fetchImpl, cache, now, forceRefresh = false) {
  if (!forceRefresh && Array.isArray(cache.keys) && cache.expiresAt > now) return cache.keys;
  const response = await fetchImpl(OIDC_JWKS_URL, {
    method: 'GET',
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('GITHUB_OIDC_JWKS_UNAVAILABLE');
  const document = await response.json();
  if (!Array.isArray(document?.keys) || document.keys.length < 1 || document.keys.length > 32) {
    throw new Error('GITHUB_OIDC_JWKS_INVALID');
  }
  cache.keys = document.keys.filter(key =>
    key && key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig' &&
    typeof key.kid === 'string' && typeof key.n === 'string' && typeof key.e === 'string'
  );
  cache.expiresAt = now + 5 * 60 * 1000;
  return cache.keys;
}

function matchesAudience(aud, expected) {
  return aud === expected || (Array.isArray(aud) && aud.includes(expected));
}

/**
 * Verify a short-lived GitHub Actions OIDC assertion for the one MNCF CPU runner.
 * This intentionally binds trust to repository, immutable repository IDs and subject, main ref,
 * event type, audience and the exact workflow file; no other GitHub workflow can
 * authenticate as this enrolled node.
 */
export async function verifyGitHubActionsOidcToken(
  token,
  { fetchImpl = fetch, cache = jwksCache, now = Date.now() } = {},
) {
  if (typeof token !== 'string' || token.length < 100 || token.length > 16384) {
    throw new Error('GITHUB_OIDC_CLAIMS_INVALID');
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('GITHUB_OIDC_CLAIMS_INVALID');
  const header = decodeJsonSegment(parts[0]);
  const claims = decodeJsonSegment(parts[1]);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' ||
      claims?.iss !== OIDC_ISSUER || !matchesAudience(claims?.aud, OIDC_AUDIENCE) ||
      ![GITHUB_ACTIONS_OIDC_POLICY.subject, GITHUB_ACTIONS_OIDC_POLICY.immutableSubject].includes(claims?.sub) ||
      !Number.isFinite(claims?.exp) || !Number.isFinite(claims?.iat) ||
      (claims.nbf !== undefined && !Number.isFinite(claims.nbf))) {
    throw new Error('GITHUB_OIDC_CLAIMS_INVALID');
  }

  const nowSeconds = Math.floor(now / 1000);
  if (claims.exp <= nowSeconds || claims.iat > nowSeconds + 30 ||
      claims.iat < nowSeconds - 600 ||
      (claims.nbf !== undefined && claims.nbf > nowSeconds + 30)) {
    throw new Error('GITHUB_OIDC_TOKEN_EXPIRED');
  }

  const repositoryMatches =
    claims.repository === GITHUB_ACTIONS_OIDC_POLICY.repository &&
    String(claims.repository_id) === GITHUB_ACTIONS_OIDC_POLICY.repositoryId;
  if (!repositoryMatches) throw new Error('GITHUB_OIDC_REPOSITORY_NOT_ALLOWED');

  const ownerMatches =
    claims.repository_owner === GITHUB_ACTIONS_OIDC_POLICY.repositoryOwner &&
    String(claims.repository_owner_id) === GITHUB_ACTIONS_OIDC_POLICY.repositoryOwnerId;
  if (!ownerMatches) throw new Error('GITHUB_OIDC_OWNER_NOT_ALLOWED');

  if (claims.ref !== GITHUB_ACTIONS_OIDC_POLICY.ref ||
      claims.workflow_ref !== GITHUB_ACTIONS_OIDC_POLICY.workflowRef ||
      !['schedule', 'workflow_dispatch'].includes(claims.event_name)) {
    throw new Error('GITHUB_OIDC_WORKFLOW_NOT_ALLOWED');
  }

  let key = (await loadJwks(fetchImpl, cache, now)).find(candidate => candidate.kid === header.kid);
  if (!key) {
    key = (await loadJwks(fetchImpl, cache, now, true)).find(candidate => candidate.kid === header.kid);
  }
  if (!key) throw new Error('GITHUB_OIDC_SIGNING_KEY_UNKNOWN');

  let imported;
  try {
    imported = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    throw new Error('GITHUB_OIDC_SIGNING_KEY_INVALID');
  }

  const signature = decodeBase64Url(parts[2]);
  const signedBytes = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    imported,
    signature,
    signedBytes,
  );
  if (!valid) throw new Error('GITHUB_OIDC_SIGNATURE_INVALID');
  return claims;
}
