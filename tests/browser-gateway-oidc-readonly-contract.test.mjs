import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");
const gateway = read("supabase/functions/midad_browser_agent_gateway/index.ts");

const oidc = read("supabase/functions/_shared/github-actions-oidc.ts");
const runner = read("tools/midad-browser-runtime/runner.py");
const worker = read("tools/midad-browser-runtime/ephemeral_readonly_worker.py");
const workflow = read(".github/workflows/midad-browser-ephemeral-worker.yml");
const supabaseConfig = read("supabase/config.toml");
const ledger = read("supabase/functions/midad_browser_agent_gateway/ledger.ts");
const controlRoom = read("ai-room.html");
const readonlyMigration = read("supabase/migrations/20261119214000_midad_browser_readonly_claim_hardening_v1.sql");

test("gateway exposes a separate read-only claim path and validates its lease on writes", () => {
  assert.match(gateway, /subaction === "create_readonly_job"/);
  assert.match(gateway, /PUBLIC_READONLY_ALLOWED_HOSTS/);
  assert.match(gateway, /inserted\.error\.code === "23505"/);
  assert.match(readonlyMigration, /midad_browser_jobs_public_readonly_idempotency_idx/);
  assert.match(readonlyMigration, /j\.agent_key = 'midad_public_research'/);
  assert.match(readonlyMigration, /j\.platform_key = 'public_read_only'/);
  assert.match(readonlyMigration, /->> 'mode' = 'public_read_only'/);
  assert.match(gateway, /action === "claim_readonly_jobs"/);
  assert.match(gateway, /midad_browser_claim_readonly_jobs_v1/);
  assert.match(gateway, /const hasWorkerLease = body\.worker_id !== undefined \|\| body\.lease_token !== undefined/);
  assert.match(gateway, /validateOperatorLease\(sb, job, body\)/);
});

test("read-only claims return only minimal job fields and never profile snapshots or input data", () => {
  const start = gateway.indexOf('if (action === "claim_readonly_jobs")');
  const end = gateway.indexOf('if (action === "renew_operator_lease"', start);
  const block = gateway.slice(start, end);
  const mapStart = block.indexOf(".map((job: Record<string, any>) => ({");
  const mapEnd = block.indexOf("}));", mapStart);
  assert.ok(mapStart >= 0 && mapEnd > mapStart, "claim response mapping must exist");
  const responseShape = block.slice(mapStart, mapEnd);
  assert.match(responseShape, /id: job\.id/);
  assert.match(responseShape, /current_url: job\.current_url/);
  assert.match(responseShape, /lease_token: leaseToken/);
  assert.doesNotMatch(responseShape, /input_data|profile_snapshot|lease_token_sha256/);
});

test("existing gateway hosts the OIDC proxy and binds it to the exact main-branch workflow", () => {
  assert.match(gateway, /action === "github_oidc_proxy"/);
  assert.match(gateway, /verifyGithubActionsOidc\(token, GITHUB_OIDC_EXPECTED\)/);
  assert.match(gateway, /midad-browser-ephemeral-worker\.yml@refs\/heads\/main/);
  assert.match(gateway, /github_ephemeral_readonly_v1/);
  assert.match(gateway, /github_worker_action_forbidden/);
  assert.match(gateway, /PUBLIC_READONLY_ALLOWED_HOSTS/);
  assert.match(gateway, /host_not_allowlisted/);
  assert.match(gateway, /release_operator_lease/);
  assert.match(oidc, /RSASSA-PKCS1-v1_5/);
  assert.match(oidc, /jwt_signature_invalid/);
  assert.match(oidc, /jwt_audience_invalid/);
  assert.match(oidc, /claims\.runner_environment !== "github-hosted"/);
});

test("Control Room, OIDC proxy and worker share the same explicit public host policy", () => {
  for (const host of ["github.com", "docs.github.com", "supabase.com", "www.supabase.com", "developer.mozilla.org", "arxiv.org", "coingecko.com", "www.coingecko.com"]) {
    assert.ok(gateway.includes('"'+host+'"'), "gateway host allowlist missing " + host);
    assert.ok(gateway.includes('"'+host+'"'), "gateway host allowlist missing " + host);
    assert.ok(workflow.includes(host), "worker runtime host allowlist missing " + host);
  }
});

test("ephemeral workflow uses GitHub OIDC, not static MIDAD secrets", () => {
  assert.match(supabaseConfig, /\[functions\.midad_browser_github_worker\][\s\S]*?verify_jwt\s*=\s*false/);
  assert.match(workflow, /vars\.MIDAD_BROWSER_EPHEMERAL_ENABLED == 'true'/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ephemeral_readonly_worker\.py/);
  assert.doesNotMatch(workflow, /MIDAD_INGEST_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test("read-only runner records final completion with leased evidence", () => {
  assert.match(runner, /async def run\(self,job,cancel=None,lease=None\)/);
  assert.match(runner, /"evidence_captured",[\s\S]*?"COMPLETED"/);
  assert.match(runner, /payload\.update\(lease\)/);
  assert.match(ledger, /text_excerpt: \{ kind: "string", max: 2500 \}/);
  assert.match(ledger, /title: \{ kind: "string", max: 500 \}/);
  assert.match(gateway, /midad_browser_evidence_ledger/);
  assert.match(gateway, /order\("created_at", \{ ascending: false \}\)/);
  assert.match(controlRoom, /item\.evidence\?\.text_excerpt/);
  assert.match(controlRoom, /publicReadOnlyForm/);
  assert.match(controlRoom, /create_readonly_job/);
  assert.match(worker, /"claim_readonly_jobs"/);
  assert.match(worker, /"release_operator_lease"/);
  assert.match(worker, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.match(worker, /midad_browser_agent_gateway/);
  assert.match(worker, /github_oidc_proxy/);
  assert.doesNotMatch(worker, /MIDAD_INGEST_KEY/);
});
