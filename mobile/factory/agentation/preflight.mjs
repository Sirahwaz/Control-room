#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../../..");
const fail = message => { console.error("AGENTATION_PREFLIGHT_FAIL:", message); process.exit(1); };
const readJson = relative => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) fail(`Missing required file: ${relative}`);
  try { return JSON.parse(fs.readFileSync(absolute, "utf8")); }
  catch (error) { fail(`Invalid JSON in ${relative}: ${error.message}`); }
};
const requireFile = relative => {
  if (!fs.existsSync(path.join(root, relative))) fail(`Missing integration file: ${relative}`);
};

const factory = readJson("mobile/factory/factory.config.json");
const integration = readJson("mobile/factory/agentation/integration.json");
const capabilities = readJson("mobile/factory/x/capabilities.registry.json").capabilities;
const providers = readJson("mobile/factory/x/providers.registry.json").providers;
const plugins = readJson("mobile/factory/x/plugins.registry.json").plugins;
const e2ePackage = readJson("tools/agentation/e2e/package.json");
const mobilePackage = readJson("mobile/package.json");

if (factory.ui_feedback?.enabled !== true || factory.ui_feedback?.provider !== "agentation") fail("Factory ui_feedback must enable Agentation");
if (!factory.default_pipeline.includes("agentation_ui_feedback_roundtrip")) fail("Factory pipeline is missing the Agentation round-trip stage");
if (!factory.quality.required_gates.includes("ui_feedback_config_valid")) fail("Factory quality gates must validate UI feedback config");
if (integration.enabled !== true || integration.api_key_required !== false) fail("Integration must be enabled without a vendor API key");
if (integration.artifact_policy?.include_in_release_apk !== false) fail("Agentation tooling must stay out of the release APK");
if (!capabilities.some(item => item.id === "agentation-dom-feedback")) fail("Agentation capability missing from Factory X");
if (!providers.some(item => item.id === "agentation" && item.capabilities.includes("agentation-dom-feedback"))) fail("Agentation provider missing from Factory X");
if (!plugins.some(item => item.id === "factory-agentation-feedback" && item.capabilities.includes("agentation-dom-feedback"))) fail("Agentation Factory plugin missing");
if (e2ePackage.dependencies?.agentation !== "3.1.2" || e2ePackage.dependencies?.["agentation-mcp"] !== "1.3.2") fail("Agentation package pins mismatch");
if (mobilePackage.dependencies?.agentation || mobilePackage.dependencies?.["agentation-mcp"]) fail("Agentation must not be added to Android runtime dependencies");

for (const file of [
  ".github/workflows/agentation-e2e.yml",
  ".github/workflows/midad-mobile-factory.yml",
  ".github/workflows/midad-mobile-android.yml",
  ".github/workflows/midad-omni-agent-android.yml",
  ".github/workflows/midad-human-bridge-android.yml",
  ".github/workflows/signalscan-ai-android.yml",
  "tools/agentation/e2e/src/main.jsx",
  "tools/agentation/e2e/tests/annotation.spec.js",
  "mobile/factory/agentation/prepare-preview.mjs",
  "mobile/factory/agentation/README.md"
]) requireFile(file);

const workflow = fs.readFileSync(path.join(root, ".github/workflows/agentation-e2e.yml"), "utf8");
const factoryWorkflow = fs.readFileSync(path.join(root, ".github/workflows/midad-mobile-factory.yml"), "utf8");
const e2eTest = fs.readFileSync(path.join(root, "tools/agentation/e2e/tests/annotation.spec.js"), "utf8");
if (!/workflow_call:/m.test(workflow)) fail("Agentation workflow must be reusable by Mobile Factory builds");
if (!/agentation-e2e\.yml/m.test(factoryWorkflow)) fail("Mobile Factory build must call Agentation E2E");
if (!e2eTest.includes("agentation_get_all_pending")) fail("E2E test must verify delivery through MCP");
if (!workflow.includes("127.0.0.1:4747")) fail("CI Agentation endpoint must remain loopback-only");

const androidBuildWorkflows = [
  ".github/workflows/midad-mobile-factory.yml",
  ".github/workflows/midad-mobile-android.yml",
  ".github/workflows/midad-omni-agent-android.yml",
  ".github/workflows/midad-human-bridge-android.yml",
  ".github/workflows/signalscan-ai-android.yml"
];
for (const file of androidBuildWorkflows) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (!source.includes("agentation-ui-feedback:") ||
      !source.includes("uses: ./.github/workflows/agentation-e2e.yml")) {
    fail("Android build route does not call Agentation E2E: " + file);
  }
  if (!source.includes("needs: agentation-ui-feedback")) {
    fail("Android build route can bypass Agentation UI verification: " + file);
  }
}

console.log(JSON.stringify({
  ok: true,
  mode: "development_and_ci_only",
  api_key_required: false,
  checks: {
    factory_config: true,
    provider_registry: true,
    plugin_registry: true,
    reusable_workflow: true,
    mcp_roundtrip_test_present: true,
    no_agentation_in_android_dependencies: true,
    excluded_from_release_apk: true
  }
}));
