import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const wallet = fs.readFileSync("supabase/functions/midad_agent_fee_wallet/index.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261113123000_midad_fee_wallet_approval_expiry_guard.sql", "utf8");

test("fee wallet provisioning uses fail-closed defaults without undefined wallet reference", () => {
  const provision = wallet.slice(wallet.indexOf("async function provision()"), wallet.indexOf("async function feePolicy()"));
  assert.match(provision, /\.\.\.initialFeeWalletSafetyMetadata\(\)/);
  assert.doesNotMatch(provision, /\bw\.status\b/);
});

test("database claim requires an active signing flag as well as spending flag", () => {
  assert.match(migration, /transaction_signing_enabled/);
  assert.match(migration, /spending_enabled/);
});

test("database claim rejects approvals with missing or expired expires_at", () => {
  assert.match(migration, /ap\.expires_at is null or ap\.expires_at <= now\(\)/);
  assert.match(migration, /owner_approval_expired/);
});
