import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileContext } from "./context-engine.mjs";
import { runBoundedAgent } from "./agent-kernel.mjs";
import { createOpenAICompatibleReasoner } from "./reasoner-adapter.mjs";
import { createMemoryStore } from "./memory-store.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 128 * 1024;
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/context-engine.mjs", ["context-engine.mjs", "text/javascript; charset=utf-8"]]
]);

function json(response, statusCode, value) {
  const payload = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  });
  response.end(payload);
}

function authorized(request, expected) {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const actualBytes = Buffer.from(header.slice(7), "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length
    && expectedBytes.length > 0
    && timingSafeEqual(actualBytes, expectedBytes);
}

function parseBody(request, maxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    let exceeded = false;
    const chunks = [];
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > maxBytes) {
        exceeded = true;
        chunks.length = 0;
      } else if (!exceeded) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (exceeded) {
        const error = new Error("Request body too large.");
        error.statusCode = 413;
        rejectBody(error);
        return;
      }
      try {
        resolveBody(JSON.parse(chunks.join("")));
      } catch {
        const error = new Error("Invalid JSON.");
        error.statusCode = 400;
        rejectBody(error);
      }
    });
    request.on("error", () => rejectBody(new Error("Could not read request body.")));
  });
}

function makeReasoner(env, fetchImpl) {
  if (!env.CONTEXT_FORGE_MODEL_BASE_URL || !env.CONTEXT_FORGE_MODEL_API_KEY || !env.CONTEXT_FORGE_MODEL) return null;
  try {
    return createOpenAICompatibleReasoner({
      baseUrl: env.CONTEXT_FORGE_MODEL_BASE_URL,
      apiKey: env.CONTEXT_FORGE_MODEL_API_KEY,
      model: env.CONTEXT_FORGE_MODEL,
      fetchImpl,
      allowContextTransmission: env.CONTEXT_FORGE_ALLOW_REMOTE_CONTEXT === "true",
      timeoutMs: Number(env.CONTEXT_FORGE_MODEL_TIMEOUT_MS) || 30000,
      maxSteps: Number(env.CONTEXT_FORGE_MAX_PLAN_STEPS) || 8
    });
  } catch {
    return null;
  }
}

