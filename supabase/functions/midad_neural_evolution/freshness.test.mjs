import test from "node:test";
import assert from "node:assert/strict";
import { buildFreshnessUpdates, mapInBatches } from "./freshness.mjs";

test("fresh evidence receives freshness score 1", () => {
  const result = buildFreshnessUpdates([{ id: "fresh", last_evidence_at: "2026-11-08T00:00:00.000Z" }], Date.parse("2026-11-08T00:00:00.000Z"));
  assert.deepEqual(result, [{ id: "fresh", freshness_score: 1 }]);
});

test("one half-life produces an exponential freshness score", () => {
  const result = buildFreshnessUpdates([{ id: "aged", last_evidence_at: "2026-10-25T00:00:00.000Z" }], Date.parse("2026-11-08T00:00:00.000Z"));
  assert.ok(Math.abs(result[0].freshness_score - Math.exp(-1)) < 0.000001);
});

test("future evidence is clamped to freshness 1 and invalid IDs are skipped", () => {
  const result = buildFreshnessUpdates([{ id: "future", last_evidence_at: "2026-11-09T00:00:00.000Z" }, { last_evidence_at: "2026-11-08T00:00:00.000Z" }], Date.parse("2026-11-08T00:00:00.000Z"));
  assert.deepEqual(result, [{ id: "future", freshness_score: 1 }]);
});

test("created_at is the stable fallback when evidence time is absent", () => {
  const result = buildFreshnessUpdates([{ id: "no-evidence-time", created_at: "2026-10-25T00:00:00.000Z", updated_at: "2026-11-08T00:00:00.000Z" }], Date.parse("2026-11-08T00:00:00.000Z"));
  assert.ok(Math.abs(result[0].freshness_score - Math.exp(-1)) < 0.000001);
});

test("very stale evidence is clamped to the configured floor", () => {
  const result = buildFreshnessUpdates([{ id: "stale", last_evidence_at: "2020-01-01T00:00:00.000Z" }], Date.parse("2026-11-08T00:00:00.000Z"));
  assert.equal(result[0].freshness_score, 0.02);
});

test("mapInBatches preserves order and never exceeds the concurrency bound", async () => {
  let active = 0;
  let maxActive = 0;
  const result = await mapInBatches([1, 2, 3, 4, 5, 6, 7], 3, async value => {
    active++;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active--;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10, 12, 14]);
  assert.equal(maxActive, 3);
});

test("mapInBatches rejects invalid batch sizes", async () => {
  await assert.rejects(() => mapInBatches([1], 0, async value => value), /batchSize/);
});
