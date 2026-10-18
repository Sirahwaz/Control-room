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
  if (error?.name === "TimeoutError") return "TIMEOUT";
  if (error?.name === "AbortError") return "ABORTED";
  return "OPERATION_FAILED";
}

function sanitizeAuditText(value, maxLength = 120) {
  return String(value ?? "")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED_TOKEN]")
    .replace(/\b0x[a-fA-F0-9]{64}\b/g, "[REDACTED_HEX_SECRET]")
    .replace(/(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|secret|mnemonic|recovery phrase|seed phrase)\s*[:=]\s*[^,\s]+/gi, "$1=[REDACTED]")
    .slice(0, maxLength);
}

async function writeAudit(audit, event) {
  if (typeof audit !== "function") return;
  await audit({ ...event, at: new Date().toISOString() });
}

export function authorizeToolCall({ toolName, tool, mode = "dry_run", approval = null, actorId = null, now = new Date() }) {
  if (!tool || typeof tool !== "object") {
    return { status: "DENIED", allowed: false, reason: "Tool is not present in the explicit registry." };
  }
  const manifest = tool.manifest;
  if (!manifest || manifest.name !== toolName || manifest.enabled !== true) {
    return { status: "DENIED", allowed: false, reason: "Tool manifest is missing, mismatched, or not explicitly enabled." };
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
    const expiresAtMs = Date.parse(approval?.expiresAt ?? "");
    const currentMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
    const validApproval = approval?.approved === true
      && typeof approval.id === "string" && approval.id.trim().length > 0
      && approval.toolName === toolName
      && approval.effect === manifest.effect
      && typeof actorId === "string" && actorId.trim().length > 0
      && approval.actorId === actorId
      && typeof approval.scope === "string" && approval.scope.trim().length > 0
      && (!manifest.approvalScope || approval.scope === manifest.approvalScope)
      && Number.isFinite(expiresAtMs)
      && Number.isFinite(currentMs)
      && expiresAtMs > currentMs;
    if (!validApproval) {
      return { status: "APPROVAL_REQUIRED", allowed: false, reason: "High-impact action requires an unexpired approval scoped to the exact tool, effect, actor, and operation." };
    }
  }
  return { status: "AUTHORIZED", allowed: true, reason: "Tool is registered and policy checks passed." };
}

function makeResult(status, goal, attempts, steps, reason = null) {
  return {
    status, goal, attempts, steps, reason,
    executionPolicy: "explicit-registry; dry-run-default; scoped-approval; verified-outcomes"
  };
}

