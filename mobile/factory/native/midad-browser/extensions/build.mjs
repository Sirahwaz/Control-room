import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(process.argv[2] || path.join(process.cwd(), "dist/midad-browser-extensions"));
const sharedFiles = ["background.js", "popup.html", "popup.js", "popup.css"];
const targets = ["chrome", "edge", "firefox"];

await mkdir(output, { recursive: true });
for (const target of targets) {
  const manifestPath = path.join(root, target, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.manifest_version !== 3) throw new Error(target + ": manifest_v3_required");
  if (!["activeTab", "scripting", "storage"].every((permission) => manifest.permissions.includes(permission))) {
    throw new Error(target + ": required_permission_missing");
  }
  if (manifest.permissions.some((permission) => ["cookies", "browsingData", "debugger", "nativeMessaging", "webRequest"].includes(permission))) {
    throw new Error(target + ": forbidden_permission_requested");
  }
  const destination = path.join(output, target);
  await mkdir(destination, { recursive: true });
  for (const file of sharedFiles) await cp(path.join(root, "shared", file), path.join(destination, file));
  await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  process.stdout.write("MIDAD_EXTENSION_PACKAGE_READY " + target + "\n");
}
