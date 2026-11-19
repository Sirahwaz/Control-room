import {
  OidcVerificationError,
  resetGithubJwksCacheForTests,
  verifyGithubActionsOidc,
} from "./github-actions-oidc.ts";

const NOW = 1_800_000_000_000;
const EXPECTED = {
  audience: "midad-browser-worker",
  repository: "Sirahwaz/Control-room",
  repositoryOwner: "Sirahwaz",
  ref: "refs/heads/main",
  workflowRef: "Sirahwaz/Control-room/.github/workflows/midad-browser-ephemeral-worker.yml@refs/heads/main",
  allowedEvents: ["schedule", "workflow_dispatch", "workflow_run"],
};

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function fixture(overrides: Record<string, unknown> = {}, signingKey?: CryptoKey) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = {
    ...await crypto.subtle.exportKey("jwk", pair.publicKey),
    kid: "midad-test-key",
    use: "sig",
    alg: "RS256",
  };
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "midad-test-key" })));
  const claims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: EXPECTED.audience,
    sub: "repo:Sirahwaz/Control-room:ref:refs/heads/main",
    repository: EXPECTED.repository,
    repository_owner: EXPECTED.repositoryOwner,
    ref: EXPECTED.ref,
    workflow_ref: EXPECTED.workflowRef,
    event_name: "schedule",
    run_id: "123456789",
    run_attempt: "1",
    runner_environment: "github-hosted",
    iat: Math.floor(NOW / 1000) - 10,
    nbf: Math.floor(NOW / 1000) - 10,
    exp: Math.floor(NOW / 1000) + 300,
    ...overrides,
  };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = header + "." + payload;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey || pair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  const token = signingInput + "." + b64url(new Uint8Array(signature));
  const fetcher = async () => new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "max-age=600" },
  });
  return { token, fetcher, pair };
}

Deno.test("accepts a correctly signed GitHub Actions token for the exact repository and workflow", async () => {
  resetGithubJwksCacheForTests();
  const f = await fixture();
  const claims = await verifyGithubActionsOidc(f.token, EXPECTED, { fetcher: f.fetcher, nowMs: NOW });
  if (claims.repository !== EXPECTED.repository || claims.event_name !== "schedule") {
    throw new Error("verified claims mismatch");
  }
});

Deno.test("accepts a workflow_run token only for the exact main workflow", async () => {
  resetGithubJwksCacheForTests();
  const f = await fixture({ event_name: "workflow_run" });
  const claims = await verifyGithubActionsOidc(f.token, EXPECTED, { fetcher: f.fetcher, nowMs: NOW });
  if (claims.event_name !== "workflow_run") throw new Error("workflow_run claim mismatch");
});

Deno.test("rejects wrong repository, ref, workflow, audience and event", async () => {
  for (const override of [
    { repository: "someone/else" },
    { ref: "refs/heads/feature" },
    { workflow_ref: "Sirahwaz/Control-room/.github/workflows/other.yml@refs/heads/main" },
    { aud: "another-audience" },
    { event_name: "pull_request" },
    { runner_environment: undefined },
    { runner_environment: "self-hosted" },
  ]) {
    resetGithubJwksCacheForTests();
    const f = await fixture(override);
    let rejected = false;
    try {
      await verifyGithubActionsOidc(f.token, EXPECTED, { fetcher: f.fetcher, nowMs: NOW });
    } catch (error) {
      rejected = error instanceof OidcVerificationError;
    }
    if (!rejected) throw new Error("untrusted claim accepted: " + JSON.stringify(override));
  }
});

Deno.test("rejects expired tokens and invalid issue times", async () => {
  for (const override of [
    { exp: Math.floor(NOW / 1000) - 1 },
    { iat: Math.floor(NOW / 1000) - 1000 },
    { nbf: Math.floor(NOW / 1000) + 120 },
  ]) {
    resetGithubJwksCacheForTests();
    const f = await fixture(override);
    let rejected = false;
    try {
      await verifyGithubActionsOidc(f.token, EXPECTED, { fetcher: f.fetcher, nowMs: NOW });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("invalid time claim accepted");
  }
});

Deno.test("rejects a forged signature even when all claims are valid", async () => {
  resetGithubJwksCacheForTests();
  const wrongPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const f = await fixture({}, wrongPair.privateKey);
  let rejected = false;
  try {
    await verifyGithubActionsOidc(f.token, EXPECTED, { fetcher: f.fetcher, nowMs: NOW });
  } catch (error) {
    rejected = error instanceof OidcVerificationError;
  }
  if (!rejected) throw new Error("forged signature accepted");
});

Deno.test("fails closed when GitHub JWKS cannot be fetched", async () => {
  resetGithubJwksCacheForTests();
  const f = await fixture();
  let rejected = false;
  try {
    await verifyGithubActionsOidc(f.token, EXPECTED, {
      fetcher: async () => new Response("unavailable", { status: 503 }),
      nowMs: NOW,
    });
  } catch (error) {
    rejected = error instanceof OidcVerificationError && error.code === "github_jwks_unavailable";
  }
  if (!rejected) throw new Error("JWKS outage did not fail closed");
});
