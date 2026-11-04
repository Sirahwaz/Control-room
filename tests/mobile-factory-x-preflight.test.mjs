import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Factory X preflight completes and emits a valid report", () => {
  const run = spawnSync(
    process.execPath,
    ["mobile/factory/x/preflight.mjs"],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(run.stdout.trim());
  assert.equal(report.ok, true);
  assert.equal(report.mode, "MIDAD Mobile Factory X");
  assert.equal(report.counts.agents, 38);
});
