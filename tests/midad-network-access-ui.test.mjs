import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "midad-network-access.html"), "utf8");
const css = fs.readFileSync(path.join(root, "midad-network-access.css"), "utf8");
const js = fs.readFileSync(path.join(root, "midad-network-access.js"), "utf8");

test("Control Room network access panel exposes all administration workspaces", () => {
  for (const section of ["overview", "proxy-profiles", "routing-rules", "vault", "diagnostics"]) {
    assert.ok(html.includes(`data-panel="${section}"`), `missing panel: ${section}`);
  }
  assert.match(html, /MIDAD Network Access/);
  assert.match(html, /BLOCK by default/i);
});

test("panel never suggests that an unconnected backend or route is live", () => {
  assert.match(html, /BACKEND NOT CONNECTED/);
  assert.match(html, /PENDING/);
  assert.match(html, /No changes can be applied yet/);
  assert.match(html, /disabled/);
});

test("browser UI contains no credential entry or persistence surface", () => {
  assert.doesNotMatch(html, /type=["']password["']/i);
  assert.doesNotMatch(html, /name=["'](?:secret|token|api[_-]?key|password)["']/i);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
  assert.doesNotMatch(js, /password|private[_-]?key|secret[_-]?value/i);
});

test("panel is RTL, responsive and supports keyboard-operable navigation", () => {
  assert.match(html, /dir=["']rtl["']/i);
  assert.match(css, /@media/);
  assert.match(html, /aria-controls/);
  assert.match(js, /addEventListener\(["']click["']/);
});
