import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserDryRun } from "../mobile/factory/native/midad-browser/agent-runtime.mjs";

const ORIGIN = "https://example.com";
const task = (steps) => ({
  id: "dryrun-0000001",
  title: "Dry-run acceptance plan",
  startOrigin: ORIGIN,
  allowedOrigins: [ORIGIN, "https://shop.example"],
  capabilities: ["browser.navigate", "browser.inspect", "browser.wait", "browser.click", "browser.fill"],
  steps,
});
const step = (id, type, fields = {}, origin = ORIGIN) => ({
  id, command: { id, type, tabId: 0, origin, ...fields },
});

test("dry run plans navigation, inspection and mutation without invoking browser or approval adapters", () => {
  let driverCalls = 0;
  let approvalCalls = 0;
  const dryRun = createBrowserDryRun({ now: () => 1000 });
  const input = task([
    step("step-0001", "navigate", { url: "https://shop.example/catalog" }),
    step("step-0002", "getDomSnapshot", { maxChars: 4000 }, "https://shop.example"),
    step("step-0003", "click", { selector: "#checkout" }, "https://shop.example"),
  ]);
  const result = dryRun.plan(input, {
    onDriverCall: () => { driverCalls += 1; },
    authorizeAction: () => { approvalCalls += 1; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, "dry_run_completed");
  assert.equal(result.plan.length, 3);
  assert.equal(result.plan[2].requiresApproval, true);
  assert.equal(result.plan.every((item) => item.willExecute === false), true);
  assert.equal(result.evidence.every((item) => item.status === "planned"), true);
  assert.equal(driverCalls, 0);
  assert.equal(approvalCalls, 0);
});

test("dry run rejects a navigation target outside the declared origin allowlist", () => {
  const result = createBrowserDryRun().plan(task([
    step("step-0001", "navigate", { url: "https://evil.example/" }),
  ]));
  assert.equal(result.ok, false);
  assert.equal(result.state, "failed");
  assert.equal(result.error, "navigation_origin_not_allowed");
});

test("dry run never includes typed field values or secret-like data in its plan", () => {
  const result = createBrowserDryRun().plan(task([
    step("step-0001", "type", { selector: "#email", text: "private-user@example.com" }),
  ]));
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /private-user@example.com/);
  assert.equal(result.plan[0].type, "type");
  assert.equal(result.plan[0].willExecute, false);
});

test("dry run validates task bounds and unsupported commands before producing a plan", () => {
  const invalid = createBrowserDryRun().plan(task([
    step("step-0001", "evaluate", { script: "alert(1)" }),
  ]));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "command_unsupported");
});
