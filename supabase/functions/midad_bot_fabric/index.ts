import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-ingest-key"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const clip=(x:any,n=1000)=>String(x??"").trim().slice(0,n);
const db=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");

async function auth(req:Request){
  const key=Deno.env.get("MIDAD_INGEST_KEY")||"";
  const autonomy=Deno.env.get("MIDAD_AUTONOMY_KEY")||"";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const suppliedIngest=req.headers.get("x-midad-ingest-key")||"";
  const suppliedAutonomy=req.headers.get("x-midad-autonomy-key")||"";
  if(sk&&req.headers.get("authorization")==="Bearer "+sk)return true;
  if(key&&suppliedIngest===key)return true;
  if(autonomy&&suppliedAutonomy===autonomy)return true;
  if(suppliedAutonomy){
    const r=await db.rpc("midad_get_autonomy_key");
    if(!r.error&&r.data&&suppliedAutonomy===String(r.data))return true;
  }
  return false;
}

async function invoke(service:string,body:any){
  const base=Deno.env.get("SUPABASE_URL")||"";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  const r=await fetch(base+"/functions/v1/"+service,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify(body)});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  return {http:r.status,ok:r.ok,data:j};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  if(!(await auth(req)))return json({ok:false,error:"unauthorized"},401);

  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,sk);
  const body=await req.json().catch(()=>({}));
  const action=clip(body.action,60).toLowerCase();

  try{
    if(action==="health"||action==="status"){
      const [bots,routes,outbox]=await Promise.all([
        sb.from("midad_bot_registry").select("bot_key,telegram_handle,display_name,role,enabled,direct_channel,background_worker,scopes,capabilities").order("bot_key"),
        sb.from("midad_service_routes").select("route_key,source_bot_key,destination_service,action,risk_class,human_gate,enabled").order("route_key"),
        sb.from("midad_bot_outbox").select("bot_key,event_type,priority,delivery_status,attempts,created_at").in("delivery_status",["queued","processing"]).order("priority",{ascending:false}).order("created_at",{ascending:false}).limit(30)
      ]);
      return json({ok:true,service:"midad_bot_fabric",version:1,bots:bots.data||[],routes:routes.data||[],queue:outbox.data||[]});
    }

    if(action==="emit"){
      const botKey=clip(body.bot_key,80),eventType=clip(body.event_type,120);
      if(!botKey||!eventType)return json({ok:false,error:"bot_key_and_event_type_required"},400);
      const dedupe=clip(body.dedupe_key||"",240)||null;
      if(dedupe){
        const old=await sb.from("midad_bot_outbox").select("id,delivery_status").eq("dedupe_key",dedupe).maybeSingle();
        if(old.data)return json({ok:true,idempotent:true,outbox:old.data});
      }
      const ins=await sb.from("midad_bot_outbox").insert({
        bot_key:botKey,channel:clip(body.channel||"telegram",40),event_type:eventType,
        priority:Number(body.priority??50),subject_key:clip(body.subject_key||"",240)||null,dedupe_key:dedupe,
        payload:(body.payload&&typeof body.payload==="object")?body.payload:{},delivery_status:"queued",attempts:0
      }).select("id,bot_key,event_type,priority,delivery_status,created_at").single();
      if(ins.error)return json({ok:false,error:"outbox_insert_failed"},500);
      return json({ok:true,outbox:ins.data});
    }

    if(action==="route"){
      const routeKey=clip(body.route_key,120);
      const route=await sb.from("midad_service_routes").select("*").eq("route_key",routeKey).eq("enabled",true).maybeSingle();
      if(!route.data)return json({ok:false,error:"route_not_found"},404);
      const r=route.data;

      // Financially consequential routes are never executed as live actions by the fabric.
      if(r.action==="live_trade"||r.action==="live_withdrawal"||r.action==="live_withdraw"){
        return json({ok:false,status:"blocked",reason:"live_financial_action_blocked_by_bot_fabric",route:r.route_key},409);
      }

      const allowed={
        "midad_neural_core":{analyze:"query"},
        "midad_market_ingest":{scan:"scan"},
        "midad_opportunity_engine":{scan:"scan"},
        "midad_finance_station":{overview:"overview",prepare_trade:"prepare_trade",create_withdrawal_intent:"create_withdrawal_intent"},
        "midad_money_hunter":{scan:"scan"},
        "midad_noncopy_trading_engine":{run:"run"},
        "midad_account_factory":{
          list_platforms:"list_platforms",
          assess_platform:"assess_platform",
          prepare_profile:"prepare_profile",
          queue_onboarding:"queue_onboarding",
          register_agent_identity:"register_agent_identity",
          list_agent_eligible_listings:"list_agent_eligible_listings",
          list_accounts:"list_accounts",
          list_runs:"list_runs"
        }
      } as any;
      const svc=allowed[r.destination_service];
      if(!svc||!svc[r.action])return json({ok:false,error:"route_action_not_supported",route:r.route_key},400);

      const mapped=svc[r.action];
      let payload=body.payload&&typeof body.payload==="object"?body.payload:{};
      if(r.destination_service==="midad_account_factory")payload={...payload,action:mapped};
      if(r.action==="analyze"&&!payload.query)payload={...payload,query:clip(body.query||"تحليل حالة MIDAD الحالية",700)};
      if(r.action==="scan"&&r.destination_service==="midad_market_ingest")payload={...payload,run_opportunity_engine:true};
      if(r.action==="scan"&&r.destination_service==="midad_money_hunter")payload={...payload};
      const result=await invoke(r.destination_service,payload);

      try {
        await sb.from("midad_audit_log").insert({
          user_id:(await sb.from("profiles").select("id").limit(1).maybeSingle()).data?.id,
          event_type:"bot_fabric_route",
          actor_type:"agent",
          action:r.action,
          subject_type:"service_route",
          subject_id:r.id,
          status:result.ok?"completed":"failed",
          risk_class:r.risk_class||"low",
          summary:"Bot Fabric routed a request to an internal MIDAD service.",
          details:{route_key:r.route_key,source_bot_key:r.source_bot_key,destination:r.destination_service,http:result.http,human_gate:r.human_gate}
        });
      } catch (_) {
        // Best-effort audit write; routing result remains authoritative.
      }

      const responseStatus = result.ok ? 200 : ([400,401,403,404,409,422].includes(result.http) ? result.http : 502);
      return json({ok:result.ok,route:r.route_key,source_bot:r.source_bot_key,destination:r.destination_service,action:mapped,human_gate:r.human_gate,result:result.data},responseStatus);
    }

    if(action==="queue"){
      const rows=await sb.from("midad_bot_outbox").select("id,bot_key,channel,event_type,priority,subject_key,payload,delivery_status,attempts,next_attempt_at,created_at").eq("delivery_status","queued").lte("next_attempt_at",new Date().toISOString()).order("priority",{ascending:false}).order("created_at",{ascending:true}).limit(Math.min(50,Math.max(1,Number(body.limit||20))));
      return json({ok:true,items:rows.data||[]});
    }

    return json({ok:false,error:"unsupported_action"},400);
  }catch(e){
    return json({ok:false,error:"bot_fabric_failed",detail:String(e).slice(0,700)},500);
  }
});