import { createNativeAgentBridge } from "./native-agent-bridge.mjs";
import { createNativeBrowserAgentRuntime } from "./native-agent-runtime.mjs";

const status = document.getElementById("nativeAgentBridgeStatus");
const tabInput = document.getElementById("nativeAgentTabId");
const originsInput = document.getElementById("nativeAgentAllowedOrigins");
const inspectButton = document.getElementById("nativeAgentInspect");
const output = document.getElementById("nativeAgentOutput");

function setStatus(message, state = "pending") {
  if (!status) return;
  status.textContent = message;
  status.className = "state-label " + state;
}

function parseAllowedOrigins() {
  const values = (originsInput?.value || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length < 1 || values.length > 20) throw new Error("أدخل نطاق HTTPS واحداً على الأقل.");
  return [...new Set(values.map((value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) {
      throw new Error("النطاقات يجب أن تكون Origins كاملة بصيغة HTTPS.");
    }
    return url.origin;
  }))];
}

if (!window.midadNative) {
  setStatus("NATIVE BRIDGE UNAVAILABLE", "pending");
} else {
  setStatus("NATIVE BRIDGE READY", "verified");
}

inspectButton?.addEventListener("click", async () => {
  inspectButton.disabled = true;
  output.textContent = "جارٍ الاتصال بمحرك WebView الأصلي…";
  let discovery;
  try {
    discovery = createNativeAgentBridge();
    const tabs = await discovery.request({ type: "getTabs" });
    const tabId = Number(tabInput?.value ?? 0);
    const tab = Array.isArray(tabs) ? tabs.find((item) => item.id === tabId) : null;
    if (!tab?.url) throw new Error("التبويب المحدد غير متاح.");
    const origin = new URL(tab.url).origin;
    const allowedOrigins = parseAllowedOrigins();
    if (!allowedOrigins.includes(origin)) {
      throw new Error("أضف Origin التبويب المحدد إلى قائمة النطاقات المسموحة أولاً: " + origin);
    }

    const agent = createNativeBrowserAgentRuntime({ allowedOrigins });
    const task = {
      id: "native-inspect-" + Date.now().toString(36),
      title: "MIDAD native WebView inspection",
      startOrigin: origin,
      allowedOrigins,
      capabilities: ["browser.inspect"],
      maxRetries: 1,
      steps: [{
        id: "inspect-" + Date.now().toString(36),
        command: {
          id: "inspect-" + Date.now().toString(36),
          type: "getDomSnapshot",
          tabId,
          origin,
          maxChars: 8000,
        },
      }],
    };
    task.steps[0].command.id = task.steps[0].id;
    const result = await agent.runtime.run(task);
    if (!result.ok) throw new Error(result.error || "native_agent_task_failed");
    output.textContent = JSON.stringify(result.evidence, null, 2);
    setStatus("WEBVIEW DRIVER VERIFIED", "verified");
    agent.bridge.close();
  } catch (error) {
    output.textContent = error?.message || "تعذر تنفيذ الفحص.";
    setStatus("AGENT TASK BLOCKED", "pending");
  } finally {
    discovery?.close();
    inspectButton.disabled = false;
  }
});
