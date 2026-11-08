import test from "node:test";
import assert from "node:assert/strict";
import { resolveRouterRoutePolicy } from "./public-routing-policy.mjs";

test("leaves existing non-public task routing unchanged", () => {
  assert.deepEqual(resolveRouterRoutePolicy({taskClass:"market_analysis",dataClass:"private"}),{ok:true,taskClass:"market_analysis",dataClass:null});
});
test("allows public market data only with an allowlisted source scope", () => {
  const r=resolveRouterRoutePolicy({taskClass:"public_sanitized",dataClass:"public",sourceScope:"public_market_data",content:"BTC public price and exchange volume summary"});
  assert.equal(r.ok,true); assert.equal(r.taskClass,"public_sanitized"); assert.equal(r.dataClass,"public");
});
test("allows every documented public provenance scope", () => {
  for(const sourceScope of ["public_chain_data","public_web_content","public_technical_docs","public_reference"]) assert.equal(resolveRouterRoutePolicy({taskClass:"public_sanitized",dataClass:"public",sourceScope,content:"Public source extract"}).ok,true);
});
test("rejects missing, private or unknown data class", () => {
  for(const dataClass of [undefined,"","private","sensitive","customer_data"]) assert.equal(resolveRouterRoutePolicy({taskClass:"public_sanitized",dataClass,sourceScope:"public_market_data",content:"Public evidence"}).ok,false);
});
test("rejects public data without allowlisted source provenance", () => {
  for(const sourceScope of [undefined,"internal_database","user_upload","unknown"]) assert.equal(resolveRouterRoutePolicy({taskClass:"public_sanitized",dataClass:"public",sourceScope,content:"Public evidence"}).error,"public_route_requires_allowlisted_source_scope");
});
test("sanitized data requires explicit verified sanitization", () => {
  assert.equal(resolveRouterRoutePolicy({taskClass:"public_sanitized",dataClass:"sanitized",content:"redacted extract"}).error,"sanitized_route_requires_verified_sanitization_method");
  assert.equal(resolveRouterRoutePolicy({taskClass:"public_sanitized",dataClass:"sanitized",sanitizationVerified:true,sanitizationMethod:"unknown",content:"redacted extract"}).error,"sanitized_route_requires_verified_sanitization_method");
});
test("accepts only documented sanitization methods", () => {
  for(const method of ["credential_redaction","pii_redaction","allowlisted_fields","aggregation_only"]) assert.equal(resolveRouterRoutePolicy({taskClass:"public_sanitized",dataClass:"sanitized",sanitizationVerified:true,sanitizationMethod:method,content:"Aggregated public-market metrics"}).ok,true);
});
test("blocks obvious secrets, bearer tokens, passwords, seed phrase labels and private keys", () => {
  const fakeOpenAiKey=["sk","-","abcdefghijklmnopqrstuvwxyz123456"].join("");
  const fakePrivateKeyHeader=["-----BEGIN ","PRIVATE KEY-----"].join("");
  const samples=[`api_key: ${fakeOpenAiKey}`,"Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456","password: SuperSecretCredential12345","seed phrase: alpha beta gamma delta epsilon",fakePrivateKeyHeader];
  for(const content of samples) assert.equal(resolveRouterRoutePolicy({taskClass:"public_sanitized",dataClass:"public",sourceScope:"public_web_content",content}).error,"public_route_sensitive_material_detected");
});
test("blocks empty public route content", () => {
  assert.equal(resolveRouterRoutePolicy({taskClass:"public_sanitized",dataClass:"public",sourceScope:"public_reference",content:""}).error,"public_route_content_required");
});
