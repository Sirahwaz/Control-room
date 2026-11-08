import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/midad-mobile-factory.yml", import.meta.url), "utf8");

test("maps the four documented Android signing secrets without changing their names", () => {
  for (const name of [
    "MIDAD_ANDROID_KEYSTORE_BASE64",
    "MIDAD_ANDROID_KEYSTORE_PASSWORD",
    "MIDAD_ANDROID_KEY_ALIAS",
    "MIDAD_ANDROID_KEY_PASSWORD"
  ]) {
    assert.match(workflow, new RegExp(name + ":\\s*\\$\\{\\{\\s*secrets\\." + name + "\\s*\\}\\}"));
  }
});

test("copies signing secrets only into lowercase local shell variables", () => {
  assert.match(workflow, /store_password="\$MIDAD_ANDROID_KEYSTORE_PASSWORD"/);
  assert.match(workflow, /key_alias="\$MIDAD_ANDROID_KEY_ALIAS"/);
  assert.match(workflow, /key_password="\$MIDAD_ANDROID_KEY_PASSWORD"/);
});

test("non-debug release channels fail closed when persistent signing is absent", () => {
  assert.ok(workflow.includes('if [ "$RELEASE_CHANNEL" != "debug" ]; then'));
  assert.match(workflow, /Internal, beta and production builds require persistent Android signing secrets/);
});
