#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root=process.cwd();
const key=process.argv[2];
const apkArg=process.argv[3];
if(!key||!apkArg) throw new Error("Usage: node mobile/factory/artifact-certification.mjs <product-key> <apk-path>");

const manifestPath=path.join(root,"mobile","factory","products",key+".json");
const apkPath=path.isAbsolute(apkArg)?apkArg:path.join(root,apkArg);
const failures=[];
const checks={};

if(!fs.existsSync(manifestPath)) failures.push({gate:"manifest",message:"Manifest missing"});
if(!fs.existsSync(apkPath)) failures.push({gate:"artifact_exists",message:"APK missing"});

let manifest=null;
if(fs.existsSync(manifestPath)) manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));

let sha256=null;
if(fs.existsSync(apkPath)){
  const data=fs.readFileSync(apkPath);
  sha256=crypto.createHash("sha256").update(data).digest("hex");
  checks.size_bytes=data.length;
  checks.sha256=sha256;
  if(data.length<500000) failures.push({gate:"artifact_integrity",message:"APK unexpectedly small",evidence:{size:data.length}});
}

const apksigner=process.env.APKSIGNER;
if(!apksigner||!fs.existsSync(apksigner)) failures.push({gate:"installability",message:"apksigner tool unavailable"});
else if(fs.existsSync(apkPath)){
  const r=spawnSync(apksigner,["verify","--verbose",apkPath],{encoding:"utf8"});
  if(r.status!==0) failures.push({gate:"installability",message:"APK signature verification failed",evidence:{detail:r.stderr||r.stdout}});
  else checks.apksigner="VERIFIED";
}

const aapt=process.env.AAPT;
if(aapt&&fs.existsSync(aapt)&&fs.existsSync(apkPath)&&manifest){
  const r=spawnSync(aapt,["dump","badging",apkPath],{encoding:"utf8"});
  if(r.status===0){
    const pkg=r.stdout.match(/package:\s+name='([^']+)'\s+versionCode='([^']+)'\s+versionName='([^']+)'/);
    if(pkg){
      checks.package_name=pkg[1];
      checks.version_code=pkg[2];
      checks.version_name=pkg[3];
      if(pkg[1]!==manifest.app_id) failures.push({gate:"artifact_identity",message:"APK application id mismatch",evidence:{expected:manifest.app_id,actual:pkg[1]}});
      if(pkg[3]!==manifest.version) failures.push({gate:"artifact_identity",message:"APK version mismatch",evidence:{expected:manifest.version,actual:pkg[3]}});
    } else failures.push({gate:"artifact_identity",message:"Could not parse APK package metadata"});
  } else failures.push({gate:"artifact_identity",message:"aapt metadata inspection failed",evidence:{detail:r.stderr||r.stdout}});
}

if(manifest?.release_channel==="production"&&process.env.PRODUCTION_SIGNING!=="true") failures.push({gate:"production_signing",message:"Production release requires production-managed signing"});

const customerEligible=failures.length===0&&manifest?.release_channel==="production"&&process.env.CUSTOMER_DELIVERY==="true"&&process.env.PRODUCTION_SIGNING==="true";
const report={
  certification_version:"1.0",
  certified_at:new Date().toISOString(),
  product_key:key,
  apk:apkArg,
  status:failures.length?"FAILED":"CERTIFIED_ARTIFACT",
  customer_delivery_eligible:customerEligible,
  checks,
  failures,
  policy:{
    build_success_is_not_release_certification:true,
    production_requires_managed_signing:true,
    customer_delivery_requires_explicit_delivery_mode:true
  }
};

const out=path.join(root,"mobile","factory","reports",key+"-artifact-certification.json");
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({ok:failures.length===0,status:report.status,customer_delivery_eligible:customerEligible,sha256}));
if(failures.length) process.exit(1);
