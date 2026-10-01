import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const JSON_HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type,authorization,x-midad-microscope-key"
};
const ok=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers:JSON_HEADERS});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const n=(v:any)=>{const x=Number(v);return Number.isFinite(x)?x:null};
const ageMin=(ts:any)=>{if(ts==null)return null;const x=Number(ts),ms=x>2e12?x:x*1000;return Math.max(0,Math.round((Date.now()-ms)/60000))};
const severityRank=(x:string)=>x==="critical"?3:x==="warning"?2:1;

function normalizeWorkers(raw:any[]){
  return raw.map((w:any)=>({
    worker_id:w.worker_id??null,
    worker_name:w.worker_name??null,
    group_id:w.group_id??null,
    group_name:w.group_name??null,
    worker_status:String(w.worker_status??"unknown").toLowerCase(),
    hashrate_10m_ths:(n(w.hashrate_10min)>=1e9?n(w.hashrate_10min)/1e12:n(w.hashrate_10min)),
    hashrate_1h_ths:(n(w.hashrate_1hour)>=1e9?n(w.hashrate_1hour)/1e12:n(w.hashrate_1hour)),
    hashrate_24h_ths:(n(w.hashrate_24hour)>=1e9?n(w.hashrate_24hour)/1e12:n(w.hashrate_24hour)),
    reject_rate:n(w.reject_rate),
    last_active:w.last_active??null
  }));
}

function statusLabel(w:any){
  const s=String(w.worker_status||"unknown");
  if(["active","online"].includes(s))return "ACTIVE";
  if(["inactive","offline","unactive","invalid"].includes(s))return "INACTIVE";
  return s.toUpperCase();
}

function diagnose(w:any,prev:any){
  const age=ageMin(w.last_active),h10=n(w.hashrate_10m_ths),h1=n(w.hashrate_1h_ths),h24=n(w.hashrate_24h_ths),rej=n(w.reject_rate);
  const prior10=n(prev?.last_hashrate_10m_ths);
  const priorStatus=String(prev?.last_status||"");
  const currentStatus=statusLabel(w);
  const out:any[]=[];
  if(currentStatus==="ACTIVE"&&h10===0)out.push({type:"active_zero_hashrate",severity:"critical",reason:"Worker reports active but current 10m hashrate is zero",causes:["stratum/network disconnect not reflected yet","miner process/hashboard fault","pool-side worker state lag"],action:"re-probe worker; inspect network, process and local miner telemetry"});
  if((currentStatus==="INACTIVE"||currentStatus==="UNKNOWN")&&["active","online","ACTIVE"].includes(priorStatus)){
    out.push({type:"worker_state_drop",severity:"critical",reason:"Worker transitioned from active to non-active",causes:["power loss or miner restart","network/stratum disconnect","worker configuration or identity change"],action:"verify power/network first, then inspect miner local status"});
  }
  if(h24!==null&&h10!==null&&h24>0){
    const drift=((h10-h24)/h24)*100;
    if(drift<=-35)out.push({type:"hashrate_drop",severity:"critical",reason:"10m hashrate is at least 35% below the 24h worker baseline",causes:["sustained hardware performance degradation","thermal/power throttling","network/stratum instability","pool-side accounting lag"],action:"open 7D history; verify local temperature/power/network before restart"});
    else if(drift<=-20)out.push({type:"hashrate_drop",severity:"warning",reason:"10m hashrate is at least 20% below the 24h worker baseline",causes:["short-term instability","thermal/power throttling","network/stratum instability"],action:"compare 1h/24h and re-probe before intervention"});
  }
  if(h1!==null&&h10!==null&&h1>0){
    const drift=((h10-h1)/h1)*100;
    if(drift<=-20)out.push({type:"short_term_drop",severity:"warning",reason:"10m hashrate is at least 20% below the 1h worker baseline",causes:["recent connectivity degradation","thermal/power event","transient miner instability"],action:"watch the next sample and compare with 24h baseline"});
  }
  if(rej!==null&&rej>=1)out.push({type:"high_reject",severity:"critical",reason:"Worker reject rate is at least 1%",causes:["network/stratum quality","pool configuration mismatch","hardware instability"],action:"inspect network quality and miner diagnostics; compare reject trend"});
  else if(rej!==null&&rej>=0.5)out.push({type:"high_reject",severity:"warning",reason:"Worker reject rate is at least 0.5%",causes:["network quality","pool configuration","transient hardware instability"],action:"monitor reject trend and re-probe"});
  // Last Active is a weak signal by itself. Do not alarm on age when the worker
  // is actively producing measurable hashrate. Escalate staleness only when
  // activity age combines with zero/near-zero output or a non-active state.
  const staleCandidate=age!==null&&age>20;
  const outputDead=h10===null||h10<=0.001;
  const hadPriorActive=["active","online","ACTIVE"].includes(priorStatus);
  // Baseline-aware: historical/invalid workers are not alarms unless previously observed active.
  if(staleCandidate&&outputDead&&(currentStatus==="ACTIVE"||hadPriorActive)){
    const crit=age>60||hadPriorActive&&currentStatus!=="ACTIVE";
    out.push({type:"stale_telemetry",severity:crit?"critical":"warning",reason:"Worker activity is stale and current output provides no meaningful hashrate",causes:["worker offline","network/stratum disconnect","telemetry lag"],action:"re-probe worker and verify network/power before intervention"});
  }
  if(prior10!==null&&h10!==null&&prior10>0&&h10/prior10<0.5)out.push({type:"sudden_step_down",severity:"critical",reason:"Current 10m hashrate is below half of the previous microscope sample",causes:["sudden power/network interruption","miner process fault","hashboard degradation"],action:"run immediate worker re-probe and inspect local machine"});
  return out;
}

