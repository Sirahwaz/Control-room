import {
  createBrowserActionBinding,
  sanitizeDomSnapshot,
  validateAndConsumeBrowserCommand,
  validateBrowserCommand,
} from "./browser-command-contract.mjs";

const MAX_STEPS = 50;
const MAX_RETRIES = 3;
const COMMANDS = new Set([
  "navigate", "getTabs", "switchTab", "getDomSnapshot", "captureScreenshot",
  "click", "type", "select", "scroll", "pressKey", "waitFor",
]);
const MUTATING = new Set(["click", "type", "select", "pressKey"]);

function originOf(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function cloneState(state) {
  return {
    state: state.state,
    taskId: state.taskId,
    currentStep: state.currentStep,
    completedSteps: state.completedSteps,
    totalSteps: state.totalSteps,
    error: state.error,
  };
}

function summarize(value, type) {
  if (type === "getDomSnapshot") {
    const html = typeof value === "string" ? value : value?.html;
    if (typeof html === "string") return sanitizeDomSnapshot(html);
    if (typeof value?.text === "string") {
      return { text: value.text.slice(0, 12000), truncated: value.text.length > 12000, source: "driver_text" };
    }
  }
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 2000);
  if (typeof value !== "object") return value;
  const safe = {};
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    if (/(password|cookie|token|secret|otp|credential|authorization|localstorage|sessionstorage)/i.test(key)) continue;
    if (typeof item === "string") safe[key] = item.slice(0, 2000);
    else if (typeof item === "number" || typeof item === "boolean") safe[key] = item;
    else if (item === null) safe[key] = null;
  }
  return safe;
}

function validateTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return { ok: false, error: "task_invalid" };
  if (typeof task.id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(task.id)) return { ok: false, error: "task_id_invalid" };
  const startOrigin = originOf(task.startOrigin);
  if (!startOrigin) return { ok: false, error: "origin_invalid" };
  if (!Array.isArray(task.allowedOrigins) || task.allowedOrigins.length < 1 || task.allowedOrigins.length > 20) {
    return { ok: false, error: "origin_scope_invalid" };
  }
  const allowedOrigins = task.allowedOrigins.map(originOf);
  if (allowedOrigins.some((origin) => !origin) || !allowedOrigins.includes(startOrigin)) {
    return { ok: false, error: "origin_scope_invalid" };
  }
  if (!Array.isArray(task.steps) || task.steps.length < 1 || task.steps.length > MAX_STEPS) {
    return { ok: false, error: "step_count_invalid" };
  }
  if (!Array.isArray(task.capabilities)) return { ok: false, error: "capabilities_invalid" };
  const ids = new Set();
  for (const step of task.steps) {
    if (!step || typeof step !== "object" || typeof step.id !== "string" ||
        !/^[A-Za-z0-9_-]{8,80}$/.test(step.id) || ids.has(step.id)) {
      return { ok: false, error: "step_id_invalid" };
    }
    ids.add(step.id);
    if (!step.command || typeof step.command !== "object" || !COMMANDS.has(step.command.type)) {
      return { ok: false, error: "command_unsupported" };
    }
    if (step.command.id !== step.id) return { ok: false, error: "command_id_mismatch" };
  }
  return {
    ok: true,
    value: {
      id: task.id,
      title: typeof task.title === "string" ? task.title.slice(0, 120) : "MIDAD Browser task",
      startOrigin,
      allowedOrigins: [...new Set(allowedOrigins)],
      capabilities: [...new Set(task.capabilities)],
      maxRetries: Number.isInteger(task.maxRetries) ? Math.max(0, Math.min(MAX_RETRIES, task.maxRetries)) : 1,
      steps: task.steps,
    },
  };
}

