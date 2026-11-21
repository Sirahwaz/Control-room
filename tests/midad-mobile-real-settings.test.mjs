import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../mobile/web/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../mobile/web/mobile-hub.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../mobile/web/mobile-hub.css", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../mobile/factory/products/midad-mobile-next.json", import.meta.url), "utf8"));

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
  for (const route of ["./midad-browser-mesh.html", "./human-bridge.html"]) assert.ok(html.includes(route));
  for (const asset of ["mobile/web/midad-browser-mesh.html", "mobile/web/midad-browser-mesh.css", "mobile/web/midad-browser-mesh.js", "mobile/web/human-bridge.html", "mobile/web/human-bridge.css", "mobile/web/human-bridge.js"]) assert.ok(manifest.web_assets.includes(asset));
  assert.ok(manifest.surfaces.includes("browser-mesh"));
  assert.ok(manifest.surfaces.includes("human-bridge"));
  assert.equal((html.match(/class="card[^"]*" data-id=/g) || []).length, 9);
});
