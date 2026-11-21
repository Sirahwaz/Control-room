import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../mobile/web/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../mobile/web/mobile-hub.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../mobile/web/mobile-hub.css", import.meta.url), "utf8");

test("Mobile Hub exposes real appearance and typography controls", () => {
  for (const id of ["settingsPanel", "themeSelect", "fontFamilySelect", "fontScale", "appearanceSave"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(js, /midad-mobile-settings/);
  assert.match(js, /data-theme/);
  assert.match(js, /fontScale/);
  assert.match(css, /\[data-theme="light"\]/);
  assert.match(css, /--font-scale/);
  assert.match(css, /zoom:var\(--font-scale\)/);
});

test("Mobile Hub exposes a five-area navigation and an honest extensions center", () => {
  for (const area of ["cockpit", "money", "tasks", "ai", "more"]) {
    assert.match(html, new RegExp('data-area="' + area + '"'));
  }
  assert.match(html, /EXTENSIONS CENTER/);
  assert.match(html, /desktop companion/i);
  assert.match(js, /extensionDetails/);
});
