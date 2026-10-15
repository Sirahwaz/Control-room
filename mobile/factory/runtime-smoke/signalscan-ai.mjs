#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root=process.cwd();
const siteDir=path.join(root,"mobile/web/signalscan");
const reportPath=path.join(root,"mobile/factory/reports/signalscan-ai-runtime-smoke.json");
const port=8123;
const errors=[];
const checks={};

const waitForServer=async()=>{
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    try{const r=await fetch("http://127.0.0.1:"+port+"/index.html");if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error("Local test server did not start");
};

const server=spawn("python3",["-m","http.server",String(port),"--directory",siteDir],{stdio:["ignore","pipe","pipe"]});
server.stderr.on("data",d=>process.stderr.write(d));
try{
  await waitForServer();
  const context=await chromium.launch({headless:true});
  try{
    const successPage=await context.newPage();
    const pageErrors=[];
    const consoleErrors=[];
    successPage.on("pageerror",e=>pageErrors.push(String(e)));
    successPage.on("console",m=>{if(m.type()==="error")consoleErrors.push(m.text());});

    await successPage.addInitScript(()=>{
      window.fetch=async url=>{
        const u=String(url);
        let body;
        if(u.includes("binance")) body={lastPrice:"68000",priceChangePercent:"1.20",quoteVolume:"1000000"};
        else if(u.includes("bybit")) body={result:{list:[{lastPrice:"68010",price24hPcnt:"0.010",turnover24h:"900000"}]}};
        else if(u.includes("kucoin")) body={data:{last:"67990",changeRate:"0.011",volValue:"800000"}};
        else if(u.includes("coinbase")) body={price:"68005",volume:"700000"};
        else throw new Error("unexpected test URL");
        return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
      };
    });

    await successPage.goto("http://127.0.0.1:"+port+"/index.html",{waitUntil:"domcontentloaded"});
    checks.launch=await successPage.title()==="SignalScan AI";
    await successPage.locator("#scanBtn").click();
    await successPage.waitForFunction(()=>document.querySelector("#stateText")?.textContent.includes("4/4"),null,{timeout:10000});
    checks.four_provider_quorum=await successPage.locator("#evidence").textContent()==="4";
    checks.signal_bias=await successPage.locator("#signal").evaluate(el=>el.classList.contains("buy"));
    checks.explainability=await successPage.locator("#explanationText").textContent().then(t=>t.includes("FACT")&&t.includes("INFERENCE")&&t.includes("ACTION"));
    await successPage.locator("#langBtn").click();
    checks.locale_en=await successPage.evaluate(()=>document.documentElement.lang==="en");
    await successPage.locator("#langBtn").click();
    checks.locale_fa=await successPage.evaluate(()=>document.documentElement.lang==="fa");
    await successPage.locator("#langBtn").click();
    checks.locale_ar=await successPage.evaluate(()=>document.documentElement.lang==="ar");
    checks.page_errors=pageErrors.length===0;
    checks.console_errors=consoleErrors.length===0;
    if(pageErrors.length)errors.push({kind:"pageerror",detail:pageErrors});
    if(consoleErrors.length)errors.push({kind:"console",detail:consoleErrors});
    await successPage.close();

    const failPage=await context.newPage();
    const failErrors=[];
    failPage.on("pageerror",e=>failErrors.push(String(e)));
    await failPage.addInitScript(()=>{window.fetch=async()=>{throw new Error("simulated network failure");};});
    await failPage.goto("http://127.0.0.1:"+port+"/index.html",{waitUntil:"domcontentloaded"});
    await failPage.locator("#scanBtn").click();
    await failPage.waitForFunction(()=>document.querySelector("#signal")?.textContent==="BLOCKED",null,{timeout:10000});
    checks.fail_closed_blocked_state=await failPage.locator("#signal").textContent()==="BLOCKED";
    checks.fail_closed_confidence=await failPage.locator("#confidence").textContent().then(t=>t.includes("0%"));
    checks.retry_visible=await failPage.locator("#retryBtn").evaluate(el=>!el.classList.contains("hidden"));
    if(failErrors.length)errors.push({kind:"blocked_path_pageerror",detail:failErrors});
    await failPage.close();
  }finally{
    await context.close();
  }
}finally{
  server.kill("SIGTERM");
}

const required=["launch","four_provider_quorum","signal_bias","explainability","locale_en","locale_fa","locale_ar","page_errors","console_errors","fail_closed_blocked_state","fail_closed_confidence","retry_visible"];
const passed=required.every(k=>checks[k]===true);

const report={
  certification_version:"1.0",
  product_key:"signalscan-ai",
  executed_at:new Date().toISOString(),
  status:passed&&errors.length===0?"PASS":"FAILED",
  checks,
  errors,
  environment:{browser:"Chromium",runner:"Playwright 1.63.0",network_mode:"deterministic_fetch_stub"},
  policy:{runtime_evidence_required_for_customer_delivery:true}
};

fs.mkdirSync(path.dirname(reportPath),{recursive:true});
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({ok:passed&&errors.length===0,status:report.status,checks,report:"mobile/factory/reports/signalscan-ai-runtime-smoke.json"}));
if(!passed||errors.length)process.exit(1);
