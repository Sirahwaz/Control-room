import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"POST,OPTIONS",
  "access-control-allow-headers":"content-type,apikey,authorization,x-signalscan-device"
};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:CORS});
const clip=(x:any,n=6000)=>String(x??"").slice(0,n);
const num=(x:any,f=0)=>Number.isFinite(Number(x))?Number(x):f;
const clamp=(x:number,a=0,b=100)=>Math.max(a,Math.min(b,x));

const buckets=new Map<string,{window:number,count:number;hour:number;hourCount:number}>();
async function sha(s:string){
  const b=new TextEncoder().encode(s),h=await crypto.subtle.digest("SHA-256",b);
  return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function rate(key:string){
  const now=Date.now(),win=Math.floor(now/60000)*60000,hr=Math.floor(now/3600000)*3600000;
  const old=buckets.get(key);
  const v=old&&old.window===win?old:{window:win,count:0,hour:hr,hourCount:0};
  if(v.hour!==hr){v.hour=hr;v.hourCount=0}
  if(v.count>=8||v.hourCount>=60)return false;
  v.count++;v.hourCount++;buckets.set(key,v);return true;
}
function allowApiKey(req:Request){
  const supplied=req.headers.get("apikey")||req.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
  const raw=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if(raw){
    try{
      const keys=JSON.parse(raw);
      return Object.values(keys).some((k:any)=>k&&k===supplied);
    }catch(_){}
  }
  const legacy=Deno.env.get("SUPABASE_ANON_KEY")||"";
  return Boolean(legacy&&legacy===supplied);
}
function consensus(signals:any[],market:any){
  const src=signals.slice(0,8);
  if(!src.length)return {direction:"NEUTRAL",score:50,confidence:0,robustness:0,fragilities:["no_signal_data"],agents:{}};
  let trend=0,structure=0,flow=0,anomaly=0,regime=0;
  for(const s of src){
    const side=s.direction==="SHORT"?-1:s.direction==="LONG"?1:0;
    const f=s.factors||{};
    const mtf=num(f.mtfScore,0)||num(f.mtfSpread,0)*5;
    trend+=side*(num(f.trendScore,0)+clamp(Math.abs(mtf),0,20));
    const struct=(String(f.structure)==="break_up"?1:String(f.structure)==="break_down"?-1:0)+(String(f.sweep)==="bullish"?1:String(f.sweep)==="bearish"?-1:0)+(String(f.fvg)==="bullish"?1:String(f.fvg)==="bearish"?-1:0);
    structure+=side*struct*8;
    flow+=side*(clamp(num(f.volumeRatio,1)-1,-1,3)*10 + clamp(num(f.orderbookImbalance,0),-1,1)*10 + clamp(num(f.takerBias,0),-1,1)*8);
    anomaly+=side*(clamp(num(f.crossVenueDelta,0),-2,2)*4 + clamp(num(f.fundingPressure,0),-2,2)*3);
    regime+=String(s.regime)==="RANGE"?-2:1;
  }
  const breadth=num(market.breadth,50), breadthBias=(breadth-50)/5;
  trend+=breadthBias*5;
  const raw=trend*.40+structure*.25+flow*.25+anomaly*.10+regime;
  const score=Math.round(clamp(50+raw,5,95));
  const direction=score>=64?"LONG":score<=36?"SHORT":"NEUTRAL";
  const spread=src.map(x=>x.score??50);
  const avg=spread.reduce((a,b)=>a+Number(b),0)/Math.max(1,spread.length);
  const dispersion=Math.sqrt(spread.reduce((a,b)=>a+(Number(b)-avg)**2,0)/Math.max(1,spread.length));
  const confidence=clamp(.52+Math.min(.34,Math.abs(raw)/180)+Math.min(.10,Math.abs(breadth-50)/50)-Math.min(.12,dispersion/100),.5,.96)/100*100;
  const independent=Math.max(1,["trend","structure","flow","anomaly"].filter((_,i)=>Math.abs([trend,structure,flow,anomaly][i])>2).length);
  const fragilities:string[]=[];
  if(Math.abs(flow)<Math.abs(raw)*.18)fragilities.push("flow_not_decisive");
  if(Math.abs(structure)<Math.abs(raw)*.18)fragilities.push("structure_not_decisive");
  if(Math.abs(breadth-50)<5)fragilities.push("breadth_neutral");
  if(dispersion>14)fragilities.push("signal_dispersion_high");
  if(direction==="NEUTRAL")fragilities.push("no_directional_edge");
  const robustness=clamp(55+independent*10-dispersion*1.4-(fragilities.length*5),0,100);
  return {direction,score,confidence:confidence/100,robustness,fragilities,agents:{
    trend:Math.round(trend),structure:Math.round(structure),flow:Math.round(flow),anomaly:Math.round(anomaly),regime:Math.round(regime)
  }};
}
async function aiExplain(body:any,cons:any){
  const sks=Deno.env.get("SUPABASE_SECRET_KEYS")||"", url=Deno.env.get("SUPABASE_URL")||"";
  if(!sks||!url)return null;
  let sk="";
  try{sk=JSON.parse(sks).default||""}catch(_){}
  if(!sk)return null;
  const compact={
    market:body.market||{},
    strongest:(body.signals||[]).slice(0,5).map((s:any)=>({
      symbol:clip(s.symbol,30),direction:clip(s.direction,12),score:num(s.score,50),
      confidence:num(s.confidence,.5),regime:clip(s.regime,20),factors:s.factors||{}
    })),
    consensus:cons
  };
  const prompt="Analyze this market scan as an explainable signal research assistant. Do not promise profit or invent facts. Give: DIRECT VERDICT, WHY IT MATTERS, WHAT COULD INVALIDATE IT, NEXT OBSERVATION. Be concise. Context: "+JSON.stringify(compact);
  try{
    const r=await fetch(url+"/functions/v1/midad_ai_router",{
      method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk},
      body:JSON.stringify({task_class:"market_analysis",request_ref:"signalscan-"+crypto.randomUUID(),prompt,max_output_tokens:800,temperature:.2})
    });
    const j=await r.json().catch(()=>({}));
    return r.ok?clip(j.answer||j.final||j.message,7000):null;
  }catch(_){return null}
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,state:"FAILED",error:"method_not_allowed"},405);
  if(!allowApiKey(req))return json({ok:false,state:"BLOCKED",error:"publishable_key_required"},401);
  const dev=clip(req.headers.get("x-signalscan-device")||"unknown",160);
  const key=await sha(dev+"|"+(req.headers.get("user-agent")||""));
  if(!rate(key))return json({ok:false,state:"BLOCKED",error:"rate_limit","retry_after_seconds":60},429);
  try{
    const body=await req.json();
    if(!body||typeof body!=="object")return json({ok:false,state:"FAILED",error:"json_body_required"},400);
    const signals=Array.isArray(body.signals)?body.signals.slice(0,10):[];
    const market=body.market&&typeof body.market==="object"?body.market:{};
    const cons=consensus(signals,market);
    const adversarial={
      remove_one_factor_survival:[],
      verdict:"UNKNOWN"
    };
    const factors=["trendScore","volumeRatio","orderbookImbalance","crossVenueDelta","takerBias","fundingPressure"];
    for(const f of factors){
      const altered=signals.map((s:any)=>({...s,factors:{...(s.factors||{}),[f]:0}}));
      const c=consensus(altered,market);
      adversarial.remove_one_factor_survival.push({factor:f,direction:c.direction,score:c.score,flip:c.direction!==cons.direction});
    }
    const flips=adversarial.remove_one_factor_survival.filter((x:any)=>x.flip).length;
    adversarial.verdict=flips>=3?"FRAGILE":flips===0?"ROBUST":"MIXED";
    let ai:null|string=null;
    if(body.want_ai===true&&signals.length)ai=await aiExplain(body,cons);
    return json({
      ok:true,state:"VERIFIED",engine:"signalscan-neural-brain-v0.2",
      consensus:cons,adversarial,ai_explanation:ai,
      limits:{live_orders:false,withdrawals:false,secrets_in_client:false},
      generated_at:new Date().toISOString()
    });
  }catch(e){return json({ok:false,state:"FAILED",error:"brain_failed",detail:clip(String(e),500)},500)}
});
