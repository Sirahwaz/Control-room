/**
 * Taskmarket payout-rail normalization and proof reuse.
 * These helpers are pure: no network access, credentials, or writes.
 */
export const SUPPORTED_REVENUE_ASSETS = [
  "USDC", "OUSD", "USDT", "BTC", "ETH", "SOL", "DAI", "EURC",
] as const;

export function isSupportedRevenueAsset(asset: unknown): boolean {
  return SUPPORTED_REVENUE_ASSETS.includes(String(asset ?? "").trim().toUpperCase() as typeof SUPPORTED_REVENUE_ASSETS[number]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function normalizeTaskmarketRail(task: unknown): {
  chainId: number | null;
  asset: string | null;
  network: string;
  supportedRail: boolean;
  verifier: "base" | "tempo" | null;
} {
  const source = asRecord(task);
  const rawId = source.chainId ?? source.chain_id;
  const parsedId = rawId === null || rawId === undefined || rawId === "" ? NaN : Number(rawId);
  const chainId = Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : null;
  if (chainId === 8453) return { chainId, asset: "USDC", network: "Base", supportedRail: true, verifier: "base" };
  if (chainId === 4217) return { chainId, asset: "OUSD", network: "Tempo", supportedRail: true, verifier: "tempo" };
  return { chainId, asset: null, network: chainId === null ? "unknown" : "chain:" + chainId, supportedRail: false, verifier: null };
}

export function parseTaskmarketExternalPayout(description: unknown): {
  asset: string | null;
  network: string;
  nativeAmount: number | null;
} | null {
  const text = String(description ?? "");
  const explicitExternal =
    /\bno\s+per[- ]worker\s+(?:USDC|OUSD)\s+release\b/i.test(text) ||
    /\b(?:USDC|OUSD)\s+(?:listing\s+)?deposit[\s\S]{0,120}\bnot\b[\s\S]{0,100}\bper[- ]worker\s+payout\b/i.test(text) ||
    /\b(?:payout|reward)\b[\s\S]{0,180}\bpaid\s+off[- ]platform\b/i.test(text) ||
    /\bpaid\s+off[- ]platform\b/i.test(text);
  if (!explicitExternal) return null;

  const payoutSection = text.match(/(?:^|\n)\s*Payout:\s*([\s\S]*?)(?=\n\s*(?:Outside\b|Holder\b|How to claim\b|Disclosure\b|TMALUM\b)|$)/i)?.[1] ?? text;
  const tokenMatch = payoutSection.match(/^\s*-\s*([A-Z][A-Z0-9]{1,15})\s+only\s*:/im);
  const asset = tokenMatch?.[1]?.toUpperCase() ?? null;
  const amountMatch = asset ? payoutSection.match(new RegExp("\\b([\\d,]+(?:\\.\\d+)?)\\s+" + asset + "\\b", "i")) : null;
  const parsedAmount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : NaN;
  const network = /\bBSC\b|\bBEP-20\b/i.test(text) ? "BSC" :
    /\bTempo\b/i.test(payoutSection) ? "Tempo" :
    /\bBase\b/i.test(payoutSection) ? "Base" :
    /\bSolana\b/i.test(payoutSection) ? "Solana" : "unknown";
  return { asset, network, nativeAmount: Number.isFinite(parsedAmount) ? parsedAmount : null };
}

export function resolveTaskmarketPayoutRail(task: unknown): {
  chainId: number | null;
  asset: string | null;
  network: string;
  supportedRail: boolean;
  verifier: "base" | "tempo" | null;
  externalPayout: boolean;
  nativeRewardAmount: number | null;
  nativeRewardAsset: string | null;
} {
  const rail = normalizeTaskmarketRail(task);
  const source = asRecord(task);
  const external = parseTaskmarketExternalPayout(source.description);
  if (external) {
    return {
      ...rail,
      asset: external.asset,
      network: external.network,
      supportedRail: false,
      verifier: null,
      externalPayout: true,
      nativeRewardAmount: external.nativeAmount,
      nativeRewardAsset: external.asset,
    };
  }
  return {
    ...rail,
    externalPayout: false,
    nativeRewardAmount: null,
    nativeRewardAsset: null,
  };
}

function toAtomic(value: unknown): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 1_000_000)) : null;
}

/**
 * Reuse a worker-verified Taskmarket escrow proof only when it still matches
 * the exact live task, tx, asset, network and reward, and is no older than 24h.
 */
export function isReusableTaskmarketProof(input: {
  proof: unknown;
  storedExternalId: unknown;
  currentExternalId: unknown;
  storedAmount: unknown;
  currentAmount: unknown;
  currentAmountAtomic: unknown;
  storedAsset: unknown;
  currentAsset: unknown;
  storedNetwork: unknown;
  currentNetwork: unknown;
  storedTxHash: unknown;
  currentTxHash: unknown;
  storedProofStatus: unknown;
  storedEscrowFunded: unknown;
  storedCheckedAt: unknown;
  nowMs?: number;
  maxAgeMs?: number;
}): boolean {
  const proof = asRecord(input.proof);
  const currentId = String(input.currentExternalId ?? "").toLowerCase();
  const storedId = String(input.storedExternalId ?? "").toLowerCase();
  const currentTx = String(input.currentTxHash ?? "").toLowerCase();
  const storedTx = String(input.storedTxHash ?? "").toLowerCase();
  const proofTx = String(proof.tx_hash ?? proof.txHash ?? "").toLowerCase();
  const currentAsset = String(input.currentAsset ?? "").toUpperCase();
  const storedAsset = String(input.storedAsset ?? "").toUpperCase();
  const proofAsset = String(proof.asset ?? "").toUpperCase();
  const currentNetwork = String(input.currentNetwork ?? "").toLowerCase();
  const storedNetwork = String(input.storedNetwork ?? "").toLowerCase();
  const proofNetwork = String(proof.network ?? "").toLowerCase();
  const proofTaskId = String(proof.task_id ?? proof.taskId ?? "").toLowerCase();
  const currentAtomic = String(input.currentAmountAtomic ?? "");
  const proofAtomic = String(proof.net_reward_atomic ?? proof.reward_atomic ?? proof.rewardAtomic ?? "");
  const storedAtomic = toAtomic(input.storedAmount);
  const currentAmountAtomic = toAtomic(input.currentAmount);
  const checkedAt = Date.parse(String(input.storedCheckedAt ?? ""));
  const now = input.nowMs ?? Date.now();
  const maxAge = input.maxAgeMs ?? 24 * 60 * 60 * 1000;
  const age = now - checkedAt;

  return proof.verified === true &&
    Number(proof.confirmations) >= 12 &&
    String(input.storedProofStatus ?? "").toLowerCase() === "verified_task_escrow" &&
    input.storedEscrowFunded === true &&
    Boolean(currentId) && storedId === currentId &&
    Boolean(currentTx) && storedTx === currentTx && proofTx === currentTx &&
    Boolean(currentAsset) && storedAsset === currentAsset && proofAsset === currentAsset &&
    Boolean(currentNetwork) && storedNetwork === currentNetwork && proofNetwork === currentNetwork &&
    (!proofTaskId || proofTaskId === currentId) &&
    Boolean(currentAtomic) && proofAtomic === currentAtomic &&
    storedAtomic !== null && currentAmountAtomic !== null && storedAtomic === currentAmountAtomic &&
    Number.isFinite(checkedAt) && age >= -5 * 60 * 1000 && age <= maxAge;
}
