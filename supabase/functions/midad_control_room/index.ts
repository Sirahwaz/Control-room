import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS={
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type,x-midad-request-id,x-midad-client",
  "access-control-max-age":"86400"
};
const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store",...CORS_HEADERS};
const PIPELINE_SMOKE_CONFIRMATION = "RUN_GEMINI_TO_CLAUDE_SMOKE";
function pipelineSmokeConfirmationBlock(body:any):Response|null {
  if (body?.confirm_pipeline_smoke === PIPELINE_SMOKE_CONFIRMATION) return null;
  return new Response(JSON.stringify({
    ok:false,
    state:"BLOCKED",
    error:"explicit_confirmation_required",
    provider_calls_started:false
  }),{status:428,headers:JSON_HEADERS});
}

const HTML_HEADERS={"content-type":"text/html; charset=utf-8","cache-control":"no-store",...CORS_HEADERS};

let MIDAD_FAST_DASHBOARD_CACHE:{at:number,data:any}|null=null;
let MIDAD_FAST_DASHBOARD_INFLIGHT:Promise<any>|null=null;

async function sha256(s:string){
  const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function labelSignal(t:string){
  const m:any={
    market_move:"حركة سوق",
    dex_boost:"تعزيز DEX",
    pool_trend:"اتجاه مجمّع",
    attention:"اهتمام/ترند",
    market_momentum:"زخم سوق",
    market_breakout_watch:"مراقبة اختراق",
    news:"خبر",
    wallet:"محفظة",
    wallet_anomaly:"شذوذ محفظة",
    anomaly:"شذوذ",
    opportunity:"فرصة مرشحة",
    mining_opportunity:"فرصة تعدين",
    verification:"تحقق",
  };
  return m[t]||t;
}
function safeNum(v:any){const n=Number(v);return Number.isFinite(n)?n:null;}
function cleanText(v:any,max=240){return String(v??"").trim().slice(0,max);}
async function safeQuery<T=any>(promise:Promise<any>,label:string){
  try{
    const r=await promise;
    if(r?.error){
      console.warn("[MIDAD dashboard]",label,r.error.message);
      return {data:[],count:0,error:r.error.message};
    }
    return r;
  }catch(e){
    console.warn("[MIDAD dashboard]",label,String(e));
    return {data:[],count:0,error:String(e)};
  }
}
function normalizeConfidence(v:any){const n=safeNum(v);return n===null?0:n>1?n/100:n;}

async function hmacSha256Hex(keyText:string,message:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(keyText),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function timingSafeHexEqual(a:string,b:string){
  if(a.length!==b.length)return false;
  let d=0; for(let i=0;i<a.length;i++) d|=a.charCodeAt(i)^b.charCodeAt(i);
  return d===0;
}

async function safeSecretEqual(a:string,b:string){
  if(!a||!b)return false;
  const [ha,hb]=await Promise.all([sha256(a),sha256(b)]);
  return timingSafeHexEqual(ha,hb);
}

const NEURAL_LIFECYCLE_RULES:any={
  money_candidate:{human_action:"qualify_apply",can_start_delivery:false},
  human_review:{human_action:"review_approve",can_start_delivery:false},
  submitted_waiting:{human_action:"monitor_respond",can_start_delivery:false},
  accepted:{human_action:"prepare_delivery",can_start_delivery:true},
  delivery:{human_action:"execute_deliver",can_start_delivery:true},
  invoiced:{human_action:"collect_verify",can_start_delivery:false},
  paid:{human_action:"reconcile_archive",can_start_delivery:false},
  technical_blocked:{human_action:"resolve_blocker",can_start_delivery:false},
  cancelled:{human_action:"none",can_start_delivery:false},
  closed:{human_action:"none",can_start_delivery:false}
};

async function getTelegramBotToken(admin:any,client:string=""){
  const normalized=cleanText(client,80);
  if(normalized==="viabtc-monitor"){
    return (Deno.env.get("VIABTC_MONITOR_BOT_TOKEN")||"").trim();
  }
  if(normalized==="ahwazai-bot"){
    return (Deno.env.get("AHWAZAI_BOT_TOKEN")||"").trim();
  }
  if(normalized==="midadroom-bot"){
    return (Deno.env.get("MIDADROOM_BOT_TOKEN")||"").trim();
  }
  if(normalized==="midadkeys-bot"){
    try{
      const r=await admin.rpc("midad_get_midadkeys_token");
      return String(r.data||"").trim();
    }catch{return "";}
  }
  // Verify Mini App initData with the token of the bot that opened this WebApp.
  if(normalized==="midad-cockpit" || normalized==="midad-control-room" || normalized==="control-room"){
    return (Deno.env.get("AIMIDAD_BOT_TOKEN")||"").trim();
  }
  const env=(Deno.env.get("TELEGRAM_BOT_TOKEN")||"").trim();
  const {data}=await admin.from("bot_configs").select("telegram_bot_token").eq("active",true).eq("platform","telegram").limit(1).maybeSingle();
  return String(data?.telegram_bot_token||env||"").trim();
}
async function getTelegramBotTokenCandidates(admin:any,client:string=""){
  const normalized=cleanText(client,80);
  if(normalized==="midad-cockpit" || normalized==="midad-control-room" || normalized==="control-room"){
    // Shared cockpit authentication supports the explicitly approved MIDAD bots, including SirdeepBot.
    // These tokens only verify Telegram initData; control_room_access still gates session creation.
    const candidates:Array<{label:string,token:string}>=[
      {label:"aimidad_bot",token:(Deno.env.get("AIMIDAD_BOT_TOKEN")||"").trim()},
      {label:"sirdeepbot",token:(Deno.env.get("TELEGRAM_BOT_TOKEN")||"").trim()},
      {label:"ahwazai_bot",token:(Deno.env.get("AHWAZAI_BOT_TOKEN")||"").trim()},
      {label:"viabtc_monitor",token:(Deno.env.get("VIABTC_MONITOR_BOT_TOKEN")||"").trim()},
      {label:"midadroom_bot",token:(Deno.env.get("MIDADROOM_BOT_TOKEN")||"").trim()}
    ];
    // Keep the same active database-configured bot fallback used by midad_telegram_auth.
    const dbBots=await admin.from("bot_configs")
      .select("business_name,telegram_bot_token")
      .eq("active",true)
      .eq("platform","telegram")
      .limit(20);
    if(!dbBots.error){
      for(const row of (dbBots.data||[])){
        const label=cleanText(row.business_name||"configured_telegram_bot",80)
          .toLowerCase().replace(/[^a-z0-9_-]+/g,"_");
        const token=String(row.telegram_bot_token||"").trim();
        if(token)candidates.push({label,token});
      }
    }
    try{
      const r=await admin.rpc("midad_get_midadkeys_token");
      const keyToken=String(r.data||"").trim();
      if(keyToken)candidates.push({label:"midadkeys_bot",token:keyToken});
    }catch{}
    const seen=new Set<string>();
    return candidates.filter(c=>{
      if(!c.token || seen.has(c.token))return false;
      seen.add(c.token);return true;
    });
  }
  if(normalized==="midadroom-bot"){
    const token=(Deno.env.get("MIDADROOM_BOT_TOKEN")||"").trim();
    return token?[{label:"midadroom_bot",token}]:[];
  }
  const token=await getTelegramBotToken(admin,normalized);
  return token?[{label:normalized||"default",token}]:[];
}

async function verifyTelegramInitData(initData:string,botToken:string){
  const p=new URLSearchParams(initData);
  const receivedHash=p.get("hash")||"";
  const authDate=Number(p.get("auth_date")||0);
  const userRaw=p.get("user")||"";
  if(!receivedHash||!authDate||!userRaw) return {ok:false,error:"telegram_init_data_incomplete"};
  const age=Math.floor(Date.now()/1000)-authDate;
  if(age<0||age>86400) return {ok:false,error:"telegram_init_data_expired"};
  p.delete("hash");
  const buildCheckString=(excludeSignature:boolean)=>{
    const pairs:Array<string>=[];
    for(const [k,v] of p.entries()){
      if(excludeSignature && k==="signature")continue;
      pairs.push(k+"="+v);
    }
    pairs.sort();
    return pairs.join("\n");
  };
  // Telegram's HMAC scheme excludes hash. On clients that also provide a
  // third-party Ed25519 signature, accept the compatible string variant too.
  const dataCheckStrings=[buildCheckString(false)];
  if(p.has("signature"))dataCheckStrings.push(buildCheckString(true));
  const secretKeyHex=await hmacSha256Hex("WebAppData",botToken);
  const keyBytes=new Uint8Array(secretKeyHex.match(/.{2}/g)!.map(x=>parseInt(x,16)));
  const cryptoKey=await crypto.subtle.importKey("raw",keyBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  let matched=false;
  for(const dataCheckString of dataCheckStrings){
    const sig=await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode(dataCheckString));
    const expectedHash=Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,"0")).join("");
    if(timingSafeHexEqual(expectedHash,receivedHash.toLowerCase())){matched=true;break;}
  }
  if(!matched)return {ok:false,error:"telegram_init_data_invalid"};
  let user:any={}; try{user=JSON.parse(userRaw)}catch{return {ok:false,error:"telegram_user_invalid"}}
  return {ok:true,user,authDate};
}
async function financeIntelligenceReadModel(admin:any){
  const [cycles, ledger, autonomy, outbox, researchRuns] = await Promise.all([
    safeQuery(admin.from("midad_finance_cycles")
      .select("id,started_at,completed_at,status,mode,signal_direction,signal_confidence,decision,anomaly_score,result,error")
      .order("started_at",{ascending:false}).limit(8),"finance_cycles"),
    safeQuery(admin.from("midad_decision_ledger")
      .select("id,subject_key,domain,mode,decision,reason_code,signal_direction,confidence,expected_edge_pct,estimated_net_edge_pct,source_cycle_id,outcome_status,decision_quality,created_at,updated_at")
      .eq("domain","finance").order("created_at",{ascending:false}).limit(10),"finance_ledger"),
    safeQuery(admin.from("midad_trading_autonomy")
      .select("id,owner_scope,label,enabled,mode,spot_only,leverage_allowed,min_expected_net_edge_pct,min_signal_confidence,require_multi_source_confirmation,kill_switch,last_cycle_at,updated_at")
      .order("updated_at",{ascending:false}).limit(1),"finance_autonomy"),
    safeQuery(admin.from("midad_bot_outbox")
      .select("id,bot_key,channel,event_type,priority,subject_key,delivery_status,attempts,next_attempt_at,last_attempt_at,delivered_at,last_error,payload,created_at")
      .eq("channel","internal").order("created_at",{ascending:false}).limit(24),"finance_enrichment_outbox"),
    safeQuery(admin.from("midad_research_runs")
      .select("id,status,query,citations,metadata,created_at")
      .order("created_at",{ascending:false}).limit(16),"neural_research_runs")
  ]);

  const cycleRows=cycles.data??[];
  const ledgerRows=ledger.data??[];
  const autonomyRow=(autonomy.data??[])[0]??null;
  const outboxRows=outbox.data??[];
  const researchRows=researchRuns.data??[];
  const researchById=new Map(researchRows.map((r:any)=>[String(r.id),r]));

  const latestCycle=cycleRows[0]??null;
  const latestLedger=ledgerRows[0]??null;

  const laneStats=(botKey:string)=>{
    const rows=outboxRows.filter((r:any)=>String(r.bot_key)===botKey);
    const counts={queued:0,processing:0,sent:0,failed:0};
    for(const r of rows){
      const s=String(r.delivery_status||"");
      if(Object.prototype.hasOwnProperty.call(counts,s))(counts as any)[s]++;
    }
    const latest=rows[0]??null;
    const dispatchResult=latest?.payload?.dispatch_result??null;
    const researchId=dispatchResult?.research_run_id
      ? String(dispatchResult.research_run_id)
      : null;
    const research=researchId?researchById.get(researchId):null;
    const usableSources=research?.metadata?.usable_sources??null;
    const citations=Array.isArray(research?.citations)?research.citations.length:null;
    const dispatchState=counts.failed>0
      ?"FAILED"
      :(counts.processing>0||counts.queued>0)
        ?"PENDING"
        :(counts.sent>0)
          ?"VERIFIED"
          :"IDLE";
    const quality=research
      ? (usableSources===0
          ?"NO_USABLE_SOURCES"
          : (typeof usableSources==="number" && usableSources>0)
            ?"SOURCED"
            :"UNKNOWN")
      : (botKey==="midad_osint_router"
          ? (dispatchResult ? "DISPATCHED_NO_NEW_EVENTS" : "UNKNOWN")
          : "NOT_AVAILABLE");
    return {
      state:dispatchState,
      queue_counts:counts,
      recent_count:rows.length,
      latest:{
        id:latest?.id??null,
        event_type:latest?.event_type??null,
        delivery_status:latest?.delivery_status??null,
        attempts:latest?.attempts??0,
        created_at:latest?.created_at??null,
        delivered_at:latest?.delivered_at??null,
        last_error:latest?.last_error??null,
        dispatch_result:dispatchResult
      },
      quality:{
        status:quality,
        research_run_id:researchId,
        research_status:research?.status??null,
        usable_sources:usableSources,
        citations
      }
    };
  };

  const osint=laneStats("midad_osint_router");
  const neural=laneStats("midad_neural_core");
  const liveAllowed=Boolean(
    autonomyRow?.enabled===true &&
    autonomyRow?.kill_switch===false &&
    String(autonomyRow?.mode||"").toLowerCase()==="live"
  );
  const coreState=latestCycle?.status==="completed"
    ?"VERIFIED"
    :(latestCycle?.status
      ? String(latestCycle.status).toUpperCase()
      :"NO_CYCLE");

  return {
    contract_version:"finance-intelligence-read-model-v1",
    finance_core:{
      state:coreState,
      critical_path:["trading_signal","governor","gate","ledger","cycle_commit"],
      latest_cycle:latestCycle?{
        id:latestCycle.id,
        started_at:latestCycle.started_at,
        completed_at:latestCycle.completed_at,
        status:latestCycle.status,
        mode:latestCycle.mode,
        signal_direction:latestCycle.signal_direction,
        signal_confidence:latestCycle.signal_confidence,
        decision:latestCycle.decision,
        anomaly_score:latestCycle.anomaly_score,
        error:latestCycle.error
      }:null,
      recent_cycle_count:cycleRows.length,
      latest_ledger:latestLedger?{
        id:latestLedger.id,
        source_cycle_id:latestLedger.source_cycle_id,
        subject_key:latestLedger.subject_key,
        mode:latestLedger.mode,
        decision:latestLedger.decision,
        reason_code:latestLedger.reason_code,
        signal_direction:latestLedger.signal_direction,
        confidence:latestLedger.confidence,
        outcome_status:latestLedger.outcome_status,
        decision_quality:latestLedger.decision_quality,
        created_at:latestLedger.created_at,
        updated_at:latestLedger.updated_at
      }:null
    },
    governor:{
      enabled:Boolean(autonomyRow?.enabled),
      mode:autonomyRow?.mode??"unknown",
      kill_switch:Boolean(autonomyRow?.kill_switch),
      live_execution_allowed:liveAllowed,
      spot_only:autonomyRow?.spot_only??null,
      leverage_allowed:autonomyRow?.leverage_allowed??null,
      min_signal_confidence:autonomyRow?.min_signal_confidence??null,
      min_expected_net_edge_pct:autonomyRow?.min_expected_net_edge_pct??null,
      require_multi_source_confirmation:autonomyRow?.require_multi_source_confirmation??null,
      last_cycle_at:autonomyRow?.last_cycle_at??null,
      updated_at:autonomyRow?.updated_at??null
    },
    intelligence:{
      osint:{
        channel:"internal",
        target:"midad_osint_router",
        ...osint
      },
      neural:{
        channel:"internal",
        target:"midad_neural_core",
        ...neural
      },
      latest_research:researchRows[0]?{
        id:researchRows[0].id,
        status:researchRows[0].status,
        usable_sources:researchRows[0].metadata?.usable_sources??null,
        query_mode:researchRows[0].metadata?.query_mode??null,
        citations:Array.isArray(researchRows[0].citations)?researchRows[0].citations.length:null,
        created_at:researchRows[0].created_at
      }:null
    },
    action:{
      financial_execution:"HUMAN_GATED",
      live_financial_execution_allowed:liveAllowed,
      note:"Finance enrichment never authorizes or executes a trade; decision authority remains in Finance Core + governor gates."
    }
  };
}

