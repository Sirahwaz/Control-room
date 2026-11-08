import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../midad-control-v2.js", import.meta.url), "utf8");

function section(start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing source section: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Missing source boundary: ${end}`);
  return source.slice(from, to);
}

test("More/System exposes the live Data Reservoir snapshot and explicit canary control", () => {
  const view = section("function storageReservoirView()", "function archiveCanaryResultView(");
  assert.match(view, /S\.data\?\.storage/, "storage data should come from the authenticated dashboard response");
  assert.match(view, /data-cmd="runArchiveCanary"/, "the canary must be a deliberate operator action");
  assert.match(view, /database_mib/, "database size should be visible");
  assert.match(view, /archive_status/, "external archive connection state should be visible");
  assert.match(section("function moreView()", "function aiFormat("), /storageReservoirView\(\)/, "the status panel should be mounted in More/System");
});

test("Canary action requires a second confirmation and reports the verified backend result", () => {
  const command = section("async function command(", "function loadingView(");
  assert.match(command, /cmd==="runArchiveCanary"/, "the button should have a dedicated action handler");
  assert.match(command, /window\.confirm\(/, "the operator must confirm the one-shot external test");
  assert.match(command, /RUN SYNTHETIC CANARY/, "the backend confirmation phrase must be explicit");
  assert.match(command, /api\("run_archive_canary"/, "the frontend should call the existing Control Room route");
  assert.match(command, /checksum_match/, "the UI should only describe a round-trip as verified when checksum matches");
  assert.match(command, /aes_gcm_decryption_verified/, "the UI should surface decryption verification");
  const verification = command.match(/const verified=([^;]+);/);
  assert.ok(verification, "the UI should define an explicit verification predicate");
  const stateResolution = command.match(/const canaryState=([^;]+);/);
  assert.ok(stateResolution, "the UI should normalize wrapper and nested state");
  assert.match(stateResolution[1], /c\.state\|\|j\.state/, "the UI should read state from the top-level Control Room wrapper when absent in archive_canary");
  assert.match(verification[1], /canaryState/, "the verification predicate should use the normalized state");
});

test("Canary UI never contains archive credentials or privileged database keys", () => {
  assert.doesNotMatch(source, /UPLOAD_AM_API_TOKEN|midad_archive_encryption_key|SUPABASE_SERVICE_ROLE_KEY|x-midad-autonomy-key/i);
});
