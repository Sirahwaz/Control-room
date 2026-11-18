export const ANDROID_BROWSER_CAPABILITIES = Object.freeze([
  "interactive-browser-execution",
  "persistent-browser-session",
  "encrypted-session-store",
]);

export function validateAndroidPairStart(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "PAIR_REQUEST_INVALID" };
  }
  const nodeId = typeof value.node_id === "string" ? value.node_id.trim() : "";
  const tokenHash = typeof value.token_hash === "string" ? value.token_hash.toLowerCase() : "";
  const label = typeof value.device_label === "string"
    ? value.device_label.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64)
    : "";
  if (!/^android-[a-f0-9]{16}$/.test(nodeId)) return { ok: false, error: "PAIR_NODE_ID_INVALID" };
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) return { ok: false, error: "PAIR_TOKEN_HASH_INVALID" };
  if (!label) return { ok: false, error: "PAIR_DEVICE_LABEL_REQUIRED" };
  return {
    ok: true,
    value: { node_id: nodeId, token_hash: tokenHash, device_label: label },
  };
}

export function validateAndroidPairId(value) {
  return typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
}

export function validateBrowserDeviceCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "BROWSER_DEVICE_COMMAND_INVALID" };
  }
  const nodeId = typeof value.node_id === "string" ? value.node_id.trim() : "";
  const requestId = typeof value.request_id === "string" ? value.request_id.trim() : "";
  const action = typeof value.action === "string" ? value.action.trim().toLowerCase() : "";
  if (!/^android-[a-f0-9]{16}$/.test(nodeId)) return { ok: false, error: "BROWSER_DEVICE_NODE_ID_INVALID" };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(requestId)) return { ok: false, error: "BROWSER_DEVICE_REQUEST_ID_INVALID" };
  if (!["navigate", "inspect"].includes(action)) return { ok: false, error: "BROWSER_DEVICE_ACTION_NOT_ALLOWED" };
  if (action === "inspect") return { ok: true, value: { node_id: nodeId, request_id: requestId, action } };
  if (typeof value.url !== "string" || value.url.length > 2048) return { ok: false, error: "BROWSER_DEVICE_URL_INVALID" };
  let url;
  try { url = new URL(value.url); } catch { return { ok: false, error: "BROWSER_DEVICE_URL_INVALID" }; }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      (url.port && url.port !== "443") || url.hostname.endsWith(".") ||
      url.hostname.includes("..")) return { ok: false, error: "BROWSER_DEVICE_URL_NOT_ALLOWED" };
  return {
    ok: true,
    value: { node_id: nodeId, request_id: requestId, action, url: url.toString(), host: url.hostname.toLowerCase() },
  };
}