async function dashboard(admin:any){
  const [
    signals, opportunities, runs, sentinelAlerts, entities, relations,
    wallets, exchanges, trades, capitals, integrations,
    approvals, humanTasks, clients, conversations, payments, osintSources, osintEvents, autonomyRuns,
    recentSignals, recentOpps, activeAlerts, recentFeedback
  ] = await Promise.all([
    admin.from("signal_events").select("id",{count:"exact",head:true}),
    admin.from("opportunities").select("id",{count:"exact",head:true}).neq("status","test"),
    admin.from("engine_runs").select("id",{count:"exact",head:true}),
    admin.from("midad_sentinel_alerts").select("id",{count:"exact",head:true}).eq("status","active"),
    admin.from("midad_sentinel_entities").select("id",{count:"exact",head:true}),
    admin.from("midad_sentinel_relations").select("id",{count:"exact",head:true}),
    admin.from("midad_wallets").select("id,label,chain,address,purpose,watch_only,active,metadata,created_at").eq("active",true).order("created_at",{ascending:false}).limit(20),
    admin.from("midad_exchange_accounts").select("id,exchange,label,account_ref,mode,status,supports_crypto,deposit_enabled,withdrawal_enabled,updated_at").order("updated_at",{ascending:false}).limit(20),
    admin.from("midad_trade_intents").select("id,asset_symbol,venue,side,strategy,amount,max_loss_pct,max_fee_pct,status,requires_approval,created_at").order("created_at",{ascending:false}).limit(20),
    admin.from("midad_capital_sources").select("id,source_type,label,asset,amount,currency,estimated_daily_value,operating_cost,status,updated_at").order("updated_at",{ascending:false}).limit(20),
    admin.from("integrations").select("provider,status,scopes,updated_at").order("updated_at",{ascending:false}).limit(20),
    admin.from("midad_approvals").select("id,subject_type,subject_id,action,risk_class,reason,evidence,status,created_at,expires_at").eq("status","pending").order("created_at",{ascending:false}).limit(20),
    admin.from("midad_human_tasks").select("id,type,priority,risk_class,blocking,title,instruction,reason,status,requested_by_agent,action_url,evidence,requested_at,expires_at,acknowledged_at,completed_at").in("status",["OPEN","ACKNOWLEDGED"]).order("priority",{ascending:false}).order("created_at",{ascending:false}).limit(20),
    admin.from("midad_client_profiles").select("id,external_ref,display_name,contact,preferred_language,detected_language,trust_level,updated_at").order("updated_at",{ascending:false}).limit(20),
    admin.from("midad_conversations").select("id,client_id,channel,status,human_approval_required,risk_class,language,topic,last_message_at").order("last_message_at",{ascending:false}).limit(20),
    admin.from("midad_payment_intents").select("id,client_id,conversation_id,project_ref,amount_fiat,fiat_currency,settlement_asset,network,quoted_crypto_amount,status,reconciliation_status,expires_at,created_at").order("created_at",{ascending:false}).limit(20),
    admin.from("midad_osint_sources").select("id,source_key,source_type,trust_tier,enabled,last_checked_at").order("updated_at",{ascending:false}).limit(20),
    admin.from("midad_osint_events").select("id,source_id,watchlist_id,event_type,subject_key,severity,confidence,observed_at,evidence,fingerprint").order("observed_at",{ascending:false}).limit(20),
    admin.from("midad_autonomy_runs").select("id,bucket_start,status,started_at,completed_at,result,error").order("started_at",{ascending:false}).limit(5),
    admin.from("signal_events").select("id,source,signal_type,entity,score,confidence,occurred_at,created_at,payload").order("created_at",{ascending:false}).limit(12),
    admin.from("opportunities").select("id,source,title,score,status,opportunity_type,description,confidence,expected_value,evidence,offer,created_at").neq("status","test").order("score",{ascending:false}).limit(12),
    admin.from("midad_sentinel_alerts").select("id,asset_key,alert_type,risk_score,confidence,status,first_seen_at,last_seen_at,evidence").in("status",["active","review"]).order("risk_score",{ascending:false}).limit(12),
    admin.from("midad_signal_outcomes").select("outcome_label,return_pct,measured_at").order("measured_at",{ascending:false}).limit(8)
  ].map((p:any,i:number)=>safeQuery(p,"dashboard_query_"+i)));

  const walletRoutesRes=await safeQuery(
    admin.from("midad_revenue_routes").select("id,label,asset,network,route_kind,wallet_id,active,auto_route,requires_approval,policy,metadata,created_at,updated_at")
      .eq("active",true).eq("route_kind","receive").in("asset",["USDC","USDT"]).in("network",["base","solana","ethereum","avalanche"])
      .order("created_at",{ascending:false}).limit(30),
    "wallet_receive_routes"
  );
  const walletRoutesBase=walletRoutesRes.data??[];
  const monitorRowsRes=walletRoutesBase.length?await safeQuery(
    admin.from("midad_wallet_monitor_state").select("route_id,last_scan_at,last_slot,latest_balance,latest_balance_updated_at,status,error_count,last_error,metadata,updated_at")
      .in("route_id",walletRoutesBase.map((r:any)=>r.id)),
    "wallet_receive_route_monitor_states"
  ):{data:[]};
  const monitorByRoute=new Map((monitorRowsRes.data??[]).map((m:any)=>[m.route_id,m]));
  const walletRoutes=walletRoutesBase.map((r:any)=>({...r,monitor:monitorByRoute.get(r.id)||null}));

  const {data:capRows}=await admin.from("midad_work_assessments").select("execution_decision,delivery_confidence,assessed_at").order("assessed_at",{ascending:false}).limit(500);
  const blueprintRes=await safeQuery(
    admin.from("midad_income_blueprints")
      .select("id,opportunity_id,state,title,money_thesis,buyer_or_market,action_url,estimated_net_usd,estimated_hours,efficiency_usd_per_hour,deliverables,acceptance_tests,blockers,proof_points,work_sequence,payment_plan,proposal_draft,client_questions,qa_checklist,metadata,created_at,updated_at")
      .eq("state","READY").order("estimated_net_usd",{ascending:false}).limit(20),
    "income_blueprints"
  );
  const incomeBlueprints=blueprintRes.data??[];
  const blueprintValue=incomeBlueprints.reduce((s:number,b:any)=>s+Number(b.estimated_net_usd||0),0);

  const moneyOppsRes=await safeQuery(
    admin.from("opportunities")
      .select("id,source,title,score,status,opportunity_type,description,confidence,expected_value,evidence,offer,created_at")
      .eq("opportunity_type","paid_work")
      .in("status",["money_candidate","human_review","submitted_waiting","technical_blocked"])
      .order("score",{ascending:false}).order("created_at",{ascending:false}).limit(50),
    "money_opportunities"
  );
  const moneyOpps=moneyOppsRes.data??[];
  const moneyRunRes=await safeQuery(
    admin.from("engine_runs")
      .select("job_type,status,created_at,completed_at,latency_ms,error,providers_used,result")
      .eq("job_type","money_hunter").order("created_at",{ascending:false}).limit(1),
    "latest_money_hunter_run"
  );
  const latestMoneyRun=moneyRunRes.data?.[0]||null;
  const moneyExpected=moneyOpps.reduce((s:number,o:any)=>s+Number(o.expected_value||0),0);
  const moneyActionable=moneyOpps.filter((o:any)=>["money_candidate","human_review"].includes(String(o.status||""))).length;
  const moneySubmitted=moneyOpps.filter((o:any)=>String(o.status||"")==="submitted_waiting").length;

  const capGateRows=capRows??[];
  const capAvg=capGateRows.length
    ? capGateRows.reduce((s:number,r:any)=>s+Number(r.delivery_confidence||0),0)/capGateRows.length
    : 0;
  const financeIntelligence=await financeIntelligenceReadModel(admin);
  const capability_gate={
    assessed_count:capGateRows.length,
    eligible:capGateRows.filter((r:any)=>r.execution_decision==="ELIGIBLE").length,
    human_review:capGateRows.filter((r:any)=>r.execution_decision==="HUMAN_REVIEW").length,
    hold:capGateRows.filter((r:any)=>r.execution_decision==="HOLD").length,
    reject:capGateRows.filter((r:any)=>r.execution_decision==="REJECT").length,
    avg_delivery_confidence:Number(capAvg.toFixed(4)),
    last_assessed_at:capGateRows[0]?.assessed_at||null,
    model_version:"miae-capability-gate-v1",
    note:"بوابة الجاهزية تقيس قابلية التنفيذ بناءً على القدرات والأدوات والاختبار. لا تعني ضمان الفوز أو التسليم؛ الموافقة البشرية تبقى مطلوبة."
  };
  const rs=(recentSignals.data??[]).map((x:any)=>({
    id:x.id,source:x.source,type:x.signal_type,type_label:labelSignal(x.signal_type),
    entity:x.entity,score:safeNum(x.score)??0,confidence:normalizeConfidence(x.confidence),
    occurred_at:x.occurred_at,created_at:x.created_at,payload:x.payload??{}
  }));
  const derived=rs.filter((x:any)=>x.score>=85 && x.confidence>=0.75).slice(0,8).map((x:any)=>({
    id:"derived:"+x.id,kind:"derived_signal",severity:x.score>=92?"critical":x.score>=88?"high":"watch",
    title:x.type_label,entity:x.entity,score:x.score,confidence:x.confidence,
    source:x.source,occurred_at:x.occurred_at,
    note:"تنبيه مشتق من إشارة قوية؛ ليس Alert مؤكّدًا حتى تمرّ بطبقة التحقق."
  }));
  const actual=(activeAlerts.data??[]).map((x:any)=>({
    id:x.id,kind:"sentinel",severity:x.risk_score>=90?"critical":x.risk_score>=75?"high":"review",
    title:x.alert_type,entity:x.asset_key,score:safeNum(x.risk_score)??0,
    confidence:normalizeConfidence(x.confidence),source:"sentinel",occurred_at:x.last_seen_at,
    note:"تنبيه من طبقة Sentinel."
  }));
  return {
    capability_gate,
    finance_intelligence:financeIntelligence,
    runtime:{
      money_hunter:latestMoneyRun?{
        status:latestMoneyRun.status||"unknown",
        created_at:latestMoneyRun.created_at||null,
        completed_at:latestMoneyRun.completed_at||null,
        latency_ms:latestMoneyRun.latency_ms??null,
        error:latestMoneyRun.error||null,
        providers_used:latestMoneyRun.providers_used||[],
        discovered:Number(latestMoneyRun.result?.discovered||0),
        updated:Number(latestMoneyRun.result?.updated||0),
        created:Number(latestMoneyRun.result?.created||0),
        source:"supabase_edge_pg_cron"
      }:null
    },
    health:{
      signals:signals.count??0,opportunities:opportunities.count??0,engine_runs:runs.count??0,
      sentinel_alerts:sentinelAlerts.count??0,entities:entities.count??0,relations:relations.count??0,
      wallets:(wallets.data??[]).length,exchanges:(exchanges.data??[]).length,
      trade_intents:(trades.data??[]).length,capital_sources:(capitals.data??[]).length,
      pending_approvals:(approvals.data??[]).length,pending_human_tasks:(humanTasks.data??[]).length,clients:(clients.data??[]).length,
      open_conversations:(conversations.data??[]).filter((x:any)=>x.status==="open").length,
      payment_intents:(payments.data??[]).length,osint_sources:(osintSources.data??[]).length,
      osint_events:(osintEvents.data??[]).length,
      autonomy_last_status:autonomyRuns.data?.[0]?.status||"never",
      autonomy_last_run:autonomyRuns.data?.[0]||null,
      money_opportunities:moneyOpps.length,
      money_actionable:moneyActionable,
      money_submitted:moneySubmitted,
      money_expected_value:Number(moneyExpected.toFixed(2)),
      income_blueprints:incomeBlueprints.length,
      blueprint_expected_value:Number(blueprintValue.toFixed(2)),
      pipeline_ok:moneyOpps.length>0,
      pipeline_note:moneyOpps.length===0
        ?"لا توجد حاليًا فرصة paid_work جاهزة أو قيد التنفيذ في مسار المال."
        :moneyActionable===0 && moneySubmitted>0
          ?"يوجد عمل مُرسل بانتظار النتيجة؛ لا توجد فرصة جديدة جاهزة الآن."
          :"مسار المال يحتوي على فرص paid_work قابلة للمراجعة أو التنفيذ."
    },
    signals:rs,
    opportunities:recentOpps.data??[],
    money_opportunities:moneyOpps,
    income_blueprints:incomeBlueprints,
    alerts:[...actual,...derived],
    wallets:wallets.data??[],
    wallet_routes:walletRoutes,
    exchanges:exchanges.data??[],
    capital:capitals.data??[],
    trades:trades.data??[],
    integrations:integrations.data??[],
    approvals:approvals.data??[],
    human_tasks:humanTasks.data??[],
    clients:clients.data??[],
    conversations:conversations.data??[],
    payments:payments.data??[],
    osint:{sources:osintSources.data??[],events:osintEvents.data??[]},
    autonomy:autonomyRuns.data??[],
    feedback:recentFeedback.data??[]
  };
}



