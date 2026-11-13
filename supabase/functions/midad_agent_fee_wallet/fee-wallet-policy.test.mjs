import test from "node:test";
import assert from "node:assert/strict";
import { initialFeeWalletSafetyMetadata, isLiveOwnerApproval } from "./fee-wallet-policy.mjs";

test("new fee wallets are fail-closed and never provision with signing enabled", () => {
  const metadata = initialFeeWalletSafetyMetadata();
  assert.equal(metadata.spending_enabled, false);
  assert.equal(metadata.transaction_signing_enabled, false);
  assert.equal(metadata.auto_execute_allowlisted, false);
  assert.equal(metadata.withdrawals_enabled, false);
  assert.equal(metadata.arbitrary_contract_calls, false);
  assert.equal(metadata.owner_approval_required_each_time, true);
});

test("owner approval must be pending and have a future expiry", () => {
  const now = Date.parse("2026-11-13T12:00:00.000Z");
  assert.equal(isLiveOwnerApproval({ status: "pending", expires_at: "2026-11-13T12:01:00.000Z" }, now), true);
  assert.equal(isLiveOwnerApproval({ status: "pending", expires_at: "2026-11-13T12:00:00.000Z" }, now), false);
  assert.equal(isLiveOwnerApproval({ status: "pending", expires_at: "2026-11-13T11:59:00.000Z" }, now), false);
  assert.equal(isLiveOwnerApproval({ status: "pending", expires_at: null }, now), false);
  assert.equal(isLiveOwnerApproval({ status: "approved", expires_at: "2026-11-13T12:01:00.000Z" }, now), false);
});
