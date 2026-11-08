Deno.test("research worker uses zero-cost source retrieval and broad discovery roles", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  if (!src.includes("synthesize:false")) throw new Error("Worker still requests paid synthesis.");
  for (const role of ["market_source_scout:[]","source_registry_auditor:[]","ai_training_scout:[]","direct_client_scout:[]"]) {
    if (!src.includes(role)) throw new Error("Missing broad-search role: "+role);
  }
  for (const seed of ["jobbi.org/gigs.json","task-force.app/docs/api","payapi.market/faq","collaborators.build","silencio.network/payout-rewards-terms"]) {
    if (!src.includes(seed)) throw new Error("Missing research seed: "+seed);
  }
});
