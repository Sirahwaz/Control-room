const CONNECTORS = Object.freeze({
  chrome: Object.freeze({
    family: "chrome", engine: "chromium", manifestVersion: 3,
    apiNamespace: "browser", packageTarget: "chrome",
    supportedSources: ["active_tab", "tabs", "bookmarks", "history", "downloads"],
  }),
  edge: Object.freeze({
    family: "edge", engine: "chromium", manifestVersion: 3,
    apiNamespace: "browser", packageTarget: "edge",
    supportedSources: ["active_tab", "tabs", "bookmarks", "history", "downloads"],
  }),
  firefox: Object.freeze({
    family: "firefox", engine: "gecko", manifestVersion: 3,
    apiNamespace: "browser", packageTarget: "firefox",
    supportedSources: ["active_tab", "tabs", "bookmarks", "history", "downloads"],
  }),
});

const SOURCE_PERMISSIONS = Object.freeze({
  active_tab: "activeTab",
  tabs: "tabs",
  bookmarks: "bookmarks",
  history: "history",
  downloads: "downloads",
});

const SOURCE_FIELDS = Object.freeze({
  active_tab: new Set(["title", "url", "text", "headings", "links", "metadata"]),
  tabs: new Set(["id", "title", "url", "favIconUrl", "active", "windowId"]),
  bookmarks: new Set(["title", "url", "folderPath", "dateAdded"]),
  history: new Set(["title", "url", "lastVisitTime", "visitCount"]),
  downloads: new Set(["filename", "url", "startedAt", "state", "bytesReceived", "totalBytes"]),
});

const PLUGIN_CAPABILITIES = new Set([
  "page.read", "tabs.read", "tabs.manage", "bookmarks.read", "history.read",
  "downloads.read", "page.interact", "evidence.capture", "export.local",
  "export.paired_gateway",
]);

const SECRET_FIELD = /(pass(word|phrase)?|cookie|token|authorization|authheader|secret|otp|mfa|recovery(code)?|privatekey|credential|localstorage|indexeddb|form(value|data)|session(storage)?)/i;

function fail(error) {
  return { ok: false, error };
}

