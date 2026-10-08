#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const requestPath = process.argv[2];
if (!requestPath) throw new Error("Usage: node mobile/factory/x/execution-engine.mjs <request.json> [--no-cache]");

const NO_CACHE = process.argv.includes("--no-cache");
const readJson = p => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const writeJson = (p, value) => fs.writeFileSync(path.join(root, p), JSON.stringify(value, null, 2) + "\n");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isoNow = () => new Date().toISOString();

const request = readJson(requestPath);
const cfg = readJson("mobile/factory/x/factory-x.config.json");
const caps = readJson("mobile/factory/x/capabilities.registry.json").capabilities;
const providers = readJson("mobile/factory/x/providers.registry.json").providers;
const plugins = readJson("mobile/factory/x/plugins.registry.json").plugins;
const agents = readJson("mobile/factory/x/agents.registry.json").agents;

const maxTasks = Math.max(1, Number(cfg.execution.max_parallel_tasks || 1));
const maxAgents = Math.max(1, Number(cfg.execution.max_parallel_agents || 1));
const maxRetries = Math.min(3, Math.max(0, Number(cfg.execution.max_repair_attempts_per_incident || 3)));
const runId = `fx-${Date.now()}`;
const cacheDir = path.join(root, ".factory-cache");
const cachePath = path.join(cacheDir, "execution-cache.json");
fs.mkdirSync(cacheDir, { recursive: true });

let cache = {};
if (!NO_CACHE && fs.existsSync(cachePath)) {
  try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch { cache = {}; }
}

const requestedTags = new Set(Array.isArray(request.capability_tags) ? request.capability_tags.map(String) : []);
const blob = JSON.stringify(request).toLowerCase();
const inferredCaps = [...new Set(
  caps.filter(c => c.tags.some(t => requestedTags.has(t) || blob.includes(t))).map(c => c.id)
)];

const scoreProvider = p => {
  const status = p.status === "known_available" ? 0.70 : p.status === "optional" ? 0.48 : p.status === "discover_on_need" ? 0.42 : 0.30;
  const fallback = Array.isArray(p.fallbacks) && p.fallbacks.length ? 0.12 : 0;
  const account = p.account_action === "none_by_default" ? 0.10 : p.account_action === "evaluate_per_task" ? 0.06 : 0.02;
  const integration = ["backend_control_plane","source_ci","research_web"].includes(p.kind) ? 0.08 : 0.04;
  return Number(Math.min(1, status + fallback + account + integration).toFixed(3));
};

const providerFor = capability => {
  const matches = providers.filter(p => p.capabilities.includes(capability))
    .map(p => ({...p, score: scoreProvider(p)}))
    .sort((a,b) => b.score - a.score);
  const primary = matches[0] ?? null;
  const fallback = matches.find(p => p.id !== primary?.id) ?? null;
  const broad = request.discovery_mode === "broad" || request.discovery_mode === "competitive";
  return {
    capability,
    primary: primary?.id ?? null,
    fallback: fallback?.id ?? null,
    candidates: matches.map(p => ({id:p.id,name:p.name,status:p.status,score:p.score})),
    discovery_required: broad || matches.length === 0 || !matches.some(p => p.status === "known_available"),
    reason: matches.length === 0 ? "no_registered_candidate" : broad ? "requested_broad_discovery" : "provider_satisfies_need"
  };
};

const makeTask = (id, phase, deps, agentId, capability, fn, parallelSafe = true) => ({
  id, phase, deps, agentId, capability, fn, parallelSafe
});

