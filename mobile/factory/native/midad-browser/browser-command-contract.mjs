const COMMAND_CAPABILITY = Object.freeze({
  navigate: "browser.navigate",
  getTabs: "browser.inspect",
  switchTab: "browser.inspect",
  getDomSnapshot: "browser.inspect",
  captureScreenshot: "browser.inspect",
  click: "browser.click",
  type: "browser.fill",
  select: "browser.fill",
  scroll: "browser.inspect",
  pressKey: "browser.click",
  waitFor: "browser.wait",
});

const MUTATING_COMMANDS = new Set(["click", "type", "select", "pressKey"]);
const COMMON_FIELDS = ["id", "type", "tabId", "origin", "approvalId"];
const COMMAND_FIELDS = Object.freeze({
  navigate: ["url"],
  getTabs: [],
  switchTab: ["targetTabId"],
  getDomSnapshot: ["maxChars"],
  captureScreenshot: [],
  click: ["selector"],
  type: ["selector", "text"],
  select: ["selector", "value"],
  scroll: ["x", "y"],
  pressKey: ["key"],
  waitFor: ["selector", "timeoutMs"],
});

function fail(error) {
  return { ok: false, error };
}

function parseHttpsOrigin(value) {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.origin !== value.replace(/\/$/, "")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function validSelector(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 512 && !/[\u0000-\u001f]/.test(value);
}

export function classifyBrowserCommand(type) {
  if (!Object.hasOwn(COMMAND_CAPABILITY, type)) {
    return { capability: null, requiresApproval: false };
  }
  return {
    capability: COMMAND_CAPABILITY[type],
    requiresApproval: MUTATING_COMMANDS.has(type),
  };
}

/**
 * Validate a typed browser command at the native/agent boundary.
 * Page content is never accepted as executable code; arbitrary JS is not a command.
 */
export function validateBrowserCommand(command, context) {
  if (!command || typeof command !== "object" || Array.isArray(command) ||
      !context || typeof context !== "object") return fail("command_invalid");
  if (typeof command.type !== "string" || !Object.hasOwn(COMMAND_CAPABILITY, command.type)) {
    return fail("command_unsupported");
  }

  const allowedFields = new Set([...COMMON_FIELDS, ...COMMAND_FIELDS[command.type]]);
  if (Object.keys(command).some((key) => !allowedFields.has(key))) return fail("command_unknown_field");
  if (typeof command.id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(command.id)) return fail("command_id_invalid");
  if (!Number.isInteger(command.tabId) || command.tabId < 0 || command.tabId > 7) return fail("tab_id_invalid");

  const currentOrigin = parseHttpsOrigin(context.currentOrigin);
  const commandOrigin = parseHttpsOrigin(command.origin);
  if (!currentOrigin || !commandOrigin || commandOrigin !== currentOrigin) return fail("origin_scope_mismatch");

  const allowedOrigins = Array.isArray(context.allowedOrigins) ? context.allowedOrigins : [];
  const normalizedAllowed = allowedOrigins.map(parseHttpsOrigin);
  if (!normalizedAllowed.includes(currentOrigin)) return fail("origin_not_allowed");

  const capability = COMMAND_CAPABILITY[command.type];
  if (!Array.isArray(context.capabilities) || !context.capabilities.includes(capability)) {
    return fail("capability_not_granted");
  }

  if (command.type === "navigate") {
    if (typeof command.url !== "string" || command.url.length > 2048) return fail("navigation_url_invalid");
    let target;
    try { target = new URL(command.url); } catch { return fail("navigation_url_invalid"); }
    if (target.protocol !== "https:" || target.username || target.password ||
        !normalizedAllowed.includes(target.origin)) return fail("navigation_origin_not_allowed");
  }

  if (["click", "type", "select", "waitFor"].includes(command.type) && !validSelector(command.selector)) {
    return fail("selector_invalid");
  }
  if (command.type === "type" &&
      (typeof command.text !== "string" || command.text.length > 4000)) return fail("text_input_invalid");
  if (command.type === "select" &&
      (typeof command.value !== "string" || command.value.length > 1000)) return fail("select_value_invalid");
  if (command.type === "waitFor" &&
      (!Number.isInteger(command.timeoutMs) || command.timeoutMs < 100 || command.timeoutMs > 30000)) {
    return fail("wait_timeout_invalid");
  }
  if (command.type === "switchTab" &&
      (!Number.isInteger(command.targetTabId) || command.targetTabId < 0 || command.targetTabId > 7)) {
    return fail("target_tab_invalid");
  }
  if (command.type === "getDomSnapshot" &&
      command.maxChars !== undefined &&
      (!Number.isInteger(command.maxChars) || command.maxChars < 1 || command.maxChars > 50000)) {
    return fail("snapshot_limit_invalid");
  }
  if (command.type === "scroll" &&
      (![command.x, command.y].every((n) => Number.isInteger(n) && Math.abs(n) <= 10000))) {
    return fail("scroll_delta_invalid");
  }
  if (command.type === "pressKey" &&
      !["ENTER", "TAB", "ESCAPE", "ARROW_UP", "ARROW_DOWN", "ARROW_LEFT", "ARROW_RIGHT", "SPACE"].includes(command.key)) {
    return fail("key_not_allowed");
  }

  if (MUTATING_COMMANDS.has(command.type)) {
    const approvals = Array.isArray(context.approvedActionIds) ? context.approvedActionIds : [];
    if (typeof command.approvalId !== "string" || !approvals.includes(command.approvalId)) {
      return fail("human_approval_required");
    }
  } else if (command.approvalId !== undefined) {
    return fail("unexpected_approval_id");
  }

  return {
    ok: true,
    value: Object.freeze({ ...command }),
    capability,
    requiresApproval: MUTATING_COMMANDS.has(command.type),
  };
}

/**
 * Produce a bounded text-only DOM projection. Form controls and active content
 * are removed before text extraction; callers must still treat the result as untrusted.
 */
export function sanitizeDomSnapshot(html, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) && options.maxChars >= 1 && options.maxChars <= 50000
    ? options.maxChars : 12000;
  const source = typeof html === "string" ? html : "";
  const safeMarkup = source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(input|textarea|select|option)\b[^>]*>[\s\S]*?<\/\2\s*>/gi, " ")
    .replace(/<(input|meta|link|base)\b[^>]*\/?>/gi, " ")
    .replace(/<([a-z][\w:-]*)\b[^>]*\bcontenteditable(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const text = safeMarkup.slice(0, maxChars);
  return Object.freeze({ text, truncated: safeMarkup.length > maxChars, source: "dom_text" });
}
