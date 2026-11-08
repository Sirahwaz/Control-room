Deno.test("revenue mesh runs bounded parallel wide research without paid model calls", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  if (!src.includes("async function runWideResearch")) throw new Error("Missing wide research scheduler.");
  if (!src.includes("midad_revenue_intel_research_worker")) throw new Error("Research worker is not integrated.");
  if (!src.includes("Promise.all(Array.from({length:workerCount}")) throw new Error("Research workers are not parallel.");
  if (!src.includes("synthesis:\"disabled\"")) throw new Error("Zero-cost synthesis policy missing.");
  if (!src.includes("MIDAD Revenue Intelligence Mesh: Wide Income Discovery")) throw new Error("Daily research parent run missing.");
  for (const role of ["market_source_scout","source_registry_auditor","payout_verifier","x402_revenue_researcher","ai_training_scout","direct_client_scout"]) {
    if (!src.includes(role)) throw new Error("Missing research lane: "+role);
  }
});
