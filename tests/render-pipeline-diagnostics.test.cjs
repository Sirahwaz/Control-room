const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("ai-room.html", "utf8");
const match = source.match(/function renderPipelineSmokeResult\(data,httpOk\)\{[\s\S]*?\n\}/);
assert.ok(match, "renderPipelineSmokeResult must exist in ai-room.html");

function setup() {
  const nodes = new Map();
  const create = () => ({
    textContent: "",
    className: "",
    children: [],
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); }
  });
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, create());
    return nodes.get(selector);
  };
  const document = { createElement: () => create() };
  const render = vm.runInNewContext("(" + match[0] + ")", { $, document });
  return { render, nodes, $ };
}

function validData(overrides = {}) {
  return {
    ok: true,
    state: "VERIFIED",
    test: "gemini_to_claude_synthetic_smoke",
    latency_ms: 42,
    request_ref: "midad-smoke-test_1",
    failure_stage: null,
    executor_called: true,
    provider_http_status: 200,
    provider_error_code: null,
    router_error: null,
    pipeline: {
      requested: true,
      advisor: { provider: "gemini", state: "VERIFIED", advice_injected: true, error: null, http_status: 200 },
      executor: { provider: "apmix", state: "VERIFIED", error: null, http_status: 200 }
    },
    expected_markers_present: true,
    ...overrides
  };
}

function resultText(nodes) {
  return nodes.get("#pipelineSmokeResult").children.map((n) => n.textContent).join("\n");
}

test("retains the strict verified success contract", () => {
  const { render, nodes } = setup();
  assert.equal(render(validData(), true), true);
  assert.equal(nodes.get("#pipelineSmokeState").textContent, "نجاح مؤكّد");
  assert.match(nodes.get("#pipelineSmokeStatus").textContent, /اجتاز/);
});

test("HTTP 200 and PARTIAL never count as verified success", () => {
  const { render, nodes } = setup();
  const data = validData({ state: "PARTIAL" });
  assert.equal(render(data, true), false);
  assert.equal(nodes.get("#pipelineSmokeState").textContent, "نجاح جزئي — لم يكتمل");
  assert.match(nodes.get("#pipelineSmokeState").className, /review/);
});

test("missing expected markers keep the result unverified", () => {
  const { render } = setup();
  assert.equal(render(validData({ expected_markers_present: false }), true), false);
});

test("distinguishes executor NOT_CALLED from a provider failure", () => {
  const { render, nodes } = setup();
  const data = validData({
    ok: false,
    state: "FAILED",
    failure_stage: "apmix_executor_not_called",
    executor_called: false,
    provider_http_status: null,
    pipeline: {
      requested: true,
      advisor: { provider: "gemini", state: "VERIFIED", advice_injected: true, http_status: 200 },
      executor: { provider: "apmix", state: "NOT_CALLED", error: null, http_status: 200 }
    }
  });
  assert.equal(render(data, false), false);
  const text = resultText(nodes);
  assert.match(text, /Claude\/APMIX: NOT_CALLED/);
  assert.match(text, /هل استُدعي المنفّذ: NO/);
  assert.match(text, /HTTP للمزوّد: غير متاح/);
});

test("does not infer invocation when executor_called evidence is absent", () => {
  const { render, nodes } = setup();
  const data = validData({
    ok: false,
    state: "FAILED",
    executor_called: null,
    pipeline: {
      requested: true,
      advisor: { provider: "gemini", state: "VERIFIED", advice_injected: true },
      executor: { provider: "apmix", state: "FAILED", error: "executor_failed" }
    }
  });
  assert.equal(render(data, false), false);
  assert.match(resultText(nodes), /هل استُدعي المنفّذ: UNKNOWN/);
});

test("shows safe failure stage, provider code, and router code", () => {
  const { render, nodes } = setup();
  const data = validData({
    ok: false,
    state: "FAILED",
    failure_stage: "apmix_executor",
    executor_called: true,
    provider_http_status: 503,
    provider_error_code: "upstream_timeout",
    router_error: "router_upstream_error"
  });
  assert.equal(render(data, false), false);
  const text = resultText(nodes);
  assert.match(text, /المرحلة الفاشلة: apmix_executor/);
  assert.match(text, /HTTP للمزوّد: 503/);
  assert.match(text, /رمز خطأ المزوّد: upstream_timeout/);
  assert.match(text, /خطأ الموجّه: router_upstream_error/);
});

test("rejects malformed diagnostic codes and out-of-range HTTP statuses", () => {
  const { render, nodes } = setup();
  const data = validData({
    ok: false,
    state: "FAILED",
    failure_stage: "<img src=x onerror=alert(1)>",
    provider_http_status: 999,
    provider_error_code: "<script>alert(1)</script>",
    router_error: "bad router code!"
  });
  assert.equal(render(data, false), false);
  const text = resultText(nodes);
  assert.doesNotMatch(text, /<script>|<img|onerror=/);
  assert.match(text, /المرحلة الفاشلة: غير متاح/);
  assert.match(text, /HTTP للمزوّد: غير متاح/);
});

test("uses textContent-based rendering for every diagnostic line", () => {
  const { render, nodes } = setup();
  render(validData({ ok: false, state: "FAILED", router_error: "gateway_error" }), false);
  for (const child of nodes.get("#pipelineSmokeResult").children) {
    assert.equal(typeof child.textContent, "string");
    assert.equal(Object.prototype.hasOwnProperty.call(child, "innerHTML"), false);
  }
});

test("handles missing data and pipeline without throwing", () => {
  const { render, nodes } = setup();
  assert.equal(render(null, false), false);
  assert.equal(nodes.get("#pipelineSmokeState").textContent, "فشل التحقق");
  assert.match(resultText(nodes), /Gemini: UNKNOWN/);
});

test("BLOCKED and PENDING are preserved as non-success states", () => {
  for (const state of ["BLOCKED", "PENDING"]) {
    const { render } = setup();
    assert.equal(render({ ...validData(), ok: false, state }, false), false);
  }
});
