import { createBrowserAgentRuntime } from "./agent-runtime.mjs";
import {
  createNativeAgentBridge,
  createNativeBrowserDriver,
} from "./native-agent-bridge.mjs";

function approvalId() {
  return "native_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 14);
}

/**
 * The native bridge displays its own Android confirmation dialog for every
 * page mutation. This short-lived runtime approval only satisfies the shared
 * task contract; it is not treated as the security boundary by native code.
 */
export function createNativeBrowserAgentRuntime({
  nativeObject = globalThis.window?.midadNative,
  allowedOrigins,
  timeoutMs,
} = {}) {
  const bridge = createNativeAgentBridge({ nativeObject, timeoutMs });
  const driver = createNativeBrowserDriver({ bridge, allowedOrigins });
  const runtime = createBrowserAgentRuntime({
    driver,
    authorizeAction: async ({ binding }) => ({
      approvalId: approvalId(),
      binding,
      expiresAt: Date.now() + 60000,
    }),
  });
  return Object.freeze({ runtime, bridge, driver });
}

if (typeof window !== "undefined") {
  window.MIDADBrowserAgent = Object.freeze({
    createRuntime: (options = {}) => createNativeBrowserAgentRuntime({
      ...options,
      nativeObject: window.midadNative,
    }),
  });
  window.dispatchEvent(new CustomEvent("midad:browser-agent-factory-ready"));
}
