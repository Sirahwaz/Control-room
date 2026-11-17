import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../mobile/factory/native/midad-browser/BrowserActivity.java", import.meta.url),
  "utf8"
);

test("native browser owns a bounded multi-tab WebView workspace", () => {
  assert.match(source, /MAX_TABS\s*=\s*8/);
  assert.match(source, /List<WebView>\s+tabs/);
  assert.match(source, /createTab\(/);
  assert.match(source, /switchToTab\(/);
  assert.match(source, /closeCurrentTab\(/);
  assert.match(source, /tabCount/);
});

test("native tab restore stores only sanitized navigation locations", () => {
  assert.match(source, /SharedPreferences/);
  assert.match(source, /sanitizeRestorableUrl\(/);
  assert.match(source, /clearQuery\(\)/);
  assert.match(source, /fragment\(null\)/);
  assert.match(source, /restoreTabs\(/);
  assert.match(source, /saveTabs\(/);
});

test("each tab uses the same fail-closed WebView security configuration", () => {
  assert.match(source, /configureWebView\(WebView\s+target/);
  assert.match(source, /MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(source, /handler\.cancel\(\)/);
  assert.match(source, /setSafeBrowsingEnabled\(true\)/);
  assert.match(source, /setAcceptThirdPartyCookies\(target,\s*false\)/);
});

test("native browser keeps WebView local asset routing on every tab", () => {
  assert.match(source, /WebViewAssetLoader/);
  assert.match(source, /assetLoader\.shouldInterceptRequest/);
  assert.match(source, /tabsContainer/);
});
