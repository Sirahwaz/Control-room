#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const key=process.argv[2];
if(!key) throw new Error("Usage: node mobile/factory/customer-delivery-gate.mjs <product-key>");

const base=path.join(root,"mobile","factory","reports");
const sourceFile=path.join(base,key+"-certification.json");
const artifactFile=path.join(base,key+"-artifact-certification.json");
const runtimeFile=process.env.RUNTIME_REPORT ? path.join(root,process.env.RUNTIME_REPORT) : path.join(base,key+"-runtime-smoke.json");

const failures=[];
const warnings=[];
const readJson=p=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):null;

const source=readJson(sourceFile);
const artifact=readJson(artifactFile);
const runtime=readJson(runtimeFile);

if(!source) failures.push({gate:"source_certification",message:"Source certification report missing"});
else if(source.status!=="CERTIFIED_SOURCE") failures.push({gate:"source_certification",message:"Source certification is not PASS",status:source.status});

if(!artifact) failures.push({gate:"artifact_certification",message:"Artifact certification report missing"});
else if(artifact.status!=="CERTIFIED_ARTIFACT") failures.push({gate:"artifact_certification",message:"Artifact certification is not PASS",status:artifact.status});
else if(!artifact.checks?.sha256) failures.push({gate:"artifact_integrity",message:"SHA-256 evidence missing"});

if(!runtime) failures.push({gate:"runtime_smoke",message:"Runtime smoke report missing"});
else if(runtime.status!=="PASS"&&runtime.status!=="PASSED") failures.push({gate:"runtime_smoke",message:"Runtime smoke evidence is not PASS",status:runtime.status});

const manifestPath=path.join(root,"mobile","factory","products",key+".json");
const manifest=readJson(manifestPath);
if(!manifest) failures.push({gate:"manifest",message:"Product manifest missing"});
else {
  if(manifest.release_channel!=="production") failures.push({gate:"release_channel",message:"Customer delivery requires release_channel=production",actual:manifest.release_channel});
  if(manifest.features?.live_financial_execution===true) failures.push({gate:"safety",message:"Live financial execution is enabled"});
}

if(artifact?.customer_delivery_eligible!==true && process.env.OVERRIDE_ARTIFACT_ELIGIBILITY!=="true"){
  failures.push({gate:"artifact_delivery_eligibility",message:"Artifact is not marked customer-delivery eligible"});
}

const report={
  certification_version:"1.0",
  certified_at:new Date().toISOString(),
  product_key:key,
  status:failures.length?"BLOCKED":"CUSTOMER_READY",
  failures,
  warnings,
  evidence:{
    source:sourceFile,
    artifact:artifactFile,
    runtime:runtime?runtimeFile:null,
    sha256:artifact?.checks?.sha256||null,
    package_name:artifact?.checks?.package_name||null,
    version_name:artifact?.checks?.version_name||null
  },
  policy:{
    no_runtime_pass_without_evidence:true,
    production_required:true,
    build_success_not_sufficient:true,
    human_approval_for_irreversible_actions:true
  }
};
const out=path.join(base,key+"-customer-delivery-certificate.json");
fs.mkdirSync(base,{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({ok:failures.length===0,status:report.status,sha256:report.evidence.sha256,certificate:path.relative(root,out)}));
if(failures.length) process.exit(1);
