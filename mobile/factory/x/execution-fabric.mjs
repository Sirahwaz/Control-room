#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const requestPath = process.argv[2];
if (!requestPath) throw new Error("Usage: node mobile/factory/x/execution-fabric.mjs <request.json> [--dispatch-ready]");

const request = JSON.parse(fs.readFileSync(path.join(root, requestPath), "utf8"));
const cfg = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/x/factory-x.config.json"), "utf8"));
const agents = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/x/agents.registry.json"), "utf8")).agents;
const bindings = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/x/agent-bindings.registry.json"), "utf8")).bindings;
const adapters = JSON.parse(fs.readFileSync(path.join(root, "mobile/factory/x/adapters.registry.json"), "utf8")).adapters;

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

  const safety =
    binding.adapter === "human-gate" ||
    binding.action.includes("release") ||
    binding.action.includes("publish") ||
    binding.action.includes("migration")
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
const remaining = [...tasks];
while (remaining.length) {
  const safe = remaining.splice(
    0,
    maxParallel
  );
  waves.push(safe);
}

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
    secrets_in_client:false
  },
  blockers,
  waves,
  dispatch_contract:{
    required_fields:["task_id","agent","action","provider","adapter","dispatch_mode","safety"],
    external_execution:"only_when_provider_contract_and_credentials_are_available_server_side",
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
