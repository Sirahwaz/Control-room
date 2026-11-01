import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelProvider } from "./provider-config.mjs";

test("selects OpenAI using only the server-side OpenAI key", () => {
  const result = resolveModelProvider("openai", {
    OPENAI_API_KEY: "server-secret",
  });
  assert.equal(result.provider, "openai");
  assert.equal(result.baseUrl, "https://api.openai.com/v1");
  assert.equal(result.apiKey, "server-secret");
  assert.equal(result.configured, true);
});

test("supports APIMIX without changing its existing endpoint", () => {
  const result = resolveModelProvider("apmix", {
    MIDAD_APMIX_API_KEY: "apmix-secret",
    MIDAD_APMIX_BASE_URL: "https://api.apmix.ai/v1",
  });
  assert.equal(result.provider, "apmix");
  assert.equal(result.baseUrl, "https://api.apmix.ai/v1");
  assert.equal(result.apiKey, "apmix-secret");
  assert.equal(result.configured, true);
});

test("fails closed when an OpenAI-compatible provider has no key", () => {
  const result = resolveModelProvider("openai", {});
  assert.equal(result.configured, false);
  assert.equal(result.apiKey, "");
});

test("rejects unknown provider slugs rather than silently routing them", () => {
  assert.throws(() => resolveModelProvider("unknown", {}), /unsupported_model_provider/);
});
