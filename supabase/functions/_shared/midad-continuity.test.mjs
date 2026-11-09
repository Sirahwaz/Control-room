import test from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeContext, loadRuntimeContext } from "./midad-continuity.mjs";

const valid = {
  schema_version: 1,
  context_id: "midad-global",
  context_version: "2026-11-09.1",
  status: "VERIFIED",
  updated_at: "2026-11-09T00:00:00.000Z",
  scope: "midad-global",
  architecture: {
    primary: ["GitHub", "Cloudflare"],
    local: ["Android", "Local"],
    optional: ["VPS"]
  },
  operating_contract: [
    "Resume from the last verified state; do not restart completed work.",
    "Preserve existing architecture and working components.",
    "Verify evidence before claims or mutations.",
    "Use least privilege; never expose secrets.",
    "Require human approval for irreversible, destructive, or financial actions."
  ],
  contains_secrets: false
};

test("accepts a current, verified, sanitized MIDAD context", () => {
  const result = validateRuntimeContext(valid, Date.parse("2026-11-09T12:00:00.000Z"));
  assert.equal(result.ok, true);
  assert.equal(result.context.context_id, "midad-global");
  assert.deepEqual(result.context.architecture.primary, ["GitHub", "Cloudflare"]);
});

test("fails closed when the runtime context is missing", () => {
  assert.deepEqual(validateRuntimeContext(null), { ok: false, code: "CONTEXT_MISSING" });
});

test("rejects unknown schema versions and wrong context identity", () => {
  assert.equal(validateRuntimeContext({ ...valid, schema_version: 2 }).code, "SCHEMA_UNSUPPORTED");
  assert.equal(validateRuntimeContext({ ...valid, context_id: "other" }).code, "CONTEXT_ID_MISMATCH");
});

test("rejects non-verified or secret-bearing context", () => {
  assert.equal(validateRuntimeContext({ ...valid, status: "PENDING" }).code, "CONTEXT_NOT_VERIFIED");
  assert.equal(validateRuntimeContext({ ...valid, contains_secrets: true }).code, "CONTEXT_SECRET_FLAGGED");
});

test("rejects stale, future-dated, and malformed timestamps", () => {
  const now = Date.parse("2026-11-09T12:00:00.000Z");
  assert.equal(validateRuntimeContext({ ...valid, updated_at: "2026-10-01T00:00:00.000Z" }, now).code, "CONTEXT_STALE");
  assert.equal(validateRuntimeContext({ ...valid, updated_at: "2026-11-10T00:00:00.000Z" }, now).code, "CONTEXT_FUTURE_DATED");
  assert.equal(validateRuntimeContext({ ...valid, updated_at: "not-a-date" }, now).code, "CONTEXT_TIMESTAMP_INVALID");
});

test("rejects empty or malformed operating contract", () => {
  assert.equal(validateRuntimeContext({ ...valid, operating_contract: [] }).code, "CONTEXT_CONTRACT_INVALID");
  assert.equal(validateRuntimeContext({ ...valid, operating_contract: [""] }).code, "CONTEXT_CONTRACT_INVALID");
});

test("loads context from the configured source and validates it", async () => {
  const result = await loadRuntimeContext({
    url: "https://raw.githubusercontent.com/example/repo/main/runtime.json",
    now: Date.parse("2026-11-09T12:00:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify(valid), { status: 200 })
  });
  assert.equal(result.ok, true);
});

test("fails closed on HTTP errors and malformed JSON", async () => {
  const http = await loadRuntimeContext({ url: "https://raw.githubusercontent.com/example/repo/main/runtime.json", fetchImpl: async () => new Response("", { status: 503 }) });
  assert.equal(http.code, "CONTEXT_SOURCE_UNAVAILABLE");
  const malformed = await loadRuntimeContext({ url: "https://raw.githubusercontent.com/example/repo/main/runtime.json", fetchImpl: async () => new Response("{", { status: 200 }) });
  assert.equal(malformed.code, "CONTEXT_SOURCE_INVALID");
});

test("rejects a runtime artifact whose pinned digest does not match", async () => {
  const result = await loadRuntimeContext({
    url: "https://raw.githubusercontent.com/example/repo/main/runtime.json",
    expectedSha256: "0".repeat(64),
    fetchImpl: async () => new Response(JSON.stringify(valid), { status: 200 })
  });
  assert.equal(result.code, "CONTEXT_INTEGRITY_MISMATCH");
});