async function readStorageGovernorSnapshot(){
  try{
    const {data:key}=await adminKeyForAutonomy();
    if(!key)return {ok:false,state:"BLOCKED",reason:"AUTONOMY_KEY_UNAVAILABLE",latest:null};
    const response=await fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_autonomy_loop",{
      method:"POST",
      headers:{"content-type":"application/json","x-midad-autonomy-key":String(key)},
      body:JSON.stringify({action:"storage_status",source:"midad_control_room"}),
      signal:AbortSignal.timeout(6500)
    });
    const payload:any=await response.json().catch(()=>({}));
    if(!response.ok||payload?.ok!==true){
      return {ok:false,state:"BLOCKED",reason:cleanText(payload?.error||("STORAGE_STATUS_HTTP_"+response.status),100),latest:null};
    }
    const m=payload.latest||null;
    if(!m)return {ok:false,state:"PENDING",reason:"NO_STORAGE_METRIC_YET",latest:null};
    const topTables=Array.isArray(m.top_tables)?m.top_tables.slice(0,5).map((x:any)=>({
      table:cleanText(x?.table||x?.relname||"unknown",100),
      bytes:safeNum(x?.bytes),
      live_rows:safeNum(x?.live_rows),
      dead_rows:safeNum(x?.dead_rows)
    })):[];
    return {
      ok:true,
      state:cleanText(m.storage_state||payload.state||"UNKNOWN",24),
      latest:{
        captured_at:m.captured_at||null,
        database_bytes:safeNum(m.database_bytes),
        database_mib:safeNum(m.database_mib),
        project_quota_bytes:m.project_quota_bytes==null?null:safeNum(m.project_quota_bytes),
        quota_usage_pct:m.quota_usage_pct==null?null:safeNum(m.quota_usage_pct),
        read_only:Boolean(m.read_only),
        dead_tuples:safeNum(m.dead_tuples),
        storage_state:cleanText(m.storage_state||payload.state||"UNKNOWN",24),
        action_recommended:cleanText(m.action_recommended||"MONITOR_ONLY",80),
        archive_status:cleanText(m.archive_status||"UNKNOWN",80),
        archive_used_bytes:m.archive_used_bytes==null?null:safeNum(m.archive_used_bytes),
        archive_limit_bytes:m.archive_limit_bytes==null?null:safeNum(m.archive_limit_bytes),
        top_tables:topTables
      },
      config:{
        archive_provider:cleanText(payload.config?.archive_provider||"upload.am",50),
        archive_enabled:Boolean(payload.config?.archive_enabled),
        auto_delete_enabled:Boolean(payload.config?.auto_delete_enabled),
        archive_quota_bytes:payload.config?.archive_quota_bytes==null?null:safeNum(payload.config.archive_quota_bytes),
        archive_used_bytes:payload.config?.archive_used_bytes==null?null:safeNum(payload.config.archive_used_bytes),
        archive_retention_days:payload.config?.archive_retention_days==null?null:safeNum(payload.config.archive_retention_days),
        archive_plan_code:cleanText(payload.config?.archive_plan_code||"unknown",40),
        archive_plan_expires_on:cleanText(payload.config?.archive_plan_expires_on||"",40)||null,
        archive_api_status:cleanText(payload.config?.archive_api_status||"UNKNOWN",80),
        archive_last_verified_at:payload.config?.archive_last_verified_at||null
      }
    };
  }catch(e){
    return {ok:false,state:"BLOCKED",reason:cleanText((e as any)?.message||e,120),latest:null};
  }
}

async function runArchiveCanary(){
  const {data:key}=await adminKeyForAutonomy();
  if(!key)return {ok:false,state:"BLOCKED",error:"autonomy_key_unavailable"};
  const response=await fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_autonomy_loop",{
    method:"POST",
    headers:{"content-type":"application/json","x-midad-autonomy-key":String(key)},
    body:JSON.stringify({action:"archive_canary",confirm_text:"RUN SYNTHETIC CANARY",source:"control_room_operator"}),
    signal:AbortSignal.timeout(90000)
  });
  const text=await response.text();
  let payload:any={};
  try{payload=text?JSON.parse(text):{};}catch{payload={};}
  if(!response.ok||payload?.ok!==true){
    return {
      ok:false,state:cleanText(payload?.state||"FAILED",24),
      error:cleanText(payload?.archive_canary_error||payload?.error||("ARCHIVE_CANARY_HTTP_"+response.status),240),
      http_status:response.status
    };
  }
  const c=payload.archive_canary||{};
  return {
    ok:true,state:cleanText(c.state||payload.state||"UNKNOWN",32),
    archive_canary:{
      provider:"upload.am",
      plan_code:cleanText(c.plan_code||"unknown",40),
      quota_bytes:safeNum(c.quota_bytes),
      quota_gib:safeNum(c.quota_gib),
      used_bytes:safeNum(c.used_bytes),
      max_file_bytes:safeNum(c.max_file_bytes),
      retention_days:safeNum(c.retention_days),
      file_uuid:cleanText(c.file_uuid||"",100)||null,
      file_bytes:safeNum(c.file_bytes),
      sha256:cleanText(c.sha256||"",64)||null,
      upload_confirmed:c.upload_confirmed===true,
      download_confirmed:c.download_confirmed===true,
      checksum_match:c.checksum_match===true,
      aes_gcm_decryption_verified:c.aes_gcm_decryption_verified===true,
      gzip_decompression_verified:c.gzip_decompression_verified===true,
      payload_match:c.payload_match===true,
      archive_enabled:false,
      auto_delete_enabled:false
    }
  };
}

async function dashboardFast(admin:any){
  const now=Date.now();
  if(MIDAD_FAST_DASHBOARD_CACHE&&now-MIDAD_FAST_DASHBOARD_CACHE.at<8000)
    return {...MIDAD_FAST_DASHBOARD_CACHE.data,cache:{hit:true,age_ms:now-MIDAD_FAST_DASHBOARD_CACHE.at}};
  if(MIDAD_FAST_DASHBOARD_INFLIGHT)
    return {...(await MIDAD_FAST_DASHBOARD_INFLIGHT),cache:{hit:true,inflight:true}};
  MIDAD_FAST_DASHBOARD_INFLIGHT=(async()=>{
    const q=await Promise.all([
      safeQuery(admin.from("signal_events").select("id",{count:"exact",head:true}),"fast_signal_count"),
      safeQuery(admin.from("opportunities").select("id",{count:"exact",head:true}).neq("status","test"),"fast_opportunity_count"),
      safeQuery(admin.from("engine_runs").select("id",{count:"exact",head:true}),"fast_engine_count"),
      safeQuery(admin.from("midad_sentinel_alerts").select("id",{count:"exact",head:true}).eq("status","active"),"fast_alert_count"),
      safeQuery(admin.from("midad_sentinel_entities").select("id",{count:"exact",head:true}),"fast_entity_count"),
      safeQuery(admin.from("midad_wallets").select("id,label,chain,address,purpose,watch_only,active,metadata,created_at").eq("active",true).order("created_at",{ascending:false}).limit(16),"fast_wallets"),
      safeQuery(admin.from("midad_approvals").select("id,subject_type,subject_id,action,risk_class,reason,evidence,status,created_at,expires_at").eq("status","pending").order("created_at",{ascending:false}).limit(12),"fast_approvals"),
      safeQuery(admin.from("midad_human_tasks").select("id,type,priority,risk_class,blocking,title,instruction,reason,status,requested_by_agent,action_url,evidence,requested_at,expires_at,acknowledged_at,completed_at").in("status",["OPEN","ACKNOWLEDGED"]).order("priority",{ascending:false}).order("created_at",{ascending:false}).limit(12),"fast_human_tasks"),
      safeQuery(admin.from("midad_osint_sources").select("id,source_key,source_type,trust_tier,enabled,last_checked_at").order("updated_at",{ascending:false}).limit(12),"fast_osint_sources"),
      safeQuery(admin.from("midad_osint_events").select("id,source_id,watchlist_id,event_type,subject_key,severity,confidence,observed_at,fingerprint").order("observed_at",{ascending:false}).limit(12),"fast_osint_events"),
      safeQuery(admin.from("signal_events").select("id,source,signal_type,entity,score,confidence,occurred_at,created_at").order("created_at",{ascending:false}).limit(10),"fast_recent_signals"),
      safeQuery(admin.from("opportunities").select("id,source,title,score,status,opportunity_type,description,confidence,expected_value,created_at").neq("status","test").order("score",{ascending:false}).limit(10),"fast_recent_opportunities"),
      safeQuery(admin.from("midad_sentinel_alerts").select("id,asset_key,alert_type,risk_score,confidence,status,first_seen_at,last_seen_at").in("status",["active","review"]).order("risk_score",{ascending:false}).limit(8),"fast_recent_alerts"),
      safeQuery(admin.from("midad_income_blueprints").select("id,opportunity_id,state,title,money_thesis,buyer_or_market,action_url,estimated_net_usd,estimated_hours,efficiency_usd_per_hour,blockers,created_at,updated_at").eq("state","READY").order("estimated_net_usd",{ascending:false}).limit(10),"fast_blueprints"),
      safeQuery(admin.from("opportunities").select("id,source,title,score,status,opportunity_type,description,confidence,expected_value,created_at").eq("opportunity_type","paid_work").in("status",["money_candidate","human_review","submitted_waiting","technical_blocked"]).order("score",{ascending:false}).order("created_at",{ascending:false}).limit(24),"fast_money_opportunities"),
      safeQuery(admin.from("midad_work_assessments").select("execution_decision,delivery_confidence,assessed_at").order("assessed_at",{ascending:false}).limit(40),"fast_capability_gate"),
      safeQuery(admin.from("midad_trading_autonomy").select("id,owner_scope,label,enabled,mode,spot_only,leverage_allowed,min_signal_confidence,min_expected_net_edge_pct,kill_switch,updated_at,last_cycle_at").order("updated_at",{ascending:false}).limit(2),"fast_governor")
    ]);
    const [signalCount,opportunityCount,engineCount,alertCount,entityCount,wallets,approvals,tasks,osintSources,osintEvents,signals,recentOpps,activeAlerts,blueprints,moneyOpps,capRows,governors]=q;
    const routeRes=await safeQuery(
      admin.from("midad_revenue_routes").select("id,label,asset,network,route_kind,wallet_id,active,auto_route,requires_approval,policy,metadata,created_at,updated_at")
       .eq("active",true).eq("route_kind","receive").in("asset",["USDC","USDT"]).in("network",["base","solana","ethereum","avalanche"])
       .order("created_at",{ascending:false}).limit(24),"fast_wallet_receive_routes");
    const routes=routeRes.data||[];
    const monitorRes=routes.length?await safeQuery(
      admin.from("midad_wallet_monitor_state").select("route_id,last_scan_at,last_slot,latest_balance,latest_balance_updated_at,status,error_count,last_error,metadata,updated_at")
        .in("route_id",routes.map((r:any)=>r.id)),"fast_wallet_monitor_states"):{data:[]};
    const monitorByRoute=new Map((monitorRes.data||[]).map((m:any)=>[m.route_id,m]));
    const walletRoutes=routes.map((r:any)=>({...r,monitor:monitorByRoute.get(r.id)||null}));
    const signalRows=(signals.data||[]).map((x:any)=>({id:x.id,source:x.source,type:x.signal_type,type_label:labelSignal(x.signal_type),signal_type:x.signal_type,entity:x.entity,score:safeNum(x.score)??0,confidence:normalizeConfidence(x.confidence),occurred_at:x.occurred_at,created_at:x.created_at}));
    const derived=signalRows.filter((x:any)=>x.score>=85&&x.confidence>=0.75).slice(0,8).map((x:any)=>({id:"derived:"+x.id,kind:"derived_signal",severity:x.score>=92?"critical":x.score>=88?"high":"watch",title:x.type_label,entity:x.entity,score:x.score,confidence:x.confidence,source:x.source,occurred_at:x.occurred_at,note:"تنبيه مشتق من إشارة قوية؛ ليس تنبيهاً مؤكداً حتى يمرّ بطبقة التحقق."}));
    const actual=(activeAlerts.data||[]).map((x:any)=>({id:x.id,kind:"sentinel",severity:x.risk_score>=90?"critical":x.risk_score>=75?"high":"review",title:x.alert_type,entity:x.asset_key,score:safeNum(x.risk_score)??0,confidence:normalizeConfidence(x.confidence),source:"sentinel",occurred_at:x.last_seen_at,note:"تنبيه من طبقة Sentinel."}));
    const moneyRows=moneyOpps.data||[],blueprintRows=blueprints.data||[],taskRows=tasks.data||[],approvalRows=approvals.data||[];
    const expected=moneyRows.reduce((s:number,x:any)=>s+Number(x.expected_value||0),0);
    const actionable=moneyRows.filter((x:any)=>["money_candidate","human_review"].includes(String(x.status||""))).length;
    const submitted=moneyRows.filter((x:any)=>String(x.status||"")==="submitted_waiting").length;
    const cap=capRows.data||[],avg=cap.length?cap.reduce((s:number,x:any)=>s+Number(x.delivery_confidence||0),0)/cap.length:0;
    const governor=(governors.data||[]).find((x:any)=>x.owner_scope==="midad")||null;
    const storage=await readStorageGovernorSnapshot();
    const data={
      storage,
      capability_gate:{assessed_count:cap.length,eligible:cap.filter((x:any)=>x.execution_decision==="ELIGIBLE").length,human_review:cap.filter((x:any)=>x.execution_decision==="HUMAN_REVIEW").length,hold:cap.filter((x:any)=>x.execution_decision==="HOLD").length,reject:cap.filter((x:any)=>x.execution_decision==="REJECT").length,avg_delivery_confidence:Number(avg.toFixed(4)),last_assessed_at:cap[0]?.assessed_at||null,model_version:"miae-capability-gate-v1",note:"الجاهزية لا تعني ضمان الفوز أو التسليم."},
      finance_intelligence:{finance_core:{latest_cycle:null},governor},
      runtime:{money_hunter:null},
      health:{
        signals:signalCount.count??0,opportunities:opportunityCount.count??0,engine_runs:engineCount.count??0,sentinel_alerts:alertCount.count??0,entities:entityCount.count??0,relations:0,
        wallets:(wallets.data||[]).length,exchanges:0,trade_intents:0,capital_sources:0,pending_approvals:approvalRows.length,pending_human_tasks:taskRows.length,clients:0,open_conversations:0,payment_intents:0,
        osint_sources:(osintSources.data||[]).length,osint_events:(osintEvents.data||[]).length,autonomy_last_status:"not_loaded",autonomy_last_run:null,
        money_opportunities:moneyRows.length,money_actionable:actionable,money_submitted:submitted,money_expected_value:Number(expected.toFixed(2)),
        income_blueprints:blueprintRows.length,blueprint_expected_value:Number(blueprintRows.reduce((s:number,b:any)=>s+Number(b.estimated_net_usd||0),0).toFixed(2)),
        pipeline_ok:moneyRows.length>0,pipeline_note:moneyRows.length===0?"لا توجد حاليًا فرصة paid_work جاهزة أو قيد التنفيذ في مسار المال.":actionable===0&&submitted>0?"يوجد عمل مُرسل بانتظار النتيجة؛ لا توجد فرصة جديدة جاهزة الآن.":"مسار المال يحتوي على فرص paid_work قابلة للمراجعة أو التنفيذ."
      },
      signals:signalRows,opportunities:recentOpps.data||[],money_opportunities:moneyRows,income_blueprints:blueprintRows,alerts:[...actual,...derived],
      wallets:wallets.data||[],wallet_routes:walletRoutes,exchanges:[],capital:[],trades:[],integrations:[],approvals:approvalRows,human_tasks:taskRows,
      clients:[],conversations:[],payments:[],osint:{sources:osintSources.data||[],events:osintEvents.data||[]},autonomy:[],feedback:[],
      _meta:{source:"dashboard_fast",generated_at:new Date().toISOString(),query_mode:"parallel_lite",cache_ttl_ms:8000}
    };
    MIDAD_FAST_DASHBOARD_CACHE={at:Date.now(),data};
    return data;
  })();
  try{return await MIDAD_FAST_DASHBOARD_INFLIGHT;}
  finally{MIDAD_FAST_DASHBOARD_INFLIGHT=null;}
}

