import test from "node:test";
import assert from "node:assert/strict";
import { parseGeminiModels } from "./gemini-catalog.mjs";

test("parses Google models.list response and normalizes models/ prefix", () => {
  const result = parseGeminiModels({
    models: [
      { name: "models/gemini-3.8-flash", displayName: "Gemini Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemma-4-31b-it", displayName: "Gemma", supportedGenerationMethods: ["generateContent"] }
    ]
  });
  assert.equal(result.shape, "models");
  assert.deepEqual(result.models.map(m => m.id), ["gemini-3.8-flash", "gemma-4-31b-it"]);
  assert.equal(result.models[0].supports_generate_content, true);
});

test("parses a direct array for compatible providers without inventing model IDs", () => {
  const result = parseGeminiModels([{ name: "models/gemini-3.8-flash" }]);
  assert.deepEqual(result.models.map(m => m.id), ["gemini-3.8-flash"]);
});

test("deduplicates model identifiers and strips unsafe metadata", () => {
  const result = parseGeminiModels({
    models: [
      { name: "models/gemini-3.8-flash", displayName: "Gemini", supportedGenerationMethods: ["generateContent"], apiKey: "must-not-return" },
      { name: "gemini-3.8-flash", displayName: "Duplicate", supportedGenerationMethods: ["generateContent"] }
    ]
  });
  assert.equal(result.models.length, 1);
  assert.equal(JSON.stringify(result).includes("must-not-return"), false);
  assert.equal(JSON.stringify(result).includes("apiKey"), false);
});

test("fails closed on malformed or unknown catalog shape", () => {
  const result = parseGeminiModels({ error: { message: "not a catalog" } });
  assert.deepEqual(result.models, []);
  assert.equal(result.shape, "object.no_model_array");
});
