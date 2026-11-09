#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { selectExecutionSubstrate } from "./runtime-readiness.mjs";
import { verifyRuntimeEvidenceEnvelope } from "./runtime-evidence.mjs";

const root = process.cwd();
const requestPath = process.argv[2];
if (!requestPath) throw new Error("Usage: node mobile/factory/x/execution-fabric.mjs <request.json> [--dispatch-ready]");

const request = JSON.parse(fs.readFileSync(path.join(root, requestPath), "utf8"));
const cfg = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/x/factory-x.config.json"), "utf8"));
const agents = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/x/agents.registry.json"), "utf8")).agents;
const bindings = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/x/agent-bindings.registry.json"), "utf8")).bindings;
const adapters = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/x/adapters.registry.json"), "utf8")).adapters;
const providers = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/x/providers.registry.json"), "utf8")).providers;

// Runtime health is accepted only from an HMAC-signed local envelope. The HMAC
// key is injected by the trusted runner environment and never appears in the plan.
const runtimeEvidencePath = process.env.MIDAD_FACTORY_RUNTIME_EVIDENCE || "";
const runtimeEvidenceKey = process.env.MIDAD_FACTORY_RUNTIME_EVIDENCE_HMAC_KEY || "";
let runtimeEvidence = {
  ok: false,
  reason: "RUNTIME_EVIDENCE_NOT_CONFIGURED",
  providers: {},
  age_ms: null,
};
if (runtimeEvidencePath && runtimeEvidenceKey) {
  try {
    const evidencePath = path.isAbsolute(runtimeEvidencePath)
      ? runtimeEvidencePath
      : path.join(root, runtimeEvidencePath);
    if (existsSync(evidencePath)) {
      const envelope = JSON.parse(readFileSync(evidencePath, "utf8"));
      runtimeEvidence = verifyRuntimeEvidenceEnvelope(envelope, runtimeEvidenceKey);
    } else {
      runtimeEvidence.reason = "RUNTIME_EVIDENCE_FILE_MISSING";
    }
  } catch {
    runtimeEvidence = {
      ok: false,
      reason: "RUNTIME_EVIDENCE_READ_OR_VERIFY_FAILED",
      providers: {},
      age_ms: null,
    };
  }
}

const runtimeCapabilities = Array.isArray(request.execution_capabilities)
  ? [...new Set(request.execution_capabilities.map(String).filter(Boolean))]
  : [
      "stateless-ci-execution",
      "ephemeral-dev-workspace",
      "persistent-worker-runtime",
      "durable-task-dispatch",
      "interactive-browser-execution",
    ];
const runtimeSubstratePlans = runtimeCapabilities.map(capability =>
  selectExecutionSubstrate({
    capability,
    max_cost_usd: Number.isFinite(Number(request.max_cost_usd))
      ? Number(request.max_cost_usd)
      : 0,
    duration_minutes: Number.isFinite(Number(request.duration_minutes))
      ? Number(request.duration_minutes)
      : 0,
    min_memory_mb: Number.isFinite(Number(request.min_memory_mb))
      ? Number(request.min_memory_mb)
      : 0,
    min_disk_mb: Number.isFinite(Number(request.min_disk_mb))
      ? Number(request.min_disk_mb)
      : 0,
    min_cpu_cores: Number.isFinite(Number(request.min_cpu_cores))
      ? Number(request.min_cpu_cores)
      : 0,
  }, providers, runtimeEvidence.providers, Date.now())
);

const bindingByAgent = new Map(bindings.map(b => [b.agent, b]));
const adapterById = new Map(adapters.map(a => [a.id, a]));
const agentById = new Map(agents.map(a => [a.id, a]));
const maxParallel = Math.min(
  Number(cfg.execution.max_parallel_agents || 1),
  Number(cfg.execution.max_parallel_tasks || 1)
);

const requested = Array.isArray(request.agent_ids)
  ? request.agent_ids
  : agents.map(a => a.id);

const tasks = [];
const blockers = [];

