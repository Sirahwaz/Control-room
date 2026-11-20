import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../mobile/factory/native/midad-browser/BrowserActivity.java", import.meta.url),
  "utf8"
);

test("browser records bounded local history only for completed HTTP(S) page navigations", () => {
  assert.match(source, /HISTORY_PREFS_KEY/);
  assert.match(source, /recordHistory\(/);
  assert.match(source, /MAX_HISTORY_ITEMS/);
  assert.match(source, /onPageFinished[\s\S]*recordHistory/);
});

test("browser bookmarks are stored locally, deduplicated by URL, and removable", () => {
  assert.match(source, /BOOKMARKS_PREFS_KEY/);
  assert.match(source, /saveBookmark\(/);
  assert.match(source, /removeBookmark\(/);
  assert.match(source, /showBookmarks\(/);
  assert.match(source, /SharedPreferences/);
});

test("browser library actions are reachable from the native menu", () => {
  assert.match(source, /showBrowserMenu\(/);
  assert.match(source, /الإشارات المرجعية/);
  assert.match(source, /السجل/);
  assert.match(source, /التنزيلات/);
  assert.match(source, /مشاركة الرابط/);
  assert.match(source, /بحث في الصفحة/);
});

test("downloads require a valid HTTP(S) URL and explicit user confirmation", () => {
  assert.match(source, /setDownloadListener/);
  assert.match(source, /confirmDownload\(/);
  assert.match(source, /تم حظر تنزيل/);
  assert.match(source, /setDestinationInExternalFilesDir/);
  assert.match(source, /VISIBILITY_VISIBLE_NOTIFY_COMPLETED/);
  assert.match(source, /DownloadManager/);
});

test("download manager lists and opens only completed downloads through content URIs", () => {
  assert.match(source, /showDownloads\(/);
  assert.match(source, /getUriForDownloadedFile/);
  assert.match(source, /FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(source, /COLUMN_STATUS/);
});

test("history and bookmarks remain local and bounded", () => {
  assert.match(source, /putString\(HISTORY_PREFS_KEY/);
  assert.match(source, /putString\(BOOKMARKS_PREFS_KEY/);
  assert.match(source, /MAX_HISTORY_ITEMS/);
  assert.match(source, /MAX_BOOKMARK_ITEMS/);
  assert.doesNotMatch(source, /WRITE_EXTERNAL_STORAGE/);
});

test("closing a tab stores only a sanitized restorable URL and exposes one-step restore", () => {
  assert.match(source, /LAST_CLOSED_TAB_KEY/);
  assert.match(source, /restoreLastClosedTab\\(/);
  assert.match(source, /sanitizeRestorableUrl\\(closingUrl\\)/);
  assert.match(source, /setItems\\(actions[\\s\\S]*استعادة آخر تبويب مغلق/);
  assert.match(source, /remove\\(LAST_CLOSED_TAB_KEY\\)/);
});
