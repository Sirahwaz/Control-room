#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(scriptDir, "../..");
const key=process.argv[2] || process.env.MIDAD_PRODUCT || "midad-omni-agent";
const manifestPath=path.join(root,"mobile","factory","products",`${key}.json`);
const configPath=path.join(root,"mobile","factory","factory.config.json");

const fail=(m)=>{console.error("QUALITY_GATE_FAIL:",m);process.exit(1)};
if(!fs.existsSync(manifestPath)) fail(`Manifest missing: ${manifestPath}`);
if(!fs.existsSync(configPath)) fail(`Factory config missing: ${configPath}`);

const m=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
const cfg=JSON.parse(fs.readFileSync(configPath,"utf8"));

if(m.schema_version!==1) fail("Unsupported manifest schema_version");
if(m.product_key!==key) fail("product_key mismatch");
if(m.features?.server_side_secrets_only!==true) fail("server_side_secrets_only must be true");
if(m.features?.live_financial_execution===true) fail("Live financial execution is blocked in Mobile Factory");
if(m.factory?.request_driven_ui!==true) fail("request_driven_ui must be true");
if(m.factory?.dynamic_content!==true) fail("dynamic_content must be true");
if(m.factory?.learning?.enabled!==true) fail("adaptive learning must be enabled");
if(m.factory?.quality?.fail_closed_on_security_gate!==true) fail("security gate must fail closed");
if((m.factory?.quality?.max_repair_attempts_per_incident ?? 3)>3) fail("max repair attempts exceeds factory policy");

const webEntry=path.join(root,m.web_entry);

if(!fs.existsSync(webEntry)) fail(`web_entry missing: ${m.web_entry}`);

const html=fs.readFileSync(webEntry,"utf8");
const scriptOpen=(html.match(/<script\b/gi)||[]).length;
const scriptClose=(html.match(/<\/script\s*>/gi)||[]).length;
const bodyOpen=(html.match(/<body\b/gi)||[]).length;
const bodyClose=(html.match(/<\/body\s*>/gi)||[]).length;
const htmlOpen=(html.match(/<html\b/gi)||[]).length;
const htmlClose=(html.match(/<\/html\s*>/gi)||[]).length;
if(scriptOpen!==scriptClose) fail(`HTML script tag mismatch: ${scriptOpen} open / ${scriptClose} close`);
if(bodyOpen!==1||bodyClose!==1||htmlOpen!==1||htmlClose!==1||!/<\/html\s*>\s*$/i.test(html)) fail("HTML document boundary tags are invalid");
const parsedScripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
if(parsedScripts.length!==scriptOpen) fail("Could not parse every HTML script element");
const inlineScripts=parsedScripts.filter(match=>!(/\bsrc\s*=/i.test(match[1])));
for(let i=0;i<inlineScripts.length;i++){
  const attrs=inlineScripts[i][1],source=inlineScripts[i][2];
  const mode=/\btype\s*=\s*["']module["']/i.test(attrs)?"module":"commonjs";
  const args=mode==="module"?["--check","--input-type=module","-"]:["--check","-"];
  const checked=spawnSync(process.execPath,args,{input:source,encoding:"utf8"});
  if(checked.status!==0) fail(`Inline HTML script syntax #${i+1}:
${checked.stderr||checked.stdout}`);
}
const ids=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match=>match[1]);
const duplicateIds=ids.filter((id,index)=>ids.indexOf(id)!==index);
if(duplicateIds.length) fail(`Duplicate HTML id(s): ${[...new Set(duplicateIds)].join(", ")}`);


const jsFiles=[];
function walk(dir){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name);
    if(ent.isDirectory()) walk(p);
    else if(p.endsWith(".js") || p.endsWith(".mjs")) jsFiles.push(p);
  }
}
const webDir=path.join(root,"mobile","web");
if(fs.existsSync(webDir)) walk(webDir);

for(const file of jsFiles){
  const r=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
  if(r.status!==0) fail(`JS syntax: ${path.relative(root,file)}
${r.stderr||r.stdout}`);
  const s=fs.readFileSync(file,"utf8");
  if(/-----BEGIN (RSA|OPENSSH|PRIVATE) KEY-----|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-/m.test(s)){
    fail(`Possible hard-coded secret detected in ${path.relative(root,file)}`);
  }
}


if(key==="midad-trading"){
  const tradingTest=path.join(webDir,"trading","trading-core.test.mjs");
  if(!fs.existsSync(tradingTest)) fail("Trading contract tests are missing");
  const tests=spawnSync(process.execPath,["--test",tradingTest],{cwd:root,encoding:"utf8"});
  if(tests.status!==0) fail(`Trading contract tests failed:
${tests.stdout||""}
${tests.stderr||""}`);
}

if(cfg.quality?.fail_closed_on_security_gate!==true) fail("Factory configuration security gate is not fail-closed");
if(!cfg.quality?.required_gates?.includes("runtime_smoke")) fail("runtime_smoke must be a required Factory quality gate");
if(cfg.quality?.optional_gates?.includes("runtime_smoke")) fail("runtime_smoke cannot be optional when APKs are released");

const feedbackPreflight=spawnSync(process.execPath,[path.join(scriptDir,"agentation","preflight.mjs")],{cwd:root,encoding:"utf8"});
if(feedbackPreflight.status!==0) fail(`Agentation integration preflight failed: ${feedbackPreflight.stderr||feedbackPreflight.stdout}`);

console.log(JSON.stringify({
  ok:true,
  product_key:key,
  checks:{
    manifest:true,
    factory_config:true,
    security_boundary:true,
    request_driven_ui:true,
    adaptive_learning:true,
    js_syntax:true,
    secret_scan:true,
    ui_feedback_config_valid:true,
    html_document_integrity:true,
    inline_script_syntax:true,
    unique_dom_ids:true
  },
  inline_html_scripts_checked:inlineScripts.length,
  js_files_checked:jsFiles.length
}));
