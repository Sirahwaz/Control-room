#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=process.cwd();
const key=process.argv[2]||process.env.MIDAD_PRODUCT;
if(!key) throw new Error("Usage: node mobile/factory/certification-gate.mjs <product-key>");

const failures=[];
const warnings=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const bad=(gate,message,evidence={})=>failures.push({gate,message,evidence});

const manifestPath="mobile/factory/products/"+key+".json";
let m=null;
if(!exists(manifestPath)) bad("manifest_valid","Manifest missing",{path:manifestPath});
else { try{m=JSON.parse(read(manifestPath));}catch(e){bad("manifest_valid","Invalid manifest JSON",{error:String(e)});} }

if(m){
  const required=["schema_version","product_key","display_name","version","app_id","artifact_name","web_entry","product_mode","release_channel","features","surfaces"];
  const missing=required.filter(k=>m[k]===undefined||m[k]===null||m[k]==="");
  if(missing.length) bad("manifest_valid","Required fields missing",{missing});
  if(m.schema_version!==1) bad("manifest_valid","Unsupported schema version",{schema_version:m.schema_version});
  if(m.product_key!==key) bad("manifest_valid","Product key mismatch",{manifest_key:m.product_key});
  if(!/^\d+\.\d+\.\d+$/.test(m.version)) bad("manifest_valid","Invalid semantic version",{version:m.version});
  if(!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(m.app_id)) bad("manifest_valid","Invalid Android application id",{app_id:m.app_id});
  if(m.features?.server_side_secrets_only!==true) bad("security_boundary","server_side_secrets_only must be true");
  if(m.features?.live_financial_execution===true) bad("security_boundary","live financial execution must be false");
  if(m.factory?.quality?.fail_closed_on_security_gate!==true) bad("quality_policy","security gate must fail closed");
  if((m.factory?.quality?.max_repair_attempts_per_incident??3)>3) bad("quality_policy","repair limit exceeds 3");
  if(!exists(m.web_entry)) bad("source_present","web entry missing",{entry:m.web_entry});

  const assets=Array.isArray(m.web_assets)?m.web_assets:[];
  const missingAssets=assets.filter(a=>!exists(a));
  if(missingAssets.length) bad("source_present","web assets missing",{missingAssets});

  if(exists(m.web_entry)){
    const html=read(m.web_entry);
    const refs=[...html.matchAll(/(?:src|href)=(["'])([^"']+)\1/gi)].map(x=>x[2]).filter(x=>!/^(https?:|data:|#|mailto:|tel:)/.test(x));
    const base=path.posix.dirname(m.web_entry.replaceAll("\\","/"));
    const badRefs=refs.filter(r=>!exists(path.posix.normalize(path.posix.join(base,r))));
    if(badRefs.length) bad("html_asset_integrity","HTML references missing local assets",{badRefs});

    const ids=[...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(x=>x[1]);
    const dup=[...new Set(ids.filter((v,i)=>ids.indexOf(v)!==i))];
    if(dup.length) bad("html_contract","Duplicate HTML ids detected",{dup});

    const jsRefs=[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(x=>x[1]).filter(x=>!/^https?:/.test(x));
    if(jsRefs.length===0) warnings.push({gate:"html_contract",message:"No local script reference found in HTML"});
  }

  const productDir=path.posix.dirname(m.web_entry.replaceAll("\\","/"));
  const jsFiles=[];
  const walk=rel=>{const abs=path.join(root,rel);if(!fs.existsSync(abs))return;for(const ent of fs.readdirSync(abs,{withFileTypes:true})){const child=path.posix.join(rel,ent.name);if(ent.isDirectory())walk(child);else if(ent.isFile()&&ent.name.endsWith(".js"))jsFiles.push(child);}};
  walk(productDir);

  let syntaxFailures=0;
  const secretHits=[];
  const secretRegexes=[
    /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
    /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{20,}["']/i,
    /(?:sk|rk)-[A-Za-z0-9_-]{20,}/,
    /AIza[0-9A-Za-z_-]{20,}/,
    /xox[baprs]-[0-9A-Za-z-]{20,}/
  ];

  for(const file of jsFiles){
    const r=spawnSync(process.execPath,["--check",path.join(root,file)],{encoding:"utf8"});
    if(r.status!==0){syntaxFailures++;bad("javascript_syntax","JavaScript syntax failure",{file,detail:r.stderr||r.stdout});}
    const content=read(file);
    for(const rx of secretRegexes) if(rx.test(content)) secretHits.push(file);
  }
  if(secretHits.length) bad("secret_scan","Potential hard-coded secret detected",{files:[...new Set(secretHits)]});

  if(exists(m.web_entry)){
    const html=read(m.web_entry);
    const ids=new Set([...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(x=>x[1]));
    const missingDom=[];
    for(const file of jsFiles){
      const content=read(file);
      for(const x of content.matchAll(/getElementById\((["'])([^"']+)\1\)/g)) if(!ids.has(x[2])) missingDom.push({file,id:x[2]});
    }
    if(missingDom.length) bad("ui_js_contract","JavaScript references missing DOM ids",{missingDom});
  }

  const smoke=m.factory?.quality?.smoke_script;
  if(smoke){
    if(!exists(smoke)) bad("contract_smoke","Configured smoke script missing",{smoke});
    else {const r=spawnSync(process.execPath,[path.join(root,smoke)],{encoding:"utf8"});if(r.status!==0)bad("contract_smoke","Product smoke failed",{smoke,detail:r.stderr||r.stdout});}
  } else warnings.push({gate:"contract_smoke",message:"No product-specific smoke script configured"});

  if(m.factory?.localization?.supported_seed){
    for(const lang of m.factory.localization.supported_seed) if(!new RegExp("\\\\b"+lang+":\\\\s*\\\\{").test(read("mobile/web/"+key.replace(/-ai$/,"")+"/index.html"))) warnings.push({gate:"localization_contract",message:"Locale presence not statically proven",{lang}});
  }
}

const cfgPath="mobile/factory/factory.config.json";
if(!exists(cfgPath)) bad("factory_config","Factory config missing");
else {
  try{
    const cfg=JSON.parse(read(cfgPath));
    if(cfg.quality?.fail_closed_on_security_gate!==true) bad("factory_security_policy","Factory config security gate is not fail-closed");
    if(!Array.isArray(cfg.quality?.required_gates)) bad("factory_quality_policy","Required gate list missing");
    if(!Array.isArray(cfg.default_pipeline)) bad("factory_pipeline","Factory pipeline missing");
  }catch(e){bad("factory_config","Factory config invalid JSON",{error:String(e)});}
}

const report={
  certification_version:"1.0",
  certified_at:new Date().toISOString(),
  product_key:key,
  status:failures.length?"FAILED":"CERTIFIED_SOURCE",
  release_eligible:failures.length===0&&m?.release_channel!=="debug",
  failures,
  warnings,
  policy:{
    evidence_before_claim:true,
    fail_closed:true,
    max_repair_attempts:3,
    build_success_is_not_release_certification:true,
    debug_build_is_not_customer_delivery:true
  }
};

const outDir=path.join(root,"mobile/factory/reports");
fs.mkdirSync(outDir,{recursive:true});
const out=path.join(outDir,key+"-certification.json");
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");

console.log(JSON.stringify({
  ok:failures.length===0,
  status:report.status,
  release_eligible:report.release_eligible,
  failures:failures.length,
  warnings:warnings.length,
  report:path.posix.join("mobile/factory/reports",key+"-certification.json")
}));
if(failures.length)process.exit(1);