function parseOrigin(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function detectBrowserFamily(input = {}) {
  const explicit = typeof input.browserName === "string" ? input.browserName.toLowerCase() : "";
  if (explicit === "edge" || explicit === "microsoft edge") return "edge";
  if (explicit === "firefox" || explicit === "mozilla firefox") return "firefox";
  if (explicit === "chrome" || explicit === "google chrome") return "chrome";

  const ua = typeof input.userAgent === "string" ? input.userAgent : "";
  if (/(EdgA|EdgiOS|Edg)\//i.test(ua)) return "edge";
  if (/Firefox\//i.test(ua)) return "firefox";
  if (/Chrome\//i.test(ua) && !/(Edg|OPR|SamsungBrowser)\//i.test(ua)) return "chrome";
  return "unsupported";
}

export function createBrowserConnector(family) {
  const connector = CONNECTORS[family];
  return connector ? Object.freeze({ ...connector }) : null;
}

export function buildPermissionPlan(requested = {}) {
  const optionalPermissions = [];
  for (const key of ["tabs", "bookmarks", "history", "downloads"]) {
    if (requested[key] === true) optionalPermissions.push(key);
  }
  return Object.freeze({
    requiredPermissions: Object.freeze(["activeTab", "scripting", "storage"]),
    optionalPermissions: Object.freeze(optionalPermissions),
    optionalHostPermissions: Object.freeze(requested.allHttpsHosts === true ? ["https://*/*"] : []),
    neverRequest: Object.freeze([
      "cookies", "browsingData", "debugger", "nativeMessaging", "webRequest",
    ]),
  });
}

export function validateExtractionRequest(request, context = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return fail("request_invalid");
  if (!Object.hasOwn(SOURCE_FIELDS, request.source)) return fail("source_unsupported");
  if (context.isPrivate === true || context.activeTab?.isPrivate === true) {
    return fail("private_context_blocked");
  }

  const fields = Array.isArray(request.fields) ? request.fields : [];
  if (fields.length === 0 || fields.length > 20) return fail("fields_invalid");
  const allowedFields = SOURCE_FIELDS[request.source];
  if (fields.some((field) => typeof field !== "string" || !allowedFields.has(field))) {
    return fail("field_not_allowed");
  }

  const permission = SOURCE_PERMISSIONS[request.source];
  const grants = Array.isArray(context.grantedPermissions) ? context.grantedPermissions : [];
  if (!grants.includes(permission)) return fail("permission_not_granted");

  if (request.source === "active_tab") {
    if (context.userInitiated !== true) return fail("user_gesture_required");
    if (!Number.isInteger(request.tabId) || request.tabId < 0 ||
        !context.activeTab || request.tabId !== context.activeTab.id) {
      return fail("active_tab_mismatch");
    }
    const requestedOrigin = parseOrigin(request.origin);
    const activeOrigin = parseOrigin(context.activeTab.origin);
    if (!requestedOrigin || requestedOrigin !== activeOrigin) return fail("active_tab_origin_mismatch");
    const grantedOrigins = Array.isArray(context.grantedOrigins) ? context.grantedOrigins : [];
    if (!grantedOrigins.map(parseOrigin).includes(requestedOrigin)) {
      return fail("host_origin_not_granted");
    }
  }

  if (request.maxItems !== undefined &&
      (!Number.isInteger(request.maxItems) || request.maxItems < 1 || request.maxItems > 500)) {
    return fail("item_limit_invalid");
  }

  const destination = request.destination ?? "local";
  if (!["local", "paired_gateway"].includes(destination)) return fail("destination_invalid");
  if (destination === "paired_gateway" &&
      (context.paired !== true || context.shareApproved !== true)) {
    return fail("remote_export_not_authorized");
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      source: request.source,
      fields: Object.freeze([...fields]),
      destination,
      maxItems: request.maxItems ?? 100,
      tabId: request.source === "active_tab" ? request.tabId : undefined,
      origin: request.source === "active_tab" ? parseOrigin(request.origin) : undefined,
    }),
    permission,
  });
}

function sanitizeUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeValue(value, depth = 0, key = "") {
  if (SECRET_FIELD.test(key)) return undefined;
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    if (/^(url|href|sourceUrl|downloadUrl)$/i.test(key)) return sanitizeUrl(value) ?? undefined;
    return value.slice(0, 20000);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
      const safe = sanitizeValue(childValue, depth + 1, childKey);
      if (safe !== undefined) out[childKey] = safe;
    }
    return out;
  }
  return undefined;
}

export function sanitizeExtractionRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  return sanitizeValue(record) ?? null;
}

export function validatePluginManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return fail("plugin_manifest_invalid");
  const allowedKeys = new Set(["id", "name", "version", "entrypoint", "capabilities", "hostOrigins"]);
  if (Object.keys(manifest).some((key) => !allowedKeys.has(key))) return fail("plugin_manifest_unknown_field");
  if (typeof manifest.id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(manifest.id)) {
    return fail("plugin_id_invalid");
  }
  if (typeof manifest.name !== "string" || manifest.name.trim().length < 1 || manifest.name.length > 80) {
    return fail("plugin_name_invalid");
  }
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    return fail("plugin_version_invalid");
  }
  if (typeof manifest.entrypoint !== "string" || manifest.entrypoint.length > 128 ||
      manifest.entrypoint.startsWith("/") || manifest.entrypoint.includes("..") ||
      /^[a-z]+:\/\//i.test(manifest.entrypoint) || !/^[A-Za-z0-9._/-]+\.js$/.test(manifest.entrypoint)) {
    return fail("plugin_entrypoint_invalid");
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0 ||
      manifest.capabilities.some((capability) => !PLUGIN_CAPABILITIES.has(capability))) {
    return fail("plugin_capability_invalid");
  }
  if (!Array.isArray(manifest.hostOrigins) ||
      manifest.hostOrigins.some((origin) => {
        if (typeof origin !== "string" || origin.includes("*")) return true;
        try {
          const url = new URL(origin);
          return url.protocol !== "https:" || url.origin !== origin || !!url.username || !!url.password;
        } catch { return true; }
      })) {
    return fail("plugin_origin_invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      id: manifest.id,
      name: manifest.name.trim(),
      version: manifest.version,
      entrypoint: manifest.entrypoint,
      capabilities: Object.freeze([...new Set(manifest.capabilities)]),
      hostOrigins: Object.freeze([...new Set(manifest.hostOrigins)]),
    }),
  });
}
