export function hasRequiredBaseFinality(proof: unknown): boolean {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return false;
  const record = proof as Record<string, unknown>;
  const finality = String(record.finality ?? "");
  if (finality === "finalized") return true;
  if (!["3_confirmations", "at_least_3_confirmations"].includes(finality)) return false;
  const raw = record.confirmations;
  if (raw === null || raw === undefined || raw === "") return false;
  const confirmations = Number(raw);
  return Number.isInteger(confirmations) && confirmations >= 3;
}
