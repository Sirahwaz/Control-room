export const DEFAULT_FRESHNESS_HALF_LIFE_HOURS = 336;
export const MIN_FRESHNESS_SCORE = 0.02;
export const DEFAULT_BATCH_SIZE = 40;

export function buildFreshnessUpdates(nodes, nowMs = Date.now(), halfLifeHours = DEFAULT_FRESHNESS_HALF_LIFE_HOURS) {
  if (!Array.isArray(nodes)) throw new TypeError("nodes must be an array");
  if (!Number.isFinite(nowMs)) throw new TypeError("nowMs must be finite");
  if (!Number.isFinite(halfLifeHours) || halfLifeHours <= 0) throw new RangeError("halfLifeHours must be greater than zero");

  return nodes.flatMap((node) => {
    const id = typeof node?.id === "string" ? node.id.trim() : "";
    if (!id) return [];
    const candidateTimestamp = node.last_evidence_at || node.created_at || node.updated_at;
    const parsedTimestamp = candidateTimestamp ? Date.parse(String(candidateTimestamp)) : nowMs;
    const evidenceMs = Number.isFinite(parsedTimestamp) ? parsedTimestamp : nowMs;
    const ageHours = Math.max(0, nowMs - evidenceMs) / 3_600_000;
    const freshness = Math.exp(-ageHours / halfLifeHours);
    const bounded = Math.max(MIN_FRESHNESS_SCORE, Math.min(1, freshness));
    return [{ id, freshness_score: Number(bounded.toFixed(6)) }];
  });
}

export async function mapInBatches(items, batchSize, worker) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError("batchSize must be a positive integer");
  if (typeof worker !== "function") throw new TypeError("worker must be a function");
  const results = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    const batchResults = await Promise.all(batch.map((item, index) => worker(item, offset + index)));
    results.push(...batchResults);
  }
  return results;
}
