import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenRouterRequestPolicy } from "./openrouter-request-policy.mjs";

const model = "approved/free-model:free";
const routeMetadata = {
  privacy_profile: "public_sanitized",
  provider_only: ["approved"]
};

test("public sanitized route stays allowlisted and never enables provider fallback", () => {
  const result = buildOpenRouterRequestPolicy({
    configuredModel: model,
    routeMetadata,
    budgetClass: "free",
    dataClass: "public"
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.provider, {
    allow_fallbacks: false,
    data_collection: "allow",
    sort: "price",
    only: ["approved"]
  });
});

test("sanitized safety-retention route remains no-fallback and no-data-collection", () => {
  const result = buildOpenRouterRequestPolicy({
    configuredModel: model,
    routeMetadata: {privacy_profile:"sanitized_safety_retention",provider_only:["approved"]},
    budgetClass: "free",
    dataClass: "sanitized"
  });
  assert.equal(result.ok,true);
  assert.equal(result.provider.allow_fallbacks,false);
  assert.equal(result.provider.data_collection,"deny");
  assert.equal(result.provider.zdr,false);
});

test("sensitive route remains no-fallback and requires ZDR", () => {
  const result=buildOpenRouterRequestPolicy({
    configuredModel:model,
    routeMetadata:{privacy_profile:"sensitive"},
    budgetClass:"free"
  });
  assert.equal(result.ok,true);
  assert.equal(result.provider.allow_fallbacks,false);
  assert.equal(result.provider.data_collection,"deny");
  assert.equal(result.provider.zdr,true);
});
