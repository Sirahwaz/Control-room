import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/midad-daily-revenue-watch.yml', import.meta.url),
  'utf8'
);

test('daily revenue watcher is independently scheduled and manually dispatchable', () => {
  assert.match(workflow, /name:\s*MIDAD Daily Revenue Watcher/);
  assert.match(workflow, /schedule:\s*\n\s*- cron:\s*["']13 7 \* \* \*["']/);
  assert.match(workflow, /workflow_dispatch:/);
});

test('daily watcher is read-only and does not call production revenue endpoints', () => {
  assert.match(workflow, /permissions:\s*\n\s*actions:\s*read\n\s*contents:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write|actions:\s*write|id-token:\s*write/);
  assert.doesNotMatch(workflow, /SUPABASE_URL|MIDAD_AUTONOMY_KEY|supabase\.co|functions\/v1/);
  assert.doesNotMatch(workflow, /workflow_dispatch.*inputs:/s);
});

test('daily watcher reads existing Revenue Runtime run history and publishes an evidence artifact', () => {
  assert.match(workflow, /actions\/workflows\/midad-revenue-runtime\.yml\/runs/);
  assert.match(workflow, /gh api/);
  assert.match(workflow, /midad-daily-revenue-watch-/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /retention-days:\s*14/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
});
