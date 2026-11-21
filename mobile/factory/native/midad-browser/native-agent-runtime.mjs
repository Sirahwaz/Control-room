import { createBrowserAgentRuntime, createBrowserDryRun, createBrowserExecutionController } from "./agent-runtime.mjs";
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
  const dryRun = createBrowserDryRun();
  const execution = createBrowserExecutionController({ dryRun, liveRuntime: runtime });
  // Never expose the raw runtime: every public run() must pass through the DRY_RUN gate.
  return Object.freeze({ runtime: execution, bridge, driver, dryRun, execution });
}

if (typeof window !== "undefined") {
  window.MIDADBrowserAgent = Object.freeze({
    createRuntime: (options = {}) => createNativeBrowserAgentRuntime({
      ...options,
      nativeObject: window.midadNative,
    }),
    createDryRun: (options = {}) => createBrowserDryRun(options),
    createExecutionController: (options = {}) => createBrowserExecutionController({
      dryRun: createBrowserDryRun(options),
    }),
  });
  window.dispatchEvent(new CustomEvent("midad:browser-agent-factory-ready"));
}