async function runStackfullProbe(admin:any,domain:string){
  const cleaned=cleanText(domain,240).toLowerCase().replace(/^https?:\/\//,"").split("/")[0].split("?")[0].split("#")[0];
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(cleaned))
    return {ok:false,error:"valid_domain_required"};
  const key=await adminKeyForAutonomy();
  if(!key?.data)return {ok:false,error:"autonomy_key_unavailable"};
  const r=await fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_stackfull_probe",{
    method:"POST",
    headers:{"content-type":"application/json","x-midad-autonomy-key":key.data},
    body:JSON.stringify({domain:cleaned}),
    signal:AbortSignal.timeout(20000)
  });
  const t=await r.text();
  let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  return r.ok?j:{ok:false,error:j?.error||("Stackfull HTTP "+r.status),http_status:r.status,detail:j};
}

async function runAutonomyNow(){
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_autonomy_loop";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const {data:key}=await adminKeyForAutonomy();
  if(!key)return {ok:false,error:"autonomy_key_unavailable"};
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-midad-autonomy-key":key},body:JSON.stringify({source:"control_room"})});
  const text=await r.text();let j:any={};try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,...j};
}
async function adminKeyForAutonomy(){
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data}=await admin.rpc("midad_get_autonomy_key");
  return {data:typeof data==="string"?data:(Array.isArray(data)?data[0]?.midad_get_autonomy_key:null)};
}
async function telegramWebhookInfo(admin:any){
  const {data:bot}=await admin.from("bot_configs").select("id,telegram_bot_token,active,platform").eq("active",true).eq("platform","telegram").limit(1).maybeSingle();
  if(!bot?.telegram_bot_token)return {ok:false,error:"telegram_bot_not_configured"};
  const base="https://api.telegram.org/bot"+bot.telegram_bot_token;
  const r=await fetch(base+"/getWebhookInfo"); const j=await r.json().catch(()=>({}));
  return {ok:r.ok&&j?.ok===true,bot_id:bot.id,result:j?.result||{}};
}
async function switchTelegramWebhook(admin:any,target:"router"|"bot"){
  const {data:bot}=await admin.from("bot_configs").select("id,telegram_bot_token,active,platform").eq("active",true).eq("platform","telegram").limit(1).maybeSingle();
  if(!bot?.telegram_bot_token)return {ok:false,error:"telegram_bot_not_configured"};
  const url=Deno.env.get("SUPABASE_URL")!;
  const secret=Deno.env.get("TELEGRAM_WEBHOOK_SECRET")||"";
  const endpoint=target==="router"
    ? url+"/functions/v1/midad_telegram_router?bot_id="+encodeURIComponent(bot.id)
    : url+"/functions/v1/telegram_bot?bot_id="+encodeURIComponent(bot.id);
  const r=await fetch("https://api.telegram.org/bot"+bot.telegram_bot_token+"/setWebhook",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({url:endpoint,allowed_updates:["message","callback_query"],...(secret?{secret_token:secret}:{})})
  });
  const j=await r.json().catch(()=>({}));
  return {ok:r.ok&&j?.ok===true,target,url:endpoint};
}
async function runOsintRouter(){
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_osint_router";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const {data:key}=await adminKeyForAutonomy();
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-autonomy-key":String(key||"")},body:JSON.stringify({lookback_hours:24,ingest_market:true})});
  const text=await r.text();let j:any={};try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,...j};
}
async function runMarketEdge(admin:any,p:any){
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,ik=Deno.env.get("MIDAD_INGEST_KEY")!;
  const operation=cleanText(p.operation||"capabilities",40);
  const payload={...p,action:operation};
  const r=await fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_market_edge",{
    method:"POST",headers:{"content-type":"application/json","x-midad-ingest-key":ik},body:JSON.stringify(payload)
  });
  const text=await r.text();let j:any={};try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,...j};
}

async function runUgig(p:any){
  const gateway=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_ugig_gateway";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  const requested=String(p.ugig_action||p.ugig_operation||p.action_name||"profile");
  const allowed=["browse_gigs","rank_gigs","best_opportunity","session","profile","profile_update","applications","apply","wallet","invoices","notifications"];
  const action=allowed.includes(requested)?requested:"profile";
  const payload={...p,action};
  delete payload.ugig_action; delete payload.ugig_operation; delete payload.action_name;
  const r=await fetch(gateway,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify(payload)});
  const text=await r.text(); let j:any={}; try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,ugig_action:action,...j};
}

async function runKeysStatus(){
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_keys_gateway";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify({action:"status"})});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  if(!r.ok||j?.ok===false)return {ok:false,error:j?.error||j?.message||("Keys HTTP "+r.status),http_status:r.status};
  return {ok:true,identities:j.identities||[],agents:j.agents||[],requests:j.requests||[]};
}

async function prepareOutreach(p:any){
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(!sk||!ik)return {ok:false,error:"outreach_gateway_not_configured",http_status:503};
  const payload=p?.payload&&typeof p.payload==="object"?p.payload:p;
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_client_gateway";
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify({...payload,action:"outreach_prepare"})});
  const text=await r.text();let j:any={};try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,...j};
}

async function decideApproval(admin:any,p:any){
  const id=cleanText(p.approval_id,80), decision=cleanText(p.decision,20);
  if(!id||!["approved","rejected","cancelled"].includes(decision))return {ok:false,error:"approval_id_and_valid_decision_required"};
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,ik=Deno.env.get("MIDAD_INGEST_KEY")!;
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_client_gateway";
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify({
    action:"approval_decide",approval_id:id,decision,note:cleanText(p.note,2000)
  })});
  const text=await r.text();let j:any={};try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,...j};
}
async function promoteSignal(admin:any, signalId:string){
  const {data:s}=await admin.from("signal_events").select("id,source,signal_type,entity,score,confidence,payload,occurred_at,fingerprint").eq("id",signalId).maybeSingle();
  if(!s) return {ok:false,error:"signal_not_found"};
  const {data:existing}=await admin.from("opportunity_signals").select("opportunity_id").eq("signal_id",signalId).limit(1);
  if(existing&&existing.length) return {ok:false,error:"already_linked",opportunity_id:existing[0].opportunity_id};
  const title=(labelSignal(s.signal_type)+(s.entity?" · "+s.entity:"")).slice(0,180);
  const {data:o,error:oe}=await admin.from("opportunities").insert({
    source:s.source,title,score:s.score,status:"new",opportunity_type:s.signal_type,
    description:"تم ترقية هذه الإشارة يدويًا للمراجعة؛ لا تعني فرصة مؤكدة.",
    confidence:s.confidence,expected_value:null,
    evidence:{signal_id:s.id,payload:s.payload,occurred_at:s.occurred_at},
    offer:{},
    fingerprint:"candidate:"+s.id,
    metadata:{origin:"control_room_manual_review"}
  }).select("id,title,score,status,opportunity_type,confidence,created_at").single();
  if(oe||!o) return {ok:false,error:"opportunity_insert_failed"};
  await admin.from("opportunity_signals").insert({opportunity_id:o.id,signal_id:s.id,contribution:Number(s.score||0)/100});
  return {ok:true,opportunity:o};
}

