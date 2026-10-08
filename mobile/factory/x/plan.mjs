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

const textBlob = JSON.stringify(req).toLowerCase();
const requestedTags = new Set(Array.isArray(req.capability_tags) ? req.capability_tags.map(String) : []);
const inferred = caps.filter(c => c.tags.some(t => requestedTags.has(t) || textBlob.includes(t)));

const capabilityPlan = [...new Set(inferred.map(c=>c.id))];
const pluginPlan = plugins
  .filter(p => p.capabilities.some(c=>capabilityPlan.includes(c)))
  .sort((a,b)=>({always:0,preferred:1,on_demand:2}[a.reuse]??9)-({always:0,preferred:1,on_demand:2}[b.reuse]??9))
  .map(p=>({id:p.id,version:p.version,reuse:p.reuse,capabilities:p.capabilities}));

const providerPlan = capabilityPlan.map(cap => {
  const matches = providers.filter(p=>p.capabilities.includes(cap));
  return {
    capability: cap,
    candidates: matches.map(p=>({id:p.id,name:p.name,status:p.status,fallbacks:p.fallbacks??[]})),
    primary: matches[0]?.id ?? null,
    fallback: matches.find(p=>p.id!==matches[0]?.id)?.id ?? null,
    discovery_required: matches.length===0 || matches.some(p=>p.status==="discover_on_need")
  };
});

const agentPlan = agents
  .filter(a =>
    ["product","architecture","factory","ui","backend","data","android","ios","ai","security","performance","localization","revenue","research","design","qa","build"].includes(a.domain)
  )
  .map(a=>a.id);

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
    max_parallel:24,
    strategy:"dynamic_bounded_parallelism"
  },
  automations:automationPlan,
  decision_policy:policy.name,
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
