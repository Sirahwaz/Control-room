import test from "node:test";
import assert from "node:assert/strict";
import {
  RUNTIME_EVIDENCE_SCHEMA,
  signRuntimeEvidenceEnvelope,
  verifyRuntimeEvidenceEnvelope,
} from "../runtime-evidence.mjs";

const KEY = "test-only-runtime-evidence-key-which-is-not-a-production-secret";
const NOW = Date.parse("2026-11-09T03:00:00.000Z");

function makeEnvelope(overrides = {}) {
  const payload = {
    schema: RUNTIME_EVIDENCE_SCHEMA,
    issued_at: new Date(NOW).toISOString(),
    providers: {
      "midad-playwright-worker": {
        state: "READY",
        observed_at: new Date(NOW).toISOString(),
        capability_handshake: true,
        authenticated: true,
      },
    },
    ...overrides,
  };
  return { ...payload, signature: signRuntimeEvidenceEnvelope(payload, KEY) };
}

test("valid HMAC envelope marks provider snapshots trusted only after verification", () => {
  const result = verifyRuntimeEvidenceEnvelope(makeEnvelope(), KEY, { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.providers["midad-playwright-worker"].source, "trusted_runtime_adapter");
  assert.equal(result.providers["midad-playwright-worker"].signature_verified, true);
});

test("missing signing key fails closed", () => {
  const result = verifyRuntimeEvidenceEnvelope(makeEnvelope(), "", { now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "RUNTIME_EVIDENCE_SIGNING_KEY_MISSING");
});

test("mutated provider evidence fails signature verification", () => {
  const envelope = makeEnvelope();
  envelope.providers["midad-playwright-worker"].authenticated = false;
  const result = verifyRuntimeEvidenceEnvelope(envelope, KEY, { now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "RUNTIME_EVIDENCE_SIGNATURE_INVALID");
});

test("expired and future-dated envelopes fail closed", () => {
  const stale = makeEnvelope({ issued_at: new Date(NOW - 600_000).toISOString() });
  stale.signature = signRuntimeEvidenceEnvelope(stale, KEY);
  assert.equal(
    verifyRuntimeEvidenceEnvelope(stale, KEY, { now: NOW }).reason,
    "RUNTIME_EVIDENCE_ENVELOPE_STALE",
  );

  const future = makeEnvelope({ issued_at: new Date(NOW + 60_000).toISOString() });
  future.signature = signRuntimeEvidenceEnvelope(future, KEY);
  assert.equal(
    verifyRuntimeEvidenceEnvelope(future, KEY, { now: NOW }).reason,
    "RUNTIME_EVIDENCE_TIMESTAMP_INVALID",
  );
});

test("provider ids and snapshots must be structurally valid", () => {
  const bad = makeEnvelope({ providers: { "../vps": { state: "READY" } } });
  bad.signature = signRuntimeEvidenceEnvelope(bad, KEY);
  const result = verifyRuntimeEvidenceEnvelope(bad, KEY, { now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "RUNTIME_EVIDENCE_PROVIDER_INVALID");
});