async function addWallet(admin,p:any){
  const label=cleanText(p.label,80),chain=cleanText(p.chain,40),address=cleanText(p.address,180);
  if(!label||!chain||!address) return {ok:false,error:"label_chain_address_required"};
  const {data,error}=await admin.from("midad_wallets").insert({
    label,chain,address,purpose:cleanText(p.purpose||"watch",40),watch_only:true,active:true,metadata:{source:"control_room"}
  }).select("id,label,chain,address,purpose,watch_only,active").single();
  return error?{ok:false,error:"wallet_insert_failed"}:{ok:true,wallet:data};
}
async function addExchange(admin,p:any){
  const exchange=cleanText(p.exchange,60),label=cleanText(p.label,80);
  if(!exchange||!label) return {ok:false,error:"exchange_and_label_required"};
  const {data,error}=await admin.from("midad_exchange_accounts").insert({
    exchange,label,account_ref:cleanText(p.account_ref||"",100)||null,mode:"monitor",status:"planned",
    supports_crypto:true,deposit_enabled:false,withdrawal_enabled:false,metadata:{source:"control_room"}
  }).select("id,exchange,label,account_ref,mode,status").single();
  return error?{ok:false,error:"exchange_insert_failed"}:{ok:true,exchange_account:data};
}
async function addCapital(admin,p:any){
  const source_type=cleanText(p.source_type,50),label=cleanText(p.label,80);
  if(!source_type||!label) return {ok:false,error:"source_type_and_label_required"};
  const {data,error}=await admin.from("midad_capital_sources").insert({
    source_type,label,asset:cleanText(p.asset||"",20)||null,amount:safeNum(p.amount),
    currency:cleanText(p.currency||"USD",10),estimated_daily_value:safeNum(p.estimated_daily_value),
    operating_cost:safeNum(p.operating_cost),status:"active",metadata:{source:"control_room"}
  }).select("id,source_type,label,asset,amount,currency,estimated_daily_value,operating_cost,status").single();
  return error?{ok:false,error:"capital_insert_failed"}:{ok:true,capital:data};
}
async function addTrade(admin,p:any){
  const asset_symbol=cleanText(p.asset_symbol,30).toUpperCase(),venue=cleanText(p.venue,60);
  if(!asset_symbol||!venue) return {ok:false,error:"asset_and_venue_required"};
  const {data,error}=await admin.from("midad_trade_intents").insert({
    asset_symbol,venue,side:["watch","buy","sell"].includes(p.side)?p.side:"watch",
    strategy:cleanText(p.strategy||"review",80),amount:safeNum(p.amount),
    max_loss_pct:safeNum(p.max_loss_pct),max_fee_pct:safeNum(p.max_fee_pct),
    status:"review",requires_approval:true,evidence:{source:"control_room"}
  }).select("id,asset_symbol,venue,side,strategy,amount,max_loss_pct,max_fee_pct,status,requires_approval,created_at").single();
  return error?{ok:false,error:"trade_intent_insert_failed"}:{ok:true,trade:data};
}

async function runMiningMonitor(){
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_viabtc_monitor";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk},body:JSON.stringify({coin:"BTC",label:"ViaBTC BTC Monitor"})});
  const text=await r.text(); let j:any={}; try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,...j};
}
async function runNoncopyTrade(body:any={}){
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_noncopy_trading_engine";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify(body)});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  return r.ok?j:{ok:false,error:j?.error||"trade_engine_http_"+r.status};
}
async function botFabricStatus(){
  const entries=[
    ["ahwazai_bot","AHWAZAI_BOT_TOKEN"],
    ["aimidad_bot","AIMIDAD_BOT_TOKEN"],
    ["telegram_bot","TELEGRAM_BOT_TOKEN"],
    ["viabtc_monitor","VIABTC_MONITOR_BOT_TOKEN"],
    ["midadroom_bot","MIDADROOM_BOT_TOKEN"]
  ];
  const out:any[]=[];
  for(const [key,env] of entries){
    const token=(key==="aimidad_bot" ? (Deno.env.get("AIMIDAD_BOT_TOKEN")||Deno.env.get("TELEGRAM_BOT_TOKEN")) : Deno.env.get(env))||"";
    if(!token){out.push({key,configured:false,ok:false});continue;}
    try{
      const r=await fetch("https://api.telegram.org/bot"+token+"/getMe",{signal:AbortSignal.timeout(10000)});
      const j:any=await r.json().catch(()=>({}));
      out.push({key,configured:true,ok:Boolean(r.ok&&j?.ok),identity:j?.result?{id:j.result.id,username:j.result.username,first_name:j.result.first_name}:null,error:j?.description||null});
    }catch(e){out.push({key,configured:true,ok:false,error:String(e?.message||e)})}
  }
  return {ok:true,bots:out,generated_at:new Date().toISOString(),secrets_exposed:false};
}

async function updateHumanTask(p:any){
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ik=Deno.env.get("MIDAD_INGEST_KEY")!;
  const r=await fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_human_task_router",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},
    body:JSON.stringify({
      action:"update_status",
      task_id:cleanText(p.task_id,80),
      status:cleanText(p.status,30),
      response_data:p.response_data&&typeof p.response_data==="object"?p.response_data:{source:"control_room"}
    })
  });
  const t=await r.text(); let j:any={}; try{j=JSON.parse(t)}catch{j={raw:t}};
  return {http_status:r.status,...j};
}

async function miningStatus(admin:any){
  const {data}=await admin.from("midad_mining_accounts").select("id,provider,coin,label,mode,status,read_only,last_hashrate_ths,last_worker_count,last_snapshot_at,metadata").order("updated_at",{ascending:false}).limit(10);
  return {accounts:data??[]};
}
async function createControlSession(admin:any, telegramUserId:string|null=null, authSource:string="web_key"){
  const token=crypto.randomUUID()+"-"+crypto.randomUUID();
  const th=await sha256(token);
  const {error}=await admin.from("control_room_sessions").insert({
    token_hash:th,active:true,
    telegram_user_id:telegramUserId
  });
  if(error) return {ok:false,error:"session_error"};
  return {ok:true,token,auth:authSource,telegram_user_id:telegramUserId};
}

async function receiveMoney(admin:any,p:any){
  const receiveAddress=cleanText(p?.receive_address,100);
  if(!/^0x[a-fA-F0-9]{40}$/.test(receiveAddress)){
    return {ok:false,status:"wallet_required",message:"أضف عنوان الاستلام العام مرة واحدة في Wallet Treasury؛ لا تدخل private key أو seed phrase."};
  }
  const network=cleanText(p?.network||"base",40).toLowerCase();
  const profileRes=await admin.from("profiles").select("id").limit(1).maybeSingle();
  if(profileRes.error) throw profileRes.error;
  const userId=profileRes.data?.id;
  if(!userId) return {ok:false,status:"system_profile_missing"};

  const walletMeta={provider:"control_room",source:"receive_money_button",verified_from:"user_local_wallet"};
  const existingWallet=await admin.from("midad_wallets").select("*").eq("address",receiveAddress).eq("active",true).maybeSingle();
  let wallet=existingWallet.data||null;
  if(!wallet){
    const ins=await admin.from("midad_wallets").insert({
      owner_scope:"midad",label:"Primary Receive Wallet",chain:network,address:receiveAddress,
      purpose:"SERVICES",watch_only:true,active:true,metadata:walletMeta
    }).select("*").single();
    if(ins.error) throw ins.error;
    wallet=ins.data;
  }

  const {data:ops,error:oe}=await admin.from("opportunities")
    .select("id,title,status,offer,metadata,evidence,expected_value")
    .eq("opportunity_type","paid_work")
    .eq("status","submitted_waiting")
    .limit(30);
  if(oe) throw oe;

  const receipts:any[]=[];
  const pending:any[]=[];
  for(const op of (ops||[])){
    const taskId=String(op?.offer?.external_id||op?.evidence?.task_id||"");
    if(!/^0x[a-fA-F0-9]{64}$/.test(taskId)) continue;
    try{
      const r=await fetch("https://api.taskmarket.dev/api/tasks/"+taskId,{headers:{accept:"application/json","user-agent":"MIDAD-Receive/1.0"}});
      const t=await r.json().catch(()=>({}));
      const awards=Array.isArray(t?.awards)?t.awards:[];
      const ours=awards.find((a:any)=>String(a.workerAddress||"").toLowerCase()===receiveAddress.toLowerCase() && a.settlementTxHash);
      if(!ours){
        pending.push({taskId,title:op.title,status:t?.status||"open",phase:t?.phase||null});
        continue;
      }
      const workerPayment=Number(ours.workerPayment||0)/1000000;
      const tx=String(ours.settlementTxHash||"");
      const existingPi=await admin.from("midad_payment_intents").select("id").filter("metadata->>task_id","eq",taskId).limit(1).maybeSingle();
      let paymentIntentId=existingPi.data?.id||null;

      if(!paymentIntentId){
        const ins=await admin.from("midad_payment_intents").insert({
          user_id:userId,amount_fiat:workerPayment,fiat_currency:"USD",
          settlement_asset:"USDC",network:"Base",quoted_crypto_amount:workerPayment,
          wallet_address:receiveAddress,status:"paid",confirmations_required:0,
          received_tx_hash:tx,verified_at:new Date().toISOString(),
          paid_at:ours.settledAt||new Date().toISOString(),reconciliation_status:"matched",
          metadata:{source:"taskmarket",task_id:taskId,award_rank:ours.rank||null,worker_agent_id:ours.workerAgentId||null,gross_amount:Number(ours.grossAmount||0)/1000000,platform_fee:Number(ours.platformFee||0)/1000000,settlement_tx_hash:tx,canonical_award:true}
        }).select("id").single();
        if(ins.error) throw ins.error;
        paymentIntentId=ins.data.id;
      }

      const ev=await admin.from("midad_payment_events").select("id").eq("payment_intent_id",paymentIntentId).eq("tx_hash",tx).limit(1).maybeSingle();
      if(!ev.data){
        const pe=await admin.from("midad_payment_events").insert({
          user_id:userId,payment_intent_id:paymentIntentId,event_type:"taskmarket_award_settlement",
          provider:"Taskmarket",tx_hash:tx,asset:"USDC",network:"Base",
          observed_amount:workerPayment,confirmations:0,
          evidence:{canonical_award:true,task_id:taskId,award:ours,verified_by:"taskmarket_detail"},
          occurred_at:ours.settledAt||new Date().toISOString()
        });
        if(pe.error) throw pe.error;
      }

      const setCall=await fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_settlement_router",{
        method:"POST",
        headers:{
          "content-type":"application/json",
          "authorization":"Bearer "+Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
          "x-midad-ingest-key":Deno.env.get("MIDAD_INGEST_KEY")||""
        },
        body:JSON.stringify({action:"route_paid_payment",payment_intent_id:paymentIntentId})
      });
      await setCall.text();

      const nextMeta={...(op.metadata||{}),settlement_detected:true,settled_at:ours.settledAt||new Date().toISOString(),settlement_tx_hash:tx,settled_worker_address:receiveAddress};
      await admin.from("opportunities").update({status:"settled",metadata:nextMeta,offer:{...(op.offer||{}),settled_worker_payment_usd:workerPayment,settlement_tx_hash:tx}}).eq("id",op.id);
      receipts.push({taskId,title:op.title,amountUsd:workerPayment,txHash:tx,settledAt:ours.settledAt||null});
    }catch(e){
      pending.push({taskId,title:op.title,error:String(e).slice(0,300)});
    }
  }

  return {ok:true,status:receipts.length?"received":"waiting",wallet:{address:wallet.address,chain:wallet.chain,label:wallet.label},received:receipts,pending,checked:(ops||[]).length,checkedAt:new Date().toISOString()};
}

async function prepareIncomeBlueprint(opportunityId:string){
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_income_factory";
  const {data:key}=await adminKeyForAutonomy();
  if(!key)return {ok:false,error:"autonomy_key_unavailable"};
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-midad-autonomy-key":String(key)},body:JSON.stringify({action:"prepare_blueprint",opportunity_id:cleanText(opportunityId,100)})});
  const text=await r.text();let j:any={};try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,...j};
}

async function runMoneyScan(){
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_money_hunter_loop";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk},body:JSON.stringify({source:"control_room_manual_cycle",requested_at:new Date().toISOString()})});
  const text=await r.text();let j:any={};try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,...j};
}

async function runOpportunityEngine(){
  const url=Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_opportunity_engine";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk},body:JSON.stringify({lookback_hours:72,min_score:85,min_confidence:.75,limit:300})});
  const text=await r.text(); let j:any={}; try{j=JSON.parse(text)}catch{j={raw:text}};
  return {http_status:r.status,...j};
}
async function replyFor(admin:any,command:string){
  const c=String(command||"").trim();
  if(c==="/status"){
    const d=await dashboard(admin);
    return "🟢 حالة مِداد\nالإشارات: "+d.health.signals+"\nالفرص: "+d.health.opportunities+"\nتشغيلات المحرك: "+d.health.engine_runs+"\nجاهزية التنفيذ: "+d.capability_gate.eligible+" | مراجعة بشرية: "+d.capability_gate.human_review+" | متوسط الثقة: "+Math.round(d.capability_gate.avg_delivery_confidence*100)+"%"+"\nتنبيهات Sentinel: "+d.health.sentinel_alerts+"\nالمحافظ: "+d.health.wallets+"\nالتداول: "+d.health.trade_intents+"\n"+d.health.pipeline_note;
  }
  if(c==="menu:radar"){const d=await dashboard(admin);return "📡 الرادار\n"+d.signals.slice(0,7).map((x:any)=>"• "+x.type_label+" · "+(x.entity||"بدون كيان")+" · "+x.score+" · conf "+x.confidence.toFixed(2)).join("\n");}
  if(c==="menu:opps"){const d=await dashboard(admin);return "🎯 الفرص\n"+(d.opportunities.length?d.opportunities.map((x:any)=>"• "+x.title+" | "+x.score+" | "+(x.status||"new")).join("\n"):"لا توجد فرص مثبتة؛ توجد إشارات مرشحة في الرادار.");}
  if(c==="menu:learning"){const d=await dashboard(admin);return "📊 التعلّم\n"+d.feedback.map((x:any)=>"• "+(x.outcome_label||"pending")+" | return "+(x.return_pct??"—")).join("\n");}
  if(c==="menu:mining"){const {data}=await admin.from("midad_capital_sources").select("label,asset,amount,currency,estimated_daily_value,status").eq("source_type","mining").limit(5);return "⛏️ التعدين\n"+((data??[]).map((x:any)=>"• "+x.label+" · "+(x.asset||"—")+" "+(x.amount??"—")+" · يومي "+(x.estimated_daily_value??"—")+" "+(x.currency||"USD")).join("\n")||"لا يوجد مصدر تعدين مسجل بعد.");}
  if(c==="menu:trade"){const {data}=await admin.from("midad_trade_intents").select("asset_symbol,venue,side,strategy,status,requires_approval").order("created_at",{ascending:false}).limit(6);return "💹 التداول\n"+((data??[]).map((x:any)=>"• "+x.asset_symbol+" @ "+x.venue+" · "+x.side+" · "+x.status+" · موافقة "+(x.requires_approval?"مطلوبة":"—")).join("\n")||"لا توجد نوايا تداول مسجلة.");}
  if(c==="menu:airdrops")return "🎁 Airdrops\nالاكتشاف والتحقق والأهلية تعرض في طبقة الفرص؛ لا تنفيذ Claims أو تحويلات تلقائية.";
  if(c==="menu:automation"){const d=await dashboard(admin);return "🤖 الأتمة\nSignals: "+d.health.signals+" | Opportunities: "+d.health.opportunities+" | Engine runs: "+d.health.engine_runs+"\n"+d.health.pipeline_note;}
  if(c==="menu:notion")return "🗂️ Notion\nالسجل التاريخي يمكن توجيهه إلى Notion بعد اكتمال طبقة الفرص.";
  if(c==="menu:settings")return "⚙️ الإعدادات\nجلسة محمية. الأسرار لا تُعرض. إعدادات Wallet/Exchange تحفظ كبيانات تشغيلية فقط.";
  if(c==="/revenue")return "💰 مركز الأموال\nاعتمد على الفرص المثبتة + قيمة متوقعة + رسوم + مخاطر؛ لا توجد فرص مثبتة حاليًا.";
  return "استلمت الأمر: "+c;
}