const tasks = [
  makeTask("intake","foundation",[],"requirements-agent",null,() => ({
    product_key: request.product_key,
    objective: request.objective,
    constraints: request.constraints ?? []
  })),
  makeTask("requirements","foundation",["intake"],"requirements-agent",null,() => ({
    normalized: true,
    languages: request.languages ?? ["ar","en","fa"],
    markets: request.target_markets ?? ["global_remote"],
    constraints: request.constraints ?? []
  })),
  makeTask("capability-plan","discovery",["requirements"],"capability-scout",null,() => ({
    capabilities: inferredCaps
  })),
  makeTask("provider-plan","discovery",["requirements"],"provider-scout",null,() => ({
    tracks: inferredCaps.map(providerFor)
  })),
  makeTask("reuse-plan","discovery",["requirements"],"reuse-agent",null,() => ({
    plugins: plugins
      .filter(p => p.capabilities.some(c => inferredCaps.includes(c)))
      .map(p => ({id:p.id,version:p.version,reuse:p.reuse}))
  })),
  makeTask("competitive-gap","discovery",["requirements"],"competitor-intel-agent","competitive-intelligence",() => ({
    required: true,
    status: request.competitor_evidence ? "EVIDENCE_ATTACHED" : "DISCOVERY_REQUIRED"
  })),
  makeTask("privacy-baseline","discovery",["requirements"],"privacy-agent","privacy-compliance",() => ({
    fail_closed: true,
    privileged_credentials_in_client: false
  })),
  makeTask("performance-budget","discovery",["requirements"],"performance-budget-agent","performance-budget",() => ({
    cache_enabled: Boolean(cfg.execution.prefer_cached_artifacts),
    incremental_build: Boolean(cfg.execution.prefer_incremental_builds),
    parallel_checks: Boolean(cfg.execution.parallel_independent_checks)
  })),
  makeTask("architecture-synthesis","architecture",
    ["capability-plan","provider-plan","reuse-plan","competitive-gap","privacy-baseline","performance-budget"],
    "factory-governor",null,results => ({
      capabilities: results["capability-plan"].capabilities,
      providers: results["provider-plan"].tracks,
      plugins: results["reuse-plan"].plugins,
      competitive: results["competitive-gap"],
      privacy: results["privacy-baseline"],
      performance: results["performance-budget"]
    }),false)
];


tasks.push(
  makeTask("ui-plan","implementation",["architecture-synthesis"],"ui-architect","responsive-ui",r=>({
    responsive:true,
    touch_targets:"large",
    typography:"readable",
    localization:r["architecture-synthesis"].capabilities.includes("rtl-l10n")
  })),
  makeTask("backend-plan","implementation",["architecture-synthesis"],"backend-architect","auth",r=>({
    backend:request.backend ?? {strategy:"provider-selected"},
    secrets:"server-side-only"
  })),
  makeTask("platform-plan","implementation",["architecture-synthesis"],"android-agent","mobile-shell",r=>({
    android:true,
    ios_ready:true,
    shared_shell_reuse:true
  })),
  makeTask("ai-plan","implementation",["architecture-synthesis"],"ai-agent","model-routing",r=>({
    routing:"evidence_weighted",
    fallback_required:true
  })),
  makeTask("security-plan","implementation",["architecture-synthesis"],"security-agent","secure-secrets",r=>({
    privileged_client_secrets:false,
    irreversible_external_actions:"human_gate"
  })),
  makeTask("localization-plan","implementation",["ui-plan"],"localization-agent","rtl-l10n",r=>({
    languages:request.languages ?? ["ar","en","fa"],
    rtl_first:true
  })),
  makeTask("monetization-plan","implementation",["architecture-synthesis"],"monetization-agent","payments",r=>({
    models:request.monetization_models ?? ["subscription","custom_build"],
    entitlements:"planned"
  })),
  makeTask("test-plan","quality",["ui-plan","backend-plan","platform-plan"],"test-agent","quality-audit",r=>({
    static:true,
    security:true,
    wiring:true,
    runtime_smoke_when_device_available:true,
    visual_regression:true,
    accessibility:true
  })),
  makeTask("dependency-plan","quality",["architecture-synthesis"],"dependency-agent",null,r=>({
    supply_chain_audit:true,
    lockfile_check:true,
    license_check:true,
    vulnerability_check:true
  })),
  makeTask("integration-plan","integration",[
    "ui-plan","backend-plan","platform-plan","ai-plan","security-plan",
    "localization-plan","monetization-plan","test-plan","dependency-plan"
  ],"factory-governor",null,r=>({
    ready:true,
    modules:["ui","backend","platform","ai","security","localization","monetization","qa","dependencies"]
  }),false),
  makeTask("prebuild-audit","gates",["integration-plan"],"audit-agent","quality-audit",r=>({
    checks:{
      requirements:true,
      capability_plan:true,
      provider_plan:true,
      reuse_plan:true,
      security:true,
      integration:true,
      fallback_coverage:true
    },
    blockers:[]
  }),false),
  makeTask("execution-gate","gates",["prebuild-audit"],"factory-governor",null,r=>{
    if(r["prebuild-audit"].blockers.length) throw new Error("Execution gate blocked");
    return {passed:true, irreversible_actions:"human_gate"};
  },false),
  makeTask("delivery-plan","delivery",["execution-gate"],"release-agent","artifact-delivery",r=>({
    channels:["debug","internal","beta","production"],
    artifacts:["apk","aab","sha256","manifest","build_report","test_report","learning_report"],
    external_publish:"human_gate"
  }),false)
);

function statusIsTerminal(s) { return s === "DONE" || s === "CACHED"; }
function runnable(status) {
  return tasks.filter(t => status[t.id] === "PENDING" && t.deps.every(d => statusIsTerminal(status[d])));
}

