import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/products/midad-mobile-next.json"), "utf8"));

test("MIDAD Mobile Next manifest resolves every declared local surface asset", () => {
  assert.equal(manifest.product_key, "midad-mobile-next");
  assert.equal(manifest.version, "0.5.1");
  assert.equal(manifest.app_id, "ai.midad.mobile.next");
  assert.equal(manifest.features.server_side_secrets_only, true);
  assert.equal(manifest.features.live_financial_execution, false);
  for (const asset of manifest.web_assets) {
    assert.ok(fs.existsSync(path.join(root, asset)), "missing declared asset: " + asset);
  }
  const basenames = manifest.web_assets.map((asset) => path.basename(asset));
  assert.equal(new Set(basenames).size, basenames.length, "web asset basenames must be unique");
});

test("MIDAD Mobile Next routes Browser Mesh and Human Bridge to bundled HTML entrypoints", () => {
  const html = fs.readFileSync(path.join(root, manifest.web_entry), "utf8");
  for (const route of ["./midad-browser-mesh.html", "./human-bridge.html"]) {
    assert.ok(html.includes(route), "missing Mobile Hub route: " + route);
  }
  for (const page of ["midad-browser-mesh.html", "human-bridge.html"]) {
    assert.ok(manifest.web_assets.some((asset) => asset.endsWith("/" + page)), "HTML page not declared: " + page);
  }
  for (const surface of ["browser-mesh", "human-bridge", "mobile-settings"]) {
    assert.ok(manifest.surfaces.includes(surface), "surface missing from manifest: " + surface);
  }
});
