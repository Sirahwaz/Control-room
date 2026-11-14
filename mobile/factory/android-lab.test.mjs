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


test("accepts a matching static, DEX, and web analysis report set as one evidence record", async () => {
  const sha = "a".repeat(64);
  const reports = [
    {
      schema: "midad-android-static-v1",
      input: { sha256: sha },
      manifest: { package: "ai.midad.omni.agent", min_sdk: "24", permissions: [], components: [] },
      analysis: { status: "partial", jadx: "failed", apktool: "completed" }
    },
    {
      schema: "midad-dex-intelligence-v1",
      apk_sha256: sha,
      package_name: "ai.midad.omni.agent",
      status: "completed",
      dex_file_count: 3,
      class_count: 8595,
      method_count: 64233,
      app_owned_class_count: 9,
      app_owned_method_count: 9,
      errors: []
    },
    {
      schema: "midad-web-bundle-intelligence-v1",
      apk_sha256: sha,
      package_name: "ai.midad.omni.agent",
      status: "completed",
      indicators: { network_calls: 37, storage_apis: 16, dynamic_execution: 0, dom_injection_sinks: 12, secret_like_patterns: 0 },
      external_endpoints: []
    }
  ];
  const files = reports.map((report, index) => ({
    name: ["android-static-report.json", "dex-intelligence-report.json", "web-intelligence-report.json"][index],
    async text() { return JSON.stringify(report); }
  }));
  const result = await inspectAnalysisReports(files, sha);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.packageName, "ai.midad.omni.agent");
  assert.equal(result.apkSha256, sha);
  assert.equal(result.dex.classCount, 8595);
  assert.equal(result.web.indicators.dom_injection_sinks, 12);
  assert.deepEqual(result.reportTypes, ["android-static", "dex-intelligence", "web-intelligence"]);
});

test("rejects analysis reports whose APK fingerprints do not match", async () => {
  const report = {
    schema: "midad-dex-intelligence-v1",
    apk_sha256: "b".repeat(64),
    package_name: "ai.midad.omni.agent",
    status: "completed"
  };
  const file = { name: "dex-intelligence-report.json", async text() { return JSON.stringify(report); } };
  await assert.rejects(() => inspectAnalysisReports([file], "a".repeat(64)), {
    code: "ANALYSIS_APK_MISMATCH"
  });
});

test("rejects unsupported or malformed analysis report schemas", async () => {
  const file = { name: "report.json", async text() { return JSON.stringify({ schema: "unknown/v9" }); } };
  await assert.rejects(() => inspectAnalysisReports([file]), {
    code: "ANALYSIS_SCHEMA_UNSUPPORTED"
  });
});

test("rejects analysis report sets that mix package identities", async () => {
  const sha = "c".repeat(64);
  const reports = [
    { schema: "midad-dex-intelligence-v1", apk_sha256: sha, package_name: "ai.midad.omni.agent", status: "completed" },
    { schema: "midad-web-bundle-intelligence-v1", apk_sha256: sha, package_name: "ai.other.app", status: "completed" }
  ];
  const files = reports.map((report, i) => ({ name: i + ".json", async text() { return JSON.stringify(report); } }));
  await assert.rejects(() => inspectAnalysisReports(files), {
    code: "ANALYSIS_PACKAGE_MISMATCH"
  });
});
