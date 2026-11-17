import test from "node:test";
import assert from "node:assert/strict";
import {
  detectBrowserFamily,
  createBrowserConnector,
  buildPermissionPlan,
  validateExtractionRequest,
  sanitizeExtractionRecord,
  validatePluginManifest,
} from "./multi-browser-bridge.mjs";

test("detects Chrome, Edge and Firefox without confusing Edge for Chrome", () => {
  assert.equal(detectBrowserFamily({ userAgent: "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36" }), "chrome");
  assert.equal(detectBrowserFamily({ userAgent: "Mozilla/5.0 Chrome/130.0.0.0 Edg/130.0.0.0" }), "edge");
  assert.equal(detectBrowserFamily({ userAgent: "Mozilla/5.0 Firefox/132.0" }), "firefox");
  assert.equal(detectBrowserFamily({ userAgent: "MIDAD-WebView/1.0" }), "unsupported");
});

test("exposes a truthful cross-browser connector descriptor", () => {
  assert.deepEqual(createBrowserConnector("chrome").supportedSources,
    ["active_tab", "tabs", "bookmarks", "history", "downloads"]);
  assert.equal(createBrowserConnector("edge").engine, "chromium");
  assert.equal(createBrowserConnector("firefox").engine, "gecko");
  assert.equal(createBrowserConnector("unknown"), null);
});

test("requests broad browser data access as optional, user-granted permissions", () => {
  const plan = buildPermissionPlan({
    tabs: true, bookmarks: true, history: true, downloads: true, allHttpsHosts: true,
  });
  assert.deepEqual(plan.requiredPermissions, ["activeTab", "scripting", "storage"]);
  assert.deepEqual(plan.optionalPermissions, ["tabs", "bookmarks", "history", "downloads"]);
  assert.deepEqual(plan.optionalHostPermissions, ["https://*/*"]);
  assert.equal(plan.neverRequest.includes("cookies"), true);
  assert.equal(plan.neverRequest.includes("browsingData"), true);
});

test("accepts a user-invoked active-tab extraction within the granted origin", () => {
  const result = validateExtractionRequest({
    source: "active_tab",
    tabId: 4,
    origin: "https://example.com",
    fields: ["title", "url", "text", "headings", "links", "metadata"],
    destination: "local",
  }, {
    userInitiated: true,
    activeTab: { id: 4, origin: "https://example.com", isPrivate: false },
    grantedPermissions: ["activeTab"],
    grantedOrigins: ["https://example.com"],
  });
  assert.equal(result.ok, true);
});

test("rejects extraction from a different tab or ungranted origin", () => {
  const request = {
    source: "active_tab", tabId: 5, origin: "https://example.com",
    fields: ["title", "text"], destination: "local",
  };
  const result = validateExtractionRequest(request, {
    userInitiated: true,
    activeTab: { id: 4, origin: "https://example.com", isPrivate: false },
    grantedPermissions: ["activeTab"],
    grantedOrigins: ["https://example.com"],
  });
  assert.equal(result.error, "active_tab_mismatch");
});

test("requires explicit optional grants for history, bookmarks and downloads", () => {
  for (const source of ["history", "bookmarks", "downloads", "tabs"]) {
    const result = validateExtractionRequest({
      source, fields: ["title", "url"], destination: "local",
    }, { grantedPermissions: ["activeTab"] });
    assert.equal(result.error, "permission_not_granted");
  }
});

test("blocks private browsing and credential-bearing extraction fields", () => {
  const privateResult = validateExtractionRequest({
    source: "active_tab", tabId: 1, origin: "https://example.com",
    fields: ["title", "text"], destination: "local",
  }, {
    userInitiated: true,
    activeTab: { id: 1, origin: "https://example.com", isPrivate: true },
    grantedPermissions: ["activeTab"],
    grantedOrigins: ["https://example.com"],
  });
  assert.equal(privateResult.error, "private_context_blocked");

  const secretResult = validateExtractionRequest({
    source: "active_tab", tabId: 1, origin: "https://example.com",
    fields: ["title", "cookies", "passwords"], destination: "local",
  }, {
    userInitiated: true,
    activeTab: { id: 1, origin: "https://example.com", isPrivate: false },
    grantedPermissions: ["activeTab"],
    grantedOrigins: ["https://example.com"],
  });
  assert.equal(secretResult.error, "field_not_allowed");
});

test("requires a paired gateway and explicit share approval for remote export", () => {
  const request = {
    source: "bookmarks", fields: ["title", "url"], destination: "paired_gateway",
  };
  assert.equal(validateExtractionRequest(request, {
    grantedPermissions: ["bookmarks"], paired: false, shareApproved: false,
  }).error, "remote_export_not_authorized");
  assert.equal(validateExtractionRequest(request, {
    grantedPermissions: ["bookmarks"], paired: true, shareApproved: true,
  }).ok, true);
});

test("sanitizes extracted records and strips URL query strings and secret-shaped fields", () => {
  const safe = sanitizeExtractionRecord({
    title: "Example",
    url: "https://example.com/page?token=secret&campaign=summer#section",
    text: "Public article text",
    links: [{ text: "Next", url: "https://example.com/next?session=secret" }],
    password: "do-not-export",
    cookies: ["cookie-secret"],
    authorization: "Bearer secret",
  });
  assert.equal(safe.url, "https://example.com/page");
  assert.equal(safe.links[0].url, "https://example.com/next");
  assert.equal(safe.password, undefined);
  assert.equal(safe.cookies, undefined);
  assert.equal(safe.authorization, undefined);
  assert.equal(safe.text, "Public article text");
});

test("accepts a least-privilege plugin manifest and rejects wildcard or secret capabilities", () => {
  const valid = {
    id: "com.midad.reader",
    name: "MIDAD Reader",
    version: "1.0.0",
    entrypoint: "plugin.js",
    capabilities: ["page.read", "tabs.read"],
    hostOrigins: ["https://example.com"],
  };
  assert.equal(validatePluginManifest(valid).ok, true);
  assert.equal(validatePluginManifest({ ...valid, hostOrigins: ["<all_urls>"] }).error, "plugin_origin_invalid");
  assert.equal(validatePluginManifest({ ...valid, capabilities: ["cookies.read"] }).error, "plugin_capability_invalid");
  assert.equal(validatePluginManifest({ ...valid, entrypoint: "https://cdn.example/plugin.js" }).error, "plugin_entrypoint_invalid");
});
