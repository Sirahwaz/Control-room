import { hasRequiredBaseFinality } from "./finality.ts";

function expect(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

Deno.test("accepts independently finalized evidence without a numeric confirmation field", () => {
  expect(hasRequiredBaseFinality({ finality: "finalized" }), "finalized should pass");
});
Deno.test("accepts 3_confirmations only when count is at least three", () => {
  expect(hasRequiredBaseFinality({ finality: "3_confirmations", confirmations: 3 }), "3 should pass");
  expect(hasRequiredBaseFinality({ finality: "3_confirmations", confirmations: 12 }), "12 should pass");
});
Deno.test("accepts at_least_3_confirmations only when count is at least three", () => {
  expect(hasRequiredBaseFinality({ finality: "at_least_3_confirmations", confirmations: 3 }), "alias at 3 should pass");
});
Deno.test("rejects insufficient, absent, fractional, or malformed confirmation counts", () => {
  expect(!hasRequiredBaseFinality({ finality: "3_confirmations", confirmations: 2 }), "2 must fail");
  expect(!hasRequiredBaseFinality({ finality: "3_confirmations" }), "missing must fail");
  expect(!hasRequiredBaseFinality({ finality: "3_confirmations", confirmations: 2.5 }), "fractional must fail");
  expect(!hasRequiredBaseFinality({ finality: "at_least_3_confirmations", confirmations: "NaN" }), "NaN must fail");
  expect(!hasRequiredBaseFinality({ finality: "at_least_3_confirmations", confirmations: "" }), "empty must fail");
});
Deno.test("rejects unknown finality labels and non-object evidence", () => {
  expect(!hasRequiredBaseFinality({ finality: "confirmed", confirmations: 100 }), "unknown label must fail");
  expect(!hasRequiredBaseFinality(null), "null must fail");
  expect(!hasRequiredBaseFinality({}), "empty evidence must fail");
});
