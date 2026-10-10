import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H={"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","access-control-allow-headers":"content-type,x-midad-autonomy-key","access-control-allow-methods":"POST,OPTIONS"};
const json=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers:H});
const clip=(v:any,n=3000)=>String(v??"").slice(0,n);

async function internalPost(base:string,path:string,headers:any,body:any){
  const r=await fetch(base+path,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  return {http_status:r.status,ok:r.ok,result:j};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);

  const adminKey=req.headers.get("x-midad-autonomy-key")||"";
  const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const secretKeys=Deno.env.get("SUPABASE_SECRET_KEYS")||"";
  const ingestKey=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(adminKey==="__health__")return json({ok:true,env:{supabase_url:Boolean(supabaseUrl),service_role_key:Boolean(serviceKey),secret_keys:Boolean(secretKeys),midad_ingest_key:Boolean(ingestKey)}});
  if(!adminKey||(!serviceKey&&!secretKeys))return json({error:"autonomy_not_configured"},503);

  const admin=createClient(supabaseUrl,serviceKey);
  const {data:keyRows}=await admin.rpc("midad_get_autonomy_key");
  const vaultKey=typeof keyRows==="string"?keyRows:(Array.isArray(keyRows)?keyRows[0]?.midad_get_autonomy_key:"");
  if(!vaultKey||adminKey!==vaultKey)return json({error:"forbidden"},403);

  const bucket=new Date(Math.floor(Date.now()/900000)*900000).toISOString();
  const {data:existing}=await admin.from("midad_autonomy_runs").select("id,status,result").eq("bucket_start",bucket).maybeSingle();
  if(existing?.status==="completed")return json({ok:true,skipped:true,reason:"already_completed",run_id:existing.id,result:existing.result});

  let runId=existing?.id;
  if(!runId){
    const ins=await admin.from("midad_autonomy_runs").insert({bucket_start:bucket,status:"running"}).select("id").single();
    if(ins.error)return json({ok:false,error:"autonomy_run_claim_failed"},500);
    runId=ins.data.id;
  }else{
    await admin.from("midad_autonomy_runs").update({status:"running",started_at:new Date().toISOString(),error:null}).eq("id",runId);
  }

  const started=Date.now();
  const headers={"authorization":"Bearer "+serviceKey,"x-midad-autonomy-key":adminKey,"x-midad-ingest-key":ingestKey};
  const result:any={source:"autonomy_loop",bucket_start:bucket,steps:{}};

  try{
    // 1) OSINT: market ingest -> normalized evidence -> opportunity candidates.
    result.steps.osint=await internalPost(supabaseUrl,"/functions/v1/midad_osint_router",headers,{lookback_hours:24,ingest_market:true});

    // 1b) MIDAD account factory: refresh official agent-eligible listings on a bounded 6-hour cadence.
    // This read-only scout runs only after an agent identity and vault credential have been verified.
    // Failures are isolated and must not fail the core autonomy cycle.
    try {
      const {data:platformAgent,error:agentError}=await admin.from("midad_platform_accounts")
        .select("id,account_status,metadata")
        .eq("platform_key","superteam_fun")
        .eq("owner_scope","midad")
        .eq("brand_key","midad_ai")
        .maybeSingle();
      const agentMeta=(platformAgent?.metadata||{}) as any;
      if(!agentError && platformAgent?.account_status==="REGISTERED_UNVERIFIED" &&
         agentMeta.external_actor_type==="autonomous_agent" &&
         agentMeta.api_secret_storage_status==="VAULTED") {
        const {data:lastScout}=await admin.from("midad_account_factory_runs")
          .select("id,state,updated_at")
          .eq("platform_key","superteam_fun")
          .eq("task_type","discover_agent_eligible_listings")
          .order("updated_at",{ascending:false})
          .limit(1)
          .maybeSingle();
        const lastAt=lastScout?.updated_at?new Date(lastScout.updated_at).getTime():0;
        if(!lastAt || !Number.isFinite(lastAt) || Date.now()-lastAt>=6*60*60*1000) {
          result.steps.platform_agent_scout=await internalPost(
            supabaseUrl,
            "/functions/v1/midad_account_factory",
            headers,
            {action:"list_agent_eligible_listings",platform_key:"superteam_fun",take:20,source:"midad_autonomy_loop"}
          );
        } else {
          result.steps.platform_agent_scout={skipped:true,reason:"six_hour_listing_scan_cooldown",last_scan_at:lastScout.updated_at,state:lastScout.state};
        }
      } else {
        result.steps.platform_agent_scout={
          skipped:true,
          reason:agentError?"account_registry_read_failed":"no_verified_superteam_agent_identity",
          account_status:platformAgent?.account_status||null
        };
      }
    } catch(e) {
      result.steps.platform_agent_scout={ok:false,isolated_failure:true,error:clip(e?.message||e,300)};
    }

    // 2) Mining telemetry is read-only. No fund movement and no miner configuration changes.
    result.steps.mining=await internalPost(supabaseUrl,"/functions/v1/midad_viabtc_monitor",headers,{coin:"BTC",label:"ViaBTC BTC Monitor"});
    // Never silently stall: create one bounded human task when ViaBTC cannot be verified.
    if(!result.steps.mining.ok){
      result.steps.human_task_mining=await internalPost(
        supabaseUrl,
        "/functions/v1/midad_human_task_router",
        headers,
        {
          action:"create",
          type:"VERIFICATION",
          priority:92,
          risk_class:"high",
          blocking:true,
          title:"تحقق من اتصال ViaBTC",
          instruction:"تحقق من أن مفاتيح ViaBTC API المطلوبة موجودة في أسرار Supabase وأن مفتاح API صالح للقراءة. لا ترسل أي Secret أو Private Key داخل المهمة.",
          reason:"ViaBTC monitor did not return a verified telemetry snapshot.",
          requested_by_agent:"midad_autonomy_loop",
          idempotency_key:"viabtc:verify-monitor-configuration",
          evidence:{monitor_result:result.steps.mining}
        }
      );
    }

    // 3) Settlement preparation: route only independently verified paid intents.
    // This records treasury state and never submits a withdrawal/transfer.
    const {data:paidPayments}=await admin.from("midad_payment_intents")
      .select("id")
      .eq("status","paid")
      .eq("reconciliation_status","matched")
      .gte("paid_at",new Date(Date.now()-7*86400000).toISOString())
      .order("paid_at",{ascending:false})
      .limit(20);
    result.steps.settlement=[];
    for(const p of (paidPayments||[])){
      result.steps.settlement.push(await internalPost(
        supabaseUrl,
        "/functions/v1/midad_settlement_router",
        headers,
        {action:"route_paid_payment",payment_intent_id:p.id}
      ));
    }

    // 3) Outcome measurement once per hour, not every 15-minute cycle.
    const minute=new Date().getUTCMinutes();
    if(minute===0) {
      result.steps.outcomes=await internalPost(supabaseUrl,"/functions/v1/midad_measure_outcomes",{"authorization":"Bearer "+serviceKey},{lookback_hours:72,limit:300,horizons_minutes:[15,60,240,1440]});
    } else {
      result.steps.outcomes={skipped:true,reason:"hourly cadence"};
    }

    // 4) Housekeeping: expire only stale sessions/approvals/payment quotes.
    const now=new Date().toISOString();
    const sessions=await admin.from("control_room_sessions").update({active:false})
      .lt("created_at",new Date(Date.now()-30*86400000).toISOString()).eq("active",true);
    const approvals=await admin.from("midad_approvals").update({status:"expired",decided_at:now})
      .eq("status","pending").lt("expires_at",now).not("expires_at","is",null);
    const payments=await admin.from("midad_payment_intents").update({status:"expired",updated_at:now})
      .in("status",["created","quoted","waiting"]).lt("expires_at",now).not("expires_at","is",null);
    result.steps.human_tasks=await internalPost(
      supabaseUrl,
      "/functions/v1/midad_human_task_router",
      headers,
      {action:"expire_stale"}
    );

    result.steps.housekeeping={
      sessions_expired_error:sessions.error?.message||null,
      approvals_expired_error:approvals.error?.message||null,
      payment_expiry_error:payments.error?.message||null
    };

    const {data:profile}=await admin.from("profiles").select("id").limit(1).maybeSingle();
    if(profile?.id){
      await admin.from("midad_audit_log").insert({
        user_id:profile.id,event_type:"autonomy_cycle",actor_type:"agent",action:"autonomy_cycle_completed",
        subject_type:"autonomy_run",subject_id:runId,status:"completed",risk_class:"low",
        summary:"MIDAD autonomy cycle completed without financial execution.",
        details:{duration_ms:Date.now()-started,steps:Object.keys(result.steps)}
      });
    }

    result.duration_ms=Date.now()-started;
    await admin.from("midad_autonomy_runs").update({status:"completed",completed_at:new Date().toISOString(),result}).eq("id",runId);
    return json({ok:true,run_id:runId,result});
  }catch(e){
    const err=clip(e?.message||e);
    result.duration_ms=Date.now()-started;
    await admin.from("midad_autonomy_runs").update({status:"error",completed_at:new Date().toISOString(),result,error:err}).eq("id",runId);
    return json({ok:false,run_id:runId,result,error:err},500);
  }
});