#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const reqPath = process.argv[2];
if (!reqPath) throw new Error("Usage: node mobile/factory/x/plan.mjs <request.json>");
const readJson = p => JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));

const req = readJson(reqPath);
const caps = readJson("mobile/factory/x/capabilities.registry.json").capabilities;
const providers = readJson("mobile/factory/x/providers.registry.json").providers;
const plugins = readJson("mobile/factory/x/plugins.registry.json").plugins;
const agents = readJson("mobile/factory/x/agents.registry.json").agents;
const automations = readJson("mobile/factory/x/automations.registry.json").automations;
const policy = readJson("mobile/factory/x/selection.policy.json");
const factoryCfg = readJson("mobile/factory/x/factory-x.config.json");

const textBlob = JSON.stringify(req).toLowerCase();
const requestedTags = new Set(Array.isArray(req.capability_tags) ? req.capability_tags.map(String) : []);
const inferred = caps.filter(c => c.tags.some(t => requestedTags.has(t) || textBlob.includes(t)));
const capabilityPlan = [...new Set(inferred.map(c=>c.id))];

const reuseRank = {always:0,preferred:1,on_demand:2};
const pluginPlan = plugins
  .filter(p => p.capabilities.some(c=>capabilityPlan.includes(c)))
  .sort((a,b)=>(reuseRank[a.reuse]??9)-(reuseRank[b.reuse]??9))
  .map(p=>({id:p.id,version:p.version,reuse:p.reuse,capabilities:p.capabilities}));

const scoreProvider = p => {
  const statusScore = p.status === "known_available" ? 0.70 :
    p.status === "optional" ? 0.48 :
    p.status === "discover_on_need" ? 0.42 : 0.30;
  const fallbackScore = Array.isArray(p.fallbacks) && p.fallbacks.length ? 0.12 : 0;
  const actionScore = p.account_action === "none_by_default" ? 0.10 :
    p.account_action === "evaluate_per_task" ? 0.06 : 0.02;
  const integrationScore = p.kind === "backend_control_plane" || p.kind === "source_ci" || p.kind === "research_web" ? 0.08 : 0.04;
  return Number(Math.min(1, statusScore + fallbackScore + actionScore + integrationScore).toFixed(3));
};

const broadDiscovery = req.discovery_mode === "broad" || req.discovery_mode === "competitive";
const providerPlan = capabilityPlan.map(cap => {
  const matches = providers
    .filter(p=>p.capabilities.includes(cap))
    .map(p=>({
      ...p,
      selection_score:scoreProvider(p)
    }))
    .sort((a,b)=>b.selection_score-a.selection_score);

  const primary = matches[0] ?? null;
  const fallback = matches.find(p=>p.id !== primary?.id) ?? null;
  const discovery_required = broadDiscovery || matches.length === 0 || !matches.some(p=>p.status === "known_available");

  return {
    capability:cap,
    candidates:matches.map(p=>({
      id:p.id,name:p.name,status:p.status,score:p.selection_score,
      fallbacks:p.fallbacks??[],evidence_sources:p.evidence_sources??[]
    })),
    primary:primary?.id ?? null,
    fallback:fallback?.id ?? null,
    discovery_required,
    discovery_reason: discovery_required
      ? (matches.length===0 ? "no_registered_candidate" : (broadDiscovery ? "requested_broad_discovery" : "no_known_available_provider"))
      : "known_provider_satisfies_need"
  };
});

const domainSet = new Set([
  "product","architecture","factory","ui","backend","data","android","ios","ai",
  "security","performance","localization","revenue","research","design","qa","build",
  "strategy","compliance","release","growth","supply_chain","content"
]);
const agentPlan = agents.filter(a=>domainSet.has(a.domain)).map(a=>a.id);

const automationPlan = automations.map(a=>a.id);

const result = {
  ok:true,
  factory:"MIDAD Mobile Factory X",
  request:req,
  inferred_capabilities:capabilityPlan,
  plugins:pluginPlan,
  providers:providerPlan,
  agents:{
    selected:agentPlan,
    max_parallel:factoryCfg.execution.max_parallel_agents,
    max_parallel_tasks:factoryCfg.execution.max_parallel_tasks,
    strategy:factoryCfg.execution.agent_pool_strategy ?? "dynamic_bounded_parallelism"
  },
  automations:automationPlan,
  decision_policy:policy.name,
  speed_policy:{
    cached_artifacts:factoryCfg.execution.prefer_cached_artifacts,
    incremental_builds:factoryCfg.execution.prefer_incremental_builds,
    parallel_independent_tasks:factoryCfg.execution.parallel_independent_checks,
    discovery_only_when_value_added:!broadDiscovery
  },
  gates:["preflight_complete","security","audit","build","verify"]
};

const out = path.join(root,"mobile","factory","x","runtime-plan.json");
fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({
  ok:true,
  capabilities:capabilityPlan.length,
  plugins:pluginPlan.length,
  provider_tracks:providerPlan.length,
  agents:agentPlan.length,
  automations:automationPlan.length,
  discovery_required:providerPlan.filter(x=>x.discovery_required).length,
  output:path.relative(root,out)
}));
