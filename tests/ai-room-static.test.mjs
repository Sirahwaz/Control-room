import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ai-room.html', import.meta.url), 'utf8');
const connector = readFileSync(new URL('../supabase/functions/midad_ai_room_status/index.ts', import.meta.url), 'utf8');

test('AI Room keeps Arabic RTL and mobile viewport', () => {
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1/);
});

test('live connection is explicit, opt-in, and Telegram-authenticated', () => {
  assert.match(html, /id="connectLive"/);
  assert.match(html, /id="refreshLive"/);
  assert.match(html, /window\.Telegram&&window\.Telegram\.WebApp/);
  assert.match(html, /telegram_init_data:initData/);
  assert.match(html, /client:"midad-control-room"/);
  assert.match(html, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
  assert.match(html, /اتصال آمن عبر Telegram/);
  assert.match(html, /لا يبدأ أي اتصال تلقائياً/);
});

test('browser networking is limited to fixed MIDAD endpoints and Telegram bootstrap', () => {
  assert.match(html, /const CONTROL_ROOM_URL="https:\/\/froegigfmpmvtecztfbf\.supabase\.co\/functions\/v1\/midad_control_room"/);
  assert.match(html, /const AI_ROOM_STATUS_URL="https:\/\/froegigfmpmvtecztfbf\.supabase\.co\/functions\/v1\/midad_ai_room_status"/);
  assert.match(html, /requestJson\(CONTROL_ROOM_URL,/);
  assert.match(html, /requestJson\(AI_ROOM_STATUS_URL,/);
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon|supabase\.from\(|\.rpc\(/i);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie/i);
  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|service_role|OPENAI_API_KEY|sk-[A-Za-z0-9]{16,}/i);
  assert.doesNotMatch(html, /<script\s+src=(?!["']https:\/\/telegram\.org\/js\/telegram-web-app\.js["'])/i);
  assert.doesNotMatch(html, /<link\s+[^>]*rel=["']stylesheet/i);
});

test('status endpoint requires an active hashed Control Room session', () => {
  assert.match(connector, /ALLOWED_ORIGINS\s*=\s*new Set\(\["https:\/\/sirahwaz\.github\.io",\s*"https:\/\/froegigfmpmvtecztfbf\.supabase\.co"\]\)/);
  assert.match(connector, /control_room_sessions/);
  assert.match(connector, /token_hash/);
  assert.match(connector, /eq\("active", true\)/);
  assert.match(connector, /30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(connector, /missing_session/);
  assert.match(connector, /session_expired/);
});

test('status endpoint returns only six aggregate counts and exposes no mutation path', () => {
  const tableRefs = [...connector.matchAll(/\.from\("([^"]+)"\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(tableRefs)].sort(), [
    'control_room_sessions',
    'engine_runs',
    'midad_approvals',
    'midad_human_tasks',
    'midad_sentinel_alerts',
    'opportunities',
    'signal_events'
  ]);
  assert.match(connector, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(connector, /scope: "read_only_aggregate"/);
  assert.match(connector, /guards: \{ mutations: false, financial_actions: false \}/);
  assert.doesNotMatch(connector, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(connector, /midad_agent_fee_|midad_browser_evidence_ledger|midad_platform_accounts|midad_store_fulfillment_jobs|midad_speedbot_fulfillments/);
});

test('dynamic local task content is HTML-escaped before insertion', () => {
  assert.match(html, /const esc=s=>String\(s\)\.replace\(\/\[&<>/);
  assert.match(html, /esc\(t\.title\)/);
  assert.match(html, /esc\(t\.detail\)/);
  assert.match(html, /esc\(t\.owner\)/);
});

test('task creation, filters, and status actions remain local UI controls', () => {
  for (const id of ['newTask', 'taskInput', 'tasks', 'taskCount', 'reviewCount', 'refresh']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /data-filter="review"/);
  assert.match(html, /data-filter="done"/);
  assert.match(html, /data-action="review"/);
  assert.match(html, /data-action="done"/);
  assert.match(html, /أضيفت محلياً في المتصفح/);
});

test('live status is rendered from a whitelist and session token stays in memory', () => {
  assert.match(html, /function renderLiveStatus\(data\)/);
  assert.match(html, /liveSessionToken/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie/i);
  assert.match(html, /financial_actions!==false/);
  assert.match(html, /mutations!==false/);
});
