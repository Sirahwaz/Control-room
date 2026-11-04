import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessAdapterReadiness } from "../mobile/factory/x/adapter-policy.mjs";

const adapters = JSON.parse(readFileSync(new URL("../mobile/factory/x/adapters.registry.json", import.meta.url), "utf8")).adapters;
const bindings = JSON.parse(readFileSync(new URL("../mobile/factory/x/agent-bindings.registry.json", import.meta.url), "utf8")).bindings;
const integrationDoc = readFileSync(new URL("../docs/integrations/PANDACODE_ACP_BRIDGE_AR.md", import.meta.url), "utf8");

test("legacy adapters remain executable when they have no explicit status", () => {
  assert.deepEqual(assessAdapterReadiness({ id: "legacy", execution: "host_dispatch" }), {
    ready: true,
    reason: null,
  });
});

test("an explicitly active adapter remains executable", () => {
  assert.deepEqual(assessAdapterReadiness({ id: "active", status: "ACTIVE", execution: "host_dispatch" }), {
    ready: true,
    reason: null,
  });
});

test("pending, blocked, failed, disabled and unknown adapter states fail closed", () => {
  for (const status of ["PENDING", "BLOCKED", "FAILED", "DISABLED", "UNKNOWN"]) {
    assert.deepEqual(assessAdapterReadiness({ id: status, status, execution: "host_dispatch" }), {
      ready: false,
      reason: status === "UNKNOWN" ? "adapter_status_unrecognized" : "adapter_not_active",
    });
  }
});

test("execution none cannot dispatch even when status is active", () => {
  assert.deepEqual(assessAdapterReadiness({ id: "disabled", status: "ACTIVE", execution: "none" }), {
    ready: false,
    reason: "execution_disabled",
  });
});

test("missing adapter fails closed", () => {
  assert.deepEqual(assessAdapterReadiness(null), {
    ready: false,
    reason: "adapter_missing",
  });
});

test("PandaCode ACP candidate is explicitly pending and cannot dispatch", () => {
  const adapter = adapters.find((item) => item.id === "acp-stdio-pending");
  assert.ok(adapter, "ACP candidate adapter must be registered");
  assert.equal(adapter.status, "PENDING");
  assert.equal(adapter.execution, "none");
  assert.equal(adapter.secrets, "none");
  assert.equal(assessAdapterReadiness(adapter).ready, false);
  assert.equal(bindings.some((binding) => binding.adapter === adapter.id), false,
    "no production agent may bind to the pending ACP adapter");
});

test("integration contract keeps PandaCode optional and preserves MIDAD policy gates", () => {
  assert.match(integrationDoc, /PENDING/);
  assert.match(integrationDoc, /لا توجد واجهة HTTP عامة/);
  assert.match(integrationDoc, /MIDAD-FX-1/);
  assert.match(integrationDoc, /Human Approval/);
  assert.match(integrationDoc, /لا يتم تشغيل أوامر غير معروفة/);
  assert.match(integrationDoc, /لا تُنقل الأسرار/);
});
