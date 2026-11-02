/**
 * Bounded async mapper for independent provider feeds.
 * Results preserve input order; worker failures propagate to the caller.
 * Callers must isolate provider-level failures inside each worker.
 */
export async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  if (typeof worker !== "function") throw new TypeError("worker must be a function");

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function drain(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    () => drain(),
  ));
  return results;
}
