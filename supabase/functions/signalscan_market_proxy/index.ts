import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"GET,OPTIONS","access-control-allow-headers":"content-type,apikey,authorization,x-signalscan-device"};

function allowApiKey(req){
  const supplied=req.headers.get("apikey")||(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const raw=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"";
  try{const keys=JSON.parse(raw);if(Object.values(keys).some(k=>k&&k===supplied))return true}catch{}
  const legacy=Deno.env.get("SUPABASE_ANON_KEY")||"";
  return Boolean(legacy&&legacy===supplied);
}

const hosts=new Set(["api.binance.com","api-gcp.binance.com","api1.binance.com","api2.binance.com","api3.binance.com","api4.binance.com","fapi.binance.com","api.coinex.com"]);
const paths=new Set(["/api/v3/ticker/24hr","/api/v3/klines","/api/v3/depth","/fapi/v1/premiumIndex","/fapi/v1/openInterest","/futures/data/takerBuySellVol","/v2/spot/ticker"]);

async function upstream(u){
  const targets=[];
  if(u.hostname==="api.binance.com"){
    for(const h of ["api.binance.com","api-gcp.binance.com","api1.binance.com","api2.binance.com","api3.binance.com","api4.binance.com"]){
      const x=new URL(u.toString());x.hostname=h;targets.push(x);
    }
  }else targets.push(u);
  let last="";
  for(const t of targets){
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),6500);
    try{
      const r=await fetch(t.toString(),{headers:{accept:"application/json"},signal:c.signal});
      const body=await r.text();
      if(r.ok)return {body,status:r.status,host:t.hostname};
      last=t.hostname+" HTTP "+r.status;
      if(r.status<500&&r.status!==403&&r.status!==429&&r.status!==451)break;
    }catch(e){last=String(e)}
    finally{clearTimeout(timer)}
  }
  throw new Error(last||"upstream_unavailable");
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="GET")return new Response(JSON.stringify({ok:false,error:"method_not_allowed"}),{status:405,headers:CORS});
  if(!allowApiKey(req))return new Response(JSON.stringify({ok:false,error:"publishable_key_required"}),{status:401,headers:CORS});
  try{
    const raw=new URL(req.url).searchParams.get("url")||"";
    const u=new URL(raw);
    if(u.protocol!=="https:"||!hosts.has(u.hostname)||!paths.has(u.pathname))throw new Error("target_not_allowed");
    const r=await upstream(u);
    return new Response(r.body,{status:200,headers:{...CORS,"x-signalscan-provider":r.host}});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:"market_proxy_failed",detail:String(e).slice(0,300)}),{status:502,headers:CORS});
  }
});