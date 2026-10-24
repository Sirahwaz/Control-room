import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ai-room.html', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../supabase/functions/midad_ai_room_preview/index.ts', import.meta.url), 'utf8');
const status = readFileSync(new URL('../supabase/functions/midad_ai_room_status/index.ts', import.meta.url), 'utf8');
const telegramBot = readFileSync(new URL('../supabase/functions/telegram_bot/index.ts', import.meta.url), 'utf8');

test('Supabase preview route redirects to the static GitHub Pages preview and has no write APIs', () => {
  assert.match(preview, /const PREVIEW_URL\s*=\s*"https:\/\/sirahwaz\.github\.io\/Control-room\/ai-room\.html"/);
  assert.match(preview, /req\.method\s*!==\s*"GET"/);
  assert.match(preview, /status:\s*302/);
  assert.match(preview, /"location":\s*PREVIEW_URL/);
  assert.doesNotMatch(preview, /createClient|SUPABASE_SERVICE_ROLE_KEY|admin\.from\(|supabase\.from\(|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(|fetch\s*\(/);
  assert.doesNotMatch(preview, /HTML_BASE64/);
});

test('the live status endpoint accepts only the production Pages origin', () => {
  assert.match(status, /ALLOWED_ORIGINS\s*=\s*new Set\(\["https:\/\/sirahwaz\.github\.io"\]\)/);
  assert.match(status, /scope:\s*"read_only_aggregate"/);
  assert.match(status, /guards:\s*\{ mutations: false, financial_actions: false \}/);
  assert.match(status, /control_room_sessions/);
  assert.doesNotMatch(status, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test('Telegram AI Room command opens the static preview and leaves the existing menu URL unchanged', () => {
  assert.ok(telegramBot.includes('const CONTROL_ROOM_URL="https://sirahwaz.github.io/Control-room/?bot=aimidad&view=cockpit&v=20260930emergencypp2";'));
  assert.ok(telegramBot.includes('const AI_ROOM_PREVIEW_URL="https://sirahwaz.github.io/Control-room/ai-room.html";'));
  assert.ok(telegramBot.includes('{command:"airoom",description:"غرفة الذكاء المتعدد (معاينة)"}'));
  assert.ok(telegramBot.includes('userText.split("@")[0]==="/airoom"'));
  assert.ok(telegramBot.includes('web_app:{url:AI_ROOM_PREVIEW_URL}'));
  assert.match(telegramBot, /setChatMenuButton[\s\S]{0,260}web_app:\{url:CONTROL_ROOM_URL\}/);
});

test('the static preview retains explicit Telegram authentication and session non-persistence', () => {
  assert.match(html, /id="connectLive"/);
  assert.match(html, /telegram_init_data:initData/);
  assert.match(html, /window\.Telegram&&window\.Telegram\.WebApp/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie/i);
  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|service_role|OPENAI_API_KEY|sk-[A-Za-z0-9]{16,}/i);
});
