import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../midad-browser.js", import.meta.url), "utf8");

test("browser session token is reused from tab-scoped sessionStorage before re-authentication", () => {
  assert.match(source, /sessionStorage\.getItem\(["']midad_browser_session_token["']\)/);
  assert.match(source, /if\(state\.token&&!force\)return state\.token/);
  assert.match(source, /if\(cached\)\{state\.token=cached;return cached\}/);
});

test("new browser session tokens are cached only in sessionStorage", () => {
  assert.match(source, /sessionStorage\.setItem\(["']midad_browser_session_token["']/);
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem)\(["']midad_browser_session_token/);
});

test("401 recovery clears the stale cached token before obtaining a fresh owner-bound session", () => {
  assert.match(source, /function clearSessionToken\(\)/);
  assert.match(source, /sessionStorage\.removeItem\(["']midad_browser_session_token["']/);
  assert.match(source, /response\.status===401&&retry\)\{clearSessionToken\(\);return api\(payload,false\)\}/);
});

test("Cloudflare Browser Run also retries once after an expired owner session", () => {
  assert.match(source, /async function cloudflareBrowserRequest\(action,payload=\{\},retry=true\)/);
  assert.match(source, /response\.status===401&&retry\)\{clearSessionToken\(\);return cloudflareBrowserRequest\(action,payload,false\)\}/);
});

test("session cache remains tab-scoped and never writes browser credentials into persistent localStorage", () => {
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem|removeItem)\(/);
});
