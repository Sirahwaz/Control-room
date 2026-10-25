import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "index.ts"), "utf8");

test("worker imports and uses the bounded concurrency helper", () => {
  assert.match(source, /import\s*\{\s*runBounded\s*\}\s*from\s*["']\.\/concurrency\.mjs["']/);
  assert.match(source, /await\s+runBounded\(/);
  assert.match(source, /Math\.min\(3,/);
});

test("affiliate lane is handled before the generic task-level payout proof gate", () => {
  assert.match(source, /classifyRevenueLane/);
  assert.match(source, /evaluateAffiliateProgramEvidence/);
  const affiliateBranch = source.indexOf('lane === "affiliate"');
  const taskEscrowBranch = source.indexOf('source_slug) === "taskmarket_api"');
  assert.ok(affiliateBranch >= 0, "affiliate lane branch must exist");
  assert.ok(taskEscrowBranch >= 0, "task-market escrow branch must remain");
  assert.ok(affiliateBranch < taskEscrowBranch, "affiliate lane must be routed before task-escrow-specific proof logic");
});

test("worker keeps external execution disabled in its worker result contract", () => {
  assert.match(source, /external_action_allowed:\s*false/);
  assert.match(source, /external_actions:\s*\[\s*["']none["']\s*\]/);
});
