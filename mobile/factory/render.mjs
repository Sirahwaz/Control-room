#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const productKey = process.argv[2] || process.env.MIDAD_PRODUCT || "midad-mobile";
if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(productKey)) {
  throw new Error(`Invalid product key: ${productKey}`);
}

const manifestPath = path.join(root, "mobile", "factory", "products", `${productKey}.json`);
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Product manifest not found: ${manifestPath}`);
}
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
if (typeof manifest.features?.mission_capsules !== "boolean") {
  throw new Error("mission_capsules feature flag must be boolean");
}
if (typeof manifest.features?.hybrid_neural_planner !== "boolean") {
  throw new Error("hybrid_neural_planner feature flag must be boolean");
}

const factoryConfigPath = path.join(root, "mobile", "factory", "factory.config.json");
if (!fs.existsSync(factoryConfigPath)) throw new Error(`Factory configuration missing: ${factoryConfigPath}`);
const factoryConfig = JSON.parse(fs.readFileSync(factoryConfigPath, "utf8"));

if (manifest.factory) {
  if (manifest.factory.request_driven_ui !== true) {
    throw new Error("Factory UX gate: request_driven_ui must be true for dynamic products");
  }
  if (manifest.factory.dynamic_content !== true) {
    throw new Error("Factory content gate: dynamic_content must be true for request-driven products");
  }
  if (manifest.factory.learning?.enabled !== true) {
    throw new Error("Factory learning gate: learning.enabled must be true");
  }
  if (manifest.factory.quality?.fail_closed_on_security_gate !== true) {
    throw new Error("Factory security gate: fail_closed_on_security_gate must be true");
  }
}

const webEntry = path.join(root, manifest.web_entry);
if (!fs.existsSync(webEntry)) {
  throw new Error(`Configured web_entry not found: ${manifest.web_entry}`);
}

const config = {
  appId: manifest.app_id,
  appName: manifest.display_name,
  webDir: "www"
};

fs.writeFileSync(
  path.join(root, "mobile", "capacitor.config.json"),
  JSON.stringify(config, null, 2) + "\n"
);

const out = path.join(root, "mobile", "factory", "runtime-product.json");
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");

const runtimeFactory = {
  factory_version: factoryConfig.factory_version,
  engine: factoryConfig.engine,
  product_key: manifest.product_key,
  product_version: manifest.version,
  pipeline: factoryConfig.default_pipeline,
  quality: {
    ...factoryConfig.quality,
    product_overrides: manifest.factory?.quality || {}
  },
  learning: {
    ...factoryConfig.learning,
    product_overrides: manifest.factory?.learning || {}
  },
  data: {
    ...factoryConfig.data,
    product_overrides: manifest.factory?.data || {}
  },
  ui_generation: {
    ...factoryConfig.ui_generation,
    product_overrides: {
      request_driven_ui: manifest.factory?.request_driven_ui ?? false,
      dynamic_content: manifest.factory?.dynamic_content ?? false,
      localization: manifest.factory?.localization || {}
    }
  },
  delivery: {
    ...factoryConfig.delivery,
    product_overrides: manifest.factory?.delivery || {}
  }
};

fs.writeFileSync(
  path.join(root, "mobile", "factory", "runtime-factory.json"),
  JSON.stringify(runtimeFactory, null, 2) + "\n"
);

const summary = {
  product_key: manifest.product_key,
  display_name: manifest.display_name,
  version: manifest.version,
  app_id: manifest.app_id,
  artifact_name: manifest.artifact_name,
  release_channel: manifest.release_channel,
  mission_capsules: manifest.features.mission_capsules,
  hybrid_neural_planner: manifest.features.hybrid_neural_planner,
  adaptive_learning: manifest.factory?.learning?.enabled === true,
  request_driven_ui: manifest.factory?.request_driven_ui === true,
  dynamic_content: manifest.factory?.dynamic_content === true
};
console.log(JSON.stringify(summary));
