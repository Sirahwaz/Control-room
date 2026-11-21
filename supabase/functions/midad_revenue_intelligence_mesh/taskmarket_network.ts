export type TaskmarketPaymentRail = Readonly<{
  chainId: number;
  network: "Base" | "Tempo" | "Base Sepolia" | "Tempo Moderato";
  asset: "USDC" | "OUSD";
  testnet: boolean;
}>;

const PAYMENT_RAILS: ReadonlyMap<number, TaskmarketPaymentRail> = new Map([
  [8453, { chainId: 8453, network: "Base", asset: "USDC", testnet: false }],
  [4217, { chainId: 4217, network: "Tempo", asset: "OUSD", testnet: false }],
  [84532, { chainId: 84532, network: "Base Sepolia", asset: "USDC", testnet: true }],
  [42431, { chainId: 42431, network: "Tempo Moderato", asset: "OUSD", testnet: true }],
]);

/**
 * Resolve the chain-specific Taskmarket payment token.
 * Unknown or malformed chain IDs remain unmapped so callers can fail closed.
 */
export function resolveTaskmarketPaymentRail(value: unknown): TaskmarketPaymentRail | null {
  const raw = typeof value === "number"
    ? String(value)
    : typeof value === "string"
    ? value.trim()
    : "";

  if (!/^\d+$/.test(raw)) return null;

  const chainId = Number(raw);
  if (!Number.isSafeInteger(chainId)) return null;

  return PAYMENT_RAILS.get(chainId) ?? null;
}

/** The current independent escrow verifier is Base-USDC only. */
export function canVerifyTaskmarketEscrowOnBase(chainId: unknown): boolean {
  const rail = resolveTaskmarketPaymentRail(chainId);
  return rail?.chainId === 8453 && rail.asset === "USDC" && !rail.testnet;
}
