import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const config = fs.readFileSync("supabase/config.toml", "utf8");
const gateway = fs.readFileSync("supabase/functions/midad_memory_gateway/index.ts", "utf8");

test("custom Control Room bearer session is verified inside the Memory Gateway", () => {
  const block = config.match(/\[functions\.midad_memory_gateway\]([\s\S]*?)(?=\n\[|$)/);
  assert.ok(block, "Memory Gateway function config block must exist");
  assert.match(block[1], /verify_jwt\s*=\s*false/);
  assert.match(gateway, /from\("control_room_sessions"\)/);
  assert.match(gateway, /validateOwnerSessionBinding\(session\)/);
  assert.match(gateway, /eq\("token_hash", tokenHash\)/);
});

test("gateway refuses to operate unless its explicit feature flag is enabled", () => {
  assert.match(gateway, /MIDAD_MEMORY_ADAPTER_ENABLED/);
  assert.match(gateway, /memory_gateway_disabled/);
});
