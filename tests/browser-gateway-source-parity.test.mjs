import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "supabase/functions/midad_browser_agent_gateway/index.ts");
const ledgerPath = path.join(root, "supabase/functions/midad_browser_agent_gateway/ledger.ts");
const snapshotPath = path.join(root, "supabase/functions/midad_browser_agent_gateway/SOURCE_SNAPSHOT.md");

test("Browser Gateway source snapshot identifies the reconciled deployed version", () => {
  const snapshot = fs.readFileSync(snapshotPath, "utf8");
  assert.match(snapshot, /Last reconciled:\*\*? 2026-11-09/);
  assert.ok(snapshot.includes("Observed deployment:** ACTIVE, version **16**"));
  assert.doesNotMatch(snapshot, /Deployed version observed: \*\*3\*\*/);
  assert.match(snapshot, /source reconciliation only/i);
});

test("repository source contains the deployed v16 bounded bridge surfaces", () => {
  const source = fs.readFileSync(indexPath, "utf8");
  const ledger = fs.readFileSync(ledgerPath, "utf8");
  for (const marker of [
    "resolveBrowserUserOwner",
    "mcpBridge",
    "tools/list",
    "midad_browser_capabilities",
    "midad_browser_list_sessions",
    "midad_browser_command",
    "midad_browser_get_result",
    "worker_heartbeat",
    "user_bridge",
    "get_operator_result",
  ]) {
    assert.ok(source.includes(marker), `gateway source missing v16 marker: ${marker}`);
  }
  for (const marker of [
    "makeLedgerEventKey",
    "sanitizeLedgerEvidence",
    "normalizeTargetState",
    "safeSourceUrl",
  ]) {
    assert.ok(ledger.includes(marker), `ledger helper missing marker: ${marker}`);
  }
});

test("gateway source has no high-confidence embedded credential literals", () => {
  const source = fs.readFileSync(indexPath, "utf8");
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bsb_secret_[A-Za-z0-9_-]{20,}\b/,
    /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/i,
  ];
  for (const pattern of patterns) assert.doesNotMatch(source, pattern);
});


test("Browser Gateway returns an opaque stable owner scope hash for Browser Run tenant isolation", () => {
  const source = fs.readFileSync(indexPath, "utf8");
  const capabilities = source.slice(source.indexOf('if (subaction === "capabilities")'));
  assert.match(capabilities, /owner_scope_hash/);
  assert.match(capabilities, /sha256\([^)]*ownerUserId/);
  assert.match(capabilities, /owner_scope_hash:\s*ownerScopeHash/);
});
