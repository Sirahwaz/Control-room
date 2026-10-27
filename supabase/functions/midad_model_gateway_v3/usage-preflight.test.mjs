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
  assert.match(source, /allowed:\["status","models","usage","chat"\]/);
  assert.match(source, /if\(action!=="chat"\)/);
});
