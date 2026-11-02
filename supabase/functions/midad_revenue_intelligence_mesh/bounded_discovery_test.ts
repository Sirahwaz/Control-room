import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { runBounded } from "./bounded_discovery.ts";

Deno.test("bounded discovery caps active workers and preserves feed order", async () => {
  let active = 0;
  let peak = 0;
  const result = await runBounded([1,2,3,4,5,6], 3, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value === 1 ? 8 : 2));
    active--;
    return value * 10;
  });
  assertEquals(peak, 3);
  assertEquals(result, [10,20,30,40,50,60]);
});

Deno.test("bounded discovery handles empty feeds without invoking worker", async () => {
  let calls = 0;
  assertEquals(await runBounded([], 3, async () => { calls++; }), []);
  assertEquals(calls, 0);
});

Deno.test("bounded discovery rejects invalid concurrency", async () => {
  await assertRejects(() => runBounded([1], 0, async (x) => x), RangeError);
  await assertRejects(() => runBounded([1], 1.5, async (x) => x), RangeError);
});

Deno.test("provider failures are propagated for per-provider isolation by caller", async () => {
  await assertRejects(() => runBounded([1,2], 2, async (value) => {
    if (value === 2) throw new Error("provider-failure");
    return value;
  }), Error, "provider-failure");
});
