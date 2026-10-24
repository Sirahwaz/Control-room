import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../ai-room.html", import.meta.url), "utf8");
const setConnection = html.match(/function setConnection\(connected,message\)\{[\s\S]*?\nfunction clearLiveMetrics/);
const setConnectionSource = html.match(/function setConnection\(connected,message\)\{[^\n]*\}/)?.[0];
const renderLiveStatus = html.match(/function renderLiveStatus\(data\)\{[\s\S]*?\nfunction renderAgentMesh/);

function createConnectionHarness(liveBusy = false) {
  assert.ok(setConnectionSource, "setConnection implementation exists");
  const ids = [
    "connectionState",
    "connectionMessage",
    "liveModeState",
    "connectLive",
    "refreshLive",
    "connectorCount",
  ];
  const elements = Object.fromEntries(
    ids.map((id) => [id, { textContent: "", className: "", disabled: false }]),
  );
  const $ = (selector) => {
    const id = selector.startsWith("#") ? selector.slice(1) : selector;
    assert.ok(elements[id], `unexpected selector: ${selector}`);
    return elements[id];
  };
  const setConnectionFn = new Function("$", "liveBusy", `${setConnectionSource}; return setConnection;`)($, liveBusy);
  return { elements, setConnection: setConnectionFn };
}

test("does not retain a stale local-only event after a live connection", () => {
  assert.doesNotMatch(html, /<p>الاتصالات الحية غير مفعّلة\.<\/p>/);
  assert.match(html, /id="liveModeState"/);
});

test("connected state updates the live-only label and control availability", () => {
  const { elements, setConnection } = createConnectionHarness();
  setConnection(true, "MIDAD live source");

  assert.equal(elements.connectionState.textContent, "متصل — قراءة فقط");
  assert.equal(elements.connectionState.className, "status ready");
  assert.equal(elements.connectionMessage.textContent, "MIDAD live source");
  assert.equal(elements.liveModeState.textContent, "اتصال حي — قراءة فقط");
  assert.equal(elements.connectLive.disabled, true);
  assert.equal(elements.refreshLive.disabled, false);
  assert.equal(elements.connectorCount.textContent, "1");
});

test("disconnected state restores local preview and blocks live refresh", () => {
  const { elements, setConnection } = createConnectionHarness();
  setConnection(false, "connection failed");

  assert.equal(elements.connectionState.textContent, "غير متصل");
  assert.equal(elements.connectionState.className, "status off");
  assert.equal(elements.liveModeState.textContent, "معاينة محلية — الاتصال الحي غير مفعّل");
  assert.equal(elements.connectLive.disabled, false);
  assert.equal(elements.refreshLive.disabled, true);
  assert.equal(elements.connectorCount.textContent, "0");
});

test("pending authentication is not mislabeled as a local-only final state", () => {
  const { elements, setConnection } = createConnectionHarness(true);
  setConnection(false, "جارٍ التحقق من جلسة Telegram ثم طلب ملخص آمن...");

  assert.equal(elements.liveModeState.textContent, "جارٍ التحقق من الاتصال");
  assert.equal(elements.connectLive.disabled, true);
  assert.equal(elements.refreshLive.disabled, true);
  assert.equal(elements.connectorCount.textContent, "0");
});

test("successful live status writes an explicit connected event", () => {
  assert.ok(renderLiveStatus, "renderLiveStatus implementation exists");
  assert.match(renderLiveStatus[0], /setConnection\(true,message\)/);
  assert.match(renderLiveStatus[0], /اتصال حي/);
});

const setRefreshFailureSource = html.match(/function setRefreshFailure\(message\)\{[^\n]*\}/)?.[0];

test("failed refresh marks retained metrics as stale instead of showing a fresh connected state", () => {
  assert.ok(setRefreshFailureSource, "setRefreshFailure implementation exists");
  const elements = Object.fromEntries(
    ["connectionState", "connectionMessage", "liveModeState", "refreshLive", "connectorCount"].map(
      (id) => [id, { textContent: "", className: "", disabled: false }],
    ),
  );
  const $ = (selector) => elements[selector.slice(1)];
  const setRefreshFailure = new Function("$", "lastLiveSuccessAt", `${setRefreshFailureSource}; return setRefreshFailure;`)($, "12:34:56");
  setRefreshFailure("network timeout");
  assert.equal(elements.connectionState.textContent, "فشل التحديث — بيانات قديمة");
  assert.equal(elements.connectionState.className, "status review");
  assert.equal(elements.liveModeState.textContent, "فشل التحديث — آخر بيانات ناجحة قديمة");
  assert.match(elements.connectionMessage.textContent, /network timeout/);
  assert.match(elements.connectionMessage.textContent, /12:34:56/);
  assert.equal(elements.refreshLive.disabled, false);
  assert.equal(elements.connectorCount.textContent, "1");
});

const refreshLiveSource = html.match(/async function refreshLive\(\)\{[^\n]*\}/)?.[0];
const requestJsonSource = html.match(/async function requestJson\(url,body\)\{[^\n]*\}/)?.[0];
const readableAuthErrorSource = html.match(/function readableAuthError\(error\)\{[^\n]*\}/)?.[0];
const clearLiveMetricsSource = html.match(/function clearLiveMetrics\(\)\{[^\n]*\}/)?.[0];

function createRefreshHarness({ fetchImpl, sessionToken = "valid-session" }) {
  for (const [name, source] of Object.entries({
    refreshLiveSource, requestJsonSource, readableAuthErrorSource, clearLiveMetricsSource, setConnectionSource, setRefreshFailureSource,
  })) assert.ok(source, name + " implementation exists");

  const ids = ["connectionState", "connectionMessage", "liveModeState", "connectLive", "refreshLive", "connectorCount",
    "liveSignals", "liveOpportunities", "liveRuns", "liveAlerts", "liveApprovals", "liveTasks", "refreshAgents"];
  const elements = Object.fromEntries(ids.map(id => [id, { textContent: id.startsWith("live") ? "stale-value" : "", className: "", disabled: false }]));
  const $ = selector => {
    const id = selector.startsWith("#") ? selector.slice(1) : selector;
    assert.ok(elements[id], "unexpected selector: " + selector);
    return elements[id];
  };
  const factory = new Function("$", "fetch", "initialToken", `
    let liveBusy = false;
    let liveSessionToken = initialToken;
    let lastLiveSuccessAt = "12:34:56";
    const requestJson = ${requestJsonSource};
    const readableAuthError = ${readableAuthErrorSource};
    const clearLiveMetrics = ${clearLiveMetricsSource};
    const setConnection = ${setConnectionSource};
    const setRefreshFailure = ${setRefreshFailureSource};
    const renderLiveStatus = () => {};
    const renderAgentMesh = () => {};
    const log = () => {};
    const refreshLive = ${refreshLiveSource};
    return { refreshLive, elements: null, token: () => liveSessionToken, lastSuccess: () => lastLiveSuccessAt };
  `);
  const app = factory($, fetchImpl, sessionToken);
  app.elements = elements;
  return app;
}

test("real refreshLive path marks network failures stale and preserves last successful time", async () => {
  const app = createRefreshHarness({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  await app.refreshLive();

  assert.equal(app.elements.connectionState.textContent, "فشل التحديث — بيانات قديمة");
  assert.equal(app.elements.connectionState.className, "status review");
  assert.equal(app.elements.liveModeState.textContent, "فشل التحديث — آخر بيانات ناجحة قديمة");
  assert.match(app.elements.connectionMessage.textContent, /12:34:56/);
  assert.equal(app.elements.connectorCount.textContent, "1");
  assert.equal(app.elements.liveSignals.textContent, "stale-value", "last known metrics remain visible but explicitly stale");
  assert.equal(app.elements.connectLive.disabled, true);
  assert.equal(app.elements.refreshLive.disabled, false);
  assert.equal(app.token(), "valid-session", "transient network errors do not discard the session");
});

test("real refreshLive path clears live metrics and session after an expired-session response", async () => {
  const app = createRefreshHarness({
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "session_expired" }) }),
  });
  await app.refreshLive();

  assert.equal(app.token(), "", "expired session token is discarded");
  assert.equal(app.elements.connectionState.textContent, "غير متصل");
  assert.equal(app.elements.liveModeState.textContent, "معاينة محلية — الاتصال الحي غير مفعّل");
  assert.equal(app.elements.connectorCount.textContent, "0");
  for (const id of ["liveSignals", "liveOpportunities", "liveRuns", "liveAlerts", "liveApprovals", "liveTasks"]) {
    assert.equal(app.elements[id].textContent, "—", id + " must not display expired-session data");
  }
  assert.equal(app.elements.connectLive.disabled, false);
  assert.equal(app.elements.refreshLive.disabled, true);
});