export function createContextForgeServer({ env = process.env, fetchImpl = globalThis.fetch, auditWriter = null } = {}) {
  const token = env.CONTEXT_FORGE_RUNTIME_TOKEN;
  if (typeof token !== "string" || token.length < 32) {
    throw new Error("CONTEXT_FORGE_RUNTIME_TOKEN must contain at least 32 characters.");
  }
  const maxBytes = Math.max(1024, Math.min(1024 * 1024, Number(env.CONTEXT_FORGE_MAX_BODY_BYTES) || MAX_BODY_BYTES));
  const auditFile = resolve(env.CONTEXT_FORGE_AUDIT_PATH || resolve(process.cwd(), ".context-forge", "audit.jsonl"));
  const audit = auditWriter || (async (event) => {
    await mkdir(dirname(auditFile), { recursive: true, mode: 0o700 });
    await appendFile(auditFile, JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
  });
  const memoryFile = resolve(env.CONTEXT_FORGE_MEMORY_PATH || resolve(process.cwd(), ".context-forge", "memory.jsonl"));
  const memoryStore = createMemoryStore({
    filePath: memoryFile,
    ownerId: env.CONTEXT_FORGE_OWNER_ID || "local-user"
  });

  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/health" && request.method === "GET") {
      json(response, 200, {
        service: "context-forge",
        status: "ok",
        version: "0.1.0",
        reasonerReady: Boolean(makeReasoner(env, fetchImpl)),
        executionMode: "dry_run",
        externalActionsEnabled: false
      });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      if (!authorized(request, token)) {
        json(response, 401, { error: "Unauthorized." });
        return;
      }
      if (request.method !== "POST") {
        json(response, 405, { error: "Method not allowed." });
        return;
      }
      let body;
      try {
        body = await parseBody(request, maxBytes);
      } catch (error) {
        json(response, error.statusCode || 400, { error: error.statusCode === 413 ? "Request body too large." : "Invalid JSON request." });
        return;
      }

      if (url.pathname === "/api/context/compile") {
        if (typeof body?.text !== "string") {
          json(response, 400, { error: "text must be a string." });
          return;
        }
        json(response, 200, { context: compileContext(body.text) });
        return;
      }

      if (url.pathname === "/api/memory/save") {
        if (typeof body?.text !== "string" || !body.text.trim() || body.text.length > 8000) {
          json(response, 400, { error: "text must be non-empty and at most 8000 characters." });
          return;
        }
        try {
          const memory = await memoryStore.saveUserNote(body.text, {
            label: typeof body.sourceLabel === "string" ? body.sourceLabel : "user note"
          });
          json(response, 201, {
            memory,
            message: "Saved as PENDING; not independently verified."
          });
        } catch (error) {
          const isSensitive = String(error?.message || "").toLowerCase().includes("sensitive");
          json(response, 400, {
            code: isSensitive ? "SENSITIVE_MATERIAL_BLOCKED" : "MEMORY_SAVE_REJECTED",
            error: isSensitive ? "Potential sensitive material detected; the note was not saved." : "The note was not saved. Check the input length and format."
          });
        }
        return;
      }

      if (url.pathname === "/api/memory/search") {
        if (typeof body?.query !== "string" || !body.query.trim() || body.query.length > 500) {
          json(response, 400, { error: "query must be non-empty and at most 500 characters." });
          return;
        }
        try {
          const records = await memoryStore.search(body.query, { limit: body.limit });
          json(response, 200, { records, count: records.length, memoryMode: "local_single_user" });
        } catch {
          json(response, 500, { error: "Memory search failed closed." });
        }
        return;
      }

      if (url.pathname === "/api/memory/list") {
        try {
          const records = await memoryStore.list({ limit: body?.limit });
          json(response, 200, { records, count: records.length, memoryMode: "local_single_user" });
        } catch {
          json(response, 500, { error: "Memory could not be read." });
        }
        return;
      }

      if (url.pathname === "/api/agent/learn") {
        try {
          const report = await memoryStore.getLearningReport({ limit: body?.limit });
          json(response, 200, { ...report, executionMode: "dry_run" });
        } catch {
          json(response, 500, { status: "FAILED", error: "Learning report could not be read." });
        }
        return;
      }

      if (url.pathname === "/api/agent/cycle") {
        if (typeof body?.goal !== "string" || !body.goal.trim() || body.goal.length > 2000) {
          json(response, 400, { error: "goal must be a non-empty string under 2000 characters." });
          return;
        }
        if (typeof body?.contextText !== "string" || body.contextText.length > 100000) {
          json(response, 400, { error: "contextText must be a string under 100000 characters." });
          return;
        }
        const reasoner = makeReasoner(env, fetchImpl);
        if (!reasoner) {
          json(response, 503, {
            code: "REASONER_NOT_CONFIGURED",
            error: "No usable model provider is configured. The cycle remains pending."
          });
          return;
        }

        const contextPackage = compileContext(body.contextText);
        let relatedMemory;
        try {
          relatedMemory = await memoryStore.search(body.goal.slice(0, 500), { limit: 5 });
        } catch {
          json(response, 500, { code: "MEMORY_RETRIEVAL_FAILED", error: "Memory retrieval failed closed; planning was not started." });
          return;
        }
        const memoryForReasoner = relatedMemory.map((record) => ({
          id: record.id,
          text: record.text,
          status: record.status,
          recordType: record.recordType || "user_note",
          source: { type: record.source?.type || "unknown", label: record.source?.label || "unlabeled" }
        }));
        const toolRegistry = {
          inspect_context: {
            manifest: {
              name: "inspect_context",
              enabled: true,
              effect: "read",
              description: "Inspect the current context package and summary counts only. No external filesystem, network, or account access."
            },
            execute: async () => ({
              claimCount: contextPackage.claims.length,
              decisionCount: contextPackage.decisions.length,
              constraintCount: contextPackage.constraints.length,
              openQuestionCount: contextPackage.openQuestions.length,
              possibleConflictCount: contextPackage.conflicts.length
            })
          }
        };

        let result;
        try {
          result = await runBoundedAgent({
            goal: body.goal,
            context: { contextPackage, relevantMemory: memoryForReasoner },
            reasoner,
            toolRegistry,
            mode: "dry_run",
            audit
          });
        } catch {
          json(response, 502, { code: "PLANNER_FAILED", error: "Planning failed; details were withheld and no memory cycle was saved." });
          return;
        }

        const policyChecks = [
          { code: "NON_EMPTY_PLAN", passed: result.steps.length > 0 },
          { code: "TOOLS_ALLOWLISTED", passed: result.steps.every((step) => Boolean(toolRegistry[step.tool]?.manifest?.enabled)) },
          { code: "DRY_RUN_ONLY", passed: result.steps.every((step) => step.status === "DRY_RUN") },
          { code: "INPUTS_SCHEMA_VALID", passed: result.steps.every((step) => step.plannedInput && typeof step.plannedInput === "object" && !Array.isArray(step.plannedInput)) },
          { code: "EXPECTED_OUTCOME_SCHEMA_VALID", passed: result.steps.every((step) => typeof step.expectedOutcome === "string") }
        ];
        const planVerified = result.status === "PLANNED"
          && policyChecks.every((check) => check.passed);
        const planId = createHash("sha256")
          .update(JSON.stringify({
            goal: body.goal,
            contextHash: createHash("sha256").update(body.contextText).digest("hex"),
            steps: result.steps.map((step) => ({
              tool: step.tool,
              status: step.status,
              expectedOutcome: step.expectedOutcome,
              effect: step.effect
            }))
          }))
          .digest("hex")
          .slice(0, 24);

        if (!planVerified) {
          json(response, 200, {
            planId,
            taskStatus: "PENDING",
            executionMode: "dry_run",
            externalActionsEnabled: false,
            stages: {
              context: { status: "VERIFIED", claims: contextPackage.claims.length, warnings: contextPackage.warnings.length },
              plan: { status: result.status, attempts: result.attempts },
              verify: { status: "PENDING", scope: "plan_policy_only", checks: policyChecks },
              memory: { status: "NOT_SAVED" },
              learn: { status: "PENDING", reason: "A plan must pass deterministic policy checks before learning metadata is stored." }
            },
            steps: result.steps,
            reason: result.reason
          });
          return;
        }

        const contextHash = createHash("sha256").update(body.contextText).digest("hex");
        const stepsWithExpectedOutcome = result.steps.filter((step) => step.expectedOutcome.trim().length > 0).length;
        const recommendations = [];
        if (stepsWithExpectedOutcome < result.steps.length) {
          recommendations.push("Add expected outcomes for every planned step.");
        }
        if (contextPackage.conflicts.length > 0) {
          recommendations.push("Resolve pending context conflicts before authorizing any action.");
        }
        if (contextPackage.openQuestions.length > 0) {
          recommendations.push("Resolve open questions that materially affect the requested goal.");
        }
        if (relatedMemory.length === 0) {
          recommendations.push("Add source-linked memory notes when durable project context is needed.");
        }
        if (recommendations.length === 0) {
          recommendations.push("Keep the workflow in dry-run until the intended outcome can be independently verified.");
        }
        const learning = {
          status: "INFERRED",
          signals: {
            stepCount: result.steps.length,
            stepsWithExpectedOutcome,
            contextConflictCount: contextPackage.conflicts.length,
            retrievedMemoryCount: relatedMemory.length
          },
          recommendations
        };
        const evidenceHash = createHash("sha256")
          .update(JSON.stringify({
            planId,
            checks: policyChecks,
            steps: result.steps.map((step) => ({
              tool: step.tool,
              expectedOutcome: step.expectedOutcome,
              effect: step.effect
            }))
          }))
          .digest("hex");

        let memoryRecord;
        try {
          memoryRecord = await memoryStore.saveAgentCycle({
            goal: body.goal,
            contextHash,
            planId,
            planVerification: {
              status: "VERIFIED",
              scope: "plan_policy_only",
              method: "deterministic_plan_policy",
              evidenceHash,
              checks: policyChecks
            },
            plannedSteps: result.steps.map((step) => ({
              tool: step.tool,
              effect: step.effect,
              expectedOutcome: step.expectedOutcome
            })),
            relatedMemoryIds: relatedMemory.map((record) => record.id),
            learning
          });
        } catch {
          json(response, 500, {
            code: "CYCLE_MEMORY_SAVE_FAILED",
            planId,
            taskStatus: "PENDING",
            executionMode: "dry_run",
            stages: {
              context: { status: "VERIFIED" },
              plan: { status: "PLANNED" },
              verify: { status: "VERIFIED", scope: "plan_policy_only", checks: policyChecks },
              memory: { status: "FAILED" },
              learn: { status: "NOT_PERSISTED" }
            },
            error: "The plan passed policy checks, but the cycle record was not saved."
          });
          return;
        }

        try {
          await audit({
            event: "agent_cycle_saved",
            planId,
            memoryId: memoryRecord.id,
            planVerification: "VERIFIED",
            taskStatus: "PENDING",
            learningStatus: "INFERRED"
          });
        } catch {
          json(response, 500, {
            code: "CYCLE_AUDIT_CONFIRMATION_FAILED",
            planId,
            memoryId: memoryRecord.id,
            taskStatus: "PENDING",
            executionMode: "dry_run",
            error: "The cycle memory was saved but the final audit confirmation failed; reconcile before retry."
          });
          return;
        }

        json(response, 200, {
          planId,
          memoryId: memoryRecord.id,
          taskStatus: "PENDING",
          executionMode: "dry_run",
          externalActionsEnabled: false,
          relatedMemory: memoryForReasoner.map((record) => ({
            id: record.id, status: record.status, recordType: record.recordType
          })),
          stages: {
            context: {
              status: "VERIFIED",
              schemaVersion: contextPackage.schemaVersion,
              claims: contextPackage.claims.length,
              warnings: contextPackage.warnings.length
            },
            plan: { status: "PLANNED", attempts: result.attempts, stepCount: result.steps.length },
            verify: { status: "VERIFIED", scope: "plan_policy_only", checks: policyChecks, evidenceHash },
            memory: { status: "SAVED", recordId: memoryRecord.id, recordStatus: memoryRecord.status },
            learn: { status: "INFERRED", recommendations, signals: learning.signals }
          },
          steps: result.steps.map((step) => ({
            tool: step.tool,
            status: step.status,
            plannedInput: step.plannedInput,
            effect: step.effect,
            expectedOutcome: step.expectedOutcome
          })),
          contextDiagnostics: {
            decisions: contextPackage.decisions.length,
            constraints: contextPackage.constraints.length,
            openQuestions: contextPackage.openQuestions.length,
            possibleConflicts: contextPackage.conflicts.length
          },
          note: "Plan-policy verification is not task completion. No tools were executed."
        });
        return;
      }

      if (url.pathname === "/api/agent/plan") {
        if (typeof body?.goal !== "string" || !body.goal.trim() || body.goal.length > 2000) {
          json(response, 400, { error: "goal must be a non-empty string under 2000 characters." });
          return;
        }
        if (typeof body?.contextText !== "string" || body.contextText.length > 100000) {
          json(response, 400, { error: "contextText must be a string under 100000 characters." });
          return;
        }
        const reasoner = makeReasoner(env, fetchImpl);
        if (!reasoner) {
          json(response, 503, {
            code: "REASONER_NOT_CONFIGURED",
            error: "No usable model provider is configured. Remote providers require explicit remote-context opt-in."
          });
          return;
        }

        const contextPackage = compileContext(body.contextText);
        const toolRegistry = {
          inspect_context: {
            manifest: {
              name: "inspect_context",
              enabled: true,
              effect: "read",
              description: "Inspect supplied Context Forge metadata only. No external filesystem, network, or account access."
            },
            execute: async () => ({
              claimCount: contextPackage.claims.length,
              decisionCount: contextPackage.decisions.length,
              constraintCount: contextPackage.constraints.length,
              openQuestionCount: contextPackage.openQuestions.length,
              possibleConflictCount: contextPackage.conflicts.length
            })
          }
        };

        let result;
        try {
          result = await runBoundedAgent({
            goal: body.goal,
            context: contextPackage,
            reasoner,
            toolRegistry,
            mode: "dry_run",
            audit
          });
        } catch {
          json(response, 502, { code: "PLANNER_FAILED", error: "Planning failed; sensitive provider details were withheld." });
          return;
        }

        const planId = createHash("sha256")
          .update(JSON.stringify({
            goal: body.goal,
            schemaVersion: contextPackage.schemaVersion,
            generatedAt: contextPackage.generatedAt
          }))
          .digest("hex")
          .slice(0, 16);
        json(response, result.status === "FAILED" ? 502 : 200, {
          planId,
          status: result.status,
          executionMode: "dry_run",
          externalActionsEnabled: false,
          attempts: result.attempts,
          steps: result.steps,
          reason: result.reason,
          contextDiagnostics: {
            claims: contextPackage.claims.length,
            decisions: contextPackage.decisions.length,
            constraints: contextPackage.constraints.length,
            openQuestions: contextPackage.openQuestions.length,
            possibleConflicts: contextPackage.conflicts.length,
            warningCount: contextPackage.warnings.length
          }
        });
        return;
      }

      json(response, 404, { error: "Unknown API endpoint." });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { error: "Method not allowed." });
      return;
    }
    const item = STATIC_FILES.get(url.pathname);
    if (!item) {
      json(response, 404, { error: "Not found." });
      return;
    }
    try {
      const content = await readFile(resolve(ROOT, item[0]));
      response.writeHead(200, {
        "Content-Type": item[1],
        "Content-Length": content.length,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      json(response, 500, { error: "Static asset unavailable." });
    }
  });
}

const ownFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === ownFile) {
  const host = process.env.CONTEXT_FORGE_HOST || "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("This preview runtime binds to loopback only. Remote hosting requires a separately reviewed deployment adapter.");
  }
  const port = Number(process.env.CONTEXT_FORGE_PORT) || 8787;
  const server = createContextForgeServer();
  server.listen(port, host, () => {
    console.log("Context Forge runtime listening at http://" + host + ":" + port);
    console.log("Runtime mode is DRY_RUN; external actions are not exposed.");
  });
}
