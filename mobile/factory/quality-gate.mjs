#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=process.cwd();
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

const jsFiles=[];
function walk(dir){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name);
    if(ent.isDirectory()) walk(p);
    else if(p.endsWith(".js")) jsFiles.push(p);
  }
}
const webDir=path.join(root,"mobile","web");
if(fs.existsSync(webDir)) walk(webDir);

for(const file of jsFiles){
  const r=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
  if(r.status!==0) fail(`JS syntax: ${path.relative(root,file)}\n${r.stderr||r.stdout}`);
  const s=fs.readFileSync(file,"utf8");
  if(/-----BEGIN (RSA|OPENSSH|PRIVATE) KEY-----|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-/m.test(s)){
    fail(`Possible hard-coded secret detected in ${path.relative(root,file)}`);
  }
}

if(cfg.quality?.fail_closed_on_security_gate!==true) fail("Factory configuration security gate is not fail-closed");

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
    secret_scan:true
  },
  js_files_checked:jsFiles.length
}));
