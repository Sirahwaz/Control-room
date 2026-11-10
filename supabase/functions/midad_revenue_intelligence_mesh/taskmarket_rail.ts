export type TaskmarketRail = {
  chainId: number | null;
  asset: "USDC" | "OUSD" | null;
  network: string;
  supported: boolean;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Taskmarket reward amounts are denominated in the payment token of the task's
 * chain. Never default a missing or unknown chain to Base/USDC.
 */
export function canonicalMidadNetwork(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    "base": "base",
    "eip155:8453": "base",
    "8453": "base",
    "tempo": "tempo",
    "eip155:4217": "tempo",
    "4217": "tempo",
    "ethereum": "ethereum",
    "mainnet": "ethereum",
    "eip155:1": "ethereum",
    "1": "ethereum",
    "avalanche": "avalanche",
    "avalanche-c": "avalanche",
    "eip155:43114": "avalanche",
    "43114": "avalanche",
    "solana": "solana",
    "solana-mainnet": "solana",
  };
  return aliases[value] ?? value;
}

export function normalizeTaskmarketRail(raw: unknown): TaskmarketRail {
  const record = asRecord(raw);
  const rawChainId = record?.chainId ?? record?.chain_id;
  const parsed = finiteNumber(rawChainId);
  const chainId = parsed !== null && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;

  if (chainId === 8453) {
    return { chainId, asset: "USDC", network: "Base", supported: true };
  }
  if (chainId === 4217) {
    return { chainId, asset: "OUSD", network: "Tempo", supported: true };
  }
  return {
    chainId,
    asset: null,
    network: chainId === null ? "unknown" : String(chainId),
    supported: false,
  };
}

/**
 * Detect explicit out-of-pocket purchases. When the task states that entrants
 * pay their own costs but omits a complete price, return a conservative $1
 * sentinel so the no-spend gate fails closed; costFloorKnown distinguishes
 * that sentinel from a quoted minimum.
 */
export function taskmarketPurchaseRequirement(raw: unknown): {
  required: boolean;
  costFloorUsd: number | null;
  costFloorKnown: boolean;
} {
  const record = asRecord(raw);
  if (!record) return { required: false, costFloorUsd: null, costFloorKnown: false };

  const title = typeof record.title === "string" ? record.title : "";
  const description = typeof record.description === "string" ? record.description : "";
  const text = `${title}\n${description}`;
  const explicit = [
    record.purchaseRequired,
    record.purchase_required,
    record.buyRequired,
    record.buy_required,
  ].some((value) => value === true);
  const outOfPocket = /\b(?:entrants?|workers?|participants?)\s+(?:must\s+)?pay\s+(?:their|your)\s+own\s+(?:purchase|purchases)(?:\s+and\s+network)?\s+costs?\b/i.test(text)
    || /\b(?:entrants?|workers?|participants?)\s+(?:must\s+)?cover\s+(?:their|your)\s+own\s+(?:purchase|purchases|product|products)\b/i.test(text);
  const purchaseSteps = /\b(?:buy|purchase|order)\b/i.test(text)
    && /\b(?:receipt|proof of purchase|guestbook|delivery)\b/i.test(text);
  const required = explicit || outOfPocket || purchaseSteps;
  const quotedMinimum = description.match(/\$\s*([0-9]+(?:\.[0-9]+)?)\s+(?:help map pass|pass|fee|purchase|product)\b/i);
  const costFloorKnown = Boolean(quotedMinimum);
  const costFloorUsd = required
    ? (quotedMinimum ? Number(quotedMinimum[1]) : 1)
    : null;

  return { required, costFloorUsd, costFloorKnown };
}

/** A U.S.-purchaser restriction is a task constraint, not proof of user eligibility. */
export function taskmarketRegionGate(raw: unknown): string {
  const record = asRecord(raw);
  if (!record) return "unknown";
  const text = [record.title, record.description]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return /\b(?:eligible\s+)?(?:U\.S\.|US|United States)\s+(?:purchasers?|residents?)\b/i.test(text)
    ? "US-only"
    : "unknown";
}

/** Conservative exclusion rule for low-value Taskmarket listings with heavy competition. */
export function isTaskmarketHighCompetitionLowValue(candidate: unknown): boolean {
  const record = asRecord(candidate);
  if (!record || String(record.sourceSlug ?? record.source_slug ?? "").toLowerCase() !== "taskmarket_api") {
    return false;
  }
  const competition = finiteNumber(record.competition ?? record.submissionCount ?? record.submission_count);
  const amount = finiteNumber(record.amount ?? record.rewardAmount ?? record.reward_amount);
  return competition !== null && competition >= 50
    && amount !== null && amount > 0 && amount <= 25;
}

/**
 * Preserve a verified Taskmarket escrow only when the exact task, transaction,
 * token and chain still match and the stored independent proof has >=12
 * confirmations. A changed rail or tx must be re-verified.
 */
export function shouldPreserveVerifiedTaskmarketProof(existing: unknown, candidate: unknown): boolean {
  const current = asRecord(existing);
  const next = asRecord(candidate);
  const proof = asRecord(current?.independent_payout_check);
  if (!current || !next || !proof) return false;

  const tx = String(next.tx ?? "").toLowerCase();
  const asset = String(next.asset ?? "").toUpperCase();
  const network = String(next.network ?? "").toLowerCase();
  return current.payout_proof_status === "verified_task_escrow"
    && current.escrow_funded === true
    && String(current.payment_tx_hash ?? "").toLowerCase() === tx
    && String(current.compensation_asset ?? "").toUpperCase() === asset
    && String(current.payout_network ?? "").toLowerCase() === network
    && proof.verified === true
    && String(proof.tx_hash ?? "").toLowerCase() === tx
    && String(proof.asset ?? "").toUpperCase() === asset
    && String(proof.network ?? "").toLowerCase() === network
    && (finiteNumber(proof.confirmations) ?? 0) >= 12;
}
