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
  assert.match(js, /localStorage\\.getItem\\(['"]midad-browser-mesh-settings-v1['"]\\)/);
  assert.match(js, /localStorage\\.setItem\\(['"]midad-browser-mesh-settings-v1['"]/);
  assert.match(js, /applySettings/);
  assert.match(js, /fontScale/);
  assert.match(js, /accent/);
  assert.match(js, /language/);
  assert.match(js, /headline/);
  assert.doesNotMatch(js, /MIDAD_LEDGER_ADMIN_KEY|MIDAD_GITHUB_APP_PRIVATE_KEY|password\\s*[:=]/i);
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
  assert.match(workflow, /uses: \\.\\/\\.github\\/workflows\\/agentation-e2e\\.yml/);
  assert.match(workflow, /product_key: midad-browser/);
  assert.match(workflow, /needs: agentation-ui-feedback/);
  assert.match(workflow, /WEB_ENTRY=/);
  assert.match(workflow, /web_assets/);
  assert.match(workflow, /mobile\\/web\\/midad-browser-mesh/);
});

test("the native WebView serves the product's packaged homepage without network access", () => {
  const activity = read("mobile/factory/native/midad-browser/BrowserActivity.java");
  const smoke = read("mobile/factory/native/midad-browser/runtime-smoke.sh");
  assert.match(activity, /appassets\\.androidplatform\\.net\\/assets\\/public\\/index\\.html/);
  assert.match(activity, /WebViewAssetLoader/);
  assert.match(smoke, /svc wifi disable/);
  assert.match(smoke, /svc data disable/);
  assert.match(smoke, /LOCAL_HOME_LOADED/);
});
