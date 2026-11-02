import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/midad-forge.yml", import.meta.url), "utf8");

function block(name) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `missing Forge job: ${name}`);
  const nextJob = /\n  [a-zA-Z0-9_-]+:\n/g;
  nextJob.lastIndex = start + 4;
  const next = nextJob.exec(workflow);
  return workflow.slice(start, next ? next.index : workflow.length);
}

test("Forge workflow defaults to read-only repository access", () => {
  const permissions = workflow.match(/^permissions:\n((?:  .*\n)+)/m)?.[1] ?? "";
  assert.match(permissions, /^  contents: read$/m);
  assert.doesNotMatch(permissions, /pull-requests:\s*write|id-token:\s*write|contents:\s*write/);
});

test("claim and prepare jobs receive only the OIDC permission they need", () => {
  for (const name of ["claim", "prepare"]) {
    const job = block(name);
    assert.match(job, /permissions:\n      id-token: write/);
    assert.doesNotMatch(job, /contents:\s*write|pull-requests:\s*write/);
  }
});

test("build job remains repository read-only", () => {
  const job = block("build");
  assert.match(job, /permissions:\n      contents: read/);
  assert.doesNotMatch(job, /contents:\s*write|pull-requests:\s*write|id-token:\s*write/);
});

test("only finalize job receives the publish permissions", () => {
  const job = block("finalize");
  assert.match(job, /permissions:\n      contents: write\n      pull-requests: write\n      id-token: write/);
});
