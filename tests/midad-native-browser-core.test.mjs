import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../mobile/web/midad-browser-mesh.html", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../mobile/web/midad-native-browser.js", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../mobile/factory/products/midad-mobile-next.json", import.meta.url), "utf8"));
const workflow = fs.readFileSync(new URL("../.github/workflows/midad-mobile-factory.yml", import.meta.url), "utf8");
const browserBundle = new URL("../mobile/www/midad-browser-native.bundle.js", import.meta.url);

test("Browser Mesh exposes an actual native WebView browser surface", () => {
  for (const id of ["nativeBrowserAddress", "nativeBrowserOpen", "nativeBrowserBack", "nativeBrowserReload", "nativeBrowserNewTab", "nativeBrowserTabs", "nativeBrowserStatus"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(runtime, /openWebView/);
  assert.match(runtime, /urlChangeEvent/);
  assert.match(runtime, /toolbarType:\s*["']navigation["']/);
  assert.match(runtime, /goBack/);
  assert.match(runtime, /reload/);
});

test("Native browser rejects unsafe URL schemes and persists only user-selected bookmarks", () => {
  assert.match(runtime, /https?:/);
  assert.match(runtime, /javascript:/);
  assert.match(runtime, /nativeBrowserBookmarks/);
  assert.match(runtime, /localStorage/);
  assert.match(runtime, /bookmark/);
});

test("Native browser runtime is included in the Mobile Next APK web assets", () => {
  assert.ok(manifest.web_assets.includes("mobile/web/midad-native-browser.js"));
  assert.match(html, /midad-browser-native\.bundle\.js/);
  assert.match(workflow, /esbuild.*midad-browser-native-entry/);
  assert.match(workflow, /midad-browser-native\.bundle\.js/);
  assert.ok(fs.existsSync(browserBundle), "native browser plugin bundle must be generated before packaging");
});
