import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../mobile/factory/native/midad-browser/BrowserActivity.java", import.meta.url),
  "utf8"
);

test("native browser toolbar uses the MIDAD dark premium surface and accent treatment", () => {
  assert.match(source, /Color\.rgb\(5, 13, 22\)/);
  assert.match(source, /brand\.setTextColor\(Color\.rgb\(115, 229, 251\)\)/);
  assert.match(source, /Color\.rgb\(10, 25, 37\)/);
  assert.match(source, /setElevation\(dp\(primary \? 3 : 1\)\)/);
  assert.match(source, /setLetterSpacing\(0\.08f\)/);
});

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
  assert.ok(source.includes('.path("/")'));
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

test("launch without a VIEW intent preserves restored tabs", () => {
  const start = source.indexOf("private void handleIncomingIntent(Intent intent)");
  const end = source.indexOf("private void createTab(", start);
  const handler = source.slice(start, end);
  assert.match(handler, /if \(webView == null\) createTab\(MIDAD_HOME\)/);
  assert.doesNotMatch(handler, /webView\.loadUrl\(MIDAD_HOME\)/);
});

test("WebView cookies are flushed when the browser pauses and before WebViews are destroyed", () => {
  assert.match(source, /private void flushCookies\(\)\s*\{\s*CookieManager\.getInstance\(\)\.flush\(\);\s*\}/);
  const pauseStart = source.indexOf("protected void onPause()");
  const pauseEnd = source.indexOf("protected void onDestroy()", pauseStart);
  const pause = source.slice(pauseStart, pauseEnd);
  assert.match(pause, /flushCookies\(\)/);
  assert.ok(pause.indexOf("flushCookies()") < pause.indexOf("super.onPause()"));
  const destroyStart = source.indexOf("protected void onDestroy()");
  const destroyEnd = source.indexOf("private void requestDefaultBrowserRole()", destroyStart);
  const destroy = source.slice(destroyStart, destroyEnd);
  assert.match(destroy, /flushCookies\(\)/);
  assert.ok(destroy.indexOf("flushCookies()") < destroy.indexOf("tab.destroy()"));
});

test("native browser exposes persisted theme and font zoom controls across all tabs", () => {
  assert.match(source, /APPEARANCE_PREFS/);
  assert.match(source, /fontZoomPercent/);
  assert.match(source, /setTextZoom\(fontZoomPercent\)/);
  assert.match(source, /appearancePrefs/);
  assert.match(source, /showAppearanceSettings\(/);
  assert.match(source, /applyBrowserAppearance\(/);
  assert.match(source, /المظهر والخط/);
  assert.match(source, /setFontZoom\(85\)/);
  assert.match(source, /setFontZoom\(130\)/);
});
