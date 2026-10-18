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

test("blocks obvious credential material before invoking a provider", async () => {
  let called = false;
  const reasoner = createOpenAICompatibleReasoner({
    baseUrl: "https://provider.example/v1",
    apiKey: "test-key",
    model: "test-model",
    allowContextTransmission: true,
    fetchImpl: async () => { called = true; return { ok: true, json: async () => validResponse }; }
  });
  await assert.rejects(reasoner.plan({
    goal: "Inspect safely",
    context: { apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456" },
    tools: [{ name: "read_project", effect: "read", enabled: true }]
  }), /sensitive material blocked/i);
  assert.equal(called, false);
});

test("rejects query strings and embedded credentials in provider URLs", () => {
  assert.throws(() => createOpenAICompatibleReasoner({
    baseUrl: "https://user:pass@provider.example/v1",
    apiKey: "test-key",
    model: "test-model",
    allowContextTransmission: true
  }), /Credentials must not be embedded/i);
  assert.throws(() => createOpenAICompatibleReasoner({
    baseUrl: "https://provider.example/v1?api_key=do-not-use",
    apiKey: "test-key",
    model: "test-model",
    allowContextTransmission: true
  }), /query parameters/i);
});


test("blocks bearer credentials and JWT-like values before provider transmission", async () => {
  let called = false;
  const reasoner = createOpenAICompatibleReasoner({
    baseUrl: "https://provider.example/v1",
    apiKey: "test-key",
    model: "test-model",
    allowContextTransmission: true,
    fetchImpl: async () => { called = true; return { ok: true, json: async () => validResponse }; }
  });
  for (const text of [
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    "session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature-value"
  ]) {
    await assert.rejects(reasoner.plan({ goal: "Review context", context: { note: text } }), /sensitive material blocked/i);
  }
  assert.equal(called, false);
});

test("suppresses provider network exception details that may contain credentials", async () => {
  const reasoner = createOpenAICompatibleReasoner({
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "local-placeholder",
    model: "local-model",
    fetchImpl: async () => { throw new Error("socket failed Authorization: Bearer super-secret-value-123456789"); }
  });
  await assert.rejects(reasoner.plan({ goal: "Test" }), (error) => {
    assert.match(error.message, /details were suppressed/i);
    assert.doesNotMatch(error.message, /super-secret-value/);
    return true;
  });
});

test("aborts a stalled provider request and reports a bounded timeout", async () => {
  const reasoner = createOpenAICompatibleReasoner({
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "local-placeholder",
    model: "local-model",
    timeoutMs: 1000,
    fetchImpl: async (_url, options) => await new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  await assert.rejects(reasoner.plan({ goal: "Test timeout" }), (error) => error.name === "TimeoutError");
});
