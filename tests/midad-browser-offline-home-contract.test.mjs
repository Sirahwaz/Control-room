import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("MIDAD Browser home is served from packaged APK assets, not the network", () => {
  const activity = read("mobile/factory/native/midad-browser/BrowserActivity.java");

  assert.match(activity, /https:\/\/appassets\.androidplatform\.net\/assets\/public\/index\.html/);
  assert.match(activity, /WebViewAssetLoader/);
  assert.match(activity, /new WebViewAssetLoader\.AssetsPathHandler\(this\)/);
  assert.match(activity, /assetLoader\.shouldInterceptRequest\(request\.getUrl\(\)\)/);
  assert.match(activity, /settings\.setAllowFileAccess\(false\)/);
  assert.match(activity, /settings\.setAllowContentAccess\(false\)/);
});

test("Android preparation installs the stable AndroidX WebKit asset-loader dependency idempotently", () => {
  const prepare = read("mobile/factory/native/midad-browser/prepare_android.py");

  assert.match(prepare, /androidx\.webkit:webkit:1\.18\.0/);
  assert.ok(prepare.includes("if not re.search(r\"androidx\\.webkit:webkit:\", gradle_text)"));
  assert.ok(prepare.includes("dependency_block = re.search"));
  assert.ok(prepare.includes("dependencies"));
});

test("Android runtime smoke proves the packaged home loads with Wi-Fi and mobile data disabled", () => {
  const activity = read("mobile/factory/native/midad-browser/BrowserActivity.java");
  const smoke = read("mobile/factory/native/midad-browser/runtime-smoke.sh");

  assert.match(activity, /LOCAL_HOME_LOADED/);
  assert.match(smoke, /svc wifi disable/);
  assert.match(smoke, /svc data disable/);
  assert.match(smoke, /LOCAL_HOME_LOADED/);
  assert.match(smoke, /svc wifi enable/);
  assert.match(smoke, /svc data enable/);
});

test("the Browser APK workflow packages the local home page and its local CSS and JS", () => {
  const workflow = read(".github/workflows/midad-browser-android.yml");
  const manifest = JSON.parse(read("mobile/factory/products/midad-browser.json"));
  const html = read("midad-browser.html");

  assert.equal(manifest.web_entry, "midad-browser.html");
  assert.deepEqual(manifest.web_assets, ["midad-browser.css", "midad-browser.js"]);
  assert.match(workflow, /cp midad-browser\.html mobile\/www\/index\.html/);
  assert.match(workflow, /cp midad-browser\.css mobile\/www\//);
  assert.match(workflow, /cp midad-browser\.js mobile\/www\//);
  assert.match(html, /href="\.\/midad-browser\.css/);
  assert.match(html, /src="\.\/midad-browser\.js/);
});
