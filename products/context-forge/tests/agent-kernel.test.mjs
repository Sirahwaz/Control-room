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
    reasoner: { plan: async () => ({ steps: [{ tool: "read_project", input: { path: "README.md" }, expectedOutcome: "file content returned" }] }) },
    toolRegistry: { read_project: readTool },
    verifyStep: async ({ output }) => ({ verified: true, evidence: "read-result-test", summary: output.content })
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
    toolRegistry: { read_project: { ...readTool, execute: async () => { executed = true; } } },
    verifyStep: async () => ({ verified: true, evidence: "test-evidence" })
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
    approval: {
      id: "approval-1", approved: true, toolName: "publish_release", effect: "publish",
      actorId: "user-1", scope: "release:staging", expiresAt: "2026-10-18T12:05:00.000Z"
    },
    actorId: "user-1",
    now: new Date("2026-10-18T12:00:00.000Z")
  }).status, "AUTHORIZED");
  assert.equal(authorizeToolCall({
    toolName: "publish_release",
    tool,
    mode: "execute",
    approval: {
      id: "approval-2", approved: true, toolName: "publish_release", effect: "financial",
      actorId: "user-1", scope: "release:staging", expiresAt: "2026-10-18T12:05:00.000Z"
    },
    actorId: "user-1",
    now: new Date("2026-10-18T12:00:00.000Z")
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
    verifyStep: async () => ({ verified: true, evidence: "test-evidence" }),
    audit: async () => { throw new Error("audit store unavailable"); }
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.steps.length, 0);
  assert.equal(executed, false);
});

test("passes only sanitized tool manifests to the reasoner", async () => {
  let receivedTools;
  const result = await runBoundedAgent({
    goal: "Inspect safely",
    reasoner: {
      plan: async ({ tools }) => {
        receivedTools = tools;
        return { steps: [{ tool: "read_project", input: {} }] };
      }
    },
    toolRegistry: {
      read_project: {
        manifest: {
          name: "read_project",
          enabled: true,
          effect: "read",
          description: "Read approved project files",
          privateCredential: "must-not-reach-reasoner"
        },
        execute: async () => ({ ok: true })
      }
    }
  });
  assert.equal(result.status, "PLANNED");
  assert.deepEqual(receivedTools, [{
    name: "read_project",
    description: "Read approved project files",
    effect: "read",
    enabled: true
  }]);
  assert.equal(JSON.stringify(receivedTools).includes("must-not-reach-reasoner"), false);
});

test("requires identity, scope, and expiry for high-impact approval", () => {
  const tool = { manifest: { name: "publish_release", enabled: true, effect: "publish" }, execute: async () => ({ ok: true }) };
  const decision = authorizeToolCall({
    toolName: "publish_release",
    tool,
    mode: "execute",
    actorId: "user-1",
    now: new Date("2026-10-18T12:00:00.000Z"),
    approval: {
      id: "approval-3",
      approved: true,
      toolName: "publish_release",
      effect: "publish",
      actorId: "user-1",
      scope: "release:staging",
      expiresAt: "2026-10-18T12:05:00.000Z"
    }
  });
  assert.equal(decision.status, "AUTHORIZED");
  assert.equal(authorizeToolCall({
    toolName: "publish_release",
    tool,
    mode: "execute",
    actorId: "user-1",
    now: new Date("2026-10-18T12:10:00.000Z"),
    approval: {
      approved: true,
      toolName: "publish_release",
      effect: "publish",
      actorId: "user-1",
      scope: "release:staging",
      expiresAt: "2026-10-18T12:05:00.000Z"
    }
  }).status, "APPROVAL_REQUIRED");
});