async function runWithTimeout(operation, timeoutMs, errorLabel) {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error(errorLabel);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout
    ]);
    return { value };
  } catch (error) {
    return { error };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runBoundedAgent({
  goal,
  context = {},
  reasoner,
  toolRegistry = {},
  mode = "dry_run",
  approvals = [],
  actorId = null,
  consumeApproval = null,
  verifyStep = null,
  maxAttempts = 3,
  maxSteps = 8,
  timeoutMs = 10000,
  audit = async () => {}
} = {}) {
  const normalizedGoal = typeof goal === "string" ? goal.trim() : "";
  if (!normalizedGoal) return makeResult("BLOCKED", normalizedGoal, 0, [], "A non-empty goal is required.");
  if (!reasoner || typeof reasoner.plan !== "function") return makeResult("BLOCKED", normalizedGoal, 0, [], "No planner adapter is configured.");
  if (mode !== "dry_run" && mode !== "execute") return makeResult("BLOCKED", normalizedGoal, 0, [], "Unsupported execution mode.");
  if (mode === "execute" && typeof verifyStep !== "function") {
    return makeResult("BLOCKED", normalizedGoal, 0, [], "Execution mode requires an independent result verifier; no tool was executed.");
  }

  const planningLimit = clampInt(maxAttempts, 3, 1, 3);
  const stepLimit = clampInt(maxSteps, 8, 1, 16);
  const timeout = clampInt(timeoutMs, 10000, 50, 120000);
  let plan = null;
  let attempts = 0;

  try {
    await writeAudit(audit, { event: "agent_run_started", goalLength: normalizedGoal.length, mode });
  } catch {
    return makeResult("FAILED", normalizedGoal, 0, [], "Audit sink unavailable; run stopped before planning.");
  }

  const availableTools = Object.entries(toolRegistry).map(([name, registeredTool]) => ({
    name,
    description: typeof registeredTool?.manifest?.description === "string" ? registeredTool.manifest.description : "",
    effect: registeredTool?.manifest?.effect ?? "unknown",
    enabled: registeredTool?.manifest?.enabled === true
  }));

  for (let attempt = 1; attempt <= planningLimit; attempt += 1) {
    attempts = attempt;
    const planned = await runWithTimeout(
      (signal) => reasoner.plan({
        goal: normalizedGoal, context, tools: availableTools, attempt, maxAttempts: planningLimit, signal
      }),
      timeout,
      "Planner timed out."
    );
    if (!planned.error) {
      if (planned.value && Array.isArray(planned.value.steps)) {
        plan = planned.value;
        break;
      }
    }
    try {
      await writeAudit(audit, { event: "planning_attempt_failed", attempt, code: planned.error ? compactError(planned.error) : "PLAN_INVALID" });
    } catch {
      return makeResult("FAILED", normalizedGoal, attempts, [], "Audit sink unavailable; planning halted.");
    }
    if (attempt === planningLimit) {
      return makeResult("FAILED", normalizedGoal, attempts, [], "Planner failed within the bounded attempt budget.");
    }
  }

  try {
    await writeAudit(audit, { event: "plan_created", attempt: attempts, stepCount: Math.min(plan.steps.length, stepLimit) });
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
  if (selectedSteps.length === 0) return makeResult("PLANNED", normalizedGoal, attempts, [], "Planner returned no steps; no action was executed.");

  for (let index = 0; index < selectedSteps.length; index += 1) {
    const step = selectedSteps[index];
    if (!step || typeof step.tool !== "string" || !step.tool.trim()
        || !step.input || typeof step.input !== "object" || Array.isArray(step.input)) {
      results.push({ index, status: "DENIED", reason: "Plan step must include a tool name and a JSON object input." });
      return makeResult("BLOCKED", normalizedGoal, attempts, results, "Malformed plan step blocked execution.");
    }

    const tool = toolRegistry[step.tool];
    const approval = approvals.find((item) => item?.approved === true && item.toolName === step.tool);
    const decision = authorizeToolCall({ toolName: step.tool, tool, mode, approval, actorId });
    try {
      await writeAudit(audit, {
        event: "tool_policy_decision", tool: step.tool, step: index,
        status: decision.status, effect: tool?.manifest?.effect ?? "unknown"
      });
    } catch {
      return makeResult("FAILED", normalizedGoal, attempts, results, "Audit sink unavailable; action blocked before execution.");
    }

    if (!decision.allowed) {
      results.push({ index, tool: step.tool, status: decision.status, reason: decision.reason });
      if (decision.status === "DRY_RUN") continue;
      return makeResult("BLOCKED", normalizedGoal, attempts, results, decision.reason);
    }

    if (HIGH_IMPACT_EFFECTS.has(tool.manifest.effect)) {
      if (typeof consumeApproval !== "function") {
        results.push({ index, tool: step.tool, status: "APPROVAL_REQUIRED", reason: "No trusted, one-use approval consumer is configured." });
        return makeResult("BLOCKED", normalizedGoal, attempts, results, "High-impact execution requires a trusted one-use approval consumer.");
      }
      try {
        await writeAudit(audit, { event: "approval_consumption_requested", approvalId: approval.id, tool: step.tool, actorId });
      } catch {
        return makeResult("FAILED", normalizedGoal, attempts, results, "Audit sink unavailable; approval was not consumed.");
      }
      let consumed = false;
      try {
        consumed = (await consumeApproval(approval, {
          toolName: step.tool, effect: tool.manifest.effect, actorId, scope: approval.scope
        })) === true;
      } catch {
        consumed = false;
      }
      if (!consumed) {
        results.push({ index, tool: step.tool, status: "APPROVAL_REQUIRED", reason: "Approval could not be verified and consumed by the trusted approval store." });
        return makeResult("BLOCKED", normalizedGoal, attempts, results, "Approval verification failed; no tool was executed.");
      }
      try {
        await writeAudit(audit, { event: "approval_consumed", approvalId: approval.id, tool: step.tool, actorId });
      } catch {
        return makeResult("FAILED", normalizedGoal, attempts, results, "Approval may have been consumed but audit confirmation failed; reconcile before retry.");
      }
    }

    try {
      await writeAudit(audit, { event: "tool_execution_started", tool: step.tool, step: index, effect: tool.manifest.effect });
    } catch {
      return makeResult("FAILED", normalizedGoal, attempts, results, "Audit sink unavailable; action blocked before execution.");
    }

    const executed = await runWithTimeout(
      (signal) => tool.execute({
        input: step.input, goal: normalizedGoal, context, expectedOutcome: step.expectedOutcome ?? "", signal
      }),
      timeout,
      "Tool timed out."
    );

    if (executed.error) {
      const errorCode = compactError(executed.error);
      results.push({ index, tool: step.tool, status: "FAILED", errorCode });
      try {
        await writeAudit(audit, { event: "tool_execution_failed", tool: step.tool, step: index, errorCode });
      } catch {
        return makeResult("FAILED", normalizedGoal, attempts, results, "Tool failed and audit recording also failed; manual reconciliation may be required.");
      }
      return makeResult("FAILED", normalizedGoal, attempts, results, "Execution stopped after the first tool failure; no automatic action replay was attempted.");
    }

    let verified = null;
    const verification = await runWithTimeout(
      (signal) => verifyStep({
        tool: step.tool, input: step.input, expectedOutcome: step.expectedOutcome ?? "",
        output: executed.value, goal: normalizedGoal, context, signal
      }),
      timeout,
      "Verifier timed out."
    );
    if (!verification.error && verification.value?.verified === true
        && typeof verification.value.evidence === "string" && verification.value.evidence.trim()) {
      verified = {
        status: "VERIFIED",
        evidence: sanitizeAuditText(verification.value.evidence, 240),
        summary: sanitizeAuditText(verification.value.summary ?? "Acceptance criteria met.", 240)
      };
    }

    if (!verified) {
      const reason = verification.error
        ? compactError(verification.error)
        : sanitizeAuditText(verification.value?.reason ?? "Verifier did not provide evidence sufficient to establish success.", 240);
      results.push({
        index, tool: step.tool, status: "EXECUTED_UNVERIFIED", output: executed.value,
        verification: { status: "PENDING", reason }
      });
      try {
        await writeAudit(audit, { event: "tool_result_unverified", tool: step.tool, step: index, reason });
      } catch {
        return makeResult("FAILED", normalizedGoal, attempts, results, "Action ran but verification and audit confirmation are incomplete; reconcile before retry.");
      }
      return makeResult("PENDING", normalizedGoal, attempts, results, "A tool executed, but the expected outcome was not independently verified.");
    }

    results.push({ index, tool: step.tool, status: "EXECUTED", output: executed.value, verification: verified });
    try {
      await writeAudit(audit, {
        event: "tool_execution_verified", tool: step.tool, step: index,
        verificationEvidence: verified.evidence, status: "VERIFIED"
      });
    } catch {
      return makeResult("FAILED", normalizedGoal, attempts, results, "Action and verification may have completed, but audit confirmation failed; do not replay blindly.");
    }
  }

  if (results.every((result) => result.status === "DRY_RUN")) {
    return makeResult("PLANNED", normalizedGoal, attempts, results, "Plan validated in dry-run mode; no tool executor was invoked.");
  }
  return makeResult("COMPLETED", normalizedGoal, attempts, results, "All selected steps completed and have verifier evidence.");
}
