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
  assert.match(html, /فحص Cloudflare Health وHeartbeat وعمال CPU مستقل عن Browser Run/);
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


test("Browser Mesh exposes authenticated interactive Browser Run and Live View controls", () => {
  const html = read("mobile/web/midad-browser-mesh.html");
  const js = read("mobile/web/midad-browser-mesh.js");
  const worker = read("mobile/factory/x/continuity-ledger/worker.mjs");
  for (const id of [
    "browserRunPanel", "browserRunConnect", "browserRunTarget",
    "browserRunAllowedHosts", "browserRunStart", "browserRunRefresh", "browserRunClose",
    "browserRunLiveViewFrame", "browserRunOpenLiveView", "browserRunStatus",
  ]) assert.ok(html.includes('id="' + id + '"'), "Missing Browser Run control: " + id);
  assert.ok(js.includes("https://midad-continuity-ledger.midadbot.workers.dev"));
  assert.equal(html.includes('id="browserRunAccessKey"'), false);
  assert.doesNotMatch(js, /browserRunAccessKey|midad_cockpit_key|access_key:/);
  assert.match(js, /telegram_init_data:[\s\S]*client:\s*["']midad-control-room["']/);
  assert.match(js, /OPEN TELEGRAM MINI APP/);
  assert.match(js, /\/v1\/browser\/ui\//);
  assert.match(worker, /midad_browser_agent_gateway/);
  assert.match(worker, /owner_scope_hash/);
  assert.match(worker, /BROWSER_USER_GATEWAY_URL/);
  for (const route of ["status", "start", "refresh", "close"]) {
    assert.ok(worker.includes("/v1/browser/ui/" + route), "Missing Worker route: " + route);
  }
  assert.match(js, /live_view_url/);
  assert.match(js, /noopener/);
  assert.doesNotMatch(js, /localStorage\.(?:setItem|getItem)\([^)]*(?:token|live.?view)/i);
  assert.match(html, /id=\"browserRunRuntimeCard\" data-browser-run-state=\"idle\"/);
});

test("Browser Mesh never ships Cloudflare or Supabase admin credentials in its browser bundle", () => {
  const js = read("mobile/web/midad-browser-mesh.js");
  for (const secretName of [
    "MIDAD_LEDGER_ADMIN_KEY", "CLOUDFLARE_API_TOKEN", "SUPABASE_SERVICE_ROLE_KEY",
    "MIDAD_GITHUB_APP_PRIVATE_KEY", "MIDAD_WAKE_INTERNAL_KEY",
  ]) assert.equal(js.includes(secretName), false, "Frontend must not contain " + secretName);
});


test("Browser Mesh uses Telegram Mini App auth only and exposes no manual access-key path", () => {
  const js = read("mobile/web/midad-browser-mesh.js");
  assert.match(js, /BROWSER_RUN_CONTROL_API[\s\S]*midad_control_room/);
  assert.match(js, /telegram_init_data:[\s\S]*client:\s*["']midad-control-room["']/);
  assert.doesNotMatch(js, /midad_telegram_auth/);\n  assert.doesNotMatch(js, /access_key|midad_cockpit_key|browserRunAccessKey/);
});


test("Browser Run Worker binds persisted sessions to the gateway-authenticated owner scope", () => {
  const worker = read("mobile/factory/x/continuity-ledger/worker.mjs");
  assert.match(worker, /owner_scope_hash/);
  assert.match(worker, /typeof result\?\.owner_scope_hash === 'string'/);
  assert.ok(worker.includes("if (!/^[a-f0-9]{64}$/.test(ownerScopeHash))"));
  assert.match(worker, /MIDAD_BROWSER_OWNER_SCOPE_MISSING/);
  assert.match(worker, /return \{ ok: true, ownerScopeHash \}/);
  assert.doesNotMatch(worker, /sha256\(['"]midad-browser-single-owner-v1['"]\)/);
});