function lifecycleForOpportunity(o:any){
  const status=String(o?.status||"").toLowerCase().trim();
  const map:any={
    money_candidate:{stage:"candidate",human_action:"qualify/apply",can_start_delivery:false,meaning:"مرشحة ولم تُقبل بعد"},
    human_review:{stage:"human_review",human_action:"review/approve",can_start_delivery:false,meaning:"تحتاج مراجعة/موافقة بشرية"},
    submitted_waiting:{stage:"submitted_waiting",human_action:"monitor/respond",can_start_delivery:false,meaning:"تم التقديم وتنتظر نتيجة/رد"},
    accepted:{stage:"accepted",human_action:"prepare_delivery",can_start_delivery:true,meaning:"مقبولة ويمكن التحضير للتسليم"},
    delivery:{stage:"delivery",human_action:"execute/deliver",can_start_delivery:true,meaning:"قيد التنفيذ/التسليم"},
    invoiced:{stage:"invoiced",human_action:"collect/verify_payment",can_start_delivery:false,meaning:"تمت الفوترة وتنتظر التحصيل"},
    paid:{stage:"paid",human_action:"reconcile/archive",can_start_delivery:false,meaning:"مدفوعة وتحتاج تسوية/إثبات"},
    technical_blocked:{stage:"blocked",human_action:"resolve_blocker",can_start_delivery:false,meaning:"متوقفة بسبب عائق تقني/تشغيلي"},
    cancelled:{stage:"closed",human_action:"none",can_start_delivery:false,meaning:"ملغاة"},
    closed:{stage:"closed",human_action:"none",can_start_delivery:false,meaning:"مغلقة"}
  };
  return map[status]||{stage:status||"unknown",human_action:"verify_state",can_start_delivery:false,meaning:"الحالة غير معروفة؛ تحقق قبل أي تنفيذ"};
}
function enrichOpportunity(o:any){return {...o,lifecycle:lifecycleForOpportunity(o)};}
function aiLean(x:any){
  const clip=(v:any,n=700)=>String(v??"").replace(/\s+/g," ").trim().slice(0,n);
  const pick=(o:any,fields:string[])=>{const r:any={};for(const k of fields)if(o?.[k]!==undefined&&o?.[k]!==null)r[k]=o[k];return r;};
  const opportunity=(o:any)=>({
    ...pick(o,["id","source","title","score","status","opportunity_type","confidence","expected_value","created_at","updated_at"]),
    description:clip(o?.description,900),
    evidence:Array.isArray(o?.evidence)?o.evidence.slice(0,3).map((e:any)=>typeof e==="string"?clip(e,500):pick(e,["source","title","url","snippet","claim","confidence"])):clip(o?.evidence,700),
    offer:o?.offer?pick(o.offer,["reward_usd","net_reward_usd","currency","chain","action_url","deadline","estimated_hours","deliverables"]):null,
    lifecycle:o?.lifecycle?pick(o.lifecycle,["stage","label","next_action","blocked","reason"]):null
  });
  const task=(o:any)=>({...pick(o,["id","type","priority","risk_class","blocking","title","status","action_url","requested_at","expires_at"]),instruction:clip(o?.instruction,700),reason:clip(o?.reason,500),evidence:Array.isArray(o?.evidence)?o.evidence.slice(0,2).map((e:any)=>typeof e==="string"?clip(e,400):pick(e,["source","url","claim","confidence"])):clip(o?.evidence,500)});
  const approval=(o:any)=>({...pick(o,["id","subject_type","subject_id","action","risk_class","status","created_at","expires_at"]),reason:clip(o?.reason,500),evidence:Array.isArray(o?.evidence)?o.evidence.slice(0,2):clip(o?.evidence,500)});
  const payment=(o:any)=>pick(o,["id","amount_fiat","fiat_currency","settlement_asset","network","status","reconciliation_status","created_at"]);
  const blueprint=(o:any)=>({...pick(o,["id","opportunity_id","state","title","buyer_or_market","action_url","estimated_net_usd","estimated_hours","efficiency_usd_per_hour","created_at","updated_at"]),money_thesis:clip(o?.money_thesis,500),deliverables:o?.deliverables?.slice?.(0,6),acceptance_tests:o?.acceptance_tests?.slice?.(0,6),blockers:o?.blockers?.slice?.(0,6),work_sequence:o?.work_sequence?.slice?.(0,8),payment_plan:o?.payment_plan,proposal_draft:clip(o?.proposal_draft,900),client_questions:o?.client_questions?.slice?.(0,5),qa_checklist:o?.qa_checklist?.slice?.(0,8)});
  return {
    mode:x?.mode,question:clip(x?.question,1200),health:x?.health,capability_gate:x?.capability_gate,
    selected_opportunity:x?.selected_opportunity?opportunity(x.selected_opportunity):null,
    selected_blueprint:x?.selected_blueprint?blueprint(x.selected_blueprint):null,
    opportunities:Array.isArray(x?.opportunities)?x.opportunities.slice(0,8).map(opportunity):undefined,
    actionable_opportunities:Array.isArray(x?.actionable_opportunities)?x.actionable_opportunities.slice(0,8).map(opportunity):undefined,
    submitted_waiting:Array.isArray(x?.submitted_waiting)?x.submitted_waiting.slice(0,8).map(opportunity):undefined,
    blueprints:Array.isArray(x?.blueprints)?x.blueprints.slice(0,8).map(blueprint):undefined,
    human_tasks:Array.isArray(x?.human_tasks)?x.human_tasks.slice(0,10).map(task):undefined,
    approvals:Array.isArray(x?.approvals)?x.approvals.slice(0,8).map(approval):undefined,
    payments:Array.isArray(x?.payments)?x.payments.slice(0,8).map(payment):undefined,
    signals:Array.isArray(x?.signals)?x.signals.slice(0,8):undefined,
    osint_events:Array.isArray(x?.osint_events)?x.osint_events.slice(0,8):undefined,
    alerts:Array.isArray(x?.alerts)?x.alerts.slice(0,8):undefined,
    autonomy:Array.isArray(x?.autonomy)?x.autonomy.slice(0,3):undefined,
    integrations:Array.isArray(x?.integrations)?x.integrations.slice(0,12):undefined
  };
}
function nowActionableOpportunity(o:any){
  const stage=lifecycleForOpportunity(o).stage;
  return stage==="accepted"||stage==="delivery"||stage==="invoiced"||stage==="blocked";
}

async function aiFastContext(admin:any,mode:string,prompt:string){
  const financeIntelligencePromise=financeIntelligenceReadModel(admin);
  const healthQueries=[
    admin.from("opportunities").select("id",{count:"exact",head:true}).neq("status","test"),
    admin.from("signal_events").select("id",{count:"exact",head:true}),
    admin.from("midad_human_tasks").select("id",{count:"exact",head:true}).in("status",["OPEN","ACKNOWLEDGED"]),
    admin.from("midad_approvals").select("id",{count:"exact",head:true}).eq("status","pending"),
    admin.from("midad_payment_intents").select("id",{count:"exact",head:true})
  ];
  const hs=await Promise.all(healthQueries.map((q:any,i:number)=>safeQuery(q,"ai_health_"+i)));
  const health={
    opportunities:hs[0].count??0,
    signals:hs[1].count??0,
    pending_human_tasks:hs[2].count??0,
    pending_approvals:hs[3].count??0,
    payment_intents:hs[4].count??0
  };
  const financeIntelligence=await financeIntelligencePromise;

  let extra:any={};
  if(mode==="blueprint"){
    const [blueprints,tasks,opps]=await Promise.all([
      safeQuery(admin.from("midad_income_blueprints")
        .select("id,opportunity_id,state,title,money_thesis,buyer_or_market,action_url,estimated_net_usd,estimated_hours,efficiency_usd_per_hour,deliverables,acceptance_tests,blockers,proof_points,work_sequence,payment_plan,proposal_draft,client_questions,qa_checklist,metadata,created_at,updated_at")
        .order("updated_at",{ascending:false}).limit(20),"ai_blueprints"),
      safeQuery(admin.from("midad_human_tasks")
        .select("id,type,priority,risk_class,blocking,title,instruction,reason,status,action_url,evidence,requested_at,expires_at")
        .in("status",["OPEN","ACKNOWLEDGED"]).order("priority",{ascending:false}).limit(15),"ai_blueprint_tasks"),
      safeQuery(admin.from("opportunities")
        .select("id,source,title,score,status,opportunity_type,description,confidence,expected_value,evidence,offer,created_at")
        .neq("status","test").order("score",{ascending:false}).limit(20),"ai_blueprint_opportunities")
    ]);
    extra={blueprints:blueprints.data??[],human_tasks:tasks.data??[],opportunities:(opps.data??[]).map(enrichOpportunity)};
  }else if(mode==="opportunity"||mode==="money"){
    const [opps,tasks,apps,payments]=await Promise.all([
      safeQuery(admin.from("opportunities")
        .select("id,source,title,score,status,opportunity_type,description,confidence,expected_value,evidence,offer,created_at")
        .eq("opportunity_type","paid_work")
        .in("status",["money_candidate","human_review","submitted_waiting","technical_blocked"])
        .order("score",{ascending:false}).order("created_at",{ascending:false}).limit(12),"ai_opportunities"),
      safeQuery(admin.from("midad_human_tasks")
        .select("id,type,priority,risk_class,blocking,title,instruction,reason,status,action_url,evidence,requested_at,expires_at")
        .in("status",["OPEN","ACKNOWLEDGED"]).order("priority",{ascending:false}).limit(10),"ai_tasks"),
      safeQuery(admin.from("midad_approvals")
        .select("id,subject_type,subject_id,action,risk_class,reason,evidence,status,created_at,expires_at")
        .eq("status","pending").order("created_at",{ascending:false}).limit(8),"ai_approvals"),
      safeQuery(admin.from("midad_payment_intents")
        .select("id,amount_fiat,fiat_currency,settlement_asset,network,status,reconciliation_status,created_at")
        .order("created_at",{ascending:false}).limit(8),"ai_payments")
    ]);
    extra={opportunities:(opps.data??[]).map(enrichOpportunity),human_tasks:tasks.data??[],approvals:apps.data??[],payments:payments.data??[]};
  }else if(mode==="now"){
    const [tasks,apps,opps,payments]=await Promise.all([
      safeQuery(admin.from("midad_human_tasks")
        .select("id,type,priority,risk_class,blocking,title,instruction,reason,status,action_url,evidence,requested_at,expires_at")
        .in("status",["OPEN","ACKNOWLEDGED"]).order("priority",{ascending:false}).limit(20),"ai_now_tasks"),
      safeQuery(admin.from("midad_approvals")
        .select("id,subject_type,subject_id,action,risk_class,reason,evidence,status,created_at,expires_at")
        .eq("status","pending").order("created_at",{ascending:false}).limit(20),"ai_now_approvals"),
      safeQuery(admin.from("opportunities")
        .select("id,source,title,score,status,opportunity_type,description,confidence,expected_value,evidence,offer,created_at,updated_at")
        .eq("opportunity_type","paid_work")
        .in("status",["submitted_waiting","accepted","delivery","invoiced","technical_blocked"])
        .order("updated_at",{ascending:false}).limit(20),"ai_now_opportunities"),
      safeQuery(admin.from("midad_payment_intents")
        .select("id,amount_fiat,fiat_currency,settlement_asset,network,status,reconciliation_status,created_at")
        .in("status",["pending","quoted","awaiting_payment","paid"])
        .order("created_at",{ascending:false}).limit(12),"ai_now_payments")
    ]);
    extra={
      human_tasks:tasks.data??[],
      approvals:apps.data??[],
      actionable_opportunities:(opps.data??[]).filter(nowActionableOpportunity).map(enrichOpportunity),
      submitted_waiting:(opps.data??[]).filter((o:any)=>lifecycleForOpportunity(o).stage==="submitted_waiting").map(enrichOpportunity),
      payments:payments.data??[]
    };
  }else if(mode==="tasks"){
    const [tasks,apps]=await Promise.all([
      safeQuery(admin.from("midad_human_tasks")
        .select("id,type,priority,risk_class,blocking,title,instruction,reason,status,action_url,evidence,requested_at,expires_at")
        .in("status",["OPEN","ACKNOWLEDGED"]).order("priority",{ascending:false}).limit(15),"ai_tasks"),
      safeQuery(admin.from("midad_approvals")
        .select("id,subject_type,subject_id,action,risk_class,reason,evidence,status,created_at,expires_at")
        .eq("status","pending").order("created_at",{ascending:false}).limit(12),"ai_approvals")
    ]);
    extra={human_tasks:tasks.data??[],approvals:apps.data??[]};
  }else if(mode==="osint"){
    const [signals,events,alerts]=await Promise.all([
      safeQuery(admin.from("signal_events")
        .select("id,source,signal_type,entity,score,confidence,occurred_at,created_at,payload")
        .order("created_at",{ascending:false}).limit(12),"ai_signals"),
      safeQuery(admin.from("midad_osint_events")
        .select("id,event_type,subject_key,severity,confidence,observed_at,evidence")
        .order("observed_at",{ascending:false}).limit(12),"ai_osint_events"),
      safeQuery(admin.from("midad_sentinel_alerts")
        .select("id,asset_key,alert_type,risk_score,confidence,status,first_seen_at,last_seen_at,evidence")
        .in("status",["active","review"]).order("risk_score",{ascending:false}).limit(10),"ai_alerts")
    ]);
    extra={signals:signals.data??[],osint_events:events.data??[],alerts:alerts.data??[]};
  }else{
    const [autonomy,integrations]=await Promise.all([
      safeQuery(admin.from("midad_autonomy_runs")
        .select("id,status,started_at,completed_at,result,error")
        .order("started_at",{ascending:false}).limit(3),"ai_autonomy"),
      safeQuery(admin.from("integrations")
        .select("provider,status,updated_at")
        .order("updated_at",{ascending:false}).limit(12),"ai_integrations")
    ]);
    extra={autonomy:autonomy.data??[],integrations:integrations.data??[]};
  }

  const cap=await safeQuery(admin.from("midad_work_assessments")
    .select("execution_decision,delivery_confidence,assessed_at")
    .order("assessed_at",{ascending:false}).limit(60),"ai_capability_gate");
  const rows=cap.data??[];
  const avg=rows.length?rows.reduce((s:number,r:any)=>s+Number(r.delivery_confidence||0),0)/rows.length:0;
  const capability_gate={
    assessed_count:rows.length,
    eligible:rows.filter((r:any)=>r.execution_decision==="ELIGIBLE").length,
    human_review:rows.filter((r:any)=>r.execution_decision==="HUMAN_REVIEW").length,
    hold:rows.filter((r:any)=>r.execution_decision==="HOLD").length,
    reject:rows.filter((r:any)=>r.execution_decision==="REJECT").length,
    avg_delivery_confidence:Number(avg.toFixed(4)),
    last_assessed_at:rows[0]?.assessed_at||null
  };

  return {
    health,
    capability_gate,
    finance_intelligence:financeIntelligence,
    ...extra
  };
}

