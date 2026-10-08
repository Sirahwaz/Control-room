#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const key=process.argv[2]||process.env.MIDAD_PRODUCT;
if(!key) throw new Error("Usage: node mobile/factory/prepare-web-bundle.mjs <product-key>");

const manifestPath=path.join(root,"mobile","factory","products",key+".json");
if(!fs.existsSync(manifestPath)) throw new Error("Manifest missing: "+manifestPath);
const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));

const exists=p=>fs.existsSync(path.join(root,p));
const copy=(src,dst)=>{
  const from=path.join(root,src),to=path.join(root,"mobile","www",dst);
  if(!fs.existsSync(from)) throw new Error("Bundle source missing: "+src);
  fs.mkdirSync(path.dirname(to),{recursive:true});
  fs.copyFileSync(from,to);
};

fs.rmSync(path.join(root,"mobile","www"),{recursive:true,force:true});
fs.mkdirSync(path.join(root,"mobile","www"),{recursive:true});
copy(manifest.web_entry,"index.html");

const targets=new Set(["index.html"]);
for(const asset of Array.isArray(manifest.web_assets)?manifest.web_assets:[]){
  const target=path.basename(asset);
  copy(asset,target);
  targets.add(target);
}
for(const asset of Array.isArray(manifest.factory?.bundle?.site_files)?manifest.factory.bundle.site_files:[]){
  const target=path.posix.join("site",path.basename(asset));
  copy(asset,target);
  targets.add(target);
}

const htmlFiles=[["index.html",manifest.web_entry]];
for(const asset of Array.isArray(manifest.factory?.bundle?.site_files)?manifest.factory.bundle.site_files:[]){
  if(asset.endsWith(".html")&&exists(asset)) htmlFiles.push([path.posix.join("site",path.basename(asset)),asset]);
}

const missing=[];
for(const [bundleHtml,sourceHtml] of htmlFiles){
  const html=fs.readFileSync(path.join(root,sourceHtml),"utf8");
  for(const ref of [...html.matchAll(/(?:src|href)=(["'])([^"']+)\1/gi)].map(x=>x[2].split("#")[0].split("?")[0]).filter(x=>!/^(https?:|data:|#|mailto:|tel:)/.test(x))){
    const normalized=path.posix.normalize(path.posix.join(path.posix.dirname(bundleHtml),ref)).replace(/^\.\//,"");
    if(!fs.existsSync(path.join(root,"mobile","www",normalized))) missing.push({html:bundleHtml,ref,target:normalized});
  }
}

if(missing.length){
  throw new Error("Final web bundle has missing internal references: "+JSON.stringify(missing));
}

const files=[];
const walk=rel=>{
  const abs=path.join(root,"mobile","www",rel);
  for(const ent of fs.readdirSync(abs,{withFileTypes:true})){
    const child=path.posix.join(rel,ent.name);
    if(ent.isDirectory()) walk(child); else files.push(child);
  }
};
walk(".");

const result={ok:true,product_key:key,entry:manifest.web_entry,bundle_files:files,bundle_targets:[...targets]};
fs.mkdirSync(path.join(root,"mobile","factory","reports"),{recursive:true});
fs.writeFileSync(path.join(root,"mobile","factory","reports",key+"-bundle-report.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result));
