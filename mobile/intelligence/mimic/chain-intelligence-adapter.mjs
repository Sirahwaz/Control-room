import { fingerprintPublicWalletActivity } from "./mimic-intelligence.mjs";

const EVM_ADDRESS = /^0x[a-f0-9]{40}$/i;

export function adaptChainIntelligenceProfile(payload, {
  walletAddress,
  chainId,
  observedAt = Date.now(),
  maxRecords = 500
} = {}) {
  const expectedAddress = String(walletAddress ?? "").trim().toLowerCase();
  const expectedChainId = String(chainId ?? "").trim();
  if (!EVM_ADDRESS.test(expectedAddress)) throw new TypeError("INVALID_EXPECTED_WALLET_ADDRESS");
  if (!/^\d{1,8}$/.test(expectedChainId)) throw new TypeError("INVALID_EXPECTED_CHAIN_ID");
  if (!payload || typeof payload !== "object") throw new TypeError("INVALID_CHAIN_INTELLIGENCE_PAYLOAD");
  if (payload.provider !== "etherscan" || payload.api_version !== "v2") {
    throw new TypeError("UNSUPPORTED_CHAIN_INTELLIGENCE_PROVIDER");
  }
  if (payload.action !== "profile") throw new TypeError("CHAIN_INTELLIGENCE_PROFILE_REQUIRED");
  if (String(payload.chainid ?? "") !== expectedChainId) throw new TypeError("CHAIN_ID_MISMATCH");
  if (String(payload.address ?? "").trim().toLowerCase() !== expectedAddress) throw new TypeError("WALLET_ADDRESS_MISMATCH");
  if (payload.ok !== true || payload.upstream?.txlist_ok !== true) {
    throw new Error("PUBLIC_TRANSACTION_FEED_NOT_VERIFIED");
  }
  const recentTransactions = payload.profile?.recent_transactions;
  if (!Array.isArray(recentTransactions)) throw new TypeError("RECENT_TRANSACTIONS_MISSING");
  const tokenTransfers = payload.upstream?.tokentx_ok === true && Array.isArray(payload.profile?.token_transfers)
    ? payload.profile.token_transfers
    : [];
  const fingerprint = fingerprintPublicWalletActivity({
    walletAddress: expectedAddress,
    chainId: expectedChainId,
    transactions: recentTransactions,
    tokenTransfers,
    observedAt,
    maxRecords
  });
  const warnings = [];
  if (payload.upstream?.tokentx_ok !== true) warnings.push("TOKEN_TRANSFER_FEED_UNAVAILABLE");
  if (fingerprint.sample.sampleQuality !== "ADEQUATE") warnings.push("SAMPLE_QUALITY_"+fingerprint.sample.sampleQuality);
  return {
    status: "VERIFIED",
    source: "midad_chain_intelligence_v42",
    provider: "etherscan",
    chainId: expectedChainId,
    walletAddress: expectedAddress,
    warnings,
    fingerprint
  };
}
