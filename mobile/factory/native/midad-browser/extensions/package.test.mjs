import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const targets = ["chrome", "edge", "firefox"];

for (const target of targets) {
  test(target + " manifest is MV3 and requests only bounded baseline permissions", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, target, "manifest.json"), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
    assert.deepEqual(manifest.optional_permissions, ["tabs", "bookmarks", "history", "downloads"]);
    assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
    assert.equal(manifest.permissions.some((p) => ["cookies", "browsingData", "debugger", "nativeMessaging", "webRequest"].includes(p)), false);
  });
}

test("Chrome and Edge use service workers while Firefox has a background-script fallback", async () => {
  const chrome = JSON.parse(await readFile(path.join(root, "chrome/manifest.json"), "utf8"));
  const edge = JSON.parse(await readFile(path.join(root, "edge/manifest.json"), "utf8"));
  const firefox = JSON.parse(await readFile(path.join(root, "firefox/manifest.json"), "utf8"));
  assert.equal(chrome.background.service_worker, "background.js");
  assert.equal(edge.background.service_worker, "background.js");
  assert.equal(firefox.background.scripts.includes("background.js"), true);
  assert.equal(firefox.browser_specific_settings.gecko.id, "midad-browser-companion@midad.ai");
});

test("companion extracts only through a fixed user-triggered action and never reads credentials", async () => {
  const background = await readFile(path.join(root, "shared/background.js"), "utf8");
  const popup = await readFile(path.join(root, "shared/popup.js"), "utf8");
  assert.match(background, /api\.runtime\.onMessage\.addListener/);
  assert.match(background, /api\.scripting\.executeScript/);
  assert.match(background, /MIDAD_EXTRACT/);
  assert.doesNotMatch(background + popup, /document\.cookie|localStorage|indexedDB|passwordManager|authorization/i);
  assert.doesNotMatch(background + popup, /\beval\s*\(|new Function\s*\(/);
  assert.match(background, /form,input,textarea,select,option,button/);
  assert.match(popup, /api\.permissions\.request/);
});
