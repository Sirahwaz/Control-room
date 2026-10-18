import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAICompatibleReasoner } from "../reasoner-adapter.mjs";

const validResponse = {
  choices: [{
    message: {
      content: JSON.stringify({
        steps: [{
          tool: "read_project",
          input: { path: "README.md" },
          expectedOutcome: "Source is read"
        }]
      })
    }
  }]
};

test("requires endpoint, key and model configuration", () => {
  assert.throws(() => createOpenAICompatibleReasoner({}), /baseUrl/i);
  assert.throws(() => createOpenAICompatibleReasoner({ baseUrl: "https://provider.example/v1" }), /apiKey/i);
});

test("blocks remote context transmission unless explicitly enabled", () => {
  assert.throws(() => createOpenAICompatibleReasoner({
    baseUrl: "https://provider.example/v1", apiKey: "test-key", model: "test-model"
  }), /allowContextTransmission/i);
});

test("rejects insecure non-loopback endpoints", () => {
  assert.throws(() => createOpenAICompatibleReasoner({
    baseUrl: "http://provider.example/v1", apiKey: "test-key", model: "test-model",
    allowContextTransmission: true
  }), /HTTPS/i);
});

test("requests a structured plan and validates the returned tool steps", async () => {
  let request;
  const reasoner = createOpenAICompatibleReasoner({
    baseUrl: "https://provider.example/v1/",
    apiKey: "test-key",
    model: "test-model",
    allowContextTransmission: true,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => validResponse };
    }
  });
  const plan = await reasoner.plan({
    goal: "Inspect project",
    context: { objective: "Check source" },
    tools: [{ name: "read_project", effect: "read", enabled: true }]
  });

  assert.equal(request.url, "https://provider.example/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(plan.steps[0], {
    tool: "read_project",
    input: { path: "README.md" },
    expectedOutcome: "Source is read"
  });
  assert.match(request.body.messages[1].content, /read_project/);
});

test("rejects malformed planner JSON and non-object tool input", async () => {
  const malformed = createOpenAICompatibleReasoner({
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "local-placeholder",
    model: "local-model",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not-json" } }] })
    })
  });
  await assert.rejects(malformed.plan({ goal: "Test" }), /valid JSON/i);

  const invalidInputResponse = {
    choices: [{
      message: {
        content: JSON.stringify({
          steps: [{ tool: "read_project", input: "shell command" }]
        })
      }
    }]
  };
  const invalidShape = createOpenAICompatibleReasoner({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "local-placeholder",
    model: "local-model",
    fetchImpl: async () => ({ ok: true, json: async () => invalidInputResponse })
  });
  await assert.rejects(invalidShape.plan({
    goal: "Test",
    tools: [{ name: "read_project", effect: "read", enabled: true }]
  }), /input must be a JSON object/i);
});

test("rejects tools that are not in the caller-provided allow-list", async () => {
  const reasoner = createOpenAICompatibleReasoner({
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "local-placeholder",
    model: "local-model",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ steps: [{ tool: "run_shell", input: {} }] })
          }
        }]
      })
    })
  });
  await assert.rejects(reasoner.plan({ goal: "Test", tools: [] }), /unregistered tool/i);
});

test("does not expose response bodies on provider errors", async () => {
  const reasoner = createOpenAICompatibleReasoner({
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "local-placeholder",
    model: "local-model",
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => "secret details" })
  });
  await assert.rejects(reasoner.plan({ goal: "Test" }), /HTTP 429/);
});
