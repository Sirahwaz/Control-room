const sourceUrl = new URL("../../supabase/functions/midad_speedbot_fulfillment/index.ts", import.meta.url);

Deno.test("fulfillment gate matches the current published service version", async () => {
  const source = await Deno.readTextFile(sourceUrl);
  const contract = source.match(/const SERVICE_ID = "([^"]+)";\s*const SERVICE_VERSION = (\d+);/);
  if (!contract) throw new Error("service contract constants missing");
  if (contract[1] !== "service_b55a499aa43848cd96f4d213e1d8bdfa") {
    throw new Error("unexpected service id: " + contract[1]);
  }
  if (Number(contract[2]) !== 3) {
    throw new Error("fulfillment service version must match public service v3; got " + contract[2]);
  }
  if (!source.includes("version!==SERVICE_VERSION") || !source.includes('reason:"service_mismatch"')) {
    throw new Error("fail-closed version mismatch guard must remain present");
  }
});
