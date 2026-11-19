export type GithubOidcClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  repository: string;
  repository_owner: string;
  ref: string;
  workflow_ref: string;
  event_name: string;
  run_id: string;
  run_attempt: string;
  actor?: string;
  runner_environment?: string;
  exp: number;
  iat: number;
  nbf?: number;
};

export type GithubOidcExpected = {
  audience: string;
  repository: string;
  repositoryOwner: string;
  ref: string;
  workflowRef: string;
  allowedEvents: readonly string[];
};

type JwksResponse = { keys?: JsonWebKey[] };
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class OidcVerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OidcVerificationError";
  }
}

let jwksCache: { keys: JsonWebKey[]; expiresAt: number } | null = null;

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new OidcVerificationError("jwt_base64url_invalid");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new OidcVerificationError("jwt_base64url_invalid");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonSegment<T>(segment: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment))) as T;
  } catch (error) {
    if (error instanceof OidcVerificationError) throw error;
    throw new OidcVerificationError("jwt_json_invalid");
  }
}

async function getGithubJwks(fetcher: Fetcher, nowMs: number): Promise<JsonWebKey[]> {
  if (jwksCache && jwksCache.expiresAt > nowMs) return jwksCache.keys;
  let response: Response;
  try {
    response = await fetcher("https://token.actions.githubusercontent.com/.well-known/jwks", {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new OidcVerificationError("github_jwks_unreachable");
  }
  if (!response.ok) throw new OidcVerificationError("github_jwks_unavailable");
  const body = await response.json().catch(() => null) as JwksResponse | null;
  if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
    throw new OidcVerificationError("github_jwks_invalid");
  }
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/i)?.[1] || 600);
  jwksCache = {
    keys: body.keys,
    expiresAt: nowMs + Math.max(60, Math.min(maxAge, 3600)) * 1000,
  };
  return jwksCache.keys;
}

export function resetGithubJwksCacheForTests(): void {
  jwksCache = null;
}

export async function verifyGithubActionsOidc(
  token: string,
  expected: GithubOidcExpected,
  options: { fetcher?: Fetcher; nowMs?: number } = {},
): Promise<GithubOidcClaims> {
  if (typeof token !== "string" || token.length < 100 || token.length > 16384) {
    throw new OidcVerificationError("jwt_size_invalid");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new OidcVerificationError("jwt_shape_invalid");
  const header = decodeJsonSegment<{ alg?: string; kid?: string; typ?: string }>(parts[0]);
  const claims = decodeJsonSegment<GithubOidcClaims>(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new OidcVerificationError("jwt_algorithm_invalid");

  const nowMs = options.nowMs ?? Date.now();
  const now = Math.floor(nowMs / 1000);
  const fetcher = options.fetcher ?? fetch;
  const keys = await getGithubJwks(fetcher, nowMs);
  const jwk = keys.find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid);
  const jwkMetadata = jwk as (JsonWebKey & { kid?: string; use?: string; alg?: string }) | undefined;
  if (
    !jwk ||
    jwk.kty !== "RSA" ||
    (jwkMetadata?.use !== undefined && jwkMetadata.use !== "sig") ||
    (jwkMetadata?.alg !== undefined && jwkMetadata.alg !== "RS256")
  ) {
    throw new OidcVerificationError("jwt_signing_key_unknown");
  }
  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new OidcVerificationError("jwt_signing_key_invalid");
  }
  let signatureValid = false;
  try {
    const signatureBytes = decodeBase64Url(parts[2]);
    const signingBytes = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const signatureBuffer = new ArrayBuffer(signatureBytes.byteLength);
    const signingBuffer = new ArrayBuffer(signingBytes.byteLength);
    new Uint8Array(signatureBuffer).set(signatureBytes);
    new Uint8Array(signingBuffer).set(signingBytes);
    signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signatureBuffer,
      signingBuffer,
    );
  } catch {
    throw new OidcVerificationError("jwt_signature_invalid");
  }
  if (!signatureValid) throw new OidcVerificationError("jwt_signature_invalid");

  if (claims.iss !== "https://token.actions.githubusercontent.com") {
    throw new OidcVerificationError("jwt_issuer_invalid");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.audience)) throw new OidcVerificationError("jwt_audience_invalid");
  if (claims.repository !== expected.repository || claims.repository_owner !== expected.repositoryOwner) {
    throw new OidcVerificationError("jwt_repository_invalid");
  }
  if (claims.ref !== expected.ref || claims.workflow_ref !== expected.workflowRef) {
    throw new OidcVerificationError("jwt_workflow_invalid");
  }
  if (!expected.allowedEvents.includes(claims.event_name)) {
    throw new OidcVerificationError("jwt_event_invalid");
  }
  if (claims.sub !== `repo:${expected.repository}:ref:${expected.ref}`) {
    throw new OidcVerificationError("jwt_subject_invalid");
  }
  if (claims.runner_environment && claims.runner_environment !== "github-hosted") {
    throw new OidcVerificationError("jwt_runner_environment_invalid");
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new OidcVerificationError("jwt_expired");
  if (!Number.isFinite(claims.iat) || claims.iat > now + 30 || claims.iat < now - 600) {
    throw new OidcVerificationError("jwt_issued_at_invalid");
  }
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 30)) {
    throw new OidcVerificationError("jwt_not_yet_valid");
  }
  if (!/^\d{1,20}$/.test(String(claims.run_id)) || !/^\d{1,5}$/.test(String(claims.run_attempt))) {
    throw new OidcVerificationError("jwt_run_identity_invalid");
  }

  return claims;
}