async function getMicroscopeKey(admin:any){
  try{const r=await admin.rpc("midad_get_microscope_key");return String(r.data||"").trim()}catch{return ""}
}

async function callMonitor(admin:any,body:any={coin:"BTC",label:"ViaBTC BTC Monitor"}){
  const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const r=await fetch(url+"/functions/v1/midad_viabtc_monitor",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk},body:JSON.stringify(body)});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  return {http_status:r.status,...j};
}

async function snapshot(admin:any){
  const {data,error}=await admin.from("midad_mining_accounts").select("id,status,read_only,last_hashrate_ths,last_worker_count,last_snapshot_at,metadata").eq("provider","viabtc").eq("coin","BTC").eq("label","ViaBTC BTC Monitor").maybeSingle();
  if(error)return {ok:false,error:"snapshot_query_failed"};
  const a=data||null,m=a?.metadata&&typeof a.metadata==="object"?a.metadata:{};
  return {ok:true,account:a?{id:a.id,status:a.status,read_only:a.read_only,hashrate_ths:a.last_hashrate_ths,worker_count:a.last_worker_count,last_snapshot_at:a.last_snapshot_at}:null,workers:normalizeWorkers(Array.isArray(m.workers)?m.workers:[]),metadata:m};
}

async function telegramApi(token:string,method:string,body:any){
  try{const r=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));return {ok:r.ok&&j?.ok===true,error:j?.description||""}}catch(e){return {ok:false,error:String(e)}}
}

