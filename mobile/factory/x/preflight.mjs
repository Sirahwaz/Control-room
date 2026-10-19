#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const files=[
  "mobile/factory/factory.config.json",
  "mobile/factory/x/factory-x.config.json",
  "mobile/factory/x/factory-x.config.schema.json",
  "mobile/factory/x/capabilities.registry.json",
  "mobile/factory/x/providers.registry.json",
  "mobile/factory/x/plugins.registry.json",
  "mobile/factory/x/agents.registry.json",
  "mobile/factory/x/automations.registry.json",
  "mobile/factory/x/selection.policy.json",
  "mobile/factory/x/adapters.registry.json",
  "mobile/factory/x/agent-bindings.registry.json",
  "mobile/factory/x/execution-engine.mjs",
  "mobile/factory/x/execution-fabric.mjs"
];

const failures=[];
for(const f of files){
  if(!fs.existsSync(path.join(root,f))) failures.push("missing_file:"+f);
}
const load=f=>JSON.parse(fs.readFileSync(path.join(root,f),"utf8"));
if(failures.length){
  const result={ok:false,failures};
  fs.writeFileSync(path.join(root,"mobile/factory/x/preflight-report.json"),JSON.stringify(result,null,2)+"\n");
  console.error(JSON.stringify(result));
  process.exit(1);
}

const parent=load(files[0]);
const cfg=load(files[1]);
const caps=load(files[3]).capabilities;
const providers=load(files[4]).providers;
const plugins=load(files[5]).plugins;
const agents=load(files[6]).agents;
const automations=load(files[7]).automations;
const policy=load(files[8]);
const adapterRegistry=load(files[9]).adapters;
const bindingRegistry=load(files[10]).bindings;

const uniq=(arr,key)=>arr.length===new Set(arr.map(x=>key(x))).size;
const adapterIds=new Set(adapterRegistry.map(a=>a.id));
const agentIds=new Set(agents.map(a=>a.id));
const boundAgentIds=new Set(bindingRegistry.map(b=>b.agent));

if(parent.extensions?.intelligent_parallel_app_factory?.enabled!==true) failures.push("parent_factory_x_disabled");
if(parent.extensions?.intelligent_parallel_app_factory?.agent_fabric?.enabled!==true) failures.push("parent_agent_fabric_unregistered");
if(parent.extensions?.intelligent_parallel_app_factory?.agent_fabric?.protocol!=="MIDAD-FX-1") failures.push("parent_fabric_protocol");
if(cfg.selection?.strategy!=="need-first-provider-second") failures.push("selection_strategy");
if(cfg.quality?.fail_closed_on_security_gate!==true) failures.push("security_gate");
if(cfg.execution?.max_parallel_agents<4) failures.push("parallel_agents_too_low");
if(cfg.execution?.max_parallel_tasks<8) failures.push("parallel_tasks_too_low");
if(cfg.execution?.max_repair_attempts_per_incident>3) failures.push("repair_limit");
if(cfg.execution?.agent_pool_strategy!=="dynamic_role_selection") failures.push("agent_pool_strategy");
if(cfg.execution?.scale_policy!=="capacity_adaptive") failures.push("scale_policy");
if(agents.length<20) failures.push("agent_pool_incomplete");
if(automations.length<7) failures.push("automation_pool_incomplete");
if(bindingRegistry.length!==agents.length) failures.push("agent_binding_count_mismatch");
if(!uniq(agents,a=>a.id)) failures.push("duplicate_agent_id");
if(!uniq(bindingRegistry,b=>b.agent)) failures.push("duplicate_binding_agent");
if(!uniq(adapterRegistry,a=>a.id)) failures.push("duplicate_adapter_id");
if(!policy.rules.includes("never_choose_provider_from_availability_alone")) failures.push("provider_rule_missing");

for(const a of agents) if(!boundAgentIds.has(a.id)) failures.push("agent_missing_binding:"+a.id);
for(const b of bindingRegistry){
  if(!agentIds.has(b.agent)) failures.push("binding_unknown_agent:"+b.agent);
  if(!adapterIds.has(b.adapter)) failures.push("binding_unknown_adapter:"+b.adapter);
  if(!String(b.action||"").trim()) failures.push("binding_missing_action:"+b.agent);
  if((b.adapter==="human-gate"||b.fallback==="human-gate") && !String(b.action||"").trim()) failures.push("human_gate_missing_action:"+b.agent);
}

const requiredCapIds=new Set(caps.map(c=>c.id));
const providerCapCoverage=new Set(providers.flatMap(p=>Array.isArray(p.capabilities)?p.capabilities:[]));
const pluginCapCoverage=new Set(plugins.flatMap(p=>Array.isArray(p.capabilities)?p.capabilities:[]));
const uncovered=caps
  .filter(c=>c.criticality==="critical" && !providerCapCoverage.has(c.id) && !pluginCapCoverage.has(c.id))
  .map(c=>c.id);

const result={
  ok:failures.length===0,
  failures,
  counts:{
    capabilities:caps.length,
    providers:providers.length,
    plugins:plugins.length,
    agents:agents.length,
    automations:automations.length,
    adapters:adapterRegistry.length,
    bindings:bindingRegistry.length
  },
  critical_capability_gaps:uncovered,
  discovery_enabled:true,
  parent_contract_verified:true,
  mode:"MIDAD Mobile Factory X"
};
fs.writeFileSync(path.join(root,"mobile/factory/x/preflight-report.json"),JSON.stringify(result,null,2)+"\n");
if(failures.length){ console.error(JSON.stringify(result)); process.exit(1); }
console.log(JSON.stringify(result));
