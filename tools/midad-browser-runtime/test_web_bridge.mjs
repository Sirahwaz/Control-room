import test from "node:test";
import assert from "node:assert/strict";
import { buildBridgePayload, validateOperatorHint } from "../../midad-browser-bridge.js";

test("bridge payload is scoped to authenticated user_bridge commands", () => {
  assert.deepEqual(buildBridgePayload("session-token", "capabilities"), {
    action: "user_bridge", subaction: "capabilities", token: "session-token"
  });
});

test("bridge payload rejects unsupported subactions and missing tokens", () => {
  assert.throws(() => buildBridgePayload("", "capabilities"), /SESSION_REQUIRED/);
  assert.throws(() => buildBridgePayload("token", "delete_everything"), /SUBACTION_NOT_ALLOWED/);
});

test("operator hints are bounded and cannot contain credential material", () => {
  assert.equal(validateOperatorHint("inspect example.com"), "inspect example.com");
  assert.throws(() => validateOperatorHint("inspect example.com " + "x".repeat(510)), /COMMAND_LENGTH_INVALID/);
  assert.throws(() => validateOperatorHint("use password: hunter2"), /SENSITIVE_COMMAND_REJECTED/);
  assert.throws(() => validateOperatorHint(""), /COMMAND_REQUIRED/);
});