async function runAiAssist(admin:any,p:any){
  const prompt=cleanText(p?.prompt,5000);
  if(!prompt) return {ok:false,error:"prompt_required"};
  const lower=prompt.toLowerCase();
  const requestedMode=cleanText(p?.ai_mode,40).toLowerCase();
  let mode=requestedMode;
  if(!mode){
    if(/ما\s*(?:أهم|اهم)\s*شي(?:ء)?\s*(?:يحتاج|محتاج)\s*(?:تدخلي|ني)\s*الآن|شنو\s*(?:أهم\s*)?شي(?:ء)?\s*يحتاجني|يحتاج\s*تدخلي\s*الآن|تدخلي\s*الآن|what\s+needs\s+me|my\s+intervention/.test(lower)) mode="now";
    else if(/blueprint|بلا|بلوپرنت|مخطط تنفيذ|Review-Request|flow|جاهز للتنفيذ|عوائق|متطلبات/.test(lower)) mode="blueprint";
    else if(/^حلّل هذه الفرصة[:：]/.test(prompt)||/\bopportunity\b|فرصة/.test(lower)) mode="opportunity";
    else if(/مال|دخل|cash|payment|pipeline|client/.test(lower)) mode="money";
    else if(/مهم|تدخل|approval|موافقة|human task|task/.test(lower)) mode="tasks";
    else if(/osint|رصد|إشارات|signal|radar|sentinel/.test(lower)) mode="osint";
    else mode="system";
  }

  const snap=await aiFastContext(admin,mode,prompt);
  let selectedOpportunity=null;
  let stackfullEvidence:any=null;
  if(mode==="opportunity"){
    const marker="حلّل هذه الفرصة:";
    const i=prompt.indexOf(marker);
    if(i>=0){
      const q=prompt.slice(i+marker.length).split("؛")[0].trim();
      const list=snap.opportunities??[];
      selectedOpportunity=list.find((o:any)=>String(o.title||"").trim()===q)
        ||list.find((o:any)=>q&&String(o.title||"").includes(q))
        ||list[0]||null;
    }
    const opportunityUrl=selectedOpportunity?.action_url||selectedOpportunity?.offer?.action_url||selectedOpportunity?.offer?.url||selectedOpportunity?.evidence?.action_url||selectedOpportunity?.evidence?.url||"";
    let domain="";
    try{domain=new URL(String(opportunityUrl)).hostname.toLowerCase().replace(/^www\./,"");}catch{}
    if(domain){
      try{
        const probe=await runStackfullProbe(admin,domain);
        stackfullEvidence=probe?.ok===false
          ? {domain,error:probe.error||"stackfull_probe_failed"}
          : {contract_version:probe.contract_version||"stackfull-adapter-v1",domain,item_count:Array.isArray(probe.items)?probe.items.length:0,items:Array.isArray(probe.items)?probe.items.slice(0,20):[],evidence_policy:probe.evidence_policy||null};
      }catch(e){stackfullEvidence={domain,error:String(e)}}
    }
  }

  const context:any={
    mode,
    question:prompt,
    health:snap.health,
    capability_gate:snap.capability_gate,
    finance_intelligence:snap.finance_intelligence
  };
  if(stackfullEvidence) context.stackfull_evidence=stackfullEvidence;
  if(mode==="blueprint"){
    const q=prompt.replace(/^.*?(?:راجع|راجع هذا|حلّل|حلل)\s*(?:الـ|ال)?Blueprint[:：]?/i,"").split(/[؛;]/)[0].trim();
    const list=snap.blueprints??[];
    const selectedBlueprint=list.find((b:any)=>String(b.title||"").trim()===q)
      ||list.find((b:any)=>q&&String(b.title||"").toLowerCase().includes(q.toLowerCase()))
      ||list.find((b:any)=>q&&q.toLowerCase().includes(String(b.title||"").toLowerCase()))
      ||list[0]||null;
    Object.assign(context,{selected_blueprint:selectedBlueprint,blueprints:list.slice(0,10),human_tasks:(snap.human_tasks??[]).slice(0,10),opportunities:(snap.opportunities??[]).slice(0,10)});
  }else if(mode==="opportunity") Object.assign(context,{selected_opportunity:selectedOpportunity,opportunities:(snap.opportunities??[]).slice(0,6),human_tasks:(snap.human_tasks??[]).slice(0,8),approvals:(snap.approvals??[]).slice(0,6),payments:(snap.payments??[]).slice(0,5)});
  else if(mode==="money") Object.assign(context,{opportunities:(snap.opportunities??[]).slice(0,8),human_tasks:(snap.human_tasks??[]).slice(0,8),approvals:(snap.approvals??[]).slice(0,5),payments:(snap.payments??[]).slice(0,8)});
  else if(mode==="now") Object.assign(context,{
    human_tasks:(snap.human_tasks??[]).slice(0,20),
    approvals:(snap.approvals??[]).slice(0,20),
    actionable_opportunities:(snap.actionable_opportunities??[]).slice(0,12),
    submitted_waiting:(snap.submitted_waiting??[]).slice(0,12),
    payments:(snap.payments??[]).slice(0,10)
  });
  else if(mode==="tasks") Object.assign(context,{human_tasks:(snap.human_tasks??[]).slice(0,15),approvals:(snap.approvals??[]).slice(0,12)});
  else if(mode==="osint") Object.assign(context,{signals:(snap.signals??[]).slice(0,12),osint_events:(snap.osint_events??[]).slice(0,12),alerts:(snap.alerts??[]).slice(0,10)});
  else Object.assign(context,{autonomy:(snap.autonomy??[]).slice(0,3),integrations:(snap.integrations??[]).slice(0,12)});

  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(!sk||!ik) return {ok:false,error:"internal_router_not_configured"};

  const systemPrompt=[
    "أنت MIDAD AI لشرح القرار والتنفيذ داخل MIDAD. استخدم الأدلة الموجودة فقط وميّز الحقيقة عن الاستنتاج.",
    "لا تعرض OSINT أو الأخبار إلا عند طلبها.",
    "opportunity/money: ركّز على قابلية التنفيذ، العائق، القيمة، وما ينقص والخطوة التالية.",
    "tasks/now: حدّد ما يحتاجه الإنسان الآن؛ لا تعتبر money_candidate مهمة فورية ولا تبدأ فرصة غير مقبولة.",
    "Lifecycle: money_candidate=تأهيل؛ human_review=مراجعة؛ submitted_waiting=مراقبة؛ accepted=تحضير؛ delivery=تنفيذ/تسليم؛ invoiced=تحصيل؛ paid=إغلاق؛ technical_blocked=حل العائق.",
    "لا تعتبر المواعيد تفويضًا. لا تغيّر الحالة بالافتراض ولا تنسب نجاحًا خارجيًا بلا دليل.",
    "blueprint: راجع الـBlueprint المحدد وبياناته المرتبطة فقط. system: افحص التشغيل والعوائق دون موجز OSINT.",
    "قبل الجواب تحقّق داخليًا من الكيان والحالة والدليل والحاجة للتدخل؛ عند نقص البيانات اذكره بدل التخمين.",
    "أجب بالعربية الواضحة: الخلاصة ثم الخطوة التالية العملية، باختصار."
  ].join(" ");

  const r=await fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/midad_orchestrator",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},
    body:JSON.stringify({role:"reasoning",task:systemPrompt+"\nMODE: "+mode+"\nالسؤال: "+prompt,context:aiLean(context)})
  });
  const text=await r.text();
  let j:any={}; try{j=JSON.parse(text)}catch{j={raw:text}};
  if(!r.ok) return {ok:false,error:j?.error||j?.detail||("AI HTTP "+r.status),http_status:r.status};
  return {ok:true,answer:j?.final||j?.message||j?.answer||"",router:j?.router||null,model:j?.selected_model||null,run_id:j?.run_id||null,mode,evidence:{generated_at:new Date().toISOString(),health:snap.health,capability_gate:snap.capability_gate,selected_opportunity:selectedOpportunity||null,selected_blueprint:context.selected_blueprint||null,stackfull_evidence:stackfullEvidence||null,human_tasks:(snap.human_tasks||[]).slice(0,5),approvals:(snap.approvals||[]).slice(0,5)}};
}

