import {
  makeLedgerEventKey,
  normalizeActorKey,
  normalizeLedgerEventType,
  normalizeTargetState,
  safeSourceUrl,
  sanitizeLedgerEvidence,
} from "./ledger.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, stable(input[key])]));
  }
  return value;
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(stable(actual));
  const e = JSON.stringify(stable(expected));
  assert(a === e, message + "\nexpected: " + e + "\nactual:   " + a);
}

Deno.test("safeSourceUrl normalizes HTTPS and removes query and fragment", () => {
  assertEqual(
    safeSourceUrl("  https://EXAMPLE.com:443/reports/item?token=private#section  "),
    "https://example.com/reports/item",
    "URL should be normalized and query/fragment removed",
  );
});

Deno.test("safeSourceUrl rejects HTTP, credentials, unusual ports, IP literals and local hosts", () => {
  const rejected = [
    "http://example.com/",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://[::1]/",
    "https://localhost/",
    "https://service.local/",
    "https://service.internal/",
    "https://service.localhost/",
    "",
    null,
    42,
  ];
  for (const candidate of rejected) {
    assertEqual(safeSourceUrl(candidate), null, "unsafe source URL should be rejected: " + String(candidate));
  }
});

Deno.test("sanitizeLedgerEvidence allowlists fields and strips sensitive or unrecognized values", () => {
  const digest = "AB".repeat(32);
  const result = sanitizeLedgerEvidence({
    source_kind: " browser\u0000 smoke ",
    http_status: 200,
    content_type: " text/html ",
    bytes_read: 42,
    duration_ms: 123,
    policy_code: " REDIRECT_BLOCKED ",
    retryable: false,
    artifact_sha256: digest,
    artifact_url: "https://EXAMPLE.com/report?token=private#fragment",
    title: "private page title",
    page_text: "private page body",
    cookies: "session=private",
    storage_state: { token: "private" },
    attempt: 4,
    error_code: "contains spaces",
  });

  assertEqual(result, {
    artifact_sha256: digest.toLowerCase(),
    artifact_url: "https://example.com/report",
    bytes_read: 42,
    content_type: "text/html",
    duration_ms: 123,
    http_status: 200,
    policy_code: "REDIRECT_BLOCKED",
    retryable: false,
    source_kind: "browser smoke",
  }, "sanitizer should retain only valid contract fields");
  const serialized = JSON.stringify(result);
  for (const secret of ["private page title", "private page body", "session=private", "storage_state"]) {
    assert(!serialized.includes(secret), "sanitized evidence must not contain " + secret);
  }
});

Deno.test("sanitizeLedgerEvidence rejects out-of-range, non-integer and wrong-type values", () => {
  const result = sanitizeLedgerEvidence({
    http_status: 99,
    bytes_read: -1,
    duration_ms: 120001,
    attempt: 4,
    retryable: "false",
    error_code: "invalid value",
    source_kind: "x".repeat(101),
    artifact_sha256: "not-a-digest",
    artifact_url: "http://example.com/",
  });
  assertEqual(result, {}, "invalid values must be dropped, not coerced");
});

Deno.test("event and state normalizers map known aliases and reject invalid states", () => {
  assertEqual(normalizeLedgerEventType(" human_gate_completed "), "human_gate_resumed", "human gate alias");
  assertEqual(normalizeLedgerEventType("external_redirect_blocked"), "policy_decision", "block alias");
  assertEqual(normalizeLedgerEventType("unrecognized-value"), "state_transition", "unknown event fallback");
  assertEqual(normalizeTargetState(" running "), "RUNNING", "state is normalized");
  assertEqual(normalizeTargetState("NOT_A_REAL_STATE"), null, "unknown state is rejected");
  assertEqual(normalizeTargetState(null), null, "non-string state is rejected");
});

Deno.test("event key is stable across input property order and normalized representations", async () => {
  const one = await makeLedgerEventKey({
    jobId: "job-1",
    eventType: "navigate",
    targetState: "running",
    sourceUrl: "https://EXAMPLE.com/page?tracking=1",
    evidence: { source_kind: "browser", http_status: 200, duration_ms: 10 },
  });
  const two = await makeLedgerEventKey({
    evidence: { duration_ms: 10, http_status: 200, source_kind: "browser" },
    sourceUrl: "https://example.com/page?tracking=2",
    targetState: "RUNNING",
    eventType: "navigation_observed",
    jobId: "job-1",
  });
  assertEqual(one, two, "same normalized event must generate the same idempotency key");
  assert(/^ev:[a-f0-9]{64}$/.test(one), "generated key must be a SHA-256 digest with ev: prefix");

  const changed = await makeLedgerEventKey({
    jobId: "job-1",
    eventType: "navigation_observed",
    targetState: "RUNNING",
    sourceUrl: "https://example.com/page",
    evidence: { source_kind: "browser", http_status: 201, duration_ms: 10 },
  });
  assert(one !== changed, "different evidence must generate a different key");
});

Deno.test("valid supplied idempotency key is honored and invalid key is replaced", async () => {
  const base = { jobId: "job-2", eventType: "error", evidence: { error_code: "TIMEOUT" } };
  assertEqual(await makeLedgerEventKey(base, "test-event:0001"), "test-event:0001", "valid supplied key");
  const generated = await makeLedgerEventKey(base, "not a valid key");
  assert(/^ev:[a-f0-9]{64}$/.test(generated), "invalid supplied key must be replaced with generated key");
});

Deno.test("actor keys are normalized and unsafe values fall back", () => {
  assertEqual(normalizeActorKey("  Agent_7:v1  "), "Agent_7:v1", "valid actor token");
  assertEqual(normalizeActorKey("unsafe actor"), "midad_browser_gateway", "unsafe actor token fallback");
  assertEqual(normalizeActorKey(null, "fallback_actor"), "fallback_actor", "custom fallback");
});
