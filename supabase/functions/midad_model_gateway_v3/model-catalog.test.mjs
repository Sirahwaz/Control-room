import test from "node:test";
import assert from "node:assert/strict";
import { parseModelCatalog } from "./model-catalog.mjs";

test("parses a root-level list of model objects", () => {
  assert.deepEqual(
    parseModelCatalog([{ id: "claude-sonnet-4-6" }, { id: "google/gemini-3.8-flash" }]).models,
    ["claude-sonnet-4-6", "google/gemini-3.8-flash"]
  );
});

test("parses a root-level list of string model IDs", () => {
  assert.deepEqual(parseModelCatalog(["model-a", "model-b"]).models, ["model-a", "model-b"]);
});

test("keeps OpenAI-compatible data-array responses working", () => {
  assert.deepEqual(parseModelCatalog({ data: [{ id: "model-a" }] }).models, ["model-a"]);
});

test("supports alternate models and nested data.models containers", () => {
  assert.deepEqual(parseModelCatalog({ models: [{ name: "model-a" }] }).models, ["model-a"]);
  assert.deepEqual(parseModelCatalog({ data: { models: [{ model: "model-b" }] } }).models, ["model-b"]);
});

test("deduplicates IDs and fails closed for unrecognized payloads", () => {
  assert.deepEqual(parseModelCatalog(["model-a", "model-a", { id: "model-a" }]).models, ["model-a"]);
  const invalid = parseModelCatalog({ message: "unrecognized shape" });
  assert.deepEqual(invalid.models, []);
  assert.equal(invalid.shape, "object.no_model_array");
});
