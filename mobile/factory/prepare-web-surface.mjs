#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveInside(root, relativePath, errorCode) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error(errorCode);
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(errorCode);
  }
  return resolved;
}

function referencedLocalAssets(html) {
  const refs = [];
  const pattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const value = match[1].trim();
    if (!value || value.startsWith("#") || /^(?:https?:|data:|mailto:|tel:|javascript:)/i.test(value)) continue;
    const clean = value.split(/[?#]/, 1)[0];
    if (clean) refs.push(clean);
  }
  return [...new Set(refs)];
}

export function prepareProductWebSurface({ repoRoot, productKey, outputDir } = {}) {
  if (!repoRoot || !productKey || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(productKey)) {
    throw new Error("INVALID_PRODUCT_WEB_SURFACE_INPUT");
  }
  const root = path.resolve(repoRoot);
  const manifestPath = path.join(root, "mobile", "factory", "products", productKey + ".json");
  if (!fs.existsSync(manifestPath)) throw new Error("PRODUCT_MANIFEST_NOT_FOUND");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.product_key !== productKey) throw new Error("PRODUCT_KEY_MISMATCH");
  if (!Array.isArray(manifest.web_assets)) throw new Error("WEB_ASSETS_MUST_BE_DECLARED");

  const entryPath = resolveInside(root, manifest.web_entry, "WEB_ENTRY_PATH_OUTSIDE_REPOSITORY");
  if (!fs.isFileSync?.(entryPath) && !fs.existsSync(entryPath)) throw new Error("WEB_ENTRY_NOT_FOUND");
  const entryHtml = fs.readFileSync(entryPath, "utf8");
  const assets = manifest.web_assets.map((asset) => {
    const source = resolveInside(root, asset, "WEB_ASSET_PATH_OUTSIDE_REPOSITORY");
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("WEB_ASSET_NOT_FOUND:" + asset);
    const name = path.basename(source);
    if (name === "index.html") throw new Error("WEB_ASSET_NAME_RESERVED");
    return { source, name };
  });
  const names = assets.map((asset) => asset.name);
  if (new Set(names).size !== names.length) throw new Error("DUPLICATE_WEB_ASSET_BASENAME");

  const destination = outputDir ? path.resolve(outputDir) : path.join(root, "mobile", "www");
  const destinationRelative = path.relative(root, destination);
  if (!destinationRelative || destinationRelative.startsWith("..") || path.isAbsolute(destinationRelative)) {
    throw new Error("WEB_OUTPUT_PATH_OUTSIDE_REPOSITORY");
  }

  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(entryPath, path.join(destination, "index.html"));
  for (const asset of assets) fs.copyFileSync(asset.source, path.join(destination, asset.name));

  for (const ref of referencedLocalAssets(entryHtml)) {
    const resolved = path.resolve(destination, ref.replace(/^\//, ""));
    const relative = path.relative(destination, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
      throw new Error("UNDECLARED_LOCAL_ASSET_REFERENCE:" + ref);
    }
  }

  const files = fs.readdirSync(destination).sort();
  return { productKey, outputDir: destination, files };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const productKey = process.argv[2];
  const result = prepareProductWebSurface({ repoRoot: process.cwd(), productKey });
  console.log(JSON.stringify(result));
}
