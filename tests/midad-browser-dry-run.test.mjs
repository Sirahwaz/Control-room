import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserDryRun, createBrowserExecutionController } from "../mobile/factory/native/midad-browser/agent-runtime.mjs";
import { createNativeBrowserAgentRuntime } from "../mobile/factory/native/midad-browser/native-agent-runtime.mjs";

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
  const dryRun = createBrowserDryRun({ now: () => 1000 });
  const input = task([
    step("step-0001", "navigate", { url: "https://shop.example/catalog" }),
    step("step-0002", "getDomSnapshot", { maxChars: 4000 }, "https://shop.example"),
    step("step-0003", "click", { selector: "#checkout" }, "https://shop.example"),
  ]);
  const result = dryRun.plan(input);
  assert.equal(result.ok, true);
  assert.equal(result.state, "dry_run_completed");
  assert.equal(result.plan.length, 3);
  assert.equal(result.plan[2].requiresApproval, true);
  assert.equal(result.plan.every((item) => item.willExecute === false), true);
  assert.equal(result.evidence.every((item) => item.status === "planned"), true);
  assert.equal(result.mode, "dry_run");
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


test("execution controller defaults to DRY_RUN and blocks live execution until explicit mode selection", async () => {
  const dryRun = createBrowserDryRun({ now: () => 1000 });
  let liveRuns = 0;
  const controller = createBrowserExecutionController({
    dryRun,
    liveRuntime: { run: async () => { liveRuns += 1; return { ok: true, state: "completed" }; } },
  });
  const input = task([step("step-0001", "getDomSnapshot", { maxChars: 1000 })]);

  assert.equal(controller.getMode(), "dry_run");
  assert.equal(controller.plan(input).ok, true);
  const blocked = await controller.run(input);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.error, "live_mode_not_explicitly_enabled");
  assert.equal(liveRuns, 0);
});

test("execution controller permits LOCAL_NATIVE only after explicit mode selection and can return to DRY_RUN", async () => {
  const dryRun = createBrowserDryRun({ now: () => 1000 });
  let liveRuns = 0;
  const controller = createBrowserExecutionController({
    dryRun,
    liveRuntime: { run: async () => { liveRuns += 1; return { ok: true, state: "completed" }; } },
  });
  const input = task([step("step-0001", "getDomSnapshot", { maxChars: 1000 })]);

  assert.equal(controller.setMode("local_native"), true);
  assert.equal(controller.getMode(), "local_native");
  assert.deepEqual(await controller.run(input), { ok: true, state: "completed" });
  assert.equal(liveRuns, 1);
  assert.equal(controller.setMode("dry_run"), true);
  assert.equal(controller.getMode(), "dry_run");
  assert.equal((await controller.run(input)).error, "live_mode_not_explicitly_enabled");
  assert.equal(controller.setMode("cloud_browser"), false);
  assert.equal(liveRuns, 1);
});


test("execution controller preserves runtime lifecycle APIs behind the LOCAL_NATIVE gate", () => {
  const calls = [];
  const controller = createBrowserExecutionController({
    dryRun: createBrowserDryRun(),
    liveRuntime: {
      run: async () => ({ ok: true }),
      pause: () => { calls.push("pause"); return true; },
      resume: () => { calls.push("resume"); return true; },
      cancel: () => { calls.push("cancel"); return true; },
      getState: () => ({ state: "running" }),
    },
  });
  assert.equal(controller.pause(), false);
  assert.deepEqual(controller.getState(), {
    state: "blocked", mode: "dry_run", error: "live_mode_not_explicitly_enabled",
  });
  assert.equal(controller.setMode("local_native"), true);
  assert.equal(controller.pause(), true);
  assert.equal(controller.resume(), true);
  assert.equal(controller.cancel(), true);
  assert.deepEqual(controller.getState(), { state: "running" });
  assert.deepEqual(calls, ["pause", "resume", "cancel"]);
});


test("public native runtime does not expose bridge or driver handles that bypass DRY_RUN", () => {
  const nativeObject = { postMessage() {}, onmessage: null };
  const agent = createNativeBrowserAgentRuntime({
    nativeObject,
    allowedOrigins: [ORIGIN],
  });

  assert.equal(agent.runtime.getMode(), "dry_run");
  assert.equal(agent.runtime, agent.execution);
  assert.equal("bridge" in agent, false);
  assert.equal("driver" in agent, false);
  assert.deepEqual(Object.keys(agent).sort(), ["dryRun", "execution", "runtime"]);
  assert.equal(typeof agent.dryRun.plan, "function");
  assert.equal(typeof agent.runtime.run, "function");
});

test("native runtime exposes a safe close path that releases its private bridge handler", () => {
  const nativeObject = { postMessage() {}, onmessage: null };
  const agent = createNativeBrowserAgentRuntime({
    nativeObject,
    allowedOrigins: [ORIGIN],
  });

  const installedHandler = nativeObject.onmessage;
  assert.equal(typeof installedHandler, "function");
  assert.equal(typeof agent.execution.close, "function");
  agent.execution.close();
  assert.equal(nativeObject.onmessage, null);
  assert.notEqual(nativeObject.onmessage, installedHandler);
});


test("execution controller close is terminal and blocks later live operations", async () => {
  const calls = [];
  const controller = createBrowserExecutionController({
    dryRun: createBrowserDryRun(),
    liveRuntime: {
      run: async () => { calls.push("run"); return { ok: true }; },
      pause: () => { calls.push("pause"); return true; },
      resume: () => { calls.push("resume"); return true; },
      cancel: () => { calls.push("cancel"); return true; },
      getState: () => ({ state: "running" }),
    },
  });
  assert.equal(controller.close(), true);
  assert.equal(controller.close(), false);
  assert.equal(controller.setMode("local_native"), false);
  assert.equal(controller.getMode(), "dry_run");
  assert.equal((await controller.run({})).error, "runtime_closed");
  assert.equal(controller.pause(), false);
  assert.equal(controller.resume(), false);
  assert.equal(controller.cancel(), false);
  assert.deepEqual(controller.getState(), {
    state: "blocked", mode: "dry_run", error: "runtime_closed",
  });
  assert.deepEqual(calls, []);
});
