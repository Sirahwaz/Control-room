import test from "node:test";
import assert from "node:assert/strict";
import { inspectApkFile, MAX_APK_BYTES } from "../web/android-lab.mjs";

function fileFixture(name, bytes) {
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() { return bytes.slice().buffer; },
    slice(start, end) {
      return { async arrayBuffer() { return bytes.slice(start, end).buffer; } };
    }
  };
}

const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

test("accepts a bounded APK and returns a SHA-256 evidence record", async () => {
  const file = fileFixture("sample.apk", zipHeader);
  const result = await inspectApkFile(file);
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.fileName, "sample.apk");
  assert.equal(result.sizeBytes, zipHeader.byteLength);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.analysisMode, "STATIC_INTAKE_ONLY");
});

test("rejects non-APK filenames", async () => {
  await assert.rejects(() => inspectApkFile(fileFixture("sample.zip", zipHeader)), {
    code: "APK_EXTENSION_INVALID"
  });
});

test("rejects files without a ZIP local-file signature", async () => {
  await assert.rejects(() => inspectApkFile(fileFixture("sample.apk", new Uint8Array([1,2,3,4]))), {
    code: "APK_CONTAINER_INVALID"
  });
});

test("rejects oversized APKs before reading file contents", async () => {
  const file = {
    name: "large.apk",
    size: MAX_APK_BYTES + 1,
    slice() { throw new Error("file content must not be read"); }
  };
  await assert.rejects(() => inspectApkFile(file), { code: "APK_SIZE_LIMIT_EXCEEDED" });
});

test("does not accept missing or malformed file objects", async () => {
  await assert.rejects(() => inspectApkFile(null), { code: "APK_FILE_REQUIRED" });
  await assert.rejects(() => inspectApkFile({ name: "x.apk", size: 1 }), { code: "APK_FILE_UNREADABLE" });
});
