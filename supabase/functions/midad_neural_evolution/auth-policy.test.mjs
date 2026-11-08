import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedEvolutionRequest } from "./auth-policy.mjs";

test("fails closed when no autonomy, ingest or Vault key is configured", () => {
  assert.equal(isAuthorizedEvolutionRequest("anything", []), false);
  assert.equal(isAuthorizedEvolutionRequest("anything", ["", null, undefined]), false);
});

test("fails closed for missing and incorrect supplied keys", () => {
  assert.equal(isAuthorizedEvolutionRequest("", ["configured-key"]), false);
  assert.equal(isAuthorizedEvolutionRequest("wrong-key", ["configured-key"]), false);
});

test("accepts an exact match from any configured MIDAD key source", () => {
  assert.equal(isAuthorizedEvolutionRequest("autonomy-key", ["autonomy-key", "ingest-key"]), true);
  assert.equal(isAuthorizedEvolutionRequest("ingest-key", ["autonomy-key", "ingest-key"]), true);
  assert.equal(isAuthorizedEvolutionRequest("vault-key", ["vault-key"]), true);
});
