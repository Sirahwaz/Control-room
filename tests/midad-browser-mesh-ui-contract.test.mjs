import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("MIDAD Browser product manifest points to the dedicated Browser Mesh home and its local assets", () => {
  const manifest = JSON.parse(read("mobile/factory/products/midad-browser.json"));
  assert.equal(manifest.product_key, "midad-browser");
  assert.equal(manifest.web_entry, "mobile/web/midad-browser-mesh.html");
  assert.deepEqual(manifest.web_assets, [
    "mobile/web/midad-browser-mesh.css",
    "mobile/web/midad-browser-mesh.js",
  ]);
  assert.equal(manifest.features.local_first, true);
  assert.equal(manifest.features.server_side_secrets_only, true);
});

test("the bundled Mesh surface exposes runtime, network, vault and appearance controls without a wallet surface", () => {
  const html = read("mobile/web/midad-browser-mesh.html");
  for (const id of [
    "runtimeGrid", "networkPanel", "vaultPanel", "appearancePanel",
    "themeSelect", "accentOptions", "fontScale", "languageSelect",
    "headlineInput", "subtitleInput", "saveAppearance", "resetAppearance",
  ]) assert.ok(html.includes('id="' + id + '"'), "Missing UI control: " + id);
  assert.match(html, /MNCF/);
  assert.match(html, /Browser Run/);
  assert.match(html, /Proxy/);
  assert.match(html, /Vault/);
  assert.doesNotMatch(html, /Wallet|wallet|محفظة/i);
});

test("appearance preferences persist locally and never store provider credentials", () => {
  const js = read("mobile/web/midad-browser-mesh.js");
  assert.ok(js.includes('const STORAGE_KEY = "midad-browser-mesh-settings-v1"'));
  assert.ok(js.includes("localStorage.getItem(STORAGE_KEY)"));
  assert.ok(js.includes("localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))"));
  assert.ok(js.includes("applySettings"));
  assert.ok(js.includes("fontScale"));
  assert.ok(js.includes("accent"));
  assert.ok(js.includes("language"));
  assert.ok(js.includes("headline"));
  assert.equal(js.includes("MIDAD_LEDGER_ADMIN_KEY"), false);
  assert.equal(js.includes("MIDAD_GITHUB_APP_PRIVATE_KEY"), false);
});

test("MNCF and network modules are explicitly pending until live health checks exist", () => {
  const html = read("mobile/web/midad-browser-mesh.html");
  assert.match(html, /data-runtime-state="pending"/);
  assert.match(html, /data-service-state="pending"/);
  assert.match(html, /لا يتطلب VPS/);
  assert.match(html, /لا يوجد اتصال حي/);
});

test("the Android APK workflow builds the manifest-selected Browser home and gates it through Agentation", () => {
  const workflow = read(".github/workflows/midad-browser-android.yml");
  assert.ok(workflow.includes("uses: ./.github/workflows/agentation-e2e.yml"));
  assert.ok(workflow.includes("product_key: midad-browser"));
  assert.ok(workflow.includes("needs: agentation-ui-feedback"));
  assert.ok(workflow.includes("WEB_ENTRY="));
  assert.ok(workflow.includes(".web_assets"));
});

test("the native WebView serves the product's packaged homepage without network access", () => {
  const activity = read("mobile/factory/native/midad-browser/BrowserActivity.java");
  const smoke = read("mobile/factory/native/midad-browser/runtime-smoke.sh");
  assert.ok(activity.includes("https://appassets.androidplatform.net/assets/public/index.html"));
  assert.ok(activity.includes("WebViewAssetLoader"));
  assert.ok(smoke.includes("svc wifi disable"));
  assert.ok(smoke.includes("svc data disable"));
  assert.ok(smoke.includes("LOCAL_HOME_LOADED"));
});
