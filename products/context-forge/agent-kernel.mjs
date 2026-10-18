const ALLOWED_EFFECTS = new Set([
  "read", "write", "external_message", "financial", "destructive", "publish", "delete"
]);
const HIGH_IMPACT_EFFECTS = new Set([
  "write", "external_message", "financial", "destructive", "publish", "delete"
]);

function clampInt(value, fallback, min, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function compactError(error) {
  if (error?.name === "TimeoutError") return "TOOL_TIMEOUT";
  if (error?.name === "AbortError") return "TOOL_ABORTED";
  return "TOOL_EXECUTION_FAILED";
}

async function writeAudit(audit, event) {
  if (typeof audit !== "function") return;
  await audit({ ...event, at: new Date().toISOString() });
}

export function authorizeToolCall({ toolName, tool, mode = "dry_run", approval = null }) {
  if (!tool || typeof tool !== "object") {
    return { status: "DENIED", allowed: false, reason: "Tool is not present in the explicit registry." };
  }
  const manifest = tool.manifest;
  if (!manifest || manifest.name !== toolName || manifest.enabled === false) {
    return { status: "DENIED", allowed: false, reason: "Tool manifest is missing, mismatched, or disabled." };
  }
  if (!ALLOWED_EFFECTS.has(manifest.effect)) {
    return { status: "DENIED", allowed: false, reason: "Tool effect is missing or not recognized." };
  }
  if (mode !== "dry_run" && mode !== "execute") {
    return { status: "DENIED", allowed: false, reason: "Execution mode is not supported." };
  }
  if (mode === "dry_run") {
    return { status: "DRY_RUN", allowed: false, reason: "Dry-run mode never invokes tool executors." };
  }
  if (typeof tool.execute !== "function") {
    return { status: "DENIED", allowed: false, reason: "Registered tool has no executable adapter." };
  }
  if (HIGH_IMPACT_EFFECTS.has(manifest.effect)) {
    const hasScopedApproval = approval?.approved === true
      && approval.toolName === toolName
      && approval.effect === manifest.effect;
    if (!hasScopedApproval) {
      return { status: "APPROVAL_REQUIRED", allowed: false, reason: "High-impact tool requires explicit approval scoped to the exact tool and effect." };
    }
  }
  return { status: "AUTHORIZED", allowed: true, reason: "Tool is registered and policy checks passed." };
}

function makeResult(status, goal, attempts, steps, reason = null) {
  return { status, goal, attempts, steps, reason, executionPolicy: "explicit-registry; dry-run-default; bounded-planning" };
}

export async function runBoundedAgent({
  goal,
  context = {},
  reasoner,
  toolRegistry = {},
  mode = "dry_run",
  approvals = [],
  maxAttempts = 3,
  maxSteps = 8,
  timeoutMs = 10000,
  audit = async () => {}
} = {}) {
  const normalizedGoal = typeof goal === "string" ? goal.trim() : "";
  if (!normalizedGoal) {
    return makeResult("BLOCKED", normalizedGoal, 0, [], "A non-empty goal is required.");
  }
  if (!reasoner || typeof reasoner.plan !== "function") {
    return makeResult("BLOCKED", normalizedGoal, 0, [], "No planner adapter is configured.");
  }
  if (mode !== "dry_run" && mode !== "execute") {
    return makeResult("BLOCKED", normalizedGoal, 0, [], "Unsupported execution mode.");
  }

  const planningLimit = clampInt(maxAttempts, 3, 1, 3);
  const stepLimit = clampInt(maxSteps, 8, 1, 16);
  const timeout = clampInt(timeoutMs, 10000, 50, 120000);
  let plan = null;
  let attempts = 0;

  try {
    await writeAudit(audit, { event: "agent_run_started", goal: normalizedGoal, mode });
  } catch {
    return makeResult("FAILED", normalizedGoal, 0, [], "Audit sink unavailable; run stopped before planning.");
  }

  for (let attempt = 1; attempt <= planningLimit; attempt += 1) {
    attempts = attempt;
    try {
      const availableTools = Object.entries(toolRegistry).map(([name, registeredTool]) => ({
        name,
        description: typeof registeredTool?.manifest?.description === "string" ? registeredTool.manifest.description : "",
        effect: registeredTool?.manifest?.effect ?? "unknown",
        enabled: registeredTool?.manifest?.enabled !== false
      }));
      const candidate = await reasoner.plan({
        goal: normalizedGoal,
        context,
        tools: availableTools,
        attempt,
        maxAttempts: planningLimit
      });
      if (!candidate || !Array.isArray(candidate.steps)) {
        throw new TypeError("Planner output must contain a steps array.");
      }
      plan = candidate;
      break;
    } catch {
      try {
        await writeAudit(audit, { event: "planning_attempt_failed", attempt, code: "PLAN_INVALID_OR_UNAVAILABLE" });
      } catch {
        return makeResult("FAILED", normalizedGoal, attempts, [], "Audit sink unavailable; planning halted.");
      }
      if (attempt === planningLimit) {
        return makeResult("FAILED", normalizedGoal, attempts, [], "Planner failed within the bounded attempt budget.");
      }
    }
  }

  try {
    await writeAudit(audit, {
      event: "plan_created",
      attempt: attempts,
      stepCount: Math.min(plan.steps.length, stepLimit)
    });
  } catch {
    return makeResult("FAILED", normalizedGoal, attempts, [], "Audit sink unavailable; plan not executed.");
  }

  const selectedSteps = plan.steps.slice(0, stepLimit);
  const results = [];
  if (plan.steps.length > stepLimit) {
    try {
      await writeAudit(audit, { event: "plan_step_limit_applied", requested: plan.steps.length, allowed: stepLimit });
    } catch {
      return makeResult("FAILED", normalizedGoal, attempts, [], "Audit sink unavailable; plan not executed.");
    }
  }
  if (selectedSteps.length === 0) {
    return makeResult("PLANNED", normalizedGoal, attempts, [], "Planner returned no steps; no action was executed.");
  }

  for (let index = 0; index < selectedSteps.length; index += 1) {
    const step = selectedSteps[index];
    if (!step || typeof step.tool !== "string" || !step.tool.trim()) {
      results.push({ index, status: "DENIED", reason: "Plan step has no valid tool name." });
      return makeResult("BLOCKED", normalizedGoal, attempts, results, "Malformed plan step blocked execution.");
    }

    const tool = toolRegistry[step.tool];
    const approval = approvals.find((item) => item?.approved === true && item.toolName === step.tool);
    const decision = authorizeToolCall({ toolName: step.tool, tool, mode, approval });
    try {
      await writeAudit(audit, {
        event: "tool_policy_decision",
        tool: step.tool,
        step: index,
        status: decision.status,
        effect: tool?.manifest?.effect ?? "unknown"
      });
    } catch {
      return makeResult("FAILED", normalizedGoal, attempts, results, "Audit sink unavailable; action blocked before execution.");
    }

    if (!decision.allowed) {
      results.push({ index, tool: step.tool, status: decision.status, reason: decision.reason });
      if (decision.status === "DRY_RUN") continue;
      return makeResult("BLOCKED", normalizedGoal, attempts, results, decision.reason);
    }

    const controller = new AbortController();
    let timeoutId;
    try {
      await writeAudit(audit, { event: "tool_execution_started", tool: step.tool, step: index });
    } catch {
      return makeResult("FAILED", normalizedGoal, attempts, results, "Audit sink unavailable; action blocked before execution.");
    }

    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          const error = new Error("Tool exceeded time budget.");
          error.name = "TimeoutError";
          reject(error);
        }, timeout);
      });
      const output = await Promise.race([
        Promise.resolve().then(() => tool.execute({
          input: step.input ?? {},
          goal: normalizedGoal,
          context,
          signal: controller.signal
        })),
        timeoutPromise
      ]);
      clearTimeout(timeoutId);
      results.push({ index, tool: step.tool, status: "EXECUTED", output });
      try {
        await writeAudit(audit, { event: "tool_execution_completed", tool: step.tool, step: index, status: "EXECUTED" });
      } catch {
        return makeResult("FAILED", normalizedGoal, attempts, results, "Action may have completed, but its completion audit failed; do not replay blindly.");
      }
    } catch (error) {
      clearTimeout(timeoutId);
      results.push({ index, tool: step.tool, status: "FAILED", errorCode: compactError(error) });
      try {
        await writeAudit(audit, { event: "tool_execution_failed", tool: step.tool, step: index, errorCode: compactError(error) });
      } catch {
        return makeResult("FAILED", normalizedGoal, attempts, results, "Tool failed and audit recording also failed; manual reconciliation may be required.");
      }
      return makeResult("FAILED", normalizedGoal, attempts, results, "Execution stopped after the first tool failure; no automatic action replay was attempted.");
    }
  }

  if (results.every((result) => result.status === "DRY_RUN")) {
    return makeResult("PLANNED", normalizedGoal, attempts, results, "Plan validated in dry-run mode; no tool executor was invoked.");
  }
  return makeResult("COMPLETED", normalizedGoal, attempts, results, "All selected steps completed under the configured policy.");
}
