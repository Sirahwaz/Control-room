import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCalendarInput,
  buildCalendarUrl,
  callMicroCalendarAvailability,
} from "./adapter.mjs";

const valid = {
  from: "2026-11-06T09:00:00+01:00",
  to: "2026-11-07T18:00:00+01:00",
  minutes: 45,
  day_start: 9,
  day_end: 18,
};

test("accepts a bounded RFC3339 availability query", () => {
  const result = validateCalendarInput(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.params, valid);
});

test("rejects unknown fields, malformed dates, inverted and oversized ranges", () => {
  assert.equal(validateCalendarInput({ ...valid, url: "https://attacker.test" }).ok, false);
  assert.equal(validateCalendarInput({ ...valid, from: "tomorrow" }).ok, false);
  assert.equal(validateCalendarInput({ ...valid, from: valid.to, to: valid.from }).ok, false);
  assert.equal(validateCalendarInput({ ...valid, to: "2026-12-20T18:00:00+01:00" }).ok, false);
});

test("rejects invalid durations and working-hour bounds", () => {
  assert.equal(validateCalendarInput({ ...valid, minutes: 0 }).ok, false);
  assert.equal(validateCalendarInput({ ...valid, minutes: 481 }).ok, false);
  assert.equal(validateCalendarInput({ ...valid, day_start: 24 }).ok, false);
  assert.equal(validateCalendarInput({ ...valid, day_start: 18, day_end: 9 }).ok, false);
});

test("builds only the fixed Micro events/free URL and approved query parameters", () => {
  const url = buildCalendarUrl(valid);
  assert.equal(url.origin, "https://micro.mu");
  assert.equal(url.pathname, "/api/v1/events/free");
  assert.equal(url.searchParams.get("minutes"), "45");
  assert.equal(url.searchParams.get("from"), valid.from);
  assert.equal(url.searchParams.has("url"), false);
});

test("calls Micro with GET, bearer token, fixed origin and redirects disabled", async () => {
  let observed;
  const result = await callMicroCalendarAvailability({
    token: "test-token",
    input: valid,
    fetchImpl: async (url, init) => {
      observed = { url: String(url), init };
      return new Response(JSON.stringify({ result: "Free for at least 45 minutes" }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(observed.init.method, "GET");
  assert.equal(observed.init.headers.authorization, "Bearer test-token");
  assert.equal(observed.init.redirect, "error");
  assert.match(observed.url, /^https:\/\/micro\.mu\/api\/v1\/events\/free\?/);
});

test("never calls upstream for invalid input or missing token", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response("{}"); };
  const badInput = await callMicroCalendarAvailability({ token: "test-token", input: { ...valid, url: "https://evil.test" }, fetchImpl });
  const noToken = await callMicroCalendarAvailability({ token: "", input: valid, fetchImpl });
  assert.equal(badInput.ok, false);
  assert.equal(noToken.ok, false);
  assert.equal(calls, 0);
});

test("maps auth, scope, rate-limit and provider failures without exposing upstream body", async () => {
  for (const [status, code] of [[401, "micro_auth_failed"], [403, "micro_scope_denied"], [429, "micro_rate_limited"], [503, "micro_unavailable"]]) {
    const result = await callMicroCalendarAvailability({
      token: "test-token", input: valid,
      fetchImpl: async () => new Response("sensitive upstream detail", { status }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, code);
    assert.equal(JSON.stringify(result).includes("sensitive upstream detail"), false);
  }
});

test("rejects oversized and non-JSON upstream responses", async () => {
  const oversized = await callMicroCalendarAvailability({
    token: "test-token", input: valid,
    fetchImpl: async () => new Response("x".repeat(40000), { status: 200 }),
  });
  const malformed = await callMicroCalendarAvailability({
    token: "test-token", input: valid,
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  assert.equal(oversized.error, "micro_response_too_large");
  assert.equal(malformed.error, "micro_invalid_response");
});
