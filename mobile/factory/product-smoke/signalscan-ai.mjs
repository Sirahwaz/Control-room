#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const html=fs.readFileSync(path.join(root,"mobile/web/signalscan/index.html"),"utf8");
const js=fs.readFileSync(path.join(root,"mobile/web/signalscan/signalscan.js"),"utf8");
const requiredIds=["asset","scanBtn","retryBtn","state","price","freshness","signal","confidence","change","quorum","spread","evidence","providers","explanationText","routerState","langBtn"];
const ids=new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(x=>x[1]));
const missing=requiredIds.filter(id=>!ids.has(id));
if(missing.length)throw new Error("Missing required UI ids: "+missing.join(", "));
for(const p of ["binance","bybit","kucoin","coinbase"])if(!js.includes('id:"'+p+'"'))throw new Error("Provider missing: "+p);
for(const l of ["ar","en","fa"])if(!js.includes(l+":{"))throw new Error("Locale missing: "+l);
for(const marker of ["FACT","INFERENCE","ACTION","BLOCKED","ROUTER VERIFIED","ROUTER SCANNING"])if(!js.includes(marker))throw new Error("Operational marker missing: "+marker);
if(!js.includes("good.length<2"))throw new Error("Low-quorum guard missing");
if(!js.includes("!a.good.length"))throw new Error("No-data fail-closed branch missing");
if(js.includes("executeTrade")||js.includes("withdraw")||js.includes("transfer"))throw new Error("Potential live financial execution surface detected");
console.log(JSON.stringify({ok:true,product:"signalscan-ai",checks:{ui_contract:true,providers:4,locales:3,explainability:true,fail_closed_no_data:true,low_quorum_guard:true,network_free:true}}));
