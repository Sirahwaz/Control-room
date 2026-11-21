import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../../", import.meta.url);
const java = await readFile(new URL("./BrowserAgentBridge.java", import.meta.url), "utf8");
const activity = await readFile(new URL("./BrowserActivity.java", import.meta.url), "utf8");
const prepare = await readFile(new URL("./prepare_android.py", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../../products/midad-browser.json", import.meta.url), "utf8"));
const html = await readFile(new URL("../../../web/midad-browser-mesh.html", import.meta.url), "utf8");

test("native bridge is bound only to the packaged HTTPS app origin and top-level frame", () => {
  assert.match(java, /APP_ORIGIN\s*=\s*"https:\/\/appassets\.androidplatform\.net"/);
  assert.match(java, /Collections\.singleton\(APP_ORIGIN\)/);
  assert.match(java, /!isMainFrame\s*\|\|\s*!APP_ORIGIN\.equals\(sourceOrigin\.toString\(\)\)/);
  assert.match(activity, /agentBridge\.attach\(target\)/);
  assert.doesNotMatch(java, /addJavascriptInterface/);
});

test("native bridge exposes typed bounded commands and no arbitrary script endpoint", () => {
  assert.match(java, /COMMAND_TYPES/);
  assert.match(java, /MAX_MESSAGE_CHARS/);
  assert.match(java, /MAX_TABS\s*=\s*8/);
  assert.match(java, /origin_scope_mismatch/);
  assert.match(java, /navigation_origin_not_allowed/);
  assert.match(java, /MIDAD_BROWSER", "AGENT_BRIDGE_ATTACHED/);
  assert.doesNotMatch(java, /command\.optString\(["']script["']/);
});

test("page mutations require an Android one-time human confirmation", () => {
  assert.match(java, /requireHumanApproval\(/);
  assert.match(java, /setPositiveButton\("السماح مرة واحدة"/);
  assert.match(java, /setNegativeButton\("رفض"/);
  assert.match(java, /e\.type==='password'\|\|e\.type==='hidden'/);
  assert.match(java, /ALLOWED_KEYS/);
});

test("tab discovery strips query strings and fragments before returning URLs", () => {
  assert.match(java, /clearQuery\(\)\.fragment\(null\)/);
});

test("Android preparation copies the native bridge into the generated Java source set", () => {
  assert.match(prepare, /BRIDGE_SRC\s*=\s*Path\(__file__\)\.with_name\("BrowserAgentBridge\.java"\)/);
  assert.match(prepare, /shutil\.copy2\(BRIDGE_SRC, BRIDGE_DST\)/);
});

test("the offline app package includes the agent runtime, bridge and control module", () => {
  const names = manifest.web_assets.map((path) => path.split("/").pop());
  for (const name of [
    "agent-runtime.mjs", "browser-command-contract.mjs",
    "native-agent-bridge.mjs", "native-agent-runtime.mjs",
    "native-agent-runtime-ui.mjs",
  ]) assert.ok(names.includes(name), name + " missing from product web assets");
  assert.match(html, /native-agent-runtime-ui\.mjs/);
  assert.match(html, /nativeAgentInspect/);
});
