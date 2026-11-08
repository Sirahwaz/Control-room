import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelGatewayAuthMode } from "./auth-policy.mjs";

test("recognizes the authenticated ingest caller without granting privileged autonomy scope", () => {
  assert.equal(resolveModelGatewayAuthMode({
    ingestHeader: "ingest-secret",
    ingestSecret: "ingest-secret",
    autonomyHeader: "",
    autonomySecret: "autonomy-secret"
  }), "ingest");
});

test("recognizes the autonomy service identity", () => {
  assert.equal(resolveModelGatewayAuthMode({
    ingestHeader: "",
    ingestSecret: "ingest-secret",
    autonomyHeader: "autonomy-secret",
    autonomySecret: "autonomy-secret"
  }), "autonomy");
});

test("prefers the autonomy identity when both credentials are present", () => {
  assert.equal(resolveModelGatewayAuthMode({
    ingestHeader: "ingest-secret",
    ingestSecret: "ingest-secret",
    autonomyHeader: "autonomy-secret",
    autonomySecret: "autonomy-secret"
  }), "autonomy");
});

test("fails closed for missing, empty, or mismatched credentials", () => {
  for (const input of [
    {},
    { ingestHeader: "wrong", ingestSecret: "ingest-secret" },
    { autonomyHeader: "wrong", autonomySecret: "autonomy-secret" },
    { ingestHeader: "ingest-secret", ingestSecret: "" },
    { autonomyHeader: "autonomy-secret", autonomySecret: "" }
  ]) assert.equal(resolveModelGatewayAuthMode(input), "unauthorized");
});
