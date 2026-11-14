import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = fs.readFileSync(path.join(root, "midad-control-v2.js"), "utf8");

test("Control Room cockpit renders the authenticated Storage Governor snapshot", () => {
  assert.match(ui, /function storageGovernorCard\(\)/);
  assert.match(ui, /S\.data\?\.storage/);
  assert.match(ui, /storageGovernorCard\(\)/);
  assert.match(ui, /database_mib/);
  assert.match(ui, /read_only/);
  assert.match(ui, /archive_status/);
});

test("Storage Governor UI distinguishes unknown project quota from database size", () => {
  assert.match(ui, /project_quota_bytes/);
  assert.match(ui, /quota_usage_pct/);
  assert.match(ui, /quota.*غير متاحة|الحصة.*غير متاحة|الحصة.*غير محددة|quota.*unknown/i);
});

test("Storage status remains read-only and never ships backend credentials to the browser", () => {
  assert.doesNotMatch(ui, /UPLOAD_AM_API_TOKEN|SUPABASE_SERVICE_ROLE_KEY|x-midad-autonomy-key/);
  assert.doesNotMatch(ui, /storage_probe/);
});
