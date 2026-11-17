import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateOwnerSessionBinding } from "../supabase/functions/_shared/midad-owner-session.mjs";

const migration = await readFile(
  new URL("../supabase/migrations/20261117140000_control_room_owner_session_binding.sql", import.meta.url),
  "utf8",
);

test("owner session migration adds a nullable profile-bound owner id", () => {
  assert.match(migration, /add column if not exists owner_user_id uuid/i);
  assert.match(migration, /foreign key \(owner_user_id\)[\s\S]*?references public\.profiles\(id\)/i);
  assert.match(migration, /on delete restrict/i);
});

test("owner session migration preserves legacy sessions without implicit promotion", () => {
  assert.doesNotMatch(migration, /update\s+public\.control_room_sessions/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.control_room_sessions/i);
  assert.equal(
    validateOwnerSessionBinding({ active: true, created_at: new Date().toISOString() }).error,
    "owner_session_not_bound",
  );
});

test("owner binding index only covers explicitly bound sessions", () => {
  assert.match(migration, /idx_control_room_sessions_owner_active/i);
  assert.match(migration, /where owner_user_id is not null/i);
});
