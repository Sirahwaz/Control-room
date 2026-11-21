import { createNativeAgentBridge } from "./native-agent-bridge.mjs";
import { createNativeBrowserAgentRuntime } from "./native-agent-runtime.mjs";

const status = document.getElementById("nativeAgentBridgeStatus");
const tabInput = document.getElementById("nativeAgentTabId");
const originsInput = document.getElementById("nativeAgentAllowedOrigins");
const inspectButton = document.getElementById("nativeAgentInspect");
const dryRunButton = document.getElementById("nativeAgentDryRun");
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

dryRunButton?.addEventListener("click", () => {
  dryRunButton.disabled = true;
  try {
    const allowedOrigins = parseAllowedOrigins();
    const tabId = Number(tabInput?.value ?? 0);
    if (!Number.isInteger(tabId) || tabId < 0 || tabId > 7) throw new Error("رقم التبويب غير صالح.");
    const origin = allowedOrigins[0];
    const taskId = "dryrun-" + Date.now().toString(36);
    const stepId = "inspect-" + Date.now().toString(36);
    const task = {
      id: taskId,
      title: "MIDAD read-only browser inspection",
      startOrigin: origin,
      allowedOrigins,
      capabilities: ["browser.inspect"],
      steps: [{
        id: stepId,
        command: { id: stepId, type: "getDomSnapshot", tabId, origin, maxChars: 8000 },
      }],
    };
    const controller = window.MIDADBrowserAgent?.createExecutionController?.();
    if (!controller || controller.getMode() !== "dry_run") throw new Error("dry_run_execution_controller_unavailable");
    const result = controller.plan(task);
    if (!result.ok) throw new Error(result.error || "dry_run_rejected");
    output.textContent = JSON.stringify(result, null, 2);
    setStatus("DRY RUN VERIFIED · 0 ACTIONS EXECUTED", "verified");
  } catch (error) {
    output.textContent = error?.message || "تعذرت محاكاة الخطة.";
    setStatus("DRY RUN BLOCKED", "pending");
  } finally {
    dryRunButton.disabled = false;
  }
});
inspectButton?.addEventListener("click", async () => {
  inspectButton.disabled = true;
  output.textContent = "جارٍ الاتصال بمحرك WebView الأصلي…";
  let discovery;
  let agent;
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

    agent = createNativeBrowserAgentRuntime({ allowedOrigins });
    const taskId = Date.now().toString(36);
    const stepId = "inspect-" + taskId;
    const task = {
      id: "native-inspect-" + taskId,
      title: "MIDAD native WebView inspection",
      startOrigin: origin,
      allowedOrigins,
      capabilities: ["browser.inspect"],
      maxRetries: 1,
      steps: [{
        id: stepId,
        command: {
          id: stepId,
          type: "getDomSnapshot",
          tabId,
          origin,
          maxChars: 8000,
        },
      }],
    };
    if (!agent.execution?.setMode("local_native")) throw new Error("LOCAL_NATIVE mode was not explicitly enabled");
    const result = await agent.execution.run(task);
    if (!result.ok) throw new Error(result.error || "native_agent_task_failed");
    output.textContent = JSON.stringify(result.evidence, null, 2);
    setStatus("WEBVIEW DRIVER VERIFIED", "verified");
  } catch (error) {
    output.textContent = error?.message || "تعذر تنفيذ الفحص.";
    setStatus("AGENT TASK BLOCKED", "pending");
  } finally {
    agent?.bridge.close();
    discovery?.close();
    inspectButton.disabled = false;
  }
});
