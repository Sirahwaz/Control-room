import test from "node:test";
import assert from "node:assert/strict";
import { computeScanRange, chunkScanRange } from "../supabase/functions/midad_base_usdc_monitor/scan-range.js";

test("advances exactly one contiguous 6000-block window from an existing cursor", () => {
  assert.deepEqual(computeScanRange({ previous: 10000, finalized: 30000 }), { from: 10001, to: 16000, caughtUp: false, blockCount: 6000 });
});
test("first scan starts at the oldest block in the bounded recent window", () => {
  assert.deepEqual(computeScanRange({ previous: 0, finalized: 30000 }), { from: 24001, to: 30000, caughtUp: true, blockCount: 6000 });
});
test("final window clamps to finalized block without scanning future blocks", () => {
  assert.deepEqual(computeScanRange({ previous: 27000, finalized: 30000 }), { from: 27001, to: 30000, caughtUp: true, blockCount: 3000 });
});
test("cursor already at or beyond finalized produces an empty caught-up window", () => {
  assert.deepEqual(computeScanRange({ previous: 30000, finalized: 30000 }), { from: 30001, to: 30000, caughtUp: true, blockCount: 0 });
});
test("splits windows into contiguous non-overlapping 500-block chunks", () => {
  const chunks = chunkScanRange(1, 1200, 500);
  assert.deepEqual(chunks, [{from:1,to:500},{from:501,to:1000},{from:1001,to:1200}]);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].from, chunks[i-1].to + 1);
});
test("rejects unsafe limits rather than silently widening RPC work", () => {
  assert.throws(() => computeScanRange({ previous: 1, finalized: 10, maxBlocks: 10001 }), /invalid_scan_limit/);
  assert.throws(() => chunkScanRange(1, 10, 5000), /invalid_chunk_size/);
});

test("empty cursor range produces no RPC chunks", () => {
  assert.deepEqual(chunkScanRange(30001, 30000), []);
});

test("6000-block windows remain exactly twelve bounded 500-block RPC chunks", () => {
  const range = computeScanRange({ previous: 10000, finalized: 30000 });
  const chunks = chunkScanRange(range.from, range.to, 500);
  assert.equal(range.blockCount, 6000);
  assert.equal(chunks.length, 12);
  assert.equal(chunks[0].from, 10001);
  assert.equal(chunks[11].to, 16000);
});