async function sendAlert(admin:any,payload:any){
  const token=(Deno.env.get("VIABTC_MONITOR_BOT_TOKEN")||Deno.env.get("TELEGRAM_BOT_TOKEN")||"").trim();
  let activeToken=token;
  if(!activeToken){
    const q=await admin.from("bot_configs").select("telegram_bot_token").eq("active",true).eq("platform","telegram").limit(1).maybeSingle();
    activeToken=String(q.data?.telegram_bot_token||"").trim();
  }
  if(!activeToken)return {sent:0,reason:"telegram_token_unavailable"};
  const q=await admin.from("control_room_access").select("telegram_user_id").eq("active",true);
  const chats=(q.data||[]).map((x:any)=>String(x.telegram_user_id||"")).filter(Boolean);
  if(!chats.length)return {sent:0,reason:"no_authorized_chats"};
  const line=payload.worker_id?("\nWorker #"+payload.worker_id+" · "+String(payload.worker_name||"unknown")):"";
  const text="🔬 MIDAD Miner Microscope\n"+String(payload.title||"Mining incident")+line+"\n\n"+String(payload.reason||"")+"\n\n🧭 السبب المحتمل: "+String(payload.causes?.join(" / ")||"يحتاج تحقق")+"\n🛠 الإجراء الآمن: "+String(payload.action||"re-probe + inspect")+"\n📡 Severity: "+String(payload.severity||"warning")+"\n\n🔗 https://sirahwaz.github.io/Control-room/viabtc.html?v=20261001vm8";
  let sent=0;for(const chatId of chats){const r=await telegramApi(activeToken,"sendMessage",{chat_id:chatId,text:text.slice(0,3900),disable_web_page_preview:true});if(r.ok)sent++}
  return {sent};
}

async function upsertIncident(admin:any,accountId:string,w:any,issue:any,runId:string){
  const fingerprint="viabtc:"+accountId+":"+String(w.worker_id)+":"+issue.type;
  const old=await admin.from("midad_miner_incidents").select("*").eq("fingerprint",fingerprint).maybeSingle();
  const evidence={worker_status:w.worker_status,status_label:statusLabel(w),hashrate_10m_ths:w.hashrate_10m_ths,hashrate_1h_ths:w.hashrate_1h_ths,hashrate_24h_ths:w.hashrate_24h_ths,reject_rate:w.reject_rate,last_active:w.last_active,last_active_age_min:ageMin(w.last_active),run_id:runId};
  const health=issue.severity==="critical"?35:issue.severity==="warning"?65:50, anomaly=100-health;
  const shouldAlert=!old.data||severityRank(issue.severity)>severityRank(String(old.data.severity||"info"))||!old.data.last_alert_at||(Date.now()-Date.parse(old.data.last_alert_at)>60*60*1000);
  if(old.data){
    await admin.from("midad_miner_incidents").update({worker_name:w.worker_name,severity:issue.severity,status:"open",health,anomaly,evidence,diagnosis:{causes:issue.causes,reason:issue.reason,agent:"root_cause_agent",confidence:issue.causes?.length===1?.9:.72},recommended_action:issue.action,auto_recovery_action:"worker_reprobe",last_seen_at:new Date().toISOString(),occurrence_count:Number(old.data.occurrence_count||0)+1,updated_at:new Date().toISOString()}).eq("id",old.data.id);
  }else{
    await admin.from("midad_miner_incidents").insert({account_id:accountId,worker_id:Number(w.worker_id),worker_name:w.worker_name,fingerprint,incident_type:issue.type,severity:issue.severity,status:"open",health,anomaly,evidence,diagnosis:{causes:issue.causes,reason:issue.reason,agent:"root_cause_agent",confidence:issue.causes?.length===1?.9:.72},recommended_action:issue.action,auto_recovery_action:"worker_reprobe",auto_recovery_status:"pending"});
  }
  return {new:!old.data,shouldAlert,fingerprint};
}

