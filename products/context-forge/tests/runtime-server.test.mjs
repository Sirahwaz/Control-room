import test from "node:test";
import assert from "node:assert/strict";
import { createContextForgeServer } from "../runtime-server.mjs";

const TEST_TOKEN = "test-runtime-token-" + "x".repeat(40);

async function withServer(options, run) {
  const server = createContextForgeServer({
    env: { CONTEXT_FORGE_RUNTIME_TOKEN: TEST_TOKEN, ...options.env },
    auditWriter: options.auditWriter ?? (async () => {}),
    fetchImpl: options.fetchImpl ?? (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ steps: [] }) } }] }) }))
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health exposes only non-secret readiness metadata", async () => {
  await withServer({}, async (base) => {
    const response = await fetch(base + "/api/health");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.reasonerReady, false);
    assert.equal(body.executionMode, "dry_run");
    assert.equal(JSON.stringify(body).includes("test-runtime-token"), false);
  });
});

test("protected context endpoint rejects missing or wrong bearer token", async () => {
  await withServer({}, async (base) => {
    const response = await fetch(base + "/api/context/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
      body: JSON.stringify({ text: "Goal: test local compile" })
    });
    assert.equal(response.status, 401);
  });
});

test("context API compiles locally and keeps user claims unverified", async () => {
  await withServer({}, async (base) => {
    const response = await fetch(base + "/api/context/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TEST_TOKEN },
      body: JSON.stringify({ text: "Goal: test local compile\nDecision: keep source lineage" })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.context.schemaVersion, "context-forge/0.1");
    assert.equal(body.context.claims[0].status, "UNVERIFIED");
    assert.equal(body.context.claims[0].source.type, "user_input");
  });
});

test("plan endpoint reports provider configuration as pending", async () => {
  await withServer({}, async (base) => {
    const response = await fetch(base + "/api/agent/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TEST_TOKEN },
      body: JSON.stringify({ goal: "Plan a test", contextText: "Goal: test" })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, "REASONER_NOT_CONFIGURED");
  });
});

test("configured local provider returns a plan in dry-run without executing tools", async () => {
  let toolExecuted = false;
  await withServer({
    env: {
      CONTEXT_FORGE_MODEL_BASE_URL: "http://127.0.0.1:11434/v1",
      CONTEXT_FORGE_MODEL_API_KEY: "local-placeholder",
      CONTEXT_FORGE_MODEL: "local-test-model"
    },
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.match(request.messages[0].content, /do not execute tools/i);
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                steps: [{
                  tool: "inspect_context",
                  input: {},
                  expectedOutcome: "Context diagnostics are available"
                }]
              })
            }
          }]
        })
      };
    }
  }, async (base) => {
    const response = await fetch(base + "/api/agent/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TEST_TOKEN },
      body: JSON.stringify({ goal: "Inspect context quality", contextText: "Goal: test quality" })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "PLANNED");
    assert.equal(body.executionMode, "dry_run");
    assert.equal(body.steps[0].status, "DRY_RUN");
    assert.equal(toolExecuted, false);
  });
});

test("remote model use remains blocked unless remote context transmission is explicitly enabled", async () => {
  await withServer({
    env: {
      CONTEXT_FORGE_MODEL_BASE_URL: "https://provider.example/v1",
      CONTEXT_FORGE_MODEL_API_KEY: "test-key",
      CONTEXT_FORGE_MODEL: "test-model"
    }
  }, async (base) => {
    const health = await (await fetch(base + "/api/health")).json();
    assert.equal(health.reasonerReady, false);
    const response = await fetch(base + "/api/agent/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TEST_TOKEN },
      body: JSON.stringify({ goal: "Plan safely", contextText: "Goal: test" })
    });
    assert.equal(response.status, 503);
  });
});

test("oversized request body is rejected", async () => {
  await withServer({}, async (base) => {
    const response = await fetch(base + "/api/context/compile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + TEST_TOKEN,
      },
      body: JSON.stringify({ text: "x".repeat(140 * 1024) })
    });
    assert.equal(response.status, 413);
  });
});

test("serves the standalone planner UI with restrictive headers and no server code exposure", async () => {
  await withServer({}, async (base) => {
    const response = await fetch(base + "/");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Context Forge/);
    assert.match(html, /agent-plan-button/);
    assert.match(response.headers.get("content-security-policy") || "", /connect-src 'self'/);

    const hidden = await fetch(base + "/agent-kernel.mjs");
    assert.equal(hidden.status, 404);
  });
});

test("requires a strong local runtime token at startup", () => {
  assert.throws(() => createContextForgeServer({
    env: { CONTEXT_FORGE_RUNTIME_TOKEN: "too-short" },
    auditWriter: async () => {}
  }), /at least 32 characters/i);
});
