#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../../..");
const productKey = process.argv[2] || "midad-mobile";
if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(productKey)) throw new Error("Invalid product key");

const manifestPath = path.join(root, "mobile", "factory", "products", `${productKey}.json`);
if (!fs.existsSync(manifestPath)) throw new Error(`Factory product not found: ${productKey}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.product_key !== productKey) throw new Error("Product manifest key mismatch");

function safeRepoPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid repository-relative path: ${relativePath}`);
  }
  const absolute = path.resolve(root, relativePath);
  const rel = path.relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`Preview file missing: ${relativePath}`);
  }
  return absolute;
}

const entryPath = safeRepoPath(manifest.web_entry);
const webRoot = path.join(root, "mobile", "web");
const webRelative = path.relative(webRoot, entryPath);
if (webRelative === ".." || webRelative.startsWith(`..${path.sep}`) || path.isAbsolute(webRelative)) {
  throw new Error("Product web_entry must remain within mobile/web");
}

const previewRoot = path.join(root, "tools", "agentation", "e2e", "public", "product-preview");
fs.rmSync(previewRoot, { recursive: true, force: true });
fs.mkdirSync(previewRoot, { recursive: true });
const copied = new Map();

function copyUnique(sourcePath, filename, sourceLabel) {
  const targetPath = path.join(previewRoot, filename);
  if (copied.has(filename)) {
    const existingPath = targetPath;
    const incoming = fs.readFileSync(sourcePath);
    const existing = fs.readFileSync(existingPath);
    if (incoming.compare(existing) !== 0) throw new Error(`Ambiguous preview asset name: ${filename} (${copied.get(filename)} vs ${sourceLabel})`);
    return;
  }
  fs.copyFileSync(sourcePath, targetPath);
  copied.set(filename, sourceLabel);
}

// Match the Mobile Factory's flattened WebView build layout. Copy the direct
// mobile web assets first, but do not replace the selected app's index.html.
for (const entry of fs.readdirSync(webRoot, { withFileTypes: true })) {
  if (!entry.isFile() || entry.name === "index.html" || !/\.(css|js|svg|webmanifest|json|png|jpe?g|webp|ico)$/i.test(entry.name)) continue;
  const source = path.join(webRoot, entry.name);
  copyUnique(source, entry.name, `mobile/web/${entry.name}`);
}
for (const assetPath of (Array.isArray(manifest.web_assets) ? manifest.web_assets : [])) {
  const source = safeRepoPath(assetPath);
  copyUnique(source, path.basename(source), assetPath);
}
fs.copyFileSync(entryPath, path.join(previewRoot, "index.html"));
copied.set("index.html", manifest.web_entry);

// The Android build exposes root website surfaces at ./site/.
const siteRoot = path.join(previewRoot, "site");
fs.mkdirSync(siteRoot, { recursive: true });
let siteFiles = 0;
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(html|css|js|svg|webmanifest|png|jpe?g|webp|ico)$/i.test(entry.name)) continue;
  fs.copyFileSync(path.join(root, entry.name), path.join(siteRoot, entry.name));
  siteFiles++;
}

const previewManifest = {
  product_key: productKey,
  display_name: manifest.display_name,
  version: manifest.version,
  source_web_entry: manifest.web_entry,
  preview_url: "/product-preview/index.html",
  preview_only: true,
  release_apk_includes_agentation: false
};
fs.writeFileSync(path.join(previewRoot, "preview-manifest.json"), JSON.stringify(previewManifest, null, 2) + "\n");
console.log(JSON.stringify({
  ok: true,
  product_key: productKey,
  source_web_entry: manifest.web_entry,
  preview_url: previewManifest.preview_url,
  copied_assets: copied.size - 1,
  root_site_assets_copied: siteFiles,
  output: path.relative(root, previewRoot)
}));
