import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDecisionAction } from "./learning-prior-sanitizer.mjs";

test("removes secret-bearing object keys recursively", () => {
  const result = sanitizeDecisionAction({
    kind:"paper_plan",
    limits:{maxOrders:3,api_key:"sk-secret-value-0123456789"},
    credential:"must-not-persist",
    metadata:{authorization:"Bearer token",private_key:"0x1234",safe_flag:true}
  });
  assert.deepEqual(result,{
    kind:"paper_plan",
    limits:{maxOrders:3},
    metadata:{safe_flag:true}
  });
});

test("redacts token-shaped values hidden inside ordinary text", () => {
  const jwt="eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signaturePayload123";
  const result=sanitizeDecisionAction({note:"trace "+jwt+" done",label:"safe"});
  assert.equal(result.note.includes(jwt),false);
  assert.equal(result.note.includes("[REDACTED_SECRET_LIKE]"),true);
  assert.equal(result.label,"safe");
});

test("bounds recursive structures and long arrays", () => {
  const values=Array.from({length:30},(_,i)=>i);
  const result=sanitizeDecisionAction({values,nested:{a:{b:{c:{d:{e:{f:"deep"}}}}}}});
  assert.equal(result.values.length,21);
  assert.equal(result.values[20],"[TRUNCATED]");
  assert.equal(result.nested.a.b.c.d.e.f,"[DEPTH_LIMIT]");
});
