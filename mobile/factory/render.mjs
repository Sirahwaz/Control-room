#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const productKey = process.argv[2] || process.env.MIDAD_PRODUCT || "midad-mobile";
const safeKey = /^[a-z0-9][a-z0-9-]{1,48}$/.test(productKey);
if (!safeKey) throw new Error(`Invalid product key: ${productKey}`);

const manifestPath = path.join(root, "mobile", "factory", "products", `${productKey}.json`);
if (!fs.existsSync(manifestPath)) throw new Error(`Product manifest not found: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const required = [
  "schema_version", "product_key", "display_name", "version",
  "app_id", "artifact_name", "web_entry", "product_mode",
  "release_channel", "features", "surfaces"
];
for (const key of required) {
  if (manifest[key] === undefined || manifest[key] === null || manifest[key] === "") {
    throw new Error(`Missing required manifest field: ${key}`);
  }
}
if (manifest.schema_version !== 1) throw new Error("Unsupported manifest schema_version");
if (manifest.product_key !== productKey) throw new Error("product_key does not match requested product");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Invalid semantic version");
if (!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(manifest.app_id)) throw new Error("Invalid Android application id");
if (!/^([A-Za-z0-9][A-Za-z0-9._-]{2,100})$/.test(manifest.artifact_name)) throw new Error("Invalid artifact_name");
if (manifest.features?.server_side_secrets_only !== true) {
  throw new Error("Factory security gate: server_side_secrets_only must be true");
}

const webEntry = path.join(root, manifest.web_entry);
if (!fs.existsSync(webEntry)) throw new Error(`Configured web_entry not found: ${manifest.web_entry}`);

const config = {
  appName: manifest.display_name,
  webDir: "www"
};

fs.writeFileSync(
  path.join(root, "mobile", "capacitor.config.json"),
  JSON.stringify(config, null, 2) + "\n"
);

const out = path.join(root, "mobile", "factory", "runtime-product.json");
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");

console.log(JSON.stringify({
  product_key: manifest.product_key,
  display_name: manifest.display_name,
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Invalid semantic version");
if (!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(manifest.app_id)) throw new Error("Invalid Android application id");
  artifact_name: manifest.artifact_name,
  release_channel: manifest.release_channel
}));
