/**
 * Small, dependency-free worker pool.
 * Results keep the input order even when work completes out of order.
 */
export async function runBounded(items, concurrency, worker) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  if (typeof worker !== "function") {
    throw new TypeError("worker must be a function");
  }

  const results = new Array(items.length);
  let nextIndex = 0;

  async function drain() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => drain()));
  return results;
}
