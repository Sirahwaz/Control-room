import test from "node:test";
import assert from "node:assert/strict";
import {
  ANDROID_BROWSER_CAPABILITIES,
  validateAndroidPairStart,
  validateAndroidPairId,
  validateBrowserDeviceCommand,
} from "./device-pairing.mjs";

const BASE = {
  node_id: "android-0123456789abcdef",
  token_hash: "a".repeat(64),
  device_label: "MIDAD Android",
};

test("Android pairing validates device identity and stores only a token hash", () => {
  const result = validateAndroidPairStart(BASE);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, BASE);
  assert.equal(Object.hasOwn(result.value, "token"), false);
  assert.deepEqual(ANDROID_BROWSER_CAPABILITIES, [
    "interactive-browser-execution",
    "persistent-browser-session",
    "encrypted-session-store",
  ]);
});

test("Android pairing rejects invalid node identifiers, hashes and empty labels", () => {
  assert.equal(validateAndroidPairStart({ ...BASE, node_id: "android-admin" }).ok, false);
  assert.equal(validateAndroidPairStart({ ...BASE, token_hash: "plaintext-token" }).ok, false);
  assert.equal(validateAndroidPairStart({ ...BASE, device_label: "   " }).ok, false);
  assert.equal(validateAndroidPairStart({ ...BASE, owner_id: "attacker" }).ok, true);
  assert.equal(Object.hasOwn(validateAndroidPairStart({ ...BASE, owner_id: "attacker" }).value, "owner_id"), false);
});

test("pair identifiers are random 192-bit hex strings", () => {
  assert.equal(validateAndroidPairId("b".repeat(48)), true);
  assert.equal(validateAndroidPairId("b".repeat(47)), false);
  assert.equal(validateAndroidPairId("g".repeat(48)), false);
});

test("browser device command permits only owner-scoped read-only operations", () => {
  assert.deepEqual(validateBrowserDeviceCommand({
    node_id: BASE.node_id,
    request_id: "request-0001",
    action: "navigate",
    url: "https://github.com/Sirahwaz/Control-room",
  }), {
    ok: true,
    value: {
      node_id: BASE.node_id,
      request_id: "request-0001",
      action: "navigate",
      url: "https://github.com/Sirahwaz/Control-room",
      host: "github.com",
    },
  });
  assert.equal(validateBrowserDeviceCommand({
    node_id: BASE.node_id, request_id: "request-0002", action: "inspect",
  }).ok, true);
  for (const action of ["click", "fill", "submit", "wallet.sign", "delete"]) {
    assert.equal(validateBrowserDeviceCommand({
      node_id: BASE.node_id, request_id: "request-0003", action,
      url: "https://example.com/",
    }).ok, false);
  }
});

test("browser device navigation rejects insecure, credentialed and non-standard URLs", () => {
  for (const url of [
    "http://example.com/",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
    "javascript:alert(1)",
    "https://example.com./",
  ]) {
    assert.equal(validateBrowserDeviceCommand({
      node_id: BASE.node_id, request_id: "request-0004", action: "navigate", url,
    }).ok, false, url);
  }
});

test("browser commands reject caller-supplied credentials and overlong payload fields", () => {
  assert.equal(validateBrowserDeviceCommand({
    node_id: BASE.node_id, request_id: "request-0005", action: "navigate",
    url: "https://example.com/", password: "do-not-accept",
  }).ok, true);
  assert.equal(validateBrowserDeviceCommand({
    node_id: BASE.node_id, request_id: "request-0006", action: "navigate",
    url: "https://example.com/" + "x".repeat(2050),
  }).ok, false);
});
