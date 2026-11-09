import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripBearerPrefix } from "../supabase/functions/midad_browser_agent_gateway/auth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gatewayPath = path.join(root, "supabase/functions/midad_browser_agent_gateway/index.ts");

test("strips the standard Bearer authorization scheme", () => {
  assert.equal(stripBearerPrefix("Bearer abc123"), "abc123");
  assert.equal(stripBearerPrefix("bearer abc123"), "abc123");
  assert.equal(stripBearerPrefix("Bearer    abc123"), "abc123");
  assert.equal(stripBearerPrefix("  Bearer abc123  "), "abc123");
});

test("preserves a raw session token and rejects empty or non-string input", () => {
  assert.equal(stripBearerPrefix("abc123"), "abc123");
  assert.equal(stripBearerPrefix(""), "");
  assert.equal(stripBearerPrefix(null), "");
  assert.equal(stripBearerPrefix(undefined), "");
});

test("MCP and User Bridge both use the shared Bearer parser", () => {
  const source = fs.readFileSync(gatewayPath, "utf8");
  assert.match(source, /import\s*\{\s*stripBearerPrefix\s*\}\s*from\s*["']\.\/auth\.mjs["']/);
  assert.equal((source.match(/stripBearerPrefix\(req\.headers\.get\(["']authorization["']\)\)/g) || []).length, 2);
});
