import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileContext } from "./context-engine.mjs";
import { runBoundedAgent } from "./agent-kernel.mjs";
import { createOpenAICompatibleReasoner } from "./reasoner-adapter.mjs";

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
