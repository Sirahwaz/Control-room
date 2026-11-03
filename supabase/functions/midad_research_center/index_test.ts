Deno.test("research center has a no-model synthesis bypass", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  if (!src.includes("const synthesize=body?.synthesize!==false")) throw new Error("Missing synthesize flag.");
  if (!src.includes("synthesize?await groundedSynthesis")) throw new Error("Synthesis is not gated.");
  if (!src.includes("model synthesis intentionally skipped")) throw new Error("No-cost methodology not recorded.");
  if (!src.includes("AbortSignal.timeout(10000)")) throw new Error("Source fetch timeout missing.");
  if (!src.includes("candidates.slice(0,4)")) throw new Error("Source fetch budget is not bounded.");
});

Deno.test("research center exposes synthesis state in run metadata and response", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  if (!src.includes("synthesis_enabled:synthesize,synthesis_skipped:!synthesize")) throw new Error("Synthesis state not persisted.");
  if (!src.includes("synthesis:{enabled:synthesize,skipped:!synthesize}")) throw new Error("Synthesis state not returned.");
});
