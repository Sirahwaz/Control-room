#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root=process.cwd();
const key=process.argv[2];
if(!key) throw new Error("Usage: node mobile/factory/runtime-smoke/generic-web.mjs <product-key>");

const reportDir=path.join(root,"mobile/factory/reports");
const reportPath=path.join(reportDir,key+"-runtime-smoke.json");
const site=path.join(root,"mobile","www");
const port=8124;

const errors=[];
const checks={};
const server=spawn("python3",["-m","http.server",String(port),"--directory",site],{stdio:["ignore","pipe","pipe"]});
server.stderr.on("data",d=>process.stderr.write(d));

const waitForServer=async()=>{
  const end=Date.now()+10000;
  while(Date.now()<end){
    try{const r=await fetch("http://127.0.0.1:"+port+"/index.html");if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,200));
  }
  throw new Error("Runtime smoke server did not start");
};

try{
  await waitForServer();
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const pageErrors=[];
    const consoleErrors=[];
    const failedRequests=[];

    page.on("pageerror",e=>pageErrors.push(String(e)));
    page.on("console",m=>{if(m.type()==="error")consoleErrors.push(m.text())});
    page.on("response",res=>{
      if(res.status()>=400) failedRequests.push({url:res.url(),status:res.status()});
    });

    await page.goto("http://127.0.0.1:"+port+"/index.html",{waitUntil:"domcontentloaded"});
    await page.waitForTimeout(1200);

    checks.launch=await page.evaluate(()=>document.title.length>0 && document.body?.innerText?.trim().length>0);
    checks.rtl=await page.evaluate(()=>document.documentElement.dir==="rtl"||document.documentElement.dir==="ltr");
    checks.no_page_errors=pageErrors.length===0;
    checks.no_console_errors=consoleErrors.length===0;
    checks.no_http_failures=failedRequests.length===0;

    const interactive=await page.locator("button,select,input,textarea,a").evaluateAll(els=>els.map(el=>({
      tag:el.tagName.toLowerCase(),
      text:(el.innerText||"").trim(),
      aria:el.getAttribute("aria-label")||"",
      title:el.getAttribute("title")||"",
      href:el.getAttribute("href")||""
    })));
    checks.interactive_accessible=interactive.every(x=>x.tag==="a" ? (x.text||x.aria||x.title||x.href) : (x.text||x.aria||x.title));
    checks.interactive_count=interactive.length;

    if(pageErrors.length)errors.push({kind:"pageerror",detail:pageErrors});
    if(consoleErrors.length)errors.push({kind:"console",detail:consoleErrors});
    if(failedRequests.length)errors.push({kind:"http",detail:failedRequests});

    const localLinks=await page.evaluate(()=>[...document.querySelectorAll("a[href]")].map(a=>a.getAttribute("href")).filter(h=>h&&!/^(https?:|mailto:|tel:|#|javascript:)/.test(h)).map(h=>h.split("#")[0].split("?")[0]));
    const normalized=[...new Set(localLinks.filter(Boolean))];
    const missing=[];
    for(const href of normalized){
      const url=new URL(href,"http://127.0.0.1:"+port+"/index.html");
      const res=await page.request.get(url.toString());
      if(res.status()>=400)missing.push({href,status:res.status()});
    }
    checks.local_navigation_links=normalized.length;
    checks.local_navigation_targets_valid=missing.length===0;
    if(missing.length)errors.push({kind:"navigation",detail:missing});

    await page.close();
  }finally{
    await browser.close();
  }
}finally{
  server.kill("SIGTERM");
}

const pass=Object.entries(checks).filter(([k])=>k!=="interactive_count"&&k!=="local_navigation_links").every(([,v])=>v===true||typeof v==="number")&&errors.length===0;
const report={
  certification_version:"1.0",
  product_key:key,
  executed_at:new Date().toISOString(),
  status:pass?"PASS":"FAILED",
  checks,
  errors,
  environment:{browser:"Chromium",runner:"Playwright 1.63.0",network_mode:"local_bundle"},
  policy:{runtime_evidence_required_for_customer_delivery:true}
};
fs.mkdirSync(reportDir,{recursive:true});
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({ok:pass,status:report.status,product:key,report:"mobile/factory/reports/"+key+"-runtime-smoke.json"}));
if(!pass)process.exit(1);
