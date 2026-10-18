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
    await assert.rejects(store.list(), async (error) => error.code === "ENOENT");
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
