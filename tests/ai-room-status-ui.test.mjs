import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const html = readFileSync(new URL("../ai-room.html", import.meta.url), "utf8");
const setConnection = html.match(/function setConnection\(connected,message\)\{[\s\S]*?\nfunction clearLiveMetrics/);
const renderLiveStatus = html.match(/function renderLiveStatus\(data\)\{[\s\S]*?\nfunction renderAgentMesh/);

test("does not retain a stale local-only event after a live connection", () => {
  assert.doesNotMatch(html, /<p>الاتصالات الحية غير مفعّلة\.<\/p>/);
  assert.match(html, /id="liveModeState"/);
});

test("connection state drives a truthful mode label", () => {
  assert.ok(setConnection, "setConnection implementation exists");
  assert.match(setConnection[0], /liveModeState/);
  assert.match(setConnection[0], /connected/);
  assert.match(setConnection[0], /قراءة فقط/);
  assert.match(setConnection[0], /معاينة محلية/);
});

test("successful live status writes an explicit connected event", () => {
  assert.ok(renderLiveStatus, "renderLiveStatus implementation exists");
  assert.match(renderLiveStatus[0], /setConnection\(true,message\)/);
  assert.match(renderLiveStatus[0], /اتصال حي/);
});
