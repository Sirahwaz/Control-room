import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../mobile/factory/native/midad-browser/BrowserActivity.java", import.meta.url),
  "utf8"
);

test("browser local library uses Android Keystore and authenticated AES-GCM encryption", () => {
  assert.match(source, /KeyStore\.getInstance\("AndroidKeyStore"\)/);
  assert.match(source, /KeyGenParameterSpec\.Builder/);
  assert.match(source, /KeyProperties\.BLOCK_MODE_GCM/);
  assert.match(source, /KeyProperties\.ENCRYPTION_PADDING_NONE/);
  assert.match(source, /Cipher\.getInstance\("AES\/GCM\/NoPadding"\)/);
  assert.match(source, /GCMParameterSpec\(128,/);
  assert.match(source, /VAULT_ALIAS/);
});

test("bookmark and history reads decrypt values and migrate legacy plaintext once", () => {
  const start = source.indexOf("private JSONArray readLibraryArray(String key)");
  const end = source.indexOf("private void recordHistory", start);
  const method = source.slice(start, end);
  assert.match(method, /decryptVaultValue\(/);
  assert.match(method, /writeLibraryArray\(/);
  assert.match(method, /legacy/i);
});

test("bookmark and history writes persist only encrypted vault envelopes", () => {
  assert.match(source, /private void writeLibraryArray\(String key, JSONArray value\)/);
  assert.match(source, /encryptVaultValue\(value\.toString\(\)\)/);
  assert.doesNotMatch(source, /libraryPrefs\.edit\(\)\.putString\((?:HISTORY_PREFS_KEY|BOOKMARKS_PREFS_KEY),\s*(?:nextItems\.toString\(\)|"\[\]")/);
});

test("vault encryption failure does not silently fall back to plaintext storage", () => {
  const start = source.indexOf("private void writeLibraryArray(String key, JSONArray value)");
  const end = source.indexOf("private void recordHistory", start);
  const method = source.slice(start, end);
  assert.match(method, /VAULT_WRITE_FAILED/);
  assert.doesNotMatch(method, /putString\(key,\s*value\.toString\(\)\)/);
});

test("restored ciphertext is never replaced when its Android Keystore key is unavailable", () => {
  const keyStart = source.indexOf("private SecretKey getVaultKey(");
  const keyEnd = source.indexOf("private String encryptVaultValue", keyStart);
  const keyMethod = source.slice(keyStart, keyEnd);
  assert.match(keyMethod, /boolean createIfMissing/);
  assert.match(keyMethod, /if \(!createIfMissing\) return null/);

  const readStart = source.indexOf("private JSONArray readLibraryArray(String key)");
  const readEnd = source.indexOf("private void recordHistory", readStart);
  const readMethod = source.slice(readStart, readEnd);
  assert.match(readMethod, /unreadableVaultKeys\.add\(key\)/);
  assert.match(readMethod, /stored\.startsWith\(VAULT_PREFIX\)/);

  const writeStart = source.indexOf("private boolean writeLibraryArray(String key, JSONArray value)");
  const writeEnd = source.indexOf("private void recordHistory", writeStart);
  const writeMethod = source.slice(writeStart, writeEnd);
  assert.match(writeMethod, /unreadableVaultKeys\.contains\(key\)/);
  assert.match(writeMethod, /return false/);
});

test("bookmark success is reported only after encrypted persistence succeeds", () => {
  const start = source.indexOf("private void saveBookmark()");
  const end = source.indexOf("private void removeBookmark", start);
  const method = source.slice(start, end);
  assert.match(method, /if \(writeLibraryArray\(BOOKMARKS_PREFS_KEY, nextItems\)\)/);
  assert.doesNotMatch(method, /writeLibraryArray\(BOOKMARKS_PREFS_KEY, nextItems\);\s*Toast\.makeText\(this, "تم حفظ الإشارة المرجعية"/);
});

test("Android app disables cloud backup for Keystore-bound local browser data", async () => {
  const prepare = await readFile(
    new URL("../mobile/factory/native/midad-browser/prepare_android.py", import.meta.url),
    "utf8"
  );
  assert.match(prepare, /allowBackup.*false/);
});
