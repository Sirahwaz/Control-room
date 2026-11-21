import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("Browser Mesh exposes a password-only access-key field without requiring Telegram", async () => {
  const html = await read("mobile/web/midad-browser-mesh.html");
  const js = await read("mobile/web/midad-browser-mesh.js");
  assert.match(html, /id="browserRunAccessKey"[^>]*type="password"|type="password"[^>]*id="browserRunAccessKey"/);
  assert.match(js, /access_key\s*:\s*accessKey/);
  assert.match(js, /getBrowserRunAccessKey/);
  assert.doesNotMatch(js, /افتح MIDAD Browser Mesh من Telegram Mini App للمصادقة التلقائية/);
});

test("Browser Run access key is encrypted by the existing Android Keystore vault", async () => {
  const activity = await read("mobile/factory/native/midad-browser/BrowserActivity.java");
  const bridge = await read("mobile/factory/native/midad-browser/BrowserAgentBridge.java");
  assert.match(activity, /saveBrowserRunAccessKey\(/);
  assert.match(activity, /readBrowserRunAccessKey\(/);
  assert.match(activity, /encryptVaultValue\(/);
  assert.match(activity, /decryptVaultValue\(/);
  assert.match(activity, /BROWSER_RUN_ACCESS_KEY_KEY/);
  assert.match(bridge, /getBrowserRunAccessKey/);
  assert.match(bridge, /saveBrowserRunAccessKey/);
  assert.match(bridge, /clearBrowserRunAccessKey/);
});

test("Access key is never persisted in WebView localStorage or packaged JavaScript", async () => {
  const js = await read("mobile/web/midad-browser-mesh.js");
  assert.doesNotMatch(js, /localStorage\.(?:setItem|getItem)\([^\n]*browserRunAccessKey/i);
  assert.doesNotMatch(js, /localStorage\.(?:setItem|getItem)\([^\n]*access_key/i);
});

test("Browser APK workflow runs the owner access-key contract test", async () => {
  const workflow = await read(".github/workflows/midad-browser-android.yml");
  assert.match(workflow, /midad-browser-web-access-key-contract\.test\.mjs/);
});
