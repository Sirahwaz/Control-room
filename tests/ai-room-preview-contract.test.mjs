import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const preview = readFileSync(new URL('../supabase/functions/midad_ai_room_preview/index.ts', import.meta.url), 'utf8');
test('preview is a fixed GET-only redirect to the published AI Room page', () => {
  assert.match(preview, /const PREVIEW_URL = "https:\/\/sirahwaz\.github\.io\/Control-room\/ai-room\.html"/);
  assert.match(preview, /req\.method !== "GET"/);
  assert.match(preview, /status: 405/);
  assert.match(preview, /status: 302/);
  assert.match(preview, /"location": PREVIEW_URL/);
  assert.doesNotMatch(preview, /createClient|SUPABASE_SERVICE_ROLE_KEY|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(|fetch\s*\(/);
});
