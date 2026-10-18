import test from "node:test";
import assert from "node:assert/strict";
import { authorizeToolCall, runBoundedAgent } from "../agent-kernel.mjs";

const readTool = {
  manifest: { name: "read_project", enabled: true, effect: "read" },
  execute: async ({ input }) => ({ content: `read:${input.path}` })
};

test("dry-run is the default and does not execute tools", async () => {
  let executed = false;
  const result = await runBoundedAgent({
    goal: "Inspect a source file",
    reasoner: { plan: async () => ({ steps: [{ tool: "read_project", input: { path: "README.md" } }] }) },
    toolRegistry: { read_project: { ...readTool, execute: async () => { executed = true; } } }
  });

  assert.equal(result.status, "PLANNED");
  assert.equal(result.steps[0].status, "DRY_RUN");
  assert.equal(executed, false);
});

test("read-only tool can execute only in explicit execute mode", async () => {
  const result = await runBoundedAgent({
    goal: "Inspect a source file",
    mode: "execute",
    reasoner: { plan: async () => ({ steps: [{ tool: "read_project", input: { path: "README.md" } }] }) },
    toolRegistry: { read_project: readTool }
  });

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.steps[0].status, "EXECUTED");
  assert.deepEqual(result.steps[0].output, { content: "read:README.md" });
});

test("unknown or unregistered tools are denied", async () => {
  let executed = false;
  const result = await runBoundedAgent({
    goal: "Do a task",
    mode: "execute",
    reasoner: { plan: async () => ({ steps: [{ tool: "unlisted_tool", input: {} }] }) },
    toolRegistry: { read_project: { ...readTool, execute: async () => { executed = true; } } }
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.steps[0].status, "DENIED");
  assert.equal(executed, false);
});

test("high-impact tool requires explicit scoped approval", () => {
  const tool = { manifest: { name: "publish_release", enabled: true, effect: "publish" }, execute: async () => ({ ok: true }) };
  assert.equal(authorizeToolCall({ toolName: "publish_release", tool, mode: "execute" }).status, "APPROVAL_REQUIRED");
  assert.equal(authorizeToolCall({
    toolName: "publish_release",
    tool,
    mode: "execute",
    approval: { approved: true, toolName: "publish_release", effect: "publish" }
  }).status, "AUTHORIZED");
  assert.equal(authorizeToolCall({
    toolName: "publish_release",
    tool,
    mode: "execute",
    approval: { approved: true, toolName: "publish_release", effect: "financial" }
  }).status, "APPROVAL_REQUIRED");
});

test("planning retries are bounded to at most three attempts", async () => {
  let calls = 0;
  const result = await runBoundedAgent({
    goal: "Prepare a plan",
    maxAttempts: 99,
    reasoner: { plan: async () => { calls += 1; throw new Error("model unavailable"); } },
    toolRegistry: {}
  });
  assert.equal(calls, 3);
  assert.equal(result.status, "FAILED");
  assert.equal(result.attempts, 3);
});

test("audit failure blocks execution before a tool can run", async () => {
  let executed = false;
  const result = await runBoundedAgent({
    goal: "Read a source",
    mode: "execute",
    reasoner: { plan: async () => ({ steps: [{ tool: "read_project", input: { path: "README.md" } }] }) },
    toolRegistry: { read_project: { ...readTool, execute: async () => { executed = true; return {}; } } },
    audit: async () => { throw new Error("audit store unavailable"); }
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.steps.length, 0);
  assert.equal(executed, false);
});
