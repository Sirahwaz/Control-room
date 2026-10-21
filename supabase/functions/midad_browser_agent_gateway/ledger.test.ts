import {
  normalizeLedgerEventType,
  normalizeTargetState,
  safeSourceUrl,
  sanitizeLedgerEvidence,
  makeLedgerEventKey,
} from "./ledger.ts";

function assertEquals(actual: unknown, expected: unknown, message = "values differ") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(message + ": expected " + e + ", got " + a);
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("source URL strips query/fragment and rejects unsafe URLs", () => {
  assertEquals(
    safeSourceUrl("https://Taskmarket.dev/tasks?id=123&token=private#section"),
    "https://taskmarket.dev/tasks",
  );
  assertEquals(safeSourceUrl("https://user:password@taskmarket.dev/tasks"), null);
  assertEquals(safeSourceUrl("http://taskmarket.dev/tasks"), null);
  assertEquals(safeSourceUrl("https://127.0.0.1/admin"), null);
  assertEquals(safeSourceUrl("not-a-url"), null);
});

Deno.test("gateway event names map to ledger contract enum", () => {
  assertEquals(normalizeLedgerEventType("job_created"), "job_created");
  assertEquals(normalizeLedgerEventType("human_gate_completed"), "human_gate_resumed");
  assertEquals(normalizeLedgerEventType("hard_block"), "policy_decision");
  assertEquals(normalizeLedgerEventType("navigation"), "navigation_observed");
  assertEquals(normalizeLedgerEventType("unknown_custom_event"), "state_transition");
});

Deno.test("target state is a declared browser state and PAID is not silently removed", () => {
  assertEquals(normalizeTargetState("running"), "RUNNING");
  assertEquals(normalizeTargetState("submitted"), "SUBMITTED");
  assertEquals(normalizeTargetState(null), null);
  assertEquals(normalizeTargetState("made_up"), null);
  assertEquals(normalizeTargetState("PAID"), "PAID");
});

Deno.test("evidence metadata is scalar-only, allowlisted and redacted", () => {
  const evidence = sanitizeLedgerEvidence({
    source_kind: "public_page",
    http_status: 200,
    bytes_read: 2048,
    retryable: false,
    policy_status: "ALLOW",
    artifact_sha256: "a".repeat(64),
    artifact_url: "https://example.com/output.json?signature=secret#fragment",
    access_token: "must-not-persist",
    raw_html: "<html>secret</html>",
    details: { private: true },
    long_text: "x".repeat(600),
    malformed_hash: "xyz",
  });
  assertEquals(evidence.source_kind, "public_page");
  assertEquals(evidence.http_status, 200);
  assertEquals(evidence.bytes_read, 2048);
  assertEquals(evidence.retryable, false);
  assertEquals(evidence.policy_status, "ALLOW");
  assertEquals(evidence.artifact_sha256, "a".repeat(64));
  assertEquals(evidence.artifact_url, "https://example.com/output.json");
  assert(!("access_token" in evidence), "unexpected token key");
  assert(!("raw_html" in evidence), "unexpected raw html key");
  assert(!("details" in evidence), "unexpected object value");
  assert(!("long_text" in evidence), "oversize string should be dropped");
  assert(!("malformed_hash" in evidence), "invalid hash should be dropped");
});

Deno.test("idempotency key is deterministic, valid and stable when explicitly supplied", async () => {
  const input = {
    jobId: "00000000-0000-4000-8000-000000000001",
    eventType: "navigation_observed",
    targetState: "RUNNING",
    sourceUrl: "https://taskmarket.dev/tasks?session=should-not-matter",
    nextAction: "read_dom",
    blockerCode: null,
    attemptCount: 1,
    evidence: { source_kind: "public_page", http_status: 200 },
  };
  const a = await makeLedgerEventKey(input);
  const b = await makeLedgerEventKey({...input, sourceUrl: "https://taskmarket.dev/tasks?different=private"});
  assertEquals(a, b, "query string should not affect idempotency key");
  assert(/^ev:[a-f0-9]{64}$/.test(a), "generated event key is invalid");
  assertEquals(await makeLedgerEventKey(input, "caller-event-key-0001"), "caller-event-key-0001");
  assertEquals(await makeLedgerEventKey(input, "bad key with spaces"), a);
});
