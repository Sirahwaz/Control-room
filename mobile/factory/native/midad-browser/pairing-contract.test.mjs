import test from "node:test";
import assert from "node:assert/strict";
import { validatePairingIntent } from "./pairing-contract.mjs";
import { validateOwnerSessionBinding, resolveUniqueOwnerProfile } from "../../../../supabase/functions/_shared/midad-owner-session.mjs";

const NOW = Date.parse("2026-11-17T10:00:00.000Z");
const OWNER = "5c0a8f3e-4e2a-4a65-a6d0-1a4b2b6f1234";

test("owner identity comes only from an active, explicitly owner-bound session", () => {
  const result = validateOwnerSessionBinding({
    active: true,
    owner_user_id: OWNER,
    created_at: "2026-11-17T09:00:00.000Z",
  }, NOW);
  assert.deepEqual(result, { ok: true, ownerUserId: OWNER });
});

test("legacy unbound sessions fail closed instead of inferring from profiles", () => {
  const result = validateOwnerSessionBinding({
    active: true,
    created_at: "2026-11-17T09:00:00.000Z",
  }, NOW);
  assert.deepEqual(result, { ok: false, error: "owner_session_not_bound" });
});

test("inactive, expired, malformed and future-dated sessions are rejected", () => {
  for (const session of [
    { active: false, owner_user_id: OWNER, created_at: "2026-11-17T09:00:00.000Z" },
    { active: true, owner_user_id: OWNER, created_at: "2026-10-01T09:00:00.000Z" },
    { active: true, owner_user_id: OWNER, created_at: "not-a-date" },
    { active: true, owner_user_id: OWNER, created_at: "2026-11-17T11:00:00.000Z" },
  ]) {
    assert.equal(validateOwnerSessionBinding(session, NOW).ok, false);
  }
});

test("pairing intent accepts a public P-256 key and least-privilege browser scope", () => {
  const result = validatePairingIntent({
    device_id: "android-7f2d91",
    device_label: "MIDAD Android",
    idempotency_key: "pairing-request-0001",
    public_key_jwk: {
      kty: "EC", crv: "P-256",
      x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      y: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
    capabilities: ["browser.inspect", "browser.navigate"],
    allowed_hosts: ["github.com", "chatgpt.com"],
  });
  assert.equal(result.ok, true);
});

test("pairing intent rejects private key material and caller-supplied owner identity", () => {
  const base = {
    device_id: "android-7f2d91",
    device_label: "MIDAD Android",
    idempotency_key: "pairing-request-0001",
    public_key_jwk: {
      kty: "EC", crv: "P-256",
      x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      y: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
    capabilities: ["browser.inspect"],
    allowed_hosts: ["github.com"],
  };
  assert.equal(validatePairingIntent({ ...base, owner_user_id: OWNER }).ok, false);
  assert.equal(validatePairingIntent({
    ...base, public_key_jwk: { ...base.public_key_jwk, d: "private-material" },
  }).ok, false);
});

test("pairing intent rejects wildcard hosts and elevated capabilities", () => {
  const base = {
    device_id: "android-7f2d91",
    device_label: "MIDAD Android",
    idempotency_key: "pairing-request-0001",
    public_key_jwk: {
      kty: "EC", crv: "P-256",
      x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      y: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
    capabilities: ["browser.inspect"],
    allowed_hosts: ["github.com"],
  };
  assert.equal(validatePairingIntent({ ...base, allowed_hosts: ["*.github.com"] }).ok, false);
  assert.equal(validatePairingIntent({ ...base, capabilities: ["wallet.sign"] }).ok, false);
});

test("owner profile resolution succeeds only for one valid profile", () => {
  assert.deepEqual(resolveUniqueOwnerProfile([{ id: OWNER }]), { ok: true, ownerUserId: OWNER });
  assert.equal(resolveUniqueOwnerProfile([]).ok, false);
  assert.equal(resolveUniqueOwnerProfile([{ id: OWNER }, { id: OWNER }]).ok, false);
  assert.equal(resolveUniqueOwnerProfile([{ id: "not-a-uuid" }]).ok, false);
});
