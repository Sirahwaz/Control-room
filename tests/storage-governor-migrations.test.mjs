import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8");

const foundation = read("20261106195218_midad_data_reservoir_storage_governor_foundation_v1.sql");
const indexes = read("20261106195312_midad_data_reservoir_fk_indexes_v1.sql");
const thresholds = read("20261106195421_midad_storage_governor_threshold_contract_tests_v1.sql");
const spine = read("20261106195713_midad_event_spine_capture_triggers_v1.sql");

test("Data Reservoir migration creates isolated private storage, event and archive tables", () => {
  for (const table of [
    "midad_storage_config", "midad_storage_metrics", "midad_storage_policies",
    "midad_event_spine", "midad_archive_outbox", "midad_archive_manifest",
    "midad_archive_restore_jobs", "midad_storage_alerts"
  ]) {
    assert.match(foundation, new RegExp("create table if not exists midad_private\\." + table));
  }
  assert.equal((foundation.match(/enable row level security/gi) || []).length, 8);
  assert.match(foundation, /auto_delete_enabled boolean not null default false check \(auto_delete_enabled = false\)/);
  assert.match(foundation, /financial_immutable/);
});

test("Archive queue has bounded retries, idempotency and restore integrity metadata", () => {
  assert.match(foundation, /idempotency_key text not null unique/);
  assert.match(foundation, /attempts smallint not null default 0 check \(attempts between 0 and 3\)/);
  assert.match(foundation, /max_attempts smallint not null default 3 check \(max_attempts = 3\)/);
  assert.match(foundation, /sha256 text not null check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(indexes, /midad_archive_outbox_retention_class_idx/);
  assert.match(indexes, /midad_archive_restore_manifest_idx/);
});

test("Storage Governor uses inclusive 70/85/95 thresholds and read-only emergency", () => {
  assert.match(thresholds, />= 0\.70/);
  assert.match(thresholds, />= 0\.85/);
  assert.match(thresholds, />= 0\.95/);
  assert.match(thresholds, /when coalesce\(p_read_only,false\) then 'EMERGENCY'/);
  assert.match(thresholds, /test failed: emergency threshold is inclusive/);
});

test("Event Spine captures metadata only for 10 sources and does not copy or purge source rows", () => {
  assert.match(spine, /security invoker/i);
  assert.match(spine, /after insert on public/);
  for (const table of [
    "signal_events", "opportunities", "midad_signal_outcomes",
    "midad_revenue_intel_evidence", "midad_payment_events", "midad_wallet_receipts",
    "engine_runs", "midad_learning_events", "midad_osint_events", "midad_bot_outbox"
  ]) assert.ok(spine.includes("'" + table + "'"), "missing Event Spine source " + table);
  assert.match(spine, /on conflict \(event_key\) do nothing/i);
  assert.doesNotMatch(spine, /delete\s+from|truncate\s+table|drop\s+table/i);
  assert.doesNotMatch(spine, /row_data->>'payload'|row_data->>'address'|row_data->>'amount'/i);
});