export function createBrowserAgentRuntime({
  driver,
  authorizeAction,
  now = () => Date.now(),
  onStateChange = () => {},
} = {}) {
  if (!driver || typeof driver !== "object") throw new TypeError("driver_required");
  let state = {
    state: "idle",
    taskId: null,
    currentStep: null,
    completedSteps: 0,
    totalSteps: 0,
    error: null,
  };
  let paused = false;
  let cancelled = false;
  let pauseWaiters = [];
  let activeController = null;
  let running = false;

  const publish = (next) => {
    state = { ...state, ...next };
    onStateChange(cloneState(state));
  };

  const waitUntilRunnable = async () => {
    while (paused && !cancelled) {
      await new Promise((resolve) => pauseWaiters.push(resolve));
    }
    return !cancelled;
  };

  const wake = () => {
    const waiters = pauseWaiters;
    pauseWaiters = [];
    waiters.forEach((resolve) => resolve());
  };

  const run = async (input) => {
    if (running) return { ok: false, state: state.state, error: "task_already_running", evidence: [] };
    const checked = validateTask(input);
    if (!checked.ok) {
      publish({ state: "failed", taskId: input?.id ?? null, error: checked.error });
      return { ok: false, state: "failed", error: checked.error, evidence: [] };
    }
    const task = checked.value;
    running = true;
    paused = false;
    cancelled = false;
    activeController = new AbortController();
    const evidence = [];
    let currentOrigin = task.startOrigin;
    publish({
      state: "running", taskId: task.id, currentStep: null,
      completedSteps: 0, totalSteps: task.steps.length, error: null,
    });

    try {
      for (const step of task.steps) {
        if (!(await waitUntilRunnable())) break;
        publish({ state: "running", currentStep: step.id });
        const command = { ...step.command };
        const context = () => ({
          currentOrigin,
          allowedOrigins: task.allowedOrigins,
          capabilities: task.capabilities,
          approvedActions: [],
          nowMs: now(),
        });

        let result;
        let lastError = null;
        for (let attempt = 0; attempt <= task.maxRetries; attempt += 1) {
          if (!(await waitUntilRunnable())) break;
          let executable = command;
          let validation;
          if (MUTATING.has(command.type)) {
            if (typeof authorizeAction !== "function") {
              lastError = new Error("human_approval_required");
              lastError.code = "human_approval_required";
              break;
            }
            const binding = createBrowserActionBinding(command);
            const approval = await authorizeAction({
              taskId: task.id,
              stepId: step.id,
              title: task.title,
              command: { ...command },
              binding,
              expiresAtMax: now() + 120000,
            });
            if (!approval || typeof approval.approvalId !== "string") {
              lastError = new Error("human_approval_required");
              lastError.code = "human_approval_required";
              break;
            }
            executable = { ...command, approvalId: approval.approvalId };
            const ctx = context();
            ctx.approvedActions = [{
              approvalId: approval.approvalId,
              binding,
              expiresAt: approval.expiresAt,
            }];
            validation = validateAndConsumeBrowserCommand(executable, ctx);
          } else {
            validation = validateBrowserCommand(executable, context());
          }
          if (!validation.ok) {
            lastError = new Error(validation.error);
            lastError.code = validation.error;
            break;
          }

          const method = driver[command.type];
          if (typeof method !== "function") {
            lastError = new Error("driver_method_unavailable");
            lastError.code = "driver_method_unavailable";
            break;
          }
          try {
            result = await method.call(driver, validation.value, {
              signal: activeController.signal,
              taskId: task.id,
              stepId: step.id,
              attempt,
            });
            lastError = null;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error("driver_execution_failed");
            if (lastError.retryable !== true || attempt >= task.maxRetries) break;
          }
        }

        if (cancelled) break;
        if (lastError) {
          const code = lastError.code || lastError.message || "step_failed";
          evidence.push({ stepId: step.id, type: command.type, status: "failed", error: String(code).slice(0, 120), at: now() });
          publish({ state: "failed", error: String(code).slice(0, 120) });
          return { ok: false, state: "failed", taskId: task.id, error: String(code), evidence };
        }

        if (command.type === "navigate") currentOrigin = new URL(command.url).origin;
        evidence.push({
          stepId: step.id,
          type: command.type,
          status: "completed",
          result: summarize(result, command.type),
          at: now(),
        });
        publish({ completedSteps: state.completedSteps + 1 });
      }

      if (cancelled) {
        publish({ state: "cancelled", error: null });
        return { ok: false, state: "cancelled", taskId: task.id, error: "task_cancelled", evidence };
      }
      publish({ state: "completed", currentStep: null, error: null });
      return { ok: true, state: "completed", taskId: task.id, evidence };
    } catch (error) {
      const message = error instanceof Error ? error.message : "runtime_failed";
      publish({ state: "failed", error: message.slice(0, 120) });
      return { ok: false, state: "failed", taskId: task.id, error: message, evidence };
    } finally {
      running = false;
      paused = false;
      activeController = null;
      wake();
    }
  };

  return Object.freeze({
    run,
    pause() {
      if (!running || cancelled || state.state !== "running") return false;
      paused = true;
      publish({ state: "paused" });
      return true;
    },
    resume() {
      if (!running || !paused || cancelled) return false;
      paused = false;
      publish({ state: "running" });
      wake();
      return true;
    },
    cancel() {
      if (!running || cancelled) return false;
      cancelled = true;
      paused = false;
      activeController?.abort();
      publish({ state: "cancelled" });
      wake();
      return true;
    },
    getState() {
      return cloneState(state);
    },
  });
}


