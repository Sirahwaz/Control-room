import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ai-room.html', import.meta.url), 'utf8');

test('prototype declares Arabic RTL and a mobile viewport', () => {
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1/);
});

test('prototype clearly identifies itself as demo-only', () => {
  assert.match(html, /DEMO\s*\/\s*NO LIVE CONNECTORS/);
  assert.match(html, /الاتصالات الحية غير مفعّلة/);
  assert.match(html, /لم يتم ربط نماذج خارجية أو استدعاء Supabase/);
});

test('prototype contains no network, credential, or persistent-storage APIs', () => {
  assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(html, /service_role|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9]{16,}/i);
  assert.doesNotMatch(html, /<script\s+src=|<link\s+[^>]*rel=["']stylesheet/i);
});

test('dynamic task content is HTML-escaped before insertion', () => {
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

test('no persistent storage or live connector is implied by task-state handling', () => {
  assert.match(html, /const tasks=\[/);
  assert.match(html, /let nextId=4,filter="all"/);
  assert.match(html, /تحديث عرض محلي فقط/);
});
