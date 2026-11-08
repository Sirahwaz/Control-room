import test from "node:test";
import assert from "node:assert/strict";
import { shouldAllowRouterFallback } from "./public-routing-policy.mjs";

test("public sanitized requests never use the generic Control Room fallback", () => {
  assert.equal(shouldAllowRouterFallback({taskClass:"public_sanitized"}),false);
  assert.equal(shouldAllowRouterFallback({taskClass:" PUBLIC_SANITIZED "}),false);
});

test("existing non-public task classes retain their prior fallback behavior", () => {
  for (const taskClass of ["market_analysis","coding","generic","revenue_triage",""]) {
    assert.equal(shouldAllowRouterFallback({taskClass}),true);
  }
});

test("missing task class retains the generic default behavior", () => {
  assert.equal(shouldAllowRouterFallback({}),true);
  assert.equal(shouldAllowRouterFallback(),true);
});
