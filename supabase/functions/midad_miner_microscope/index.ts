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

function diagnose(w:any,prev:any,local:any,peer:any[]=[]){
  const age=ageMin(w.last_active),h10=n(w.hashrate_10m_ths),h1=n(w.hashrate_1h_ths),h24=n(w.hashrate_24h_ths),rej=n(w.reject_rate);
  const prior10=n(prev?.last_hashrate_10m_ths);
  const priorStatus=String(prev?.last_status||"");
  const currentStatus=statusLabel(w);
  const out:any[]=[];
  const lt=local&&typeof local==="object"?local:null;
  const lhash=n(lt?.local_hashrate_ths),temp=n(lt?.temp_max_c),fan=n(lt?.fan_avg_pct),power=n(lt?.power_watts),asic=n(lt?.asic_error_count),chains=n(lt?.chain_count),expectedChains=n(lt?.chain_expected),stratum=typeof lt?.stratum_ok==="boolean"?lt.stratum_ok:null;
  if(temp!==null&&temp>=90)out.push({type:"thermal_risk",severity:"critical",reason:"Local sensor reports very high ASIC temperature (heuristic threshold >=90°C)",causes:["cooling airflow restriction","fan failure or low fan speed","ambient heat","thermal throttling"],action:"inspect cooling/fans immediately; do not force a restart without local verification"});
  else if(temp!==null&&temp>=85)out.push({type:"thermal_risk",severity:"warning",reason:"Local sensor reports elevated ASIC temperature (heuristic threshold >=85°C)",causes:["cooling restriction","high ambient temperature","fan behavior","thermal load"],action:"inspect temperature trend and fan behavior"});
  if(fan!==null&&fan<30&&temp!==null&&temp>=75)out.push({type:"cooling_suspect",severity:"warning",reason:"Low average fan signal combined with elevated temperature",causes:["fan degradation","fan control issue","airflow restriction"],action:"inspect fan/airflow and compare peer miners"});
  if(asic!==null&&asic>0)out.push({type:"asic_error",severity:asic>=10?"critical":"warning",reason:"Local miner reports hardware/ASIC errors",causes:["ASIC/board instability","power quality","thermal stress","firmware/device condition"],action:"inspect per-chain/device diagnostics before restart"});
  if(expectedChains!==null&&chains!==null&&expectedChains>0&&chains<expectedChains)out.push({type:"chain_loss",severity:"critical",reason:"Observed ASIC chain count is below the configured expected count",causes:["hashboard/chain fault","cabling/power issue","controller/firmware state"],action:"inspect the missing chain and local device diagnostics"});
  if(stratum===false)out.push({type:"local_stratum_down",severity:"critical",reason:"Local miner reports Stratum as inactive",causes:["LAN/WAN path","pool endpoint resolution","miner networking","pool-side issue"],action:"verify network and pool endpoint; compare other miners before hardware intervention"});
  if(h10!==null&&lhash!==null&&h10>0){
    const gap=((lhash-h10)/h10)*100;
    if(Math.abs(gap)>=15)out.push({type:"pool_local_disparity",severity:"warning",reason:"Local hashrate and pool-side 10m hashrate differ materially",causes:gap<0?["local miner performance below pool observation","local sensor sampling window mismatch"]:["pool-side accounting/sampling lag","worker mapping mismatch"],action:"compare timestamps/windows and inspect pool vs local samples"});
  }
  const topology=lt?.signals?.topology&&typeof lt.signals.topology==="object"?lt.signals.topology:null;
  if(topology?.rack&&peer.length){
    const peers=peer.filter((x:any)=>x?.signals?.topology?.rack===topology.rack);
    const degraded=peers.filter((x:any)=>Number(x.local_hashrate_ths||0)>0&&Number(x.local_hashrate_ths)<Number(x.pool_10m_ths||0)*0.8);
    if(peers.length>=2&&degraded.length>=Math.ceil(peers.length*0.5))out.push({type:"shared_rack_degradation",severity:"critical",reason:"Multiple miners in the same Rack/Zone show simultaneous local-vs-pool degradation",causes:["shared power/PSU zone","shared network/switch path","environmental condition"],action:"inspect shared infrastructure before replacing any individual miner"});
  }
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

async function aiRootCause(admin:any,w:any,issue:any,local:any){
  const ambiguous=["active_zero_hashrate","worker_state_drop","hashrate_drop","sudden_step_down","pool_local_disparity"];
  if(issue.severity!=="critical"||!ambiguous.includes(issue.type))return null;
  // Only escalate when the deterministic evidence is not already strongly local.
  const strongLocal=Boolean(local&&(Number(local.asic_error_count)>0||Number(local.chain_count)>0&&Number(local.chain_expected)>Number(local.chain_count)||local.stratum_ok===false||Number(local.temp_max_c)>=90));
  if(strongLocal)return null;
  const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(!url||!sk||!ik)return null;
  const prompt=`أنت MIDAD Root-Cause Reasoning Agent. حلّل Incident تعدين حرِج اعتمادًا على الأدلة فقط.
لا تفترض سببًا غير مقاس. أرجع JSON فقط بهذا الشكل:
{"hypotheses":[{"cause":"...","confidence":0.0,"evidence":"...","missing":"..."}],"next_probe":"...","do_not_claim":"..."}
الأولوية لتمييز hardware / thermal / power / network-stratum / pool-accounting / telemetry-lag.
لا تقترح Restart أو Power Cycle كخطوة تلقائية؛ أعطِ فحصًا غير هدّام أولًا.
Worker: ${JSON.stringify(w)}
Issue: ${JSON.stringify(issue)}
Local telemetry: ${JSON.stringify(local||null)}`;
  try{
    const r=await fetch(url+"/functions/v1/midad_orchestrator",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},
      body:JSON.stringify({task:prompt,role:"reasoning",context:{worker:w,issue,local}})
    });
    const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
    if(!r.ok||j?.success===false||!j?.final)return null;
    const raw=String(j.final);
    try{return JSON.parse(raw)}catch{return {hypotheses:[],next_probe:"AI returned non-JSON reasoning",do_not_claim:raw.slice(0,1800)}}
  }catch{return null}
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