async function resolveRecovered(admin:any,accountId:string,currentFingerprints:Set<string>){
  const {data}=await admin.from("midad_miner_incidents").select("*").eq("account_id",accountId).eq("status","open").limit(200);
  const recovered:any[]=[];
  for(const row of data||[]){
    if(!currentFingerprints.has(row.fingerprint)){
      await admin.from("midad_miner_incidents").update({status:"resolved",resolved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",row.id);
      recovered.push(row);
    }
  }
  return recovered;
}

async function runScan(admin:any){
  const started=new Date().toISOString();
  const q=await admin.from("midad_mining_accounts").select("id,status,last_snapshot_at").eq("provider","viabtc").eq("coin","BTC").eq("label","ViaBTC BTC Monitor").maybeSingle();
  if(!q.data)return {ok:false,error:"viabtc_account_missing"};
  const runIns=await admin.from("midad_miner_agent_runs").insert({account_id:q.data.id,status:"running"}).select("id").single();
  const runId=runIns.data?.id;
  let monitor=await callMonitor(admin);
  if(!monitor.ok){
    await sleep(1200);
    monitor=await callMonitor(admin);
  }
  const snap=await snapshot(admin);
  if(!snap.ok||!snap.account){
    await admin.from("midad_miner_agent_runs").update({status:"failed",finished_at:new Date().toISOString(),summary:{monitor,snapshot:snap}}).eq("id",runId);
    return {ok:false,error:"microscope_snapshot_failed",monitor,snapshot:snap};
  }
  const workers=snap.workers||[];
  const stateQ=await admin.from("midad_miner_worker_states").select("*").eq("account_id",snap.account.id).limit(200);
  const stateMap=new Map((stateQ.data||[]).map((x:any)=>[String(x.worker_id),x]));
  const current=new Set<string>(), opened:any[]=[],alerts:any[]=[],recovery:any[]=[],updatedStates:any[]=[];
  for(const w of workers){
    const prev=stateMap.get(String(w.worker_id));
    const issues=diagnose(w,prev);
    for(const issue of issues){
      const u=await upsertIncident(admin,snap.account.id,w,issue,runId);
      current.add(u.fingerprint);
      opened.push({worker_id:w.worker_id,type:issue.type,severity:issue.severity});
      if(u.shouldAlert)alerts.push({...issue,worker_id:w.worker_id,worker_name:w.worker_name});
      // Recovery Agent: a second read for high-impact discrepancies, never an actuator.
      if(severityRank(issue.severity)>=2){
        const detail=await callMonitor(admin,{coin:"BTC",label:"ViaBTC BTC Monitor",worker_id:String(w.worker_id),scope:"worker_detail"});
        const detailOk=Boolean(detail.ok);
        await admin.from("midad_miner_incidents").update({auto_recovery_status:detailOk?"reprobe_complete":"reprobe_failed",updated_at:new Date().toISOString()}).eq("fingerprint",u.fingerprint);
        recovery.push({worker_id:w.worker_id,type:issue.type,reprobe_ok:detailOk});
      }
    }
    const alertCount=issues.length;
    const priorDrop=Number(prev?.consecutive_drop_count||0),priorInactive=Number(prev?.consecutive_inactive_count||0);
    const isDrop=issues.some(x=>["hashrate_drop","short_term_drop","sudden_step_down"].includes(x.type));
    const isInactive=issues.some(x=>x.type==="worker_state_drop");
    const vals={account_id:snap.account.id,worker_id:Number(w.worker_id),worker_name:w.worker_name,last_status:w.worker_status,last_hashrate_10m_ths:w.hashrate_10m_ths,last_hashrate_1h_ths:w.hashrate_1h_ths,last_hashrate_24h_ths:w.hashrate_24h_ths,last_reject_rate:w.reject_rate,last_active:w.last_active,last_seen_at:new Date().toISOString(),consecutive_drop_count:isDrop?priorDrop+1:0,consecutive_inactive_count:isInactive?priorInactive+1:0,consecutive_alert_count:alertCount?Number(prev?.consecutive_alert_count||0)+1:0,metadata:{issue_types:issues.map(x=>x.type),run_id:runId},updated_at:new Date().toISOString()};
    await admin.from("midad_miner_worker_states").upsert(vals,{onConflict:"account_id,worker_id"});
    updatedStates.push({worker_id:w.worker_id,issues:issues.length});
  }
  // Account/Fleet Agent
  const fleet10=workers.reduce((s:any,w:any)=>s+(n(w.hashrate_10m_ths)||0),0);
  const fleet24=workers.reduce((s:any,w:any)=>s+(n(w.hashrate_24h_ths)||0),0);
  if(fleet24>0){
    const drift=((fleet10-fleet24)/fleet24)*100;
    if(drift<=-20){
      const type=drift<=-35?"fleet_collapse":"fleet_drift",severity=drift<=-35?"critical":"warning";
      const fIssue={type,severity,reason:"Fleet 10m hashrate is materially below the worker-level 24h baseline",causes:["multiple workers degraded together","shared network/stratum issue","shared power/environment condition"],action:"open the heatmap and identify whether the drop is concentrated by group or distributed"};
      const fw={worker_id:0,worker_name:"FLEET",hashrate_10m_ths:fleet10,hashrate_1h_ths:null,hashrate_24h_ths:fleet24,reject_rate:null,last_active:null,worker_status:"fleet"};
      const u=await upsertIncident(admin,snap.account.id,fw,fIssue,runId);
      current.add(u.fingerprint);if(u.shouldAlert)alerts.push({...fIssue,worker_id:null,worker_name:"FLEET"});
    }
  }
  const recovered=await resolveRecovered(admin,snap.account.id,current);
  for(const row of recovered){
    alerts.push({severity:"info",title:"Miner recovered",reason:"The previously observed incident is no longer present in the current microscope scan.",causes:["current telemetry returned to the monitored range"],action:"continue monitoring; no hardware action performed",worker_id:row.worker_id,worker_name:row.worker_name,recovery:true});
  }
  let alertsSent=0;
  for(const a of alerts){
    const r=await sendAlert(admin,{title:a.recovery?"✅ Recovery":"⚠ Microscope Alert",...a});
    alertsSent+=Number(r.sent||0);
    if(!a.recovery&&a.worker_id!==0)await admin.from("midad_miner_incidents").update({last_alert_at:r.sent?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("fingerprint","viabtc:"+snap.account.id+":"+String(a.worker_id)+":"+String(a.type));
  }
  const summary={agent_pipeline:["telemetry_scout","drop_detector","root_cause_agent","recovery_agent","alert_agent"],workers:workers.length,active:workers.filter((w:any)=>statusLabel(w)==="ACTIVE").length,issues:opened,alerts_candidates:alerts.length,recovery,recovered:recovered.length,fleet_10m_ths:fleet10,fleet_24h_ths:fleet24,transport:snap.metadata?.transport||null};
  await admin.from("midad_miner_agent_runs").update({status:"completed",finished_at:new Date().toISOString(),workers_scanned:workers.length,incidents_opened:opened.filter(x=>x.severity==="critical"||x.severity==="warning").length,incidents_updated:opened.length,incidents_resolved:recovered.length,alerts_sent:alertsSent,auto_recoveries:recovery.length,summary}).eq("id",runId);
  return {ok:true,run_id:runId,summary,alerts_sent:alertsSent};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:JSON_HEADERS});
  try{
    const url=new URL(req.url),admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const expected=await getMicroscopeKey(admin);
    const supplied=req.headers.get("x-midad-microscope-key")||"";
    const auth=req.headers.get("authorization")||"";
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    if(!(expected&&supplied===expected)&&auth!=="Bearer "+serviceKey)return ok({ok:false,error:"unauthorized"},401);
    const body=req.method==="POST"?await req.json().catch(()=>({})):{};
    const mode=String(body.mode||url.searchParams.get("mode")||"status").toLowerCase();
    if(mode==="status"){
      const [runs,inc]=await Promise.all([
        admin.from("midad_miner_agent_runs").select("id,status,started_at,finished_at,workers_scanned,incidents_opened,incidents_resolved,alerts_sent,auto_recoveries,summary").order("started_at",{ascending:false}).limit(5),
        admin.from("midad_miner_incidents").select("id,worker_id,worker_name,incident_type,severity,status,health,anomaly,diagnosis,recommended_action,auto_recovery_status,first_seen_at,last_seen_at,occurrence_count,last_alert_at").eq("status","open").order("severity",{ascending:false}).order("last_seen_at",{ascending:false}).limit(50)
      ]);
      return ok({ok:true,mode:"status",latest_runs:runs.data||[],open_incidents:inc.data||[]});
    }
    if(mode==="scan")return ok(await runScan(admin));
    return ok({ok:false,error:"unsupported_mode"},400);
  }catch(e){return ok({ok:false,error:"microscope_error",message:String(e).slice(0,800)},500)}
});