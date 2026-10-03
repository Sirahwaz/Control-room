#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [productKey, displayName, appId, version = "0.1.0"] = process.argv.slice(2);
if (!productKey || !displayName || !appId) {
  console.error("Usage: node mobile/factory/create-product.mjs <product-key> <display-name> <app-id> [version]");
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(productKey)) throw new Error("Invalid product-key");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid version");
if (!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(appId)) throw new Error("Invalid app-id");

const safeName = displayName.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
const manifest = {
  $schema: "../product.schema.json",
  schema_version: 1,
  product_key: productKey,
  display_name: displayName,
  version,
  app_id: appId,
  artifact_name: `${safeName || productKey}-v${version}`,
  web_entry: "mobile/web/index.html",
  product_mode: "midad-powered",
  release_channel: "debug",
  features: {
    rtl_first: true,
    local_first: true,
    native_haptics: true,
    native_back_navigation: true,
    in_app_browser: true,
    server_side_secrets_only: true,
    live_financial_execution: false,
    mission_capsules: true,
    hybrid_neural_planner: true
  },
  surfaces: []
};

const outDir = path.join(process.cwd(), "mobile", "factory", "products");
fs.mkdirSync(outDir, {recursive:true});
const out = path.join(outDir, `${productKey}.json`);
if (fs.existsSync(out)) throw new Error(`Product already exists: ${out}`);
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(out);