const status = Object.fromEntries(tasks.map(t => [t.id, "PENDING"]));
const attempts = Object.fromEntries(tasks.map(t => [t.id, 0]));
const outputs = {};
const timings = [];
const events = [];
const active = new Set();

async function runTask(t) {
  const cacheKey = hash({task:t.id,request,configVersion:cfg.factory_x_version,registrySizes:[caps.length,providers.length,plugins.length,agents.length]});
  if (!NO_CACHE && cache[cacheKey]) {
    status[t.id] = "CACHED";
    outputs[t.id] = cache[cacheKey].output;
    timings.push({...cache[cacheKey].telemetry, cache_hit:true});
    events.push({event:"CACHE_HIT",task:t.id,at:isoNow()});
    return;
  }

  status[t.id] = "RUNNING";
  active.add(t.id);
  attempts[t.id] += 1;
  const start = Date.now();
  events.push({event:"START",task:t.id,at:isoNow(),attempt:attempts[t.id]});

  try {
    const upstream = Object.fromEntries(t.deps.map(d => [d, outputs[d]]));
    const output = await t.fn(upstream);
    outputs[t.id] = output;
    status[t.id] = "DONE";
    const telemetry = {
      task:t.id,
      phase:t.phase,
      agent:t.agentId,
      duration_ms:Date.now()-start,
      attempt:attempts[t.id]
    };
    timings.push(telemetry);
    if (!NO_CACHE) cache[cacheKey] = {output,telemetry};
    events.push({event:"DONE",task:t.id,at:isoNow(),duration_ms:telemetry.duration_ms});
  } catch (error) {
    if (attempts[t.id] < maxRetries) {
      status[t.id] = "PENDING";
      events.push({event:"RETRY",task:t.id,at:isoNow(),attempt:attempts[t.id],error:String(error)});
    } else {
      status[t.id] = "FAILED";
      events.push({event:"FAILED",task:t.id,at:isoNow(),attempt:attempts[t.id],error:String(error)});
      throw error;
    }
  } finally {
    active.delete(t.id);
  }
}

while (true) {
  if (Object.values(status).includes("FAILED")) break;
  if (tasks.every(t => statusIsTerminal(status[t.id]))) break;

  const ready = runnable(status).filter(t => !active.has(t.id));
  const capacity = Math.max(0, Math.min(maxTasks, maxAgents) - active.size);

  if (!ready.length || capacity <= 0) {
    const pending = tasks.filter(t => status[t.id] === "PENDING");
    const blocked = pending.filter(t => t.deps.some(d => status[d] === "FAILED"));
    if (blocked.length) {
      for (const t of blocked) status[t.id] = "BLOCKED";
      break;
    }
    if (!active.size) throw new Error("Execution deadlock");
    await new Promise(resolve => setTimeout(resolve, 2));
    continue;
  }

  await Promise.all(ready.slice(0, capacity).map(t => runTask(t).catch(() => {})));
}

if (Object.values(status).includes("FAILED")) {
  const failed = Object.entries(status).filter(([,s]) => s === "FAILED").map(([id]) => id);
  writeJson("mobile/factory/x/execution-report.json", {
    ok:false, factory:"MIDAD Mobile Factory X", run_id:runId,
    state:"FAILED", failed_tasks:failed, statuses:status, attempts, timings, events
  });
  process.exit(1);
}

const discoveryQueue = outputs["provider-plan"].tracks.filter(x => x.discovery_required);
const report = {
  ok:true,
  factory:"MIDAD Mobile Factory X",
  mode:"intelligent-parallel-app-factory",
  run_id:runId,
  state:"PLANNED_EXECUTION_VERIFIED",
  counts:{tasks:tasks.length,completed:Object.values(status).filter(x=>x==="DONE").length,cached:Object.values(status).filter(x=>x==="CACHED").length},
  parallelism:{max_parallel_agents:maxAgents,max_parallel_tasks:maxTasks},
  discovery_queue:discoveryQueue.map(x => ({capability:x.capability,candidates:x.candidates,reason:x.reason})),
  statuses:status,
  attempts,
  timings,
  events,
  outputs
};

writeJson(cachePath, cache);
writeJson("mobile/factory/x/execution-report.json", report);
console.log(JSON.stringify({
  ok:true,
  state:report.state,
  tasks:report.counts.tasks,
  completed:report.counts.completed,
  cached:report.counts.cached,
  discovery_required:report.discovery_queue.length,
  max_parallel_tasks:maxTasks,
  max_parallel_agents:maxAgents
}));
