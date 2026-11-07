const EVM_ADDRESS = /^0x[a-f0-9]{40}$/i;
const TX_HASH = /^0x[a-f0-9]{64}$/i;
const FEATURE_KEYS = ["outgoingShare", "contractInteractionRate", "counterpartyDiversity", "activityRate", "tokenDiversity"];
const MAX_RECORDS = 500;

function normalizeAddress(value) {
  const address = String(value ?? "").trim();
  return EVM_ADDRESS.test(address) ? address.toLowerCase() : null;
}

function epochSeconds(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n > 1e12 ? n / 1000 : n);
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isFailed(tx) {
  const value = String(tx?.isError ?? tx?.txreceipt_status ?? "0").toLowerCase();
  return value === "1" || value === "true" || value === "failed";
}

function isContractCall(tx) {
  const input = String(tx?.input ?? "0x").trim().toLowerCase();
  return input.length > 2 && input !== "0x";
}

export function fingerprintPublicWalletActivity({
  walletAddress,
  chainId,
  transactions = [],
  tokenTransfers = [],
  observedAt = Date.now(),
  maxRecords = MAX_RECORDS
} = {}) {
  const wallet = normalizeAddress(walletAddress);
  if (!wallet) throw new TypeError("INVALID_EVM_WALLET_ADDRESS");
  const chain = String(chainId ?? "").trim();
  if (!/^\d{1,8}$/.test(chain)) throw new TypeError("INVALID_CHAIN_ID");
  if (!Array.isArray(transactions) || !Array.isArray(tokenTransfers)) throw new TypeError("INVALID_ACTIVITY_ARRAYS");
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > MAX_RECORDS) throw new RangeError("INVALID_SAMPLE_LIMIT");
  const observedMs = Number(observedAt);
  if (!Number.isFinite(observedMs) || observedMs <= 0) throw new TypeError("INVALID_OBSERVED_AT");

  const unique = new Map();
  for (const tx of transactions.slice(0, maxRecords)) {
    const hash = String(tx?.hash ?? "").toLowerCase();
    const from = normalizeAddress(tx?.from);
    const to = normalizeAddress(tx?.to);
    const timestamp = epochSeconds(tx?.timeStamp ?? tx?.timestamp ?? tx?.block_timestamp);
    if (!TX_HASH.test(hash) || !from || !to || timestamp === null) continue;
    if (from !== wallet && to !== wallet) continue;
    if (!unique.has(hash)) unique.set(hash, { hash, from, to, timestamp, failed: isFailed(tx), contractCall: isContractCall(tx) });
  }

  const rows = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
  const succeeded = rows.filter(x => !x.failed);
  const failedCount = rows.length - succeeded.length;
  let incomingCount = 0;
  let outgoingCount = 0;
  let contractCalls = 0;
  const counterparties = new Map();
  const activeDays = new Set();
  const timestamps = [];

  for (const tx of succeeded) {
    const outgoing = tx.from === wallet;
    const counterparty = outgoing ? tx.to : tx.from;
    if (outgoing) outgoingCount++;
    else incomingCount++;
    if (tx.contractCall) contractCalls++;
    counterparties.set(counterparty, (counterparties.get(counterparty) || 0) + 1);
    activeDays.add(new Date(tx.timestamp * 1000).toISOString().slice(0, 10));
    timestamps.push(tx.timestamp);
  }

  const uniqueTokens = new Set();
  let validTokenTransfers = 0;
  for (const transfer of tokenTransfers.slice(0, maxRecords)) {
    const from = normalizeAddress(transfer?.from);
    const to = normalizeAddress(transfer?.to);
    const token = normalizeAddress(transfer?.contractAddress ?? transfer?.tokenAddress);
    if (!token || (!from && !to) || (from !== wallet && to !== wallet)) continue;
    uniqueTokens.add(token);
    validTokenTransfers++;
  }

  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) intervals.push(timestamps[i] - timestamps[i - 1]);
  const averageInterval = intervals.length ? intervals.reduce((sum, x) => sum + x, 0) / intervals.length : null;
  const intervalMedian = median(intervals);
  const intervalVariance = averageInterval === null ? null : intervals.reduce((sum, x) => sum + (x - averageInterval) ** 2, 0) / intervals.length;
  const intervalCv = averageInterval && intervalVariance !== null ? Math.sqrt(intervalVariance) / averageInterval : null;
  const topCounterpartyCount = counterparties.size ? Math.max(...counterparties.values()) : 0;
  const counterpartyShare = succeeded.length ? topCounterpartyCount / succeeded.length : 0;
  const activeDayCount = activeDays.size;
  const dailyActivity = activeDayCount ? succeeded.length / activeDayCount : 0;
  const contractInteractionRate = succeeded.length ? contractCalls / succeeded.length : 0;
  const outgoingShare = succeeded.length ? outgoingCount / succeeded.length : 0;
  const sampleQuality = succeeded.length < 10 ? "INSUFFICIENT" : succeeded.length < 50 ? "LIMITED" : "ADEQUATE";

  const observedTraits = [];
  if (succeeded.length < 10) observedTraits.push("INSUFFICIENT_SAMPLE");
  if (succeeded.length >= 10 && contractInteractionRate >= 0.7) observedTraits.push("CONTRACT_INTERACTION_HEAVY");
  if (succeeded.length >= 10 && counterparties.size >= 2 && counterpartyShare >= 0.6) observedTraits.push("COUNTERPARTY_CONCENTRATED");
  if (succeeded.length >= 10 && activeDayCount >= 3 && dailyActivity >= 5) observedTraits.push("HIGH_ACTIVITY_CADENCE");
  if (uniqueTokens.size >= 3) observedTraits.push("TOKEN_TRANSFER_DIVERSE");

  const features = {
    outgoingShare: Number(clamp01(outgoingShare).toFixed(6)),
    contractInteractionRate: Number(clamp01(contractInteractionRate).toFixed(6)),
    counterpartyDiversity: Number(clamp01(counterparties.size / Math.max(1, succeeded.length)).toFixed(6)),
    activityRate: Number(clamp01(dailyActivity / 10).toFixed(6)),
    tokenDiversity: Number(clamp01(uniqueTokens.size / 10).toFixed(6))
  };
  const fromTimestamp = rows.length ? rows[0].timestamp : null;
  const toTimestamp = rows.length ? rows[rows.length - 1].timestamp : null;

  return {
    schema: "MIDAD_MIMIC_PUBLIC_WALLET_FINGERPRINT_V1",
    mode: "READ_ONLY_ANALYSIS",
    chainId: chain,
    walletAddress: wallet,
    observedAt: new Date(observedMs).toISOString(),
    sample: {
      receivedTransactions: transactions.length,
      cappedTransactions: Math.min(transactions.length, maxRecords),
      validUniqueTransactions: rows.length,
      successfulTransactions: succeeded.length,
      failedTransactions: failedCount,
      tokenTransfers: validTokenTransfers,
      uniqueTokenContracts: uniqueTokens.size,
      sampleQuality
    },
    window: {
      from: fromTimestamp === null ? null : new Date(fromTimestamp * 1000).toISOString(),
      to: toTimestamp === null ? null : new Date(toTimestamp * 1000).toISOString(),
      activeDays: activeDayCount
    },
    metrics: {
      incomingTransactions: incomingCount,
      outgoingTransactions: outgoingCount,
      uniqueCounterparties: counterparties.size,
      topCounterpartyShare: Number(clamp01(counterpartyShare).toFixed(6)),
      contractInteractionRate: Number(clamp01(contractInteractionRate).toFixed(6)),
      averageTransactionsPerActiveDay: Number(dailyActivity.toFixed(4)),
      medianIntertransactionSeconds: intervalMedian,
      meanIntertransactionSeconds: averageInterval === null ? null : Number(averageInterval.toFixed(2)),
      intertransactionCoefficientOfVariation: intervalCv === null ? null : Number(intervalCv.toFixed(6))
    },
    features,
    observedTraits,
    interpretation: "DESCRIPTIVE_PUBLIC_ACTIVITY_ONLY_NOT_IDENTITY_OR_RETURN_PREDICTION",
    execution: { copyTrading: false, signingAllowed: false, orderSubmissionAllowed: false, executionAllowed: false }
  };
}