async function proposeRepair(admin:any,accountId:string,issue:any,w:any,incident:any){
  if(issue.severity!=="critical")return null;
  const dedupe="miner-repair:"+accountId+":"+String(w.worker_id)+":"+issue.type;
  const recent=await admin.from("midad_miner_repair_actions").select("id").eq("account_id",accountId).eq("worker_id",Number(w.worker_id)).eq("action_type",issue.type).in("action_state",["proposed","approved","running"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(recent.data)return recent.data;
  const ins=await admin.from("midad_miner_repair_actions").insert({
    incident_id:incident?.id||null,account_id:accountId,worker_id:Number(w.worker_id),
    action_type:issue.type,action_state:"proposed",requires_approval:true,
    requested_by_agent:"midad_miner_microscope",
    rationale:issue.action,
    evidence:{worker:w,issue,incident_id:incident?.id||null},
    command_descriptor:{adapter:"local_miner_actuator",operation:"diagnostic",execution:"APPROVED_ONLY",dedupe_key:dedupe,restart_requires_explicit_operator_change:true}
  }).select("id,action_type,action_state,requires_approval").single();
  return ins.data||null;
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
  const [stateQ,localQ]=await Promise.all([
    admin.from("midad_miner_worker_states").select("*").eq("account_id",snap.account.id).limit(200),
    admin.from("midad_miner_local_telemetry").select("worker_id,node_id,observed_at,local_hashrate_ths,temp_max_c,temp_avg_c,fan_min_pct,fan_avg_pct,power_watts,efficiency_ths_per_kw,uptime_seconds,asic_error_count,chain_count,chain_expected,stratum_ok,pool_latency_ms,firmware,model,fault_codes,signals").eq("account_id",snap.account.id).order("observed_at",{ascending:false}).limit(500)
  ]);
  const stateMap=new Map((stateQ.data||[]).map((x:any)=>[String(x.worker_id),x]));
  const localMap=new Map<string,any>();
  for(const x of localQ.data||[])if(!localMap.has(String(x.worker_id)))localMap.set(String(x.worker_id),x);
  const localPeers=[...localMap.values()].map((x:any)=>({
    ...x,
    pool_10m_ths:workers.find((w:any)=>String(w.worker_id)===String(x.worker_id))?.hashrate_10m_ths??null
  }));
  const current=new Set<string>(), opened:any[]=[],alerts:any[]=[],recovery:any[]=[],updatedStates:any[]=[];
  for(const w of workers){
    const prev=stateMap.get(String(w.worker_id));
    const local=localMap.get(String(w.worker_id));
    const issues=diagnose(w,prev,local,localPeers);
    for(const issue of issues){
      const u=await upsertIncident(admin,snap.account.id,w,issue,runId);
      const localNow=localMap.get(String(w.worker_id))||null;
      const ai=await aiRootCause(admin,w,issue,localNow);
      if(ai){
        await admin.from("midad_miner_incidents").update({
          diagnosis:{
            causes:issue.causes,reason:issue.reason,agent:"root_cause_agent",
            confidence:issue.causes?.length===1?.9:.72,
            ai_reasoning_agent:"midad_orchestrator",
            ai_hypotheses:ai.hypotheses||[],
            ai_next_probe:ai.next_probe||null,
            ai_do_not_claim:ai.do_not_claim||null
          },
          updated_at:new Date().toISOString()
        }).eq("fingerprint",u.fingerprint);
      }
      current.add(u.fingerprint);
      const incidentRow=await admin.from("midad_miner_incidents").select("id").eq("fingerprint",u.fingerprint).maybeSingle();
      const repairPlan=await proposeRepair(admin,snap.account.id,issue,w,incidentRow.data);

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
    const vals={account_id:snap.account.id,worker_id:Number(w.worker_id),worker_name:w.worker_name,last_status:w.worker_status,last_hashrate_10m_ths:w.hashrate_10m_ths,last_hashrate_1h_ths:w.hashrate_1h_ths,last_hashrate_24h_ths:w.hashrate_24h_ths,last_reject_rate:w.reject_rate,last_active:w.last_active,last_seen_at:new Date().toISOString(),consecutive_drop_count:isDrop?priorDrop+1:0,consecutive_inactive_count:isInactive?priorInactive+1:0,consecutive_alert_count:alertCount?Number(prev?.consecutive_alert_count||0)+1:0,metadata:{issue_types:issues.map(x=>x.type),run_id:runId,local_telemetry:local||null},updated_at:new Date().toISOString()};
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

function selfTest(){
  const scenarios=[
    {name:"thermal_fault",w:{worker_id:1,worker_status:"active",hashrate_10m_ths:80,hashrate_1h_ths:80,hashrate_24h_ths:82,reject_rate:0,last_active:Math.floor(Date.now()/1000)},local:{local_hashrate_ths:72,temp_max_c:92,fan_avg_pct:58,power_watts:3200,asic_error_count:0,chain_count:3,chain_expected:3,stratum_ok:true,signals:{topology:{rack:"A"}}}},
    {name:"asic_fault",w:{worker_id:2,worker_status:"active",hashrate_10m_ths:45,hashrate_1h_ths:60,hashrate_24h_ths:62,reject_rate:.2,last_active:Math.floor(Date.now()/1000)},local:{local_hashrate_ths:44,temp_max_c:78,fan_avg_pct:85,power_watts:3400,asic_error_count:12,chain_count:2,chain_expected:3,stratum_ok:true,signals:{topology:{rack:"B"}}}},
    {name:"network_fault",w:{worker_id:3,worker_status:"active",hashrate_10m_ths:20,hashrate_1h_ths:60,hashrate_24h_ths:65,reject_rate:.1,last_active:Math.floor(Date.now()/1000)},local:{local_hashrate_ths:60,temp_max_c:72,fan_avg_pct:90,power_watts:3300,asic_error_count:0,chain_count:3,chain_expected:3,stratum_ok:false,signals:{topology:{rack:"C"}}}},
    {name:"stable",w:{worker_id:4,worker_status:"active",hashrate_10m_ths:80,hashrate_1h_ths:79,hashrate_24h_ths:78,reject_rate:.01,last_active:Math.floor(Date.now()/1000)},local:{local_hashrate_ths:80,temp_max_c:70,fan_avg_pct:88,power_watts:3300,asic_error_count:0,chain_count:3,chain_expected:3,stratum_ok:true,signals:{topology:{rack:"D"}}}}
  ];
  return scenarios.map(s=>{
    const issues=diagnose(s.w,null,s.local,[s.local]);
    return {scenario:s.name,issue_types:issues.map(x=>x.type),severity:issues.reduce((m,x)=>severityRank(x.severity)>severityRank(m)?x.severity:m,"info")};
  });
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
    if(mode==="self_test")return ok({ok:true,mode:"self_test",mutations:[],results:selfTest()});
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