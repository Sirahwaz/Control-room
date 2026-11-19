import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const gateway = fs.readFileSync(new URL("../supabase/functions/midad_browser_agent_gateway/index.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../tools/midad-browser-runtime/operator_worker.py", import.meta.url), "utf8");

test("gateway imports and validates short-lived server-side worker leases", () => {
  assert.match(gateway, /from "\.\/lease\.ts"/);
  assert.match(gateway, /async function validateOperatorLease/);
  assert.match(gateway, /midad_browser_validate_operator_lease_v1/);
  assert.match(gateway, /operator_lease_expired_or_invalid/);
});

test("gateway claims jobs atomically and never returns the stored lease digest", () => {
  assert.match(gateway, /action === "claim_operator_jobs"/);
  assert.match(gateway, /midad_browser_claim_operator_jobs_v1/);
  assert.match(gateway, /lease_token_sha256: _digest/);
  assert.match(gateway, /lease_token: leaseToken/);
});

test("operator result writes and state events require a valid lease", () => {
  const calls = gateway.match(/validateOperatorLease\(sb,/g) || [];
  assert.ok(calls.length >= 2, "lease validation must protect both worker write paths");
  assert.match(gateway, /action === "record_command_result"[\s\S]*?validateOperatorLease\(sb, found\.data, body\)/);
  assert.match(gateway, /action === "record_event"[\s\S]*?validateOperatorLease\(sb, job, body\)/);
});

test("gateway advertises claim, renew and release lease actions", () => {
  for (const action of ["claim_operator_jobs", "renew_operator_lease", "release_operator_lease"]) {
    assert.ok(gateway.includes('"' + action + '"'), action + " capability missing");
  }
});

test("worker uses claim-based dispatch and includes the lease on writes", () => {
  assert.match(worker, /"claim_operator_jobs"/);
  assert.match(worker, /"renew_operator_lease"/);
  assert.match(worker, /"release_operator_lease"/);
  assert.match(worker, /self\._lease_payload\(job\)/);
  assert.doesNotMatch(worker, /"list_jobs", owner_user_id=self\.owner_user_id/);
});
