import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ai-room.html', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../supabase/functions/midad_ai_room_preview/index.ts', import.meta.url), 'utf8');
const status = readFileSync(new URL('../supabase/functions/midad_ai_room_status/index.ts', import.meta.url), 'utf8');
const telegramBot = readFileSync(new URL('../supabase/functions/telegram_bot/index.ts', import.meta.url), 'utf8');

function embeddedHtml(source) {
  const match = source.match(/const HTML_BASE64\s*=\s*"([A-Za-z0-9+/=]+)"/);
  assert.ok(match, 'preview must embed a deterministic base64 HTML snapshot');
  return Buffer.from(match[1], 'base64').toString('utf8');
}

test('preview serves the exact reviewed AI Room HTML and is a static GET-only surface', () => {
  assert.equal(embeddedHtml(preview), html);
  assert.match(preview, /content-type["']?\s*:\s*["']text\/html; charset=utf-8["']/i);
  assert.match(preview, /req\.method\s*!==\s*["']GET["']/);
  assert.doesNotMatch(preview, /createClient|SUPABASE_SERVICE_ROLE_KEY|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(preview, /fetch\s*\(/);
});

test('the live status endpoint allowlists both the production Pages origin and isolated preview origin', () => {
  assert.match(status, /ALLOWED_ORIGINS\s*=\s*new Set\(\[\s*"https:\/\/sirahwaz\.github\.io"\s*,\s*"https:\/\/froegigfmpmvtecztfbf\.supabase\.co"\s*\]\)/);
  assert.match(status, /scope:\s*"read_only_aggregate"/);
  assert.match(status, /guards:\s*\{ mutations: false, financial_actions: false \}/);
});

test('Telegram AI Room command is additive and does not change the existing default mini-app URL', () => {
  assert.match(telegramBot, /const CONTROL_ROOM_URL="https:\/\/sirahwaz\.github\.io\/Control-room\/\?bot=aimidad&view=cockpit&v=20260930emergencypp2";/);
  assert.match(telegramBot, /const AI_ROOM_PREVIEW_URL="https:\/\/froegigfmpmvtecztfbf\.supabase\.co\/functions\/v1\/midad_ai_room_preview";/);
  assert.match(telegramBot, /command:"airoom",description:"غرفة الذكاء المتعدد (معاينة)"/);
  assert.match(telegramBot, /userText\.split\("@"\)\[0\]===["']\/airoom["']/);
  assert.match(telegramBot, /web_app:\{url:AI_ROOM_PREVIEW_URL\}/);
  assert.match(telegramBot, /setChatMenuButton[\s\S]{0,260}web_app:\{url:CONTROL_ROOM_URL\}/);
});

test('the preview retains opt-in Telegram auth and session non-persistence', () => {
  assert.match(html, /id="connectLive"/);
  assert.match(html, /telegram_init_data:initData/);
  assert.match(html, /window\.Telegram&&window\.Telegram\.WebApp/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie/i);
  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|service_role|OPENAI_API_KEY|sk-[A-Za-z0-9]{16,}/i);
});
