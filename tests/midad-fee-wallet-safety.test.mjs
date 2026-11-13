import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const walletSource = fs.readFileSync("supabase/functions/midad_agent_fee_wallet/index.ts", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20261113084000_midad_fee_payment_expiry_signing_guard.sql",
  "utf8",
);

test("fee-wallet provisioning does not read an undefined existing-wallet variable", () => {
  const provision = walletSource.slice(
    walletSource.indexOf("async function provision()"),
    walletSource.indexOf("async function feePolicy()"),
  );
  assert.ok(provision.includes("const wallet = Wallet.createRandom();"));
  assert.doesNotMatch(provision, /spending_enabled:\s*w\./);
  assert.doesNotMatch(provision, /transaction_signing_enabled:\s*w\./);
  assert.match(provision, /spending_enabled:\s*false/);
  assert.match(provision, /transaction_signing_enabled:\s*false/);
});

test("database reservation rejects expired approvals", () => {
  assert.match(migration, /ap\.expires_at\s+is\s+null/i);
  assert.match(migration, /ap\.expires_at\s*<=\s*now\(\)/i);
});

test("database reservation independently requires signing to be enabled", () => {
  assert.match(
    migration,
    /metadata->>\s*'transaction_signing_enabled'\s*,\s*'false'\)\s*<>\s*'true'/i,
  );
});

test("database function remains restricted to service_role", () => {
  assert.match(migration, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.midad_claim_agent_fee_payment/i);
  assert.match(migration, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.midad_claim_agent_fee_payment[\s\S]*TO\s+service_role/i);
  assert.doesNotMatch(migration, /TO\s+(PUBLIC|anon|authenticated)\s*;/i);
});