export function compareWalletBehaviorFingerprints(left, right) {
  if (left?.schema !== "MIDAD_MIMIC_PUBLIC_WALLET_FINGERPRINT_V1" || right?.schema !== "MIDAD_MIMIC_PUBLIC_WALLET_FINGERPRINT_V1") {
    throw new TypeError("INVALID_WALLET_FINGERPRINT");
  }
  if (!left.features || !right.features || left.chainId !== right.chainId) {
    throw new TypeError("INCOMPATIBLE_WALLET_FINGERPRINTS");
  }
  const distances = FEATURE_KEYS.map(key => {
    const a = Number(left.features[key]);
    const b = Number(right.features[key]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new TypeError("INVALID_FINGERPRINT_FEATURES");
    return Math.abs(clamp01(a) - clamp01(b));
  });
  const similarity = 1 - distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const quality = left.sample.sampleQuality === "ADEQUATE" && right.sample.sampleQuality === "ADEQUATE" ? "LIMITED_DESCRIPTIVE" : "LOW_CONFIDENCE";
  return {
    chainId: left.chainId,
    similarityIndex: Number((clamp01(similarity) * 100).toFixed(2)),
    evidenceQuality: quality,
    interpretation: "FEATURE_SIMILARITY_ONLY_NOT_COMMON_OWNERSHIP_OR_PROFITABILITY",
    copyTradingSuggested: false,
    executionAllowed: false
  };
}
