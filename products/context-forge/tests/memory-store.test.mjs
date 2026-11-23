import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "../memory-store.mjs";

async function withStore(run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "context-forge-memory-"));
  try {
    const store = createMemoryStore({
      filePath: join(directory, "memory.jsonl"),
      ownerId: options.ownerId ?? "local-user",
      now: options.now ?? (() => new Date("2026-10-18T12:00:00.000Z"))
    });
    await run(store, join(directory, "memory.jsonl"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("saves explicit user notes with provenance and PENDING status", async () => {
  await withStore(async (store) => {
    const note = await store.saveUserNote("The project needs a local context memory.", { label: "planning note" });
    assert.match(note.id, /^mem_/);
    assert.equal(note.status, "PENDING");
    assert.equal(note.ownerId, "local-user");
    assert.equal(note.source.type, "user_input");
    assert.equal(note.source.label, "planning note");
    assert.equal(note.verification, null);
    assert.equal(note.contentHash.length, 64);
  });
});

test("search retrieves only relevant records and keeps the owner scope", async () => {
  await withStore(async (store) => {
    await store.saveUserNote("Context compiler tracks source lineage.", { label: "engineering" });
    await store.saveUserNote("Android companion supports offline capture.", { label: "mobile" });
    const results = await store.search("source lineage");
    assert.equal(results.length, 1);
    assert.match(results[0].text, /source lineage/i);
    assert.equal(results[0].ownerId, "local-user");
  });
});

test("rejects likely secret material before writing it to disk", async () => {
  await withStore(async (store, filePath) => {
    await assert.rejects(
      store.saveUserNote("api_key=sk-abcdefghijklmnopqrstuvwxyz123456", { label: "unsafe note" }),
      /sensitive material/i
    );
    assert.deepEqual(await store.list(), []);
  });
});

test("rejects empty notes and excessive input", async () => {
  await withStore(async (store) => {
    await assert.rejects(store.saveUserNote("   "), /non-empty/i);
    await assert.rejects(store.saveUserNote("x".repeat(9000)), /length limit/i);
  });
});

test("preserves append-only records and returns latest records first", async () => {
  let tick = 0;
  await withStore(async (store, filePath) => {
    const first = await store.saveUserNote("First project decision.", { label: "one" });
    tick += 1;
    const secondStore = createMemoryStore({
      filePath,
      ownerId: "local-user",
      now: () => new Date(Date.parse("2026-10-18T12:00:00.000Z") + tick * 1000)
    });
    const second = await secondStore.saveUserNote("Second project decision.", { label: "two" });
    const records = await store.list();
    assert.equal(records.length, 2);
    assert.equal(records[0].id, second.id);
    assert.equal(records[1].id, first.id);
  });
});

test("fails closed on malformed memory log lines", async () => {
  await withStore(async (store, filePath) => {
    await writeFile(filePath, "{broken-json}\n", "utf8");
    await assert.rejects(store.list(), /memory log is corrupt/i);
  });
});

test("requires an explicit file path and owner namespace", () => {
  assert.throws(() => createMemoryStore({}), /filePath/i);
  assert.throws(() => createMemoryStore({ filePath: "/tmp/memory.jsonl", ownerId: "" }), /ownerId/i);
});

test("saves a plan-cycle record only with deterministic verification evidence", async () => {
  await withStore(async (store) => {
    const record = await store.saveAgentCycle({
      goal: "Audit context integration",
      contextHash: "a".repeat(64),
      planId: "plan_test_01",
      planVerification: {
        status: "VERIFIED",
        scope: "plan_policy_only",
        method: "deterministic_plan_policy",
        evidenceHash: "b".repeat(64),
        checks: [
          { code: "TOOLS_ALLOWLISTED", passed: true },
          { code: "INPUTS_SCHEMA_VALID", passed: true }
        ]
      },
      plannedSteps: [{
        tool: "inspect_context",
        input: { accessToken: "never-save-this-input" },
        effect: "read",
        expectedOutcome: "Context diagnostics are returned"
      }],
      relatedMemoryIds: ["mem_prior"],
      learning: {
        status: "INFERRED",
        signals: { stepCount: 1, stepsWithExpectedOutcome: 1, contextConflictCount: 0, retrievedMemoryCount: 1 },
        recommendations: ["Continue requiring expected outcomes."]
      }
    });

    assert.equal(record.recordType, "agent_cycle");
    assert.equal(record.status, "PENDING");
    assert.equal(record.cycle.planVerification.status, "VERIFIED");
    assert.equal(record.cycle.planVerification.scope, "plan_policy_only");
    assert.equal(record.cycle.learning.status, "INFERRED");
    assert.equal(Object.hasOwn(record.cycle.plannedSteps[0], "input"), false);
    assert.equal(JSON.stringify(record).includes("never-save-this-input"), false);
  });
});

test("refuses to persist a cycle without verified plan-policy evidence", async () => {
  await withStore(async (store) => {
    await assert.rejects(store.saveAgentCycle({
      goal: "Unverified plan",
      contextHash: "a".repeat(64),
      planId: "plan_unverified",
      planVerification: {
        status: "PENDING",
        scope: "plan_policy_only",
        method: "deterministic_plan_policy",
        evidenceHash: "b".repeat(64),
        checks: []
      },
      plannedSteps: [],
      relatedMemoryIds: [],
      learning: { status: "INFERRED", signals: {}, recommendations: [] }
    }), /plan verification/i);
    assert.deepEqual(await store.list(), []);
  });
});

test("learning report summarizes prior cycles without claiming task completion", async () => {
  await withStore(async (store) => {
    const before = await store.getLearningReport();
    assert.equal(before.status, "PENDING");
    assert.equal(before.cyclesAnalyzed, 0);

    await store.saveAgentCycle({
      goal: "Improve plan specificity",
      contextHash: "a".repeat(64),
      planId: "plan_learning_01",
      planVerification: {
        status: "VERIFIED",
        scope: "plan_policy_only",
        method: "deterministic_plan_policy",
        evidenceHash: "b".repeat(64),
        checks: [{ code: "TOOLS_ALLOWLISTED", passed: true }]
      },
      plannedSteps: [
        { tool: "inspect_context", effect: "read", expectedOutcome: "" },
        { tool: "inspect_context", effect: "read", expectedOutcome: "Return context diagnostics" }
      ],
      relatedMemoryIds: [],
      learning: {
        status: "INFERRED",
        signals: { stepCount: 2, stepsWithExpectedOutcome: 1, contextConflictCount: 0, retrievedMemoryCount: 0 },
        recommendations: ["Add expected outcomes for every planned step."]
      }
    });

    const report = await store.getLearningReport();
    assert.equal(report.status, "INFERRED");
    assert.equal(report.cyclesAnalyzed, 1);
    assert.equal(report.taskCompletionProven, false);
    assert.equal(report.metrics.steps, 2);
    assert.equal(report.metrics.stepsWithExpectedOutcome, 1);
    assert.ok(report.recommendations.some((item) => /expected outcomes/i.test(item.recommendation)));
  });
});
