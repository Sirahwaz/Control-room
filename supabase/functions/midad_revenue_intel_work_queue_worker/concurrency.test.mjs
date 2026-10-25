import test from "node:test";
import assert from "node:assert/strict";
import { runBounded } from "./concurrency.mjs";

test("bounded runner never exceeds concurrency and preserves input order", async () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8];
  let active = 0;
  let peak = 0;

  const results = await runBounded(values, 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 4));
    active -= 1;
    return value * 10;
  });

  assert.equal(peak, 3);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70, 80]);
});

test("bounded runner handles empty inputs without invoking worker", async () => {
  let calls = 0;
  const results = await runBounded([], 3, async () => { calls += 1; });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

test("bounded runner rejects invalid concurrency", async () => {
  await assert.rejects(() => runBounded([1], 0, async (x) => x), RangeError);
  await assert.rejects(() => runBounded([1], 1.5, async (x) => x), RangeError);
});

test("a worker rejection is propagated to the caller", async () => {
  await assert.rejects(
    () => runBounded([1, 2], 2, async (value) => {
      if (value === 2) throw new Error("expected-worker-failure");
      return value;
    }),
    /expected-worker-failure/,
  );
});
