import test from "node:test";
import assert from "node:assert/strict";
import { resolveAIRouterAuthMode } from "./auth-policy.mjs";

test("ingest identity cannot claim privileged public-sanitized routing", () => {
  assert.equal(resolveAIRouterAuthMode({
    ingestHeader: "ingest-secret",
    ingestSecret: "ingest-secret",
    autonomyHeader: "",
    autonomySecret: "autonomy-secret"
  }), "ingest");
});

test("autonomy service identity is privileged", () => {
  assert.equal(resolveAIRouterAuthMode({
    ingestHeader: "",
    ingestSecret: "ingest-secret",
    autonomyHeader: "autonomy-secret",
    autonomySecret: "autonomy-secret"
  }), "autonomy");
});

test("autonomy identity takes precedence when both credentials are present", () => {
  assert.equal(resolveAIRouterAuthMode({
    ingestHeader: "ingest-secret",
    ingestSecret: "ingest-secret",
    autonomyHeader: "autonomy-secret",
    autonomySecret: "autonomy-secret"
  }), "autonomy");
});

test("rejects missing, empty and mismatched credentials", () => {
  for (const input of [
    {},
    { ingestHeader: "wrong", ingestSecret: "ingest-secret" },
    { autonomyHeader: "wrong", autonomySecret: "autonomy-secret" },
    { ingestHeader: "ingest-secret", ingestSecret: "" },
    { autonomyHeader: "autonomy-secret", autonomySecret: "" }
  ]) assert.equal(resolveAIRouterAuthMode(input), "unauthorized");
});

// Pull the caller/source integration contract into the existing AI Router test gate.
import "../../../tests/ai-router-caller-auth-contract.test.mjs";
