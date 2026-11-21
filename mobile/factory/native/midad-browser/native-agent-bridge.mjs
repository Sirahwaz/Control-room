const REQUEST_TIMEOUT_MS = 20000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;

function makeRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, "");
  return "midad_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
}

function parseResponse(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" ? value : null;
}

/**
 * A narrow Promise-based client for AndroidX WebMessageListener.
 * The native endpoint is supplied by the host and never accepts executable code.
 */
export function createNativeAgentBridge({
  nativeObject = globalThis.window?.midadNative,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (!nativeObject || typeof nativeObject.postMessage !== "function") {
    throw new Error("native_browser_bridge_unavailable");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    throw new Error("native_browser_timeout_invalid");
  }

  const pending = new Map();
  const onMessage = (event) => {
    const response = parseResponse(event?.data);
    if (!response || response.v !== 1 || typeof response.requestId !== "string") return;
    const entry = pending.get(response.requestId);
    if (!entry) return;
    pending.delete(response.requestId);
    clearTimeout(entry.timer);
    if (response.ok === true) entry.resolve(response.result ?? null);
    else entry.reject(Object.assign(new Error(response.error || "native_browser_command_failed"), {
      code: response.error || "native_browser_command_failed",
    }));
  };
  nativeObject.onmessage = onMessage;

  const request = (command) => {
    if (!command || typeof command !== "object" || Array.isArray(command) ||
        typeof command.type !== "string") {
      return Promise.reject(new Error("native_browser_command_invalid"));
    }
    const requestId = makeRequestId();
    if (!REQUEST_ID.test(requestId)) return Promise.reject(new Error("native_browser_request_id_invalid"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Object.assign(new Error("native_browser_request_timeout"), {
          code: "native_browser_request_timeout",
          retryable: true,
        }));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      try {
        nativeObject.postMessage(JSON.stringify({ v: 1, requestId, command }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error("native_browser_post_failed"));
      }
    });
  };

  const close = () => {
    if (nativeObject.onmessage === onMessage) nativeObject.onmessage = null;
    for (const [requestId, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("native_browser_bridge_closed"));
      pending.delete(requestId);
    }
  };

  return Object.freeze({ request, close });
}

export function createNativeBrowserDriver({ bridge, allowedOrigins } = {}) {
  if (!bridge || typeof bridge.request !== "function") throw new TypeError("native_bridge_required");
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length < 1 || allowedOrigins.length > 20) {
    throw new TypeError("allowed_origins_required");
  }
  const normalized = [...new Set(allowedOrigins.map((value) => {
    if (typeof value !== "string") throw new TypeError("allowed_origin_invalid");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) {
      throw new TypeError("allowed_origin_invalid");
    }
    return url.origin;
  }))];

  const invoke = (type) => (command) => bridge.request({
    ...command,
    type,
    allowedOrigins: normalized,
  });
  return Object.freeze({
    navigate: invoke("navigate"),
    getTabs: invoke("getTabs"),
    switchTab: invoke("switchTab"),
    getDomSnapshot: invoke("getDomSnapshot"),
    captureScreenshot: invoke("captureScreenshot"),
    click: invoke("click"),
    type: invoke("type"),
    select: invoke("select"),
    scroll: invoke("scroll"),
    pressKey: invoke("pressKey"),
    waitFor: invoke("waitFor"),
  });
}
