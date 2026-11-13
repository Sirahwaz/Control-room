export function initialFeeWalletSafetyMetadata() {
  return {
    spending_enabled: false,
    transaction_signing_enabled: false,
    auto_execute_allowlisted: false,
    owner_approval_per_operation: true,
    owner_approval_required_each_time: true,
    withdrawals_enabled: false,
    arbitrary_contract_calls: false,
  };
}

export function isLiveOwnerApproval(approval, now = Date.now()) {
  if (!approval || approval.status !== "pending") return false;
  if (typeof approval.expires_at !== "string" || !approval.expires_at) return false;
  const expiresAt = Date.parse(approval.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}