for (const agentId of requested) {
  const agent = agentById.get(agentId);
  const binding = bindingByAgent.get(agentId);

  if (!agent) {
    blockers.push({agent: agentId, reason:"unknown_agent"});
    continue;
  }
  if (!binding) {
    blockers.push({agent: agentId, reason:"missing_binding"});
    continue;
  }

  const adapter = adapterById.get(binding.adapter);
  if (!adapter) {
    blockers.push({agent: agentId, reason:"missing_adapter",adapter:binding.adapter});
    continue;
  }

  const requestedCaps = new Set(Array.isArray(request.capability_tags) ? request.capability_tags : []);
  const fit = binding.capabilities.filter(c => requestedCaps.size === 0 || requestedCaps.has(c)).length;
  const fitScore = binding.capabilities.length ? Number((fit / binding.capabilities.length).toFixed(3)) : 0;

  const irreversible = ["publish","transfer","withdraw","execute","delete","credential","production"].some(
    token => String(binding.action).toLowerCase().includes(token)
  );
  const safety =
    binding.adapter === "human-gate" || irreversible
      ? "HUMAN_GATE_OR_POLICY_CHECK"
      : "AUTO_ALLOWED";

  const dispatchMode = adapter.execution;
  const ready = dispatchMode !== "none";

  tasks.push({
    task_id: crypto.createHash("sha256").update(JSON.stringify({
      run:request.run_key ?? request.product_key,
      agent:agentId,
      action:binding.action,
      provider:binding.primary
    })).digest("hex").slice(0,16),
    agent:agentId,
    domain:agent.domain,
    action:binding.action,
    capabilities:binding.capabilities,
    provider:{
      primary:binding.primary,
      fallback:binding.fallback
    },
    adapter:binding.adapter,
    dispatch_mode:dispatchMode,
    safety,
    parallel_safe:Boolean(agent.parallel_safe),
    fit_score:fitScore,
    ready
  });
}

const waves = [];
let safeWave = [];
for (const item of tasks) {
  if (!item.parallel_safe) {
    if (safeWave.length) {
      waves.push(safeWave);
      safeWave = [];
    }
    waves.push([item]);
    continue;
  }
  safeWave.push(item);
  if (safeWave.length >= maxParallel) {
    waves.push(safeWave);
    safeWave = [];
  }
}
if (safeWave.length) waves.push(safeWave);

const result = {
  ok:blockers.length===0,
  protocol:"MIDAD-FX-1",
  factory:"MIDAD Mobile Factory X",
  mode:request.mode ?? "dispatch-ready",
  run_key:request.run_key ?? crypto.randomUUID(),
  counts:{
    requested:requested.length,
    dispatch_tasks:tasks.length,
    blockers:blockers.length,
    waves:waves.length
  },
  parallelism:{
    configured_max_agents:Number(cfg.execution.max_parallel_agents),
    configured_max_tasks:Number(cfg.execution.max_parallel_tasks),
    max_dispatch_per_wave:maxParallel
  },
  policy:{
    need_first_provider_second:true,
    reuse_before_rebuild:true,
    fallback_required:true,
    human_gate_for_irreversible:true,
    secrets_in_client:false,
    signed_runtime_evidence_required:true,
    dispatch_requires_atomic_lease:true,
    dispatch_requires_live_recheck:true
  },
  runtime_readiness:{
    verified:runtimeEvidence.ok,
    reason:runtimeEvidence.reason,
    envelope_age_ms:runtimeEvidence.age_ms
  },
  runtime_substrate_plans:runtimeSubstratePlans,
  dispatch_allowed:false,
  execution_performed:false,
  plan_only:true,
  blockers,
  waves,
  dispatch_contract:{
    required_fields:["task_id","agent","action","provider","adapter","dispatch_mode","safety"],
    external_execution:"requires_signed_runtime_evidence_atomic_lease_and_trusted_dispatcher",
    runtime_substrate_selection:"evidence_gated_plan_only",
    dispatch_allowed:false,
    execution_performed:false,
    native_connectors:"host_dispatch",
    human_gate:"approval_queue"
  }
};

fs.writeFileSync(
  path.join(root, "mobile/factory/x/fabric-plan.json"),
  JSON.stringify(result, null, 2) + "\n"
);
console.log(JSON.stringify({
  ok:result.ok,
  requested:result.counts.requested,
  dispatch_tasks:result.counts.dispatch_tasks,
  blockers:result.counts.blockers,
  waves:result.counts.waves,
  max_dispatch_per_wave:maxParallel
}));
