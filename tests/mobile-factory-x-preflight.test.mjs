import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preflight = "mobile/factory/x/preflight.mjs";

test("Factory X preflight completes and emits a valid report", () => {
  const run = spawnSync(process.execPath, [preflight], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(run.stdout.trim());
  assert.equal(report.ok, true);
  assert.equal(report.mode, "MIDAD Mobile Factory X");
  assert.equal(report.counts.agents, 38);
});

test("Factory X preflight reports invalid bindings without crashing", () => {
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "midad-factory-x-"));
  const source = path.join(repoRoot, "mobile/factory/x");
  const target = path.join(isolatedRoot, "mobile/factory/x");

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });

    const bindingsPath = path.join(target, "agent-bindings.registry.json");
    const registry = JSON.parse(fs.readFileSync(bindingsPath, "utf8"));
    registry.bindings.pop();
    fs.writeFileSync(bindingsPath, JSON.stringify(registry, null, 2) + "\n");

    const run = spawnSync(process.execPath, [preflight], {
      cwd: isolatedRoot,
      encoding: "utf8",
    });

    assert.equal(run.status, 1);
    const report = JSON.parse(run.stderr.trim());
    assert.equal(report.ok, false);
    assert.ok(report.failures.includes("agent_binding_count_mismatch"));
    assert.doesNotMatch(run.stderr, /ReferenceError|before initialization/);
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});
