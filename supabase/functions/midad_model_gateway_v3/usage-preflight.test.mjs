import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "index.ts"), "utf8");

test("APMIX usage preflight is an authenticated read-only GET", () => {
  const start = source.indexOf('if(action==="usage")');
  const end = source.indexOf('if(action!=="chat")', start);
  assert.ok(start >= 0, "usage action exists");
  assert.ok(end > start, "usage action is bounded before chat handling");
  const usageBranch = source.slice(start, end);
  assert.match(usageBranch, /fetch\(BASE_URL\+"\/usage"/);
  assert.match(usageBranch, /"authorization":"Bearer "\+APIMIX_KEY/);
  assert.match(usageBranch, /p_task_class:"usage"/);
  assert.match(usageBranch, /state:"VERIFIED"/);
  assert.doesNotMatch(usageBranch, /chat\/completions|\/responses|\/messages/);
});

test("usage is listed as an allowed action without replacing the existing chat path", () => {
  const allowedMatch = source.match(/allowed:\s*\[([^\]]+)\]/);
  assert.ok(allowedMatch, "unsupported-action response declares allowed actions");
  const allowedActions = [...allowedMatch[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  for (const required of ["status", "models", "usage", "chat"]) assert.ok(allowedActions.includes(required), `missing required action: ${required}`);
  assert.match(source, /if\(action!=="chat"\)/);
});
