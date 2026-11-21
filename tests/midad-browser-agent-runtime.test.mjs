import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserAgentRuntime } from "../mobile/factory/native/midad-browser/agent-runtime.mjs";

const ORIGIN = "https://example.com";
const baseTask = (steps) => ({
  id: "task-00000001",
  title: "Example task",
  startOrigin: ORIGIN,
  allowedOrigins: [ORIGIN, "https://shop.example"],
  capabilities: ["browser.navigate", "browser.inspect", "browser.wait", "browser.click", "browser.fill"],
  maxRetries: 2,
  steps,
});

const step = (id, type, fields = {}, origin = ORIGIN) => ({
  id, command: { id, type, tabId: 0, origin, ...fields },
});

test("agent runtime executes typed steps in order and records bounded evidence", async () => {
  const calls = [];
  const runtime = createBrowserAgentRuntime({
    driver: {
      navigate: async (command) => { calls.push(command.type); return { url: command.url }; },
      getDomSnapshot: async () => ({ html: "<h1>Ready</h1><input value='secret'>" }),
      waitFor: async () => ({ found: true }),
    },
  });
  const result = await runtime.run(baseTask([
    step("step-0001", "navigate", { url: ORIGIN + "/catalog" }),
    step("step-0002", "getDomSnapshot", { maxChars: 100 }),
    step("step-0003", "waitFor", { selector: "h1", timeoutMs: 1000 }),
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.state, "completed");
  assert.deepEqual(calls, ["navigate"]);
  assert.equal(result.evidence.length, 3);
  assert.match(JSON.stringify(result.evidence), /Ready/);
  assert.doesNotMatch(JSON.stringify(result.evidence), /secret/);
});

test("agent runtime rejects arbitrary JavaScript and commands outside the task origin scope", async () => {
  const runtime = createBrowserAgentRuntime({ driver: {} });
  const arbitrary = await runtime.run(baseTask([
    step("step-0001", "evaluate", { script: "alert(1)" }),
  ]));
  assert.equal(arbitrary.ok, false);
  assert.equal(arbitrary.error, "command_unsupported");

  const outside = await runtime.run(baseTask([
    step("step-0002", "navigate", { url: "https://evil.example/" }),
  ]));
  assert.equal(outside.ok, false);
  assert.equal(outside.error, "navigation_origin_not_allowed");
});

test("agent runtime requires a short-lived exact approval for page mutations", async () => {
  const calls = [];
  const runtime = createBrowserAgentRuntime({
    driver: { click: async () => { calls.push("clicked"); return { ok: true }; } },
  });
  const task = baseTask([step("step-0001", "click", { selector: "#continue" })]);
  const denied = await runtime.run(task);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "human_approval_required");
  assert.deepEqual(calls, []);

  const approvedRuntime = createBrowserAgentRuntime({
    driver: { click: async () => { calls.push("approved-click"); return { ok: true }; } },
    authorizeAction: async ({ binding }) => ({
      approvalId: "approval-00000001",
      binding,
      expiresAt: Date.now() + 60000,
    }),
  });
  const approved = await approvedRuntime.run(task);
  assert.equal(approved.ok, true);
  assert.deepEqual(calls, ["approved-click"]);
});

test("agent runtime retries only retryable failures and caps retries at three", async () => {
  let attempts = 0;
  const runtime = createBrowserAgentRuntime({
    driver: {
      waitFor: async () => {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error("temporary"), { retryable: true });
        return { found: true };
      },
    },
  });
  const result = await runtime.run(baseTask([
    step("step-0001", "waitFor", { selector: "main", timeoutMs: 1000 }),
  ]));
  assert.equal(result.ok, true);
  assert.equal(attempts, 3);
});

test("agent runtime exposes pause, resume and cancel states", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runtime = createBrowserAgentRuntime({
    driver: { waitFor: async () => { await gate; return { found: true }; } },
  });
  const running = runtime.run(baseTask([
    step("step-0001", "waitFor", { selector: "main", timeoutMs: 1000 }),
  ]));
  runtime.pause();
  assert.equal(runtime.getState().state, "paused");
  runtime.resume();
  assert.equal(runtime.getState().state, "running");
  runtime.cancel();
  release();
  const result = await running;
  assert.equal(result.state, "cancelled");
});

test("agent runtime fails closed on invalid origins, missing driver methods and sensitive command types", async () => {
  const runtime = createBrowserAgentRuntime({ driver: {} });
  const insecure = await runtime.run({ ...baseTask([step("step-0001", "navigate", { url: "http://example.com" })]), startOrigin: "http://example.com" });
  assert.equal(insecure.ok, false);
  assert.equal(insecure.error, "origin_invalid");

  const missing = await runtime.run(baseTask([
    step("step-0002", "captureScreenshot"),
  ]));
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "driver_method_unavailable");

  const sensitive = await runtime.run(baseTask([
    step("step-0003", "submit", { selector: "form" }),
  ]));
  assert.equal(sensitive.ok, false);
  assert.equal(sensitive.error, "command_unsupported");
});