async function runAiPipelineSmokeTest(){
  const url=Deno.env.get("SUPABASE_URL")||"";
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(!url||!sk||!ik)return {ok:false,state:"BLOCKED",error:"internal_credentials_unavailable",provider_calls_started:false};
  const requestRef="midad-smoke-"+crypto.randomUUID();
  const started=Date.now();
  const safeCode=(value:any)=>{const s=String(value??"").trim().slice(0,80);return /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(s)?s:(s?"provider_error":null);};
  const safeStatus=(value:any)=>Number.isInteger(value)&&value>=100&&value<=599?value:null;
  try{
    const response=await fetch(url+"/functions/v1/midad_ai_router",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},
      body:JSON.stringify({
        action:"chat",
        task_class:"generic",
        consult_gemini:true,
        strict_pipeline:true,
        request_ref:requestRef,
        max_output_tokens:120,
        temperature:0,
        prompt:"Synthetic wiring smoke test only. Return exactly these two labels, one per line: ADVISOR_SEEN and EXECUTOR_OK. This task contains no user or project data. Do not browse, call tools, modify records, or perform any external action."
      }),
      signal:AbortSignal.timeout(95000)
    });
    const raw=await response.text();
    let data:any={};try{data=JSON.parse(raw)}catch{data={};}
    const pipeline=data?.pipeline||null;
    const rawAdvisor=pipeline?.advisor||data?.advisor||null;
    const rawExecutor=pipeline?.executor||data?.executor||null;
    const answer=String(data?.answer||data?.final||data?.message||"").slice(0,500);
    const advisorRequested=Boolean(pipeline?.requested===true||rawAdvisor?.provider==="gemini"||data?.error==="gemini_advisor_failed"||data?.executor_called===false);
    const advisorInjected=Boolean(rawAdvisor?.advice_injected===true);
    const advisorOk=Boolean(advisorRequested&&rawAdvisor?.state==="VERIFIED"&&advisorInjected);
    const executorCalled=typeof data?.executor_called==="boolean"?data.executor_called:
      (typeof data?.executor_request_sent==="boolean"?data.executor_request_sent:
      (rawExecutor?.state?true:null));
    const executorOk=Boolean(response.ok&&data?.ok!==false&&pipeline?.executor?.state==="VERIFIED"&&pipeline?.executor?.provider==="apmix");
    const markers=answer.includes("ADVISOR_SEEN")&&answer.includes("EXECUTOR_OK");
    const verified=advisorOk&&executorOk&&markers;
    const advisorHttpStatus=safeStatus(rawAdvisor?.http_status??rawAdvisor?.status);
    const executorHttpStatus=safeStatus(rawExecutor?.http_status??rawExecutor?.status??data?.gateway_status);
    const failureStage=verified?null:
      (!advisorOk&&advisorRequested?"gemini_advisor":
      (executorCalled===false?"apmix_executor_not_called":
      (rawExecutor||Number.isInteger(data?.gateway_status)?"apmix_executor":"pipeline_response_unclassified")));
    const providerErrorCode=verified?null:safeCode(rawAdvisor?.error||rawAdvisor?.code||rawExecutor?.error||data?.error||"pipeline_smoke_test_incomplete");
    return {
      ok:verified,
      state:verified?"VERIFIED":(advisorOk&&executorOk?"PARTIAL":"FAILED"),
      test:"gemini_to_claude_synthetic_smoke",
      request_ref:requestRef,
      http_status:response.status,
      latency_ms:Date.now()-started,
      failure_stage:failureStage,
      executor_called:executorCalled,
      provider_http_status:failureStage==="gemini_advisor"?advisorHttpStatus:(failureStage==="apmix_executor"?executorHttpStatus:null),
      router_error:verified?null:safeCode(data?.error),
      provider_error_code:providerErrorCode,
      pipeline:{
        requested:true,
        advisor:{provider:"gemini",model:rawAdvisor?.model||pipeline?.advisor?.model||"gemini-3.8-flash",state:rawAdvisor?.state||"FAILED",advice_injected:advisorOk,error:advisorOk?null:safeCode(rawAdvisor?.error||rawAdvisor?.code||null),http_status:advisorHttpStatus},
        executor:{provider:"apmix",model:rawExecutor?.model||data?.model||null,state:executorOk?"VERIFIED":(rawExecutor?.state||(executorCalled===false?"NOT_CALLED":"FAILED")),error:executorOk?null:safeCode(rawExecutor?.error||null),http_status:executorHttpStatus}
      },
      expected_markers_present:markers,
      usage:data?.usage||null,
      answer:answer||null,
      error:verified?null:providerErrorCode
    };
  }catch(e){
    return {ok:false,state:"FAILED",test:"gemini_to_claude_synthetic_smoke",request_ref:requestRef,latency_ms:Date.now()-started,failure_stage:"router_request",executor_called:null,provider_http_status:null,error:"pipeline_request_failed"};
  }
}

Deno.serve(async(req:Request)=>{
  try{
    if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS_HEADERS});
    if(req.method==="GET") return new Response(JSON.stringify({
      ok:true,
      service:"midad_control_room",
      version:24,
      telegram_auth_configured:!!(Deno.env.get("TELEGRAM_BOT_TOKEN")),
      web_access_enabled:true
    }),{headers:JSON_HEADERS});
    if(req.method!=="POST") return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers:JSON_HEADERS});
    const body=await req.json().catch(()=>({}));
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const requestAction=typeof body?.action==="string"?body.action:(typeof body?.operation==="string"?body.operation:"");
    const suppliedInternalKey=req.headers.get("x-midad-key")||req.headers.get("x-midad-ingest-key")||"";
    const configuredInternalKey=Deno.env.get("MIDAD_INGEST_KEY")||"";
    const internalAuthorized=await safeSecretEqual(suppliedInternalKey,configuredInternalKey);
    const internalAllowed=requestAction==="ai_context"||requestAction==="ai_assist"||requestAction==="ai_pipeline_smoke_test";
    if(internalAuthorized&&!internalAllowed){
      return new Response(JSON.stringify({error:"internal_action_not_allowed"}),{status:403,headers:JSON_HEADERS});
    }
    if(internalAuthorized&&requestAction==="ai_pipeline_smoke_test"){
      const blocked=pipelineSmokeConfirmationBlock(body);
      if(blocked)return blocked;
      const result=await runAiPipelineSmokeTest();
      return new Response(JSON.stringify({source:"midad_control_room",internal:true,...result}),{status:result.ok?200:502,headers:JSON_HEADERS});
    }
    if(internalAuthorized&&requestAction==="ai_assist"){
      const prompt=cleanText(body?.prompt||"",5000);
      if(!prompt)return new Response(JSON.stringify({ok:false,error:"prompt_required"}),{status:400,headers:JSON_HEADERS});
      const result=await runAiAssist(admin,{...body,prompt});
      return new Response(JSON.stringify({ok:true,source:"midad_control_room",internal:true,...result}),{headers:JSON_HEADERS});
    }

    if(internalAuthorized&&requestAction==="ai_context"){
      const modeRaw=cleanText(body?.mode||"money",30).toLowerCase();
      const mode=["money","opportunity","blueprint","now","tasks","osint","system"].includes(modeRaw)?modeRaw:"money";
      const prompt=cleanText(body?.prompt||"",5000);
      const ctx=await aiFastContext(admin,mode,prompt);
      return new Response(JSON.stringify({
        ok:true,
        source:"midad_control_room",
        neural_contract:{
          version:"neural++-state-contract-v1",
          generated_at:new Date().toISOString(),
          authoritative_source:"supabase_operational_state",
          mode,
          no_implied_consent:true,
          never_start_unaccepted:true,
          lifecycle_rules:NEURAL_LIFECYCLE_RULES,
          evidence_rule:"facts must come from returned state; inference must be labeled"
        },
        ...ctx
      }),{headers:JSON_HEADERS});
    }


    if(typeof body?.telegram_init_data==="string" && body.telegram_init_data){
      const authClient=cleanText(body?.client||req.headers.get("x-midad-client")||"",80);
      const tokenCandidates=await getTelegramBotTokenCandidates(admin,authClient);
      if(!tokenCandidates.length)return new Response(JSON.stringify({error:"telegram_auth_not_configured",client:authClient||"default"}),{status:503,headers:JSON_HEADERS});
      let verified:any=null,matchedBot="";
      for(const candidate of tokenCandidates){
        const result=await verifyTelegramInitData(body.telegram_init_data,candidate.token);
        if(result.ok){verified=result;matchedBot=candidate.label;break;}
        if(result.error!=="telegram_init_data_invalid"){verified=result;break;}
      }
      if(!verified?.ok)return new Response(JSON.stringify({error:verified?.error||"telegram_init_data_invalid"}),{status:401,headers:JSON_HEADERS});
      const telegramUserId=String(verified.user?.id||"");
      if(!telegramUserId)return new Response(JSON.stringify({error:"telegram_user_id_missing"}),{status:401,headers:JSON_HEADERS});
      const {data:telegramAccess}=await admin.from("control_room_access")
        .select("id")
        .eq("active",true)
        .eq("telegram_user_id",telegramUserId)
        .limit(1)
        .maybeSingle();
      if(!telegramAccess)return new Response(JSON.stringify({error:"telegram_user_not_authorized"}),{status:403,headers:JSON_HEADERS});
      const token=crypto.randomUUID()+"-"+crypto.randomUUID(), th=await sha256(token);
      const {error}=await admin.from("control_room_sessions").insert({
        token_hash:th,active:true,telegram_user_id:telegramUserId,telegram_chat_id:telegramUserId,last_used_at:new Date().toISOString()
      });
      if(error)return new Response(JSON.stringify({error:"session_error"}),{status:500,headers:JSON_HEADERS});
      return new Response(JSON.stringify({
        ok:true,token,auth:"telegram_init_data",telegram_user_id:telegramUserId,auth_bot:matchedBot
      }),{headers:JSON_HEADERS});
    }

    if((body?.access_key!==undefined && body?.access_key!==null) || (body?.key!==undefined && body?.key!==null)){
      const accessKey=typeof body?.access_key==="string"?body.access_key:(typeof body?.key==="string"?body.key:"");
      if(!accessKey) return new Response(JSON.stringify({error:"missing_access_key"}),{status:401,headers:JSON_HEADERS});
      const keyHash=await sha256(accessKey);
      const {data:access}=await admin.from("control_room_access").select("id").eq("key_hash",keyHash).eq("active",true).maybeSingle();
      if(!access) return new Response(JSON.stringify({error:"invalid_access_key"}),{status:401,headers:JSON_HEADERS});
      const session=await createControlSession(admin,null,"web_access_key");
      if(!session.ok) return new Response(JSON.stringify({error:session.error}),{status:500,headers:JSON_HEADERS});
      return new Response(JSON.stringify(session),{headers:JSON_HEADERS});
    }

    const token=typeof body?.token==="string"?body.token:"";
    if(!token)return new Response(JSON.stringify({error:"missing_session"}),{status:401,headers:JSON_HEADERS});
    const th=await sha256(token);
    const {data:sess}=await admin.from("control_room_sessions").select("id,active,created_at,last_used_at").eq("token_hash",th).eq("active",true).maybeSingle();
    if(!sess)return new Response(JSON.stringify({error:"session_expired"}),{status:401,headers:JSON_HEADERS});
    const sessionAgeMs=Date.now()-new Date(sess.created_at).getTime();
    if(!Number.isFinite(sessionAgeMs)||sessionAgeMs>30*24*60*60*1000){
      await admin.from("control_room_sessions").update({active:false}).eq("id",sess.id);
      return new Response(JSON.stringify({error:"session_expired"}),{status:401,headers:JSON_HEADERS});
    }
    await admin.from("control_room_sessions").update({last_used_at:new Date().toISOString()}).eq("id",sess.id);

    const action=typeof body?.action==="string"?body.action:(typeof body?.operation==="string"?body.operation:"");
    let result:any;
    if(action==="dashboard_fast") result=await dashboardFast(admin);
    else if(action==="dashboard") result=await dashboard(admin);
    else if(action==="run_opportunity_scan") result=await runOpportunityEngine();
    else if(action==="run_money_scan") result=await runMoneyScan();
    else if(action==="prepare_income_blueprint") result=await prepareIncomeBlueprint(cleanText(body?.opportunity_id,100));
    else if(action==="run_osint_scan") result=await runOsintRouter();
    else if(action==="run_autonomy_now") result=await runAutonomyNow();
    else if(action==="run_archive_canary"){
      if(body?.confirm_text!=="RUN SYNTHETIC CANARY") result={ok:false,state:"BLOCKED",error:"explicit_synthetic_canary_confirmation_required"};
      else result=await runArchiveCanary();
    }
    else if(action==="telegram_webhook_info") result=await telegramWebhookInfo(admin);
    else if(action==="telegram_webhook_router") result=await switchTelegramWebhook(admin,"router");
    else if(action==="telegram_webhook_bot") result=await switchTelegramWebhook(admin,"bot");
    else if(action==="market_edge") result=await runMarketEdge(admin,body);
    else if(action==="noncopy_trade") result=await runNoncopyTrade(body);
    else if(action==="bot_fabric_status") result=await botFabricStatus();
    else if(action==="ugig") result=await runUgig(body);
    else if(action==="outreach_prepare") result=await prepareOutreach(body);
    else if(action==="approval_decide") result=await decideApproval(admin,body);
    else if(action==="run_mining_monitor") result=await runMiningMonitor();
    else if(action==="stackfull_probe") result=await runStackfullProbe(admin,cleanText(body?.domain,240));
    else if(action==="receive_money") result=await receiveMoney(admin,body);
    else if(action==="human_task_update") result=await updateHumanTask(body);
    else if(action==="keys_status") result=await runKeysStatus();
    else if(action==="ai_assist") result=await runAiAssist(admin,body);
    else if(action==="ai_pipeline_smoke_test") {
      const blocked=pipelineSmokeConfirmationBlock(body);
      if(blocked)return blocked;
      result=await runAiPipelineSmokeTest();
    }
    else if(action==="ai_context") {
      const modeRaw=cleanText(body?.mode||"money",30).toLowerCase();
      const mode=["money","opportunity","blueprint","now","tasks","osint","system"].includes(modeRaw)?modeRaw:"money";
      result={
        source:"midad_control_room",
        neural_contract:{
          version:"neural++-state-contract-v1",
          generated_at:new Date().toISOString(),
          authoritative_source:"supabase_operational_state",
          mode,
          no_implied_consent:true,
          never_start_unaccepted:true,
          lifecycle_rules:NEURAL_LIFECYCLE_RULES,
          evidence_rule:"facts must come from returned state; inference must be labeled"
        },
        ...(await aiFastContext(admin,mode,cleanText(body?.prompt||"",5000)))
      };
    }
    else if(action==="mining_status") result=await miningStatus(admin);
    else if(action==="promote_signal") result=await promoteSignal(admin,cleanText(body?.signal_id,80));
    else if(action==="wallet_add") result=await addWallet(admin,body?.payload||{});
    else if(action==="exchange_add") result=await addExchange(admin,body?.payload||{});
    else if(action==="capital_add") result=await addCapital(admin,body?.payload||{});
    else if(action==="trade_add") result=await addTrade(admin,body?.payload||{});
    else if(action.startsWith("ugig_")) result=await runUgig({...body,action:action.slice(5)});
    else if(action==="dashboard_refresh") result=await dashboard(admin);
    else {
      const command=typeof body?.command==="string"?body.command:"";
      if(!command)return new Response(JSON.stringify({error:"missing_action_or_command"}),{status:400,headers:JSON_HEADERS});
      result={reply:await replyFor(admin,command)};
    }
    return new Response(JSON.stringify({ok:true,...result}),{headers:JSON_HEADERS});
  }catch(e){
    return new Response(JSON.stringify({error:"unexpected_error",message:String((e as any)?.message||e).slice(0,500)}),{status:500,headers:JSON_HEADERS});
  }
});