import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenRouterRequestPolicy } from "./openrouter-request-policy.mjs";
import { evaluateGeminiRequestPolicy } from "./gemini-request-policy.mjs";
import { resolveAutoPromotableRouteTaskClass } from "./model-promotion-policy.mjs";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const baseRoute = { privacy_profile: "sanitized_safety_retention", provider_only: ["stealth"], price_input_per_token: "0", price_output_per_token: "0", free_price_verified_at: new Date(NOW - 60 * 60 * 1000).toISOString() };

test("Safety Retention permits public/sanitized only and never claims ZDR", () => {
  for (const dataClass of ["public", "sanitized"]) {
    const r = buildOpenRouterRequestPolicy({ routeMetadata: baseRoute, budgetClass:"free", configuredModel:"stealth/crouton-alpha", dataClass, now:NOW });
    assert.equal(r.ok, true);
    assert.equal(r.provider.data_collection, "deny");
    assert.equal(r.provider.zdr, false);
    assert.equal(r.provider.allow_fallbacks, false);
  }
});

test("Safety Retention rejects sensitive/private/unknown data", () => {
  for (const dataClass of ["private", "sensitive", "", undefined]) {
    const r = buildOpenRouterRequestPolicy({ routeMetadata:baseRoute, budgetClass:"free", configuredModel:"stealth/crouton-alpha", dataClass, now:NOW });
    assert.equal(r.ok, false);
    assert.equal(r.error, "openrouter_safety_retention_requires_public_or_sanitized_data");
  }
});

test("Public-sanitized profile requires a valid provider allowlist", () => {
  const r = buildOpenRouterRequestPolicy({ routeMetadata:{privacy_profile:"public_sanitized",provider_only:[]}, budgetClass:"free", configuredModel:"provider/model:free", dataClass:"public", now:NOW });
  assert.equal(r.error, "openrouter_public_provider_allowlist_required");
});

test("Provider allowlist accepts valid slugs and drops invalid entries", () => {
  const r = buildOpenRouterRequestPolicy({ routeMetadata:{privacy_profile:"public_sanitized",provider_only:["valid-provider","../bad","UPPER_CASE"]}, budgetClass:"free", configuredModel:"provider/model:free", dataClass:"sanitized", now:NOW });
  assert.equal(r.ok,true);
  assert.deepEqual(r.provider.only,["valid-provider"]);
});

test("OpenRouter refuses paid budgets and caller model overrides", () => {
  const paid=buildOpenRouterRequestPolicy({routeMetadata:baseRoute,budgetClass:"paid",configuredModel:"provider/model:free",dataClass:"public",now:NOW});
  assert.equal(paid.error,"openrouter_paid_budget_disabled");
  const override=buildOpenRouterRequestPolicy({routeMetadata:baseRoute,budgetClass:"free",configuredModel:"provider/model:free",requestedModel:"attacker/model:free",dataClass:"public",now:NOW});
  assert.equal(override.error,"openrouter_model_override_not_allowed");
});

test("Non-free model requires fresh zero input/output price proof", () => {
  const base={routeMetadata:{privacy_profile:"sanitized_safety_retention",provider_only:["stealth"]},budgetClass:"free",configuredModel:"stealth/model",dataClass:"public",now:NOW};
  assert.equal(buildOpenRouterRequestPolicy(base).error,"openrouter_free_price_proof_missing_or_stale");
  const stale=buildOpenRouterRequestPolicy({...base,routeMetadata:{...baseRoute,price_input_per_token:"0",price_output_per_token:"0",free_price_verified_at:new Date(NOW-25*3600000).toISOString()}});
  assert.equal(stale.error,"openrouter_free_price_proof_missing_or_stale");
  const fresh=buildOpenRouterRequestPolicy({...base,routeMetadata:{...baseRoute,price_input_per_token:"0",price_output_per_token:"0",free_price_verified_at:new Date(NOW-3600000).toISOString()}});
  assert.equal(fresh.ok,true);
  assert.equal(fresh.provider.zdr,false);
});

test("Sensitive profile requires deny collection, ZDR, and no fallback", () => {
  const r=buildOpenRouterRequestPolicy({routeMetadata:{privacy_profile:"sensitive"},budgetClass:"free",configuredModel:"provider/model:free",dataClass:"sensitive",now:NOW});
  assert.equal(r.ok,true);
  assert.equal(r.provider.zdr,true);
  assert.equal(r.provider.data_collection,"deny");
  assert.equal(r.provider.allow_fallbacks,false);
});

test("Gemini permits only data classes explicitly allowed by the route", () => {
  const meta={privacy_profile:"public_sanitized_only",allowed_data_classes:["public","sanitized"]};
  assert.deepEqual(evaluateGeminiRequestPolicy({routeMetadata:meta,dataClass:"public"}),{ok:true,dataClass:"public"});
  assert.deepEqual(evaluateGeminiRequestPolicy({routeMetadata:meta,dataClass:"sanitized"}),{ok:true,dataClass:"sanitized"});
  for (const dataClass of ["private","sensitive","",undefined]) assert.equal(evaluateGeminiRequestPolicy({routeMetadata:meta,dataClass}).ok,false);
});

test("Gemini rejects a route without public-sanitized privacy profile", () => {
  const r=evaluateGeminiRequestPolicy({routeMetadata:{privacy_profile:"sensitive",allowed_data_classes:["public"]},dataClass:"public"});
  assert.equal(r.error,"gemini_route_not_marked_public_sanitized");
});

test("Automatic promotion is restricted to general reasoning only", () => {
  assert.equal(resolveAutoPromotableRouteTaskClass("general_reasoning"),"generic");
  for (const task of ["market_analysis","research_compression","osint_synthesis","client_proposal","audio_tasks","vision_analysis","generic"]) {
    assert.equal(resolveAutoPromotableRouteTaskClass(task),null);
  }
});
