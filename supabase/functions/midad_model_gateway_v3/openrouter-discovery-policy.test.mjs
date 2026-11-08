import test from "node:test";
import assert from "node:assert/strict";
import { OPENROUTER_DISCOVERY_POLICY } from "./openrouter-discovery.mjs";

test("model discovery never runs inference or changes enabled model routes", () => {
  assert.deepEqual(OPENROUTER_DISCOVERY_POLICY, {
    catalogSync: true,
    endpointMetadataRefresh: true,
    recommendations: true,
    providerInference: false,
    routeReconciliation: false,
    routePromotion: false
  });
});
