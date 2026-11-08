export function computeScanRange({ previous, finalized, maxBlocks = 6000 }) {
  if (!Number.isSafeInteger(finalized) || finalized < 0) throw new Error("invalid_finalized_block");
  if (!Number.isSafeInteger(previous) || previous < 0) throw new Error("invalid_previous_cursor");
  if (!Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 10000) throw new Error("invalid_scan_limit");
  const from = previous > 0 ? previous + 1 : Math.max(0, finalized - maxBlocks + 1);
  const to = Math.min(finalized, from + maxBlocks - 1);
  return { from, to, caughtUp: previous >= finalized || to >= finalized, blockCount: Math.max(0, to - from + 1) };
}
export function chunkScanRange(from, to, chunkSize = 500) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
    if (from === to + 1 && from >= 0) return [];
    throw new Error("invalid_scan_range");
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 2000) throw new Error("invalid_chunk_size");
  const chunks = [];
  for (let start = from; start <= to; start += chunkSize) chunks.push({ from: start, to: Math.min(to, start + chunkSize - 1) });
  return chunks;
}
