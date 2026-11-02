import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bot = readFileSync(new URL('../supabase/functions/telegram_bot/index.ts', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../supabase/functions/midad_noncopy_trading_engine/index.ts', import.meta.url), 'utf8');

test('Telegram AI Room command opens the fixed static preview without changing the main menu URL', () => {
  assert.match(bot, /const AI_ROOM_PREVIEW_URL="https:\/\/sirahwaz\.github\.io\/Control-room\/ai-room\.html"/);
  assert.match(bot, /userText\.split\("@"\)\[0\]==="\/airoom"/);
  assert.match(bot, /web_app:\{url:AI_ROOM_PREVIEW_URL\}/);
  assert.match(bot, /const CONTROL_ROOM_URL=/);
  assert.match(bot, /const menuUrl=isMidadRoomBot\?AI_ROOM_PREVIEW_URL:CONTROL_ROOM_URL/);
  assert.match(bot, /setChatMenuButton/);
  assert.match(bot, /web_app:\{url:menuUrl\}/);
});

test('Telegram trade and mysun commands delegate to the isolated non-copy engine', () => {
  assert.match(bot, /userText==="\/trade"\|\|userText==="\/mysun"/);
  assert.match(bot, /runNoncopyTradeTelegram\(\)/);
  assert.match(bot, /midad_noncopy_trading_engine/);
  assert.match(bot, /JSON\.stringify\(\{mode:"run"\}\)/);
});

test('non-copy engine explicitly disables live execution and labels paper simulation', () => {
  assert.match(engine, /paper_only:true,live_execution:false/);
  assert.match(engine, /action:"paper_trade_simulation"/);
  assert.match(engine, /reason:"noncopy_paper_only"/);
  assert.match(engine, /paper_only:true/);
  assert.doesNotMatch(engine, /\b(createOrder|placeOrder|withdraw|transfer|sendTransaction|signTransaction)\b/i);
  assert.doesNotMatch(engine, /api\.binance\.com\/api\/v3\/order/i);
});

test('engine write targets are restricted to signal ingestion and paper-trade simulation', () => {
  const writeTargets = [...engine.matchAll(/\.from\("([^"]+)"\)\.(insert|upsert|update|delete)\(/g)]
    .map(match => match[1] + ':' + match[2]).sort();
  assert.deepEqual(writeTargets, ['midad_paper_trades:insert', 'signal_events:upsert']);
});

test('deployed bot and engine contain no hard-coded credential material', () => {
  for (const source of [bot, engine]) {
    assert.doesNotMatch(source, /\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/);
    assert.doesNotMatch(source, /bot\d{6,}:[A-Za-z0-9_-]{25,}/);
    assert.doesNotMatch(source, /(?:postgres|postgresql):\/\/[^'"\s]{15,}/);
    assert.doesNotMatch(source, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  }
});