test("does not execute a tool without a result verifier", async () => {
  let executed = false;
  const result = await runBoundedAgent({
    goal: "Read a source",
    mode: "execute",
    reasoner: { plan: async () => ({ steps: [{ tool: "read_project", input: { path: "README.md" }, expectedOutcome: "file content returned" }] }) },
    toolRegistry: { read_project: { ...readTool, execute: async () => { executed = true; return { content: "ok" }; } } }
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(executed, false);
  assert.match(result.reason, /verifier/i);
});

test("marks executed tool output VERIFIED only when verifier returns evidence", async () => {
  const result = await runBoundedAgent({
    goal: "Read a source",
    mode: "execute",
    reasoner: { plan: async () => ({ steps: [{ tool: "read_project", input: { path: "README.md" }, expectedOutcome: "file content returned" }] }) },
    toolRegistry: { read_project: readTool },
    verifyStep: async ({ output }) => ({ verified: true, evidence: "test-observation-001", summary: output.content })
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.steps[0].verification.status, "VERIFIED");
  assert.equal(result.steps[0].verification.evidence, "test-observation-001");
});

test("returns PENDING when a verifier cannot establish the expected outcome", async () => {
  const result = await runBoundedAgent({
    goal: "Read a source",
    mode: "execute",
    reasoner: { plan: async () => ({ steps: [{ tool: "read_project", input: { path: "README.md" }, expectedOutcome: "file content returned" }] }) },
    toolRegistry: { read_project: readTool },
    verifyStep: async () => ({ verified: false, reason: "Expected content marker not found" })
  });
  assert.equal(result.status, "PENDING");
  assert.equal(result.steps[0].status, "EXECUTED_UNVERIFIED");
});

test("blocks high-impact approval when the actor identity does not match", () => {
  const tool = { manifest: { name: "publish_release", enabled: true, effect: "publish" }, execute: async () => ({ ok: true }) };
  const decision = authorizeToolCall({
    toolName: "publish_release", tool, mode: "execute", actorId: "user-2",
    now: new Date("2026-10-18T12:00:00.000Z"),
    approval: {
      id: "approval-4", approved: true, toolName: "publish_release", effect: "publish", actorId: "user-1",
      scope: "release:staging", expiresAt: "2026-10-18T12:05:00.000Z"
    }
  });
  assert.equal(decision.status, "APPROVAL_REQUIRED");
});

test("never executes a high-impact tool without a trusted one-use approval consumer", async () => {
  let executed = false;
  const approval = {
    id: "approval-run-1", approved: true, toolName: "publish_release", effect: "publish",
    actorId: "user-1", scope: "release:staging", expiresAt: "2099-10-18T12:05:00.000Z"
  };
  const result = await runBoundedAgent({
    goal: "Publish staging release",
    mode: "execute",
    actorId: "user-1",
    approvals: [approval],
    reasoner: { plan: async () => ({ steps: [{ tool: "publish_release", input: { target: "staging" }, expectedOutcome: "staging release is available" }] }) },
    toolRegistry: {
      publish_release: {
        manifest: { name: "publish_release", enabled: true, effect: "publish", approvalScope: "release:staging" },
        execute: async () => { executed = true; return { ok: true }; }
      }
    },
    verifyStep: async () => ({ verified: true, evidence: "release-url-123" })
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(executed, false);
  assert.match(result.reason, /one-use approval consumer/i);
});

test("one-use approval must be consumed by the trusted store before an impactful tool runs", async () => {
  let executed = false;
  const approval = {
    id: "approval-run-2", approved: true, toolName: "publish_release", effect: "publish",
    actorId: "user-1", scope: "release:staging", expiresAt: "2099-10-18T12:05:00.000Z"
  };
  const result = await runBoundedAgent({
    goal: "Publish staging release",
    mode: "execute",
    actorId: "user-1",
    approvals: [approval],
    reasoner: { plan: async () => ({ steps: [{ tool: "publish_release", input: { target: "staging" }, expectedOutcome: "staging release is available" }] }) },
    toolRegistry: {
      publish_release: {
        manifest: { name: "publish_release", enabled: true, effect: "publish", approvalScope: "release:staging" },
        execute: async () => { executed = true; return { ok: true }; }
      }
    },
    verifyStep: async () => ({ verified: true, evidence: "release-url-123" }),
    consumeApproval: async () => false
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(executed, false);
  assert.match(result.reason, /approval verification failed/i);
});