const EXPECTED_OUTCOMES = Object.freeze({
  navigate: "The target URL would be opened within the allowlisted origin scope.",
  getTabs: "The available browser tabs would be listed without reading credentials.",
  switchTab: "The selected tab would become active.",
  getDomSnapshot: "A bounded, sanitized text snapshot would be collected.",
  captureScreenshot: "A screenshot would be captured for evidence.",
  click: "The selected element would receive a click after human approval.",
  type: "Text would be entered only after human approval; values are omitted from this plan.",
  select: "The requested option would be selected after human approval.",
  scroll: "The page would scroll by the requested bounded offset.",
  pressKey: "The allowed key would be sent after human approval.",
  waitFor: "The selector would be checked within the bounded timeout.",
});

/**
 * Validate and describe a browser task without creating a driver, requesting
 * approval, connecting to a browser, or executing any page operation.
 */
export function createBrowserDryRun({ now = () => Date.now() } = {}) {
  return Object.freeze({
    plan(input) {
      const checked = validateTask(input);
      if (!checked.ok) {
        return { ok: false, state: "failed", mode: "dry_run", error: checked.error, plan: [], evidence: [] };
      }

      const task = checked.value;
      let currentOrigin = task.startOrigin;
      const plan = [];
      const evidence = [];

      for (const step of task.steps) {
        const source = step.command;
        const command = { ...source };
        const requiresApproval = MUTATING.has(command.type);
        const binding = requiresApproval ? createBrowserActionBinding(command) : null;
        const approvalId = requiresApproval ? "dryrun-approval-" + step.id : null;
        const executable = requiresApproval ? { ...command, approvalId } : command;
        const context = {
          currentOrigin,
          allowedOrigins: task.allowedOrigins,
          capabilities: task.capabilities,
          approvedActions: requiresApproval ? [{
            approvalId,
            binding,
            expiresAt: now() + 60000,
          }] : [],
          nowMs: now(),
        };
        const validation = validateBrowserCommand(executable, context);
        if (!validation.ok) {
          return {
            ok: false,
            state: "failed",
            mode: "dry_run",
            taskId: task.id,
            error: validation.error,
            failedStepId: step.id,
            plan,
            evidence,
          };
        }

        const item = Object.freeze({
          stepId: step.id,
          type: command.type,
          origin: currentOrigin,
          capability: validation.capability,
          requiresApproval,
          willExecute: false,
          expectedOutcome: EXPECTED_OUTCOMES[command.type],
          risk: requiresApproval ? "human_approval_required_in_live_mode" : "read_only_or_navigation",
        });
        plan.push(item);
        evidence.push({
          stepId: step.id,
          type: command.type,
          status: "planned",
          effect: "none",
          at: now(),
        });

        if (command.type === "navigate") currentOrigin = new URL(command.url).origin;
      }

      return {
        ok: true,
        state: "dry_run_completed",
        mode: "dry_run",
        taskId: task.id,
        totalSteps: plan.length,
        executedSteps: 0,
        plan,
        evidence,
        warnings: plan.some((item) => item.requiresApproval)
          ? ["Mutating steps are only planned; live execution requires separate human approval."]
          : [],
      };
    },
  });
}
