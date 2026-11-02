import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareProductWebSurface } from "./prepare-web-surface.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "midad-web-surface-"));
  fs.mkdirSync(path.join(root, "mobile/factory/products"), { recursive: true });
  fs.mkdirSync(path.join(root, "mobile/web/site"), { recursive: true });
  fs.writeFileSync(path.join(root, "mobile/factory/products/midad-human-bridge.json"), JSON.stringify({
    product_key: "midad-human-bridge",
    web_entry: "mobile/web/human-bridge.html",
    web_assets: ["mobile/web/human-bridge.css", "mobile/web/human-bridge.js"]
  }));
  fs.writeFileSync(path.join(root, "mobile/web/human-bridge.html"),
    '<link rel="stylesheet" href="./human-bridge.css"><script src="./human-bridge.js"></script>');
  fs.writeFileSync(path.join(root, "mobile/web/human-bridge.css"), "body{color:white}");
  fs.writeFileSync(path.join(root, "mobile/web/human-bridge.js"), "window.midadBridge=true;");
  fs.writeFileSync(path.join(root, "mobile/web/site/unused.html"), "not part of this product");
  fs.writeFileSync(path.join(root, "iaitrader.html"), "not part of this product");
  return root;
}

test("copies only the selected product entry and manifest-declared assets", () => {
  const root = fixture();
  try {
    const outputDir = path.join(root, "mobile/www");
    const result = prepareProductWebSurface({ repoRoot: root, productKey: "midad-human-bridge", outputDir });
    assert.deepEqual(result.files.sort(), ["human-bridge.css", "human-bridge.js", "index.html"]);
    assert.deepEqual(fs.readdirSync(outputDir).sort(), ["human-bridge.css", "human-bridge.js", "index.html"]);
    assert.equal(fs.readFileSync(path.join(outputDir, "index.html"), "utf8"),
      fs.readFileSync(path.join(root, "mobile/web/human-bridge.html"), "utf8"));
    assert.equal(fs.existsSync(path.join(outputDir, "site")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when the entry references an undeclared local asset", () => {
  const root = fixture();
  try {
    fs.appendFileSync(path.join(root, "mobile/web/human-bridge.html"), '<script src="./undeclared.js"></script>');
    assert.throws(
      () => prepareProductWebSurface({ repoRoot: root, productKey: "midad-human-bridge" }),
      /UNDECLARED_LOCAL_ASSET_REFERENCE/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects manifest asset paths that escape the repository", () => {
  const root = fixture();
  try {
    const manifestPath = path.join(root, "mobile/factory/products/midad-human-bridge.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.web_assets = ["../../outside.js"];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => prepareProductWebSurface({ repoRoot: root, productKey: "midad-human-bridge" }),
      /WEB_ASSET_PATH_OUTSIDE_REPOSITORY/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
