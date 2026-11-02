import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H={"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-ingest-key,x-midad-autonomy-key"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const URL=Deno.env.get("SUPABASE_URL")||"";
const SK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ING=Deno.env.get("MIDAD_INGEST_KEY")||"";
const admin=createClient(URL,SK);

function num(v:any){const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(n:number,a=0,b=1){return Math.max(a,Math.min(b,n));}
function sign(v:number){return v>0?1:v<0?-1:0;}

async function fetchJson(url:string){
  const r=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(12000)});
  if(!r.ok) throw new Error("HTTP_"+r.status);
  return await r.json();
}

async function binance(){
  const j=await fetchJson("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
  return {source:"binance",symbol:"BTCUSDT",price:num(j?.lastPrice),change_24h_pct:num(j?.priceChangePercent),volume_usdt:num(j?.quoteVolume)};
}
async function bybit(){
  const j=await fetchJson("https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT");
  const x=Array.isArray(j?.result?.list)?j.result.list[0]:null;
  const p=num(x?.price24hPcnt);
  return {source:"bybit",symbol:"BTCUSDT",price:num(x?.lastPrice),change_24h_pct:p==null?null:p*100,volume_usdt:num(x?.turnover24h)};
}
async function kraken(){
  const j=await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
  const x=j?.result?.XXBTZUSD||j?.result?.XBTUSD||Object.values(j?.result||{})[0];
  const last=num(x?.c?.[0]),open=num(x?.o);
  return {source:"kraken",symbol:"BTCUSD",price:last,change_24h_pct:open&&last?((last/open)-1)*100:null,volume_usdt:null};
}
async function okx(){
  const j=await fetchJson("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT");
  const x=Array.isArray(j?.data)?j.data[0]:null;
  const last=num(x?.last),open=num(x?.open24h);
  return {source:"okx",symbol:"BTCUSDT",price:last,change_24h_pct:x?.sodUtc0?null:(open&&last?((last/open)-1)*100:null),volume_usdt:num(x?.volCcy24h)};
}
async function coingecko(){
  const j=await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true");
  return {source:"coingecko",symbol:"BTCUSDT",price:num(j?.bitcoin?.usd),change_24h_pct:num(j?.bitcoin?.usd_24h_change),volume_usdt:null};
}
async function coinex(){
  const j=await fetchJson("https://api.coinex.com/v2/spot/ticker?market=BTCUSDT");
  const x=Array.isArray(j?.data)?j.data[0]:null;
  const open=num(x?.open),last=num(x?.last);
  const p=num(x?.change_rate);
  return {source:"coinex",symbol:"BTCUSDT",price:last,change_24h_pct:p!=null?p*100:(open&&last?((last/open)-1)*100:null),volume_usdt:num(x?.value)};
}

async function miningState(){
  const {data,error}=await admin.from("midad_mining_accounts")
    .select("id,status,read_only,last_hashrate_ths,last_worker_count,last_snapshot_at,metadata")
    .eq("provider","viabtc").eq("coin","BTC").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(error) return {state:"ERROR",error:error.message};
  const m=data?.metadata||{};
  const ageMs=data?.last_snapshot_at?Date.now()-Date.parse(data.last_snapshot_at):Infinity;
  const live=Number.isFinite(ageMs)&&ageMs<=2*3600000&&data?.last_hashrate_ths!=null;
  return {
    state:live?"LIVE":(data?"PENDING":"MISSING"),
    account_status:data?.status||"missing",
    read_only:data?.read_only!==false,
    hashrate_ths:data?.last_hashrate_ths??null,
    workers:data?.last_worker_count??null,
    snapshot_at:data?.last_snapshot_at??null,
    declared_hashrate_ths:m?.fleet_hashrate_ths_declared??null,
    telemetry_status:m?.fleet_telemetry_status??"PENDING",
    transport:m?.transport??null
  };
}

function derive(ms:any[]){
  const usable=ms.filter(x=>x?.price>0&&x?.change_24h_pct!=null);
  const changes=usable.map(x=>Number(x.change_24h_pct));
  const avg=changes.length?changes.reduce((a,b)=>a+b,0)/changes.length:0;
  const pos=changes.filter(x=>sign(x)>0).length;
  const neg=changes.filter(x=>sign(x)<0).length;
  let direction="NEUTRAL";
  if(usable.length>=2){
    if(pos>=2 && avg>=0.5) direction="LONG";
    else if(neg>=2 && avg<=-0.5) direction="SHORT";
  }
  const agreement=Math.max(pos,neg);
  const agreementFactor=usable.length?agreement/usable.length:0;
  const magnitudeFactor=clamp(Math.abs(avg)/3);
  const sourceFactor=clamp(usable.length/3);
  let confidence=0.25+0.35*agreementFactor+0.2*magnitudeFactor+0.2*sourceFactor;
  if(direction==="NEUTRAL") confidence=Math.min(confidence,0.58);
  confidence=Number(clamp(confidence).toFixed(4));
  const riskClass=direction==="NEUTRAL"?"high":(agreement===usable.length&&usable.length===3?"medium":"high");
  return {direction,confidence,avg_change_24h_pct:Number(avg.toFixed(6)),agreement,usable_sources:usable.length,risk_class:riskClass};
}

function deriveLanes(markets:any[], mining:any){
  const usable=markets.filter(x=>x?.price>0&&x?.change_24h_pct!=null);
  const changes=usable.map(x=>Number(x.change_24h_pct));
  const avg=changes.length?changes.reduce((a,b)=>a+b,0)/changes.length:0;
  const prices=usable.map(x=>Number(x.price));
  const median=prices.length?[...prices].sort((a,b)=>a-b)[Math.floor(prices.length/2)]:null;
  const maxSpread=prices.length>1?(Math.max(...prices)-Math.min(...prices))/Math.max(median||1,1):0;
  const pos=changes.filter(x=>x>=0.35).length,neg=changes.filter(x=>x<=-0.35).length;
  const momentum=pos>neg&&avg>=0.35?"LONG":neg>pos&&avg<=-0.35?"SHORT":"NEUTRAL";
  const divergence=maxSpread>=0.15/100?(prices[prices.indexOf(Math.max(...prices))]>median?"SHORT":"LONG"):"NEUTRAL";
  const miningState=String(mining?.state||"PENDING").toUpperCase();
  const miningStress=!["LIVE","VERIFIED"].includes(miningState);
  const regime=Math.abs(avg)>=1?"TREND":Math.abs(avg)>=0.35?"WEAK_TREND":"RANGE";
  const lanes=[
   {id:"momentum_consensus",direction:momentum,score:Number(Math.min(1,Math.abs(avg)/2).toFixed(4)),state:usable.length>=2?"VERIFIED":"BLOCKED",reason:usable.length>=2?"multi-venue momentum":"insufficient sources"},
   {id:"cross_venue_dislocation",direction:divergence,score:Number(Math.min(1,maxSpread*100).toFixed(4)),state:usable.length>=2?"VERIFIED":"BLOCKED",reason:usable.length>=2?"price dislocation observer":"insufficient venue prices"},
   {id:"mining_stress_modifier",direction:"NEUTRAL",score:miningStress?0.7:0.2,state:miningStress?"PENDING":"VERIFIED",reason:miningStress?"mining telemetry not live":"mining telemetry live"},
   {id:"regime_filter",direction:regime==="TREND"?(avg>0?"LONG":"SHORT"):"NEUTRAL",score:Number(Math.min(1,Math.abs(avg)/2).toFixed(4)),state:usable.length>=2?"VERIFIED":"BLOCKED",reason:"regime="+regime}
  ];
  const active=lanes.filter(x=>x.state==="VERIFIED"&&x.direction!=="NEUTRAL");
  let direction="NEUTRAL";
  if(active.length){const L=active.filter(x=>x.direction==="LONG").reduce((s,x)=>s+x.score,0),S=active.filter(x=>x.direction==="SHORT").reduce((s,x)=>s+x.score,0);if(Math.max(L,S)>=0.8)direction=L>S?"LONG":"SHORT";}
  return {lanes,direction,regime,max_spread_pct:Number((maxSpread*100).toFixed(5)),avg_change_24h_pct:Number(avg.toFixed(6))};
}

function levels(price:number,direction:string){
  if(direction==="LONG") return {stop:price*0.99,take:price*1.02};
  if(direction==="SHORT") return {stop:price*1.01,take:price*0.98};
  return {stop:null,take:null};
}

async function policyGate(input:any){
  if(!URL||!SK||!ING)return {decision:"require_approval",risk_class:input.risk_class||"high",error:"policy_router_not_configured"};
  try{
    const r=await fetch(URL+"/functions/v1/midad_policy_engine",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+SK,"x-midad-ingest-key":ING},
      body:JSON.stringify(input),
      signal:AbortSignal.timeout(12000)
    });
    const t=await r.text(); let j:any={}; try{j=JSON.parse(t)}catch{j={raw:t}};
    if(!r.ok)return {decision:"require_approval",risk_class:input.risk_class||"high",error:j?.error||"policy_http_"+r.status};
    return j;
  }catch(e){return {decision:"require_approval",risk_class:input.risk_class||"high",error:String(e)};}
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method==="GET"){
    const u=new globalThis.URL(req.url);
    if(u.searchParams.get("action")==="health"){
      const checks=await Promise.allSettled([binance(),bybit(),coinex(),coingecko(),kraken(),okx()]);
      return json({
        ok:true,service:"midad_noncopy_trading_engine",version:1,
        health:checks.map(x=>x.status==="fulfilled"?{ok:true,source:x.value.source,price:x.value.price,change_24h_pct:x.value.change_24h_pct}:{ok:false,error:String(x.reason?.message||x.reason)}),
        paper_only:true,live_execution:false
      });
    }
    return json({ok:true,service:"midad_noncopy_trading_engine",version:1,paper_only:true,live_execution:false});
  }
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const supplied=req.headers.get("x-midad-ingest-key")||req.headers.get("x-midad-autonomy-key")||"";
  const auth=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const autonomy= Deno.env.get("MIDAD_AUTONOMY_KEY")||"";
  const okAuth=Boolean((ING&&supplied===ING)||(autonomy&&supplied===autonomy)||(SK&&auth===SK));
  if(!okAuth)return json({ok:false,error:"unauthorized"},401);

  try{
    const body=await req.json().catch(()=>({}));
    const mode=String(body?.mode||"run");
    const results=await Promise.allSettled([binance(),bybit(),coinex(),coingecko(),kraken(),okx()]);
    const markets=results.map(x=>x.status==="fulfilled"?x.value:null).filter(Boolean);
    const sourceErrors=results.filter(x=>x.status==="rejected").map((x:any)=>String(x.reason?.message||x.reason));
    const d=derive(markets);
    const mining=await miningState();
    const lanes=deriveLanes(markets,mining);
    d.direction=lanes.direction;
    d.avg_change_24h_pct=lanes.avg_change_24h_pct;
    const medianPrice=markets.length?markets.map(x=>x.price).sort((a,b)=>a-b)[Math.floor(markets.length/2)]:null;
    const price=medianPrice;
    const lv=price&&d.direction!=="NEUTRAL"?levels(price,d.direction):{stop:null,take:null};

    const evidence={
      observed_at:new Date().toISOString(),
      market_sources:markets,
      source_errors:sourceErrors,
      independent_method:"multi_lane_noncopy_v2",
      mining,
      no_copy_trading:true
    };
    const gate=await policyGate({
      action:"paper_trade_simulation",
      paper_only:true,
      financial_write:false,
      high_impact_action:false,
      risk_class:d.risk_class,
      confidence:d.confidence,
      conflicting_sources:markets.length<3 || d.agreement<markets.length,
      missing_evidence:markets.length<2 || price==null,
      reason:"noncopy_paper_only"
    });

    const fingerprint="noncopy:BTC:"+Math.floor(Date.now()/60000);
    const payload={strategy:"independent_non_copy",asset_id:"bitcoin",symbol:"BTCUSDT",strategy_lanes:lanes.lanes,regime:lanes.regime,max_spread_pct:lanes.max_spread_pct,direction:d.direction,price,avg_change_24h_pct:d.avg_change_24h_pct,agreement:d.agreement,usable_sources:d.usable_sources,mining_state:mining.state,paper_only:true};
    const {data:sig,error:sigErr}=await admin.from("signal_events").upsert({
      source:"midad-noncopy-trading",
      signal_type:"independent_trading_signal",
      entity:"BTCUSDT",
      score:Number((d.confidence*100).toFixed(2)),
      confidence:d.confidence,
      payload,
      fingerprint,
      occurred_at:new Date().toISOString()
    },{onConflict:"fingerprint"}).select("id,occurred_at").maybeSingle();
    if(sigErr)throw sigErr;

    let paper:any=null;
    if(mode!=="inspect" && d.direction!=="NEUTRAL" && price && d.confidence>=0.64){
      const status=gate?.decision==="block"?"review":gate?.decision==="allow"?"open":"review";
      const {data:existing}=await admin.from("midad_paper_trades").select("id,status").eq("signal_event_id",sig?.id||"").in("status",["open","review"]).maybeSingle();
      if(!existing){
        const {data:pt,error:ptErr}=await admin.from("midad_paper_trades").insert({
          signal_event_id:sig?.id||null,
          asset_symbol:"BTC",
          venue:"binance/bybit/coinex",
          direction:d.direction,
          strategy:"independent_non_copy",
          entry_price:price,
          stop_price:lv.stop,
          take_profit_price:lv.take,
          confidence:d.confidence,
          risk_class:d.risk_class,
          gate_decision:gate?.decision||"require_approval",
          status,
          paper_only:true,
          human_approval_required:true,
          evidence,
          evaluation_at:new Date(Date.now()+15*60000).toISOString(),
          metadata:{engine_version:1,method:"multi_lane_noncopy_v2"}
        }).select("id,status,entry_price,stop_price,take_profit_price,evaluation_at").single();
        if(ptErr)throw ptErr;
        paper=pt;
      }else paper=existing;
    }

    const {data:paperOutcomes}=await admin.from("midad_signal_outcomes")
      .select("horizon_minutes,return_pct,outcome_label,measured_at,target_at,measurement_method")
      .eq("signal_event_id",sig?.id||"").order("horizon_minutes",{ascending:true}).limit(8);
    const {data:learningFeedback}=await admin.from("midad_model_feedback")
      .select("id,signal_type,source,horizon_minutes,sample_size,hit_rate,avg_return_pct,recommended_weight,confidence,generated_at")
      .eq("signal_type","independent_trading_signal").eq("source","midad-noncopy-trading")
      .order("generated_at",{ascending:false}).limit(5);

    return json({
      ok:true,engine:"midad_noncopy_trading_engine",version:2,mode,
      signal:{asset:"BTC",direction:d.direction,strategy:"independent_non_copy",confidence:d.confidence,entry:price,stop:lv.stop,take_profit:lv.take},
      features:{avg_change_24h_pct:d.avg_change_24h_pct,agreement:d.agreement,usable_sources:d.usable_sources,regime:lanes.regime,max_spread_pct:lanes.max_spread_pct,strategy_lanes:lanes.lanes},
      mining,
      risk:{class:d.risk_class,gate_decision:gate?.decision||"require_approval",gate_policy:gate?.policy_key||null},
      evidence,
      paper_trade:paper,
      paper_only:true,
      human_approval_required:true,
      source_errors:sourceErrors,
      signal_event_id:sig?.id||null,
      paper_outcome:(paperOutcomes||[])[0]||null,
      paper_outcomes:paperOutcomes||[],
      learning_feedback:learningFeedback||[]
    });
  }catch(e){return json({ok:false,error:String(e?.message||e).slice(0,1000)},500);}
});