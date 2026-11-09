import test from "node:test";
import assert from "node:assert/strict";
import { selectProviderForCapability } from "../provider-selection.mjs";
import { signRuntimeEvidenceEnvelope, RUNTIME_EVIDENCE_SCHEMA } from "../runtime-evidence.mjs";

const KEY = "factory-test-runtime-evidence-signing-key-not-for-production";
const NOW = Date.parse("2026-11-09T03:15:00.000Z");

const providers = [
  { id:"github", name:"GitHub", status:"known_available", kind:"source_ci",
    capabilities:["ci-cd-mobile","stateless-ci-execution"],
    runtime_capabilities:["stateless-ci-execution"], fallbacks:[], account_action:"none_by_default",
    runtime_class:"stateless_ci" },
  { id:"github-codespaces", name:"Codespaces", status:"discover_on_need", kind:"ephemeral_compute",
    capabilities:["ephemeral-dev-workspace"], runtime_capabilities:["ephemeral-dev-workspace"],
    runtime_class:"ephemeral", requires_quota_check:true, always_on_worker:false,
    fallbacks:[], account_action:"check_account_quota_and_approve_start" },
  { id:"midad-vps-control-node", name:"MIDAD VPS", status:"verification_required", kind:"self_hosted_control_plane",
    capabilities:["persistent-worker-runtime","durable-task-dispatch"],
    runtime_capabilities:["persistent-worker-runtime","durable-task-dispatch"],
    runtime_class:"persistent_control", health_requirements:{heartbeat_max_age_seconds:45},
    fallbacks:[], account_action:"verify_existing_host_and_capacity" },
  { id:"midad-playwright-worker", name:"MIDAD Playwright", status:"verification_required", kind:"self_hosted_browser",
    capabilities:["interactive-browser-execution","persistent-worker-runtime"],
    runtime_capabilities:["interactive-browser-execution","persistent-worker-runtime"],
    runtime_class:"persistent_browser", health_requirements:{heartbeat_max_age_seconds:45},
    fallbacks:[], account_action:"verify_fresh_heartbeat_before_dispatch" },
];

function envelopeFor(providerId, snapshot) {
  const payload = {
    schema: RUNTIME_EVIDENCE_SCHEMA,
    issued_at: new Date(NOW).toISOString(),
    providers: { [providerId]: {
      state:"READY", observed_at:new Date(NOW).toISOString(),
      capability_handshake:true, authenticated:true, estimated_cost_usd:0,
      ...snapshot,
    }},
  };
  return { ...payload, signature: signRuntimeEvidenceEnvelope(payload, KEY) };
}

test("native GitHub connector remains usable for its non-runtime capabilities", () => {
  const result = selectProviderForCapability({
    capability:"ci-cd-mobile", providers, now:NOW,
  });
  assert.equal(result.primary,"github");
  assert.equal(result.dispatch_allowed,false);
});

test("runtime-only provider cannot be selected without a signed evidence envelope", () => {
  const result = selectProviderForCapability({
    capability:"interactive-browser-execution", providers, signingKey:KEY, now:NOW,
  });
  assert.equal(result.primary,null);
  assert.equal(result.reason,"NO_PROVIDER_PASSED_RUNTIME_READINESS");
  assert.equal(result.candidates[0].reason,"RUNTIME_EVIDENCE_MISSING");
  assert.equal(result.dispatch_allowed,false);
});

test("Codespaces requires signed quota, lifecycle and machine-size evidence", () => {
  const envelope = envelopeFor("github-codespaces", {
    capabilities:["ephemeral-dev-workspace"],
    lifecycle_control:true, quota_remaining_minutes:120,
    machine_resources:{verified:true,memory_mb:4096,cpu_cores:4},
  });
  const result = selectProviderForCapability({
    capability:"ephemeral-dev-workspace", providers, evidenceEnvelope:envelope,
    signingKey:KEY, requirements:{duration_minutes:30,min_memory_mb:2048,max_cost_usd:0}, now:NOW,
  });
  assert.equal(result.primary,"github-codespaces");
  assert.equal(result.readiness_verified,true);
  assert.equal(result.dispatch_allowed,false);
});

test("Playwright requires a fresh authenticated browser runtime and encrypted session storage", () => {
  const envelope = envelopeFor("midad-playwright-worker", {
    capabilities:["interactive-browser-execution"],
    queue_authenticated:true, browser_installed:true,
    encrypted_session_store:true, available_slots:1,
  });
  const result = selectProviderForCapability({
    capability:"interactive-browser-execution", providers, evidenceEnvelope:envelope,
    signingKey:KEY, requirements:{max_cost_usd:0}, now:NOW,
  });
  assert.equal(result.primary,null);
  assert.equal(result.candidates[0].reason,"CAPABILITY_NOT_CONFIRMED");
});

test("provider evidence must cover the exact runtime capability being requested", () => {
  const envelope = envelopeFor("midad-playwright-worker", {
    capabilities:["interactive-browser-execution","persistent-worker-runtime"],
    queue_authenticated:true, browser_installed:true,
    encrypted_session_store:true, available_slots:1,
  });
  const result = selectProviderForCapability({
    capability:"interactive-browser-execution", providers, evidenceEnvelope:envelope,
    signingKey:KEY, requirements:{max_cost_usd:0}, now:NOW,
  });
  assert.equal(result.primary,"midad-playwright-worker");
  assert.equal(result.readiness_verified,true);
  assert.equal(result.dispatch_allowed,false);
});

test("a tampered runtime envelope cannot unlock a provider", () => {
  const envelope = envelopeFor("midad-playwright-worker", {
    capabilities:["interactive-browser-execution","persistent-worker-runtime"],
    queue_authenticated:true, browser_installed:true,
    encrypted_session_store:true, available_slots:1,
  });
  envelope.providers["midad-playwright-worker"].available_slots=99;
  const result = selectProviderForCapability({
    capability:"interactive-browser-execution", providers, evidenceEnvelope:envelope,
    signingKey:KEY, requirements:{max_cost_usd:0}, now:NOW,
  });
  assert.equal(result.primary,null);
  assert.equal(result.candidates[0].reason,"RUNTIME_EVIDENCE_SIGNATURE_INVALID");
});
