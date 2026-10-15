import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H={"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","access-control-allow-headers":"content-type,authorization,x-midad-ingest-key","access-control-allow-methods":"POST,OPTIONS"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const clip=(x:any,n=4000)=>String(x??"").slice(0,n);

async function getJson(url:string, timeoutMs=8000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"MIDAD-Money-Hunter/2.3"},signal:controller.signal});
    const t=await r.text(); let j:any={}; try{j=JSON.parse(t)}catch{j={raw:t}};
    return {ok:r.ok,status:r.status,data:j};
  }catch(e){
    return {ok:false,status:0,data:{error:String(e?.name||e||"fetch_failed")}};
  }finally{
    clearTimeout(timer);
  }
}

function score(reward:number, applicants:number, freshnessHours:number, crypto:boolean){
  let s=55 + Math.min(28, Math.max(0,reward)*2.2);
  s -= Math.min(18, Math.max(0,applicants)*0.35);
  s += Math.max(0,6-Math.max(0,freshnessHours)/24);
  if(crypto) s+=5;
  return Math.max(50,Math.min(99,Math.round(s*100)/100));
}

function hoursSince(iso:any){
  const t=Date.parse(String(iso||"")); if(!Number.isFinite(t)) return 72;
  return Math.max(0,(Date.now()-t)/3600000);
}

function normalizedCoin(x:any){ return String(x||"").toLowerCase().replace("-","_"); }

function viableCoin(x:any){
  const c=normalizedCoin(x);
  return ["usdc","usdt","usdc_sol","usdc_eth","usdc_pol","usdc_base","eth","sol","btc"].includes(c);
}

function assessRisk(c:any){
  const text=(String(c.title||"")+" "+String(c.description||"")+" "+JSON.stringify(c.evidence||{})).toLowerCase();
  const flags:string[]=[];
  const add=(name:string,re:RegExp)=>{if(re.test(text)) flags.push(name);};
  add("anti_bot_bypass",/anti[- ]?bot\s*(bypass|evasion)|cloudflare[^\n]{0,80}bypass|datadome[^\n]{0,80}bypass/);
  add("captcha_or_human_verification",/captcha|recaptcha|turnstile|anti[- ]?sybil|proof of humanity|human verification/);
  add("credential_or_secret_access",/password|private key|seed phrase|secret key|api key.*provide|credential/);
  add("identity_or_residency_constraint",/u\.s\. resident|us resident|citizen only|residency required|identity verification|kyc/);
  add("account_provisioning",/provide .*platform account|provide .*ai platform accounts|rent .*account|account creation for someone/);
  add("impersonation_or_fraud",/impersonat|fake identity|fraud|stolen|counterfeit|scam/);
  add("unauthorized_access",/bypass .*access|unauthorized access|drainer|wallet connect.*unknown/);
  add("malware_or_exploit_execution",/malware|credential stealer|ransomware/);

  const hardBlock=flags.some(x=>[
    "anti_bot_bypass","credential_or_secret_access","impersonation_or_fraud",
    "unauthorized_access","malware_or_exploit_execution","account_provisioning"
  ].includes(x));
  const riskClass=hardBlock?"RED":flags.length?"AMBER":"GREEN";
  return {
    risk_class:riskClass,
    flags:[...new Set(flags)],
    requires_human_review:riskClass!=="GREEN",
    automation_allowed:riskClass==="GREEN",
    reason:riskClass==="RED"?"Potentially unsafe, unauthorized, or policy-sensitive activity detected":
      riskClass==="AMBER"?"Eligibility, identity, or human-verification conditions require review":
      "No blocked pattern detected"
  };
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:H});
  if(req.method!=="POST") return json({error:"POST required"},405);

  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const expected=Deno.env.get("MIDAD_INGEST_KEY")||"";
  const auth=req.headers.get("authorization")||"";
  const supplied=req.headers.get("x-midad-ingest-key")||"";
  const autonomy=req.headers.get("x-midad-autonomy-key")||"";
  const autonomyKey=Deno.env.get("MIDAD_AUTONOMY_KEY")||"";
  const authorized=serviceKey && (
    auth==="Bearer "+serviceKey ||
    supplied===expected ||
    (autonomyKey && autonomy===autonomyKey)
  );
  if(!authorized) return json({error:"unauthorized"},401);

  const sb=createClient(Deno.env.get("SUPABASE_URL")!,serviceKey);
  const {data:profile}=await sb.from("profiles").select("id").limit(1).maybeSingle();
  if(!profile?.id) return json({error:"no_system_profile"},503);

  // Fail closed for uGig application readiness whenever its live profile is flagged or the account health record is blocked.
  const {data:revenuePolicy}=await sb.from("midad_revenue_policy")
    .select("allow_auto_submission,allow_auto_ugig")
    .eq("owner_scope","midad").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  const {data:ugigHealth,error:ugigHealthError}=await sb.from("midad_platform_accounts")
    .select("account_status,metadata,verification_snapshot")
    .eq("platform_key","ugig").eq("owner_scope","midad").eq("brand_key","midad_ai").maybeSingle();
  const ugigMeta=ugigHealth?.metadata||{};
  const ugigVerification=ugigHealth?.verification_snapshot||{};
  const ugigExternalFlag=ugigMeta.external_profile_is_spam===true ||
    String(ugigMeta.external_profile_status||"").toUpperCase()==="SPAM_REVIEW" ||
    String(ugigVerification.external_profile_is_spam||"").toLowerCase()==="true";
  const ugigHealthBlocked=Boolean(ugigHealthError || !ugigHealth || ugigExternalFlag ||
    ["BLOCKED","SUSPENDED","REJECTED"].includes(String(ugigHealth?.account_status||"").toUpperCase()) ||
    String(ugigMeta.submission_gate||"").toUpperCase()==="BLOCKED");
  const ugigApplicationLaneAllowed=!ugigHealthBlocked &&
    revenuePolicy?.allow_auto_submission===true && revenuePolicy?.allow_auto_ugig===true;

  const started=Date.now();
  const optionalRevenueSourcesEnabled=String(Deno.env.get("MIDAD_ENABLE_OPTIONAL_REVENUE_SOURCES")||"true").toLowerCase()==="true";
  const result:any={source:"midad_money_hunter",version:14,sources:{},created:0,updated:0,skipped:0,reconciled:0,discovered:0,optional_revenue_sources_enabled:optionalRevenueSourcesEnabled,
    ugig_submission_gate:{allowed:ugigApplicationLaneAllowed,account_status:ugigHealth?.account_status||null,blocked:ugigHealthBlocked,reason:ugigHealthError?"account_health_lookup_failed":ugigExternalFlag?"external_profile_flagged_spam":!ugigHealth?"account_health_record_missing":String(ugigHealth?.account_status||"").toUpperCase()==="BLOCKED"?"platform_account_blocked":!revenuePolicy?.allow_auto_submission||!revenuePolicy?.allow_auto_ugig?"policy_paused":null}};
  let engineRunId:string|null=null;
  try{
    const {data:run}=await sb.from("engine_runs").insert({
      user_id:profile.id,
      job_type:"money_hunter",
      status:"running",
      requested_tools:["taskmarket","deskcrew","ugig","moltjobs","basedagents","taskbounty","monetizeyouragent","withagi_signal","agent_souk","opportunities"],
      result:{trigger:"direct_money_hunter"}
    }).select("id").single();
    engineRunId=run?.id||null;
  }catch(_){/* telemetry must never block revenue discovery */}


  try{
    const [tm,dc,ug1,ug2,ug3,ug4,molt,ba,tb,mya,withagi,agentSouk]=await Promise.all([
      getJson("https://api.taskmarket.dev/api/tasks?status=open&sort=reward_desc&limit=50"),
      getJson("https://deskcrew.io/api/arena/contests"),
      getJson("https://ugig.net/api/gigs?listing_type=hiring&page=1&limit=100"),
      getJson("https://ugig.net/api/gigs?listing_type=hiring&page=2&limit=100"),
      getJson("https://ugig.net/api/gigs?listing_type=hiring&page=3&limit=100"),
      getJson("https://ugig.net/api/gigs?listing_type=hiring&page=4&limit=100"),
      getJson("https://api.moltjobs.io/v1/jobs?status=OPEN"),
      getJson("https://api.basedagents.ai/v1/tasks?status=open&limit=50"),
      getJson("https://www.task-bounty.com/api/v1/tasks?state=open&limit=50"),
      optionalRevenueSourcesEnabled?getJson("https://monetizeyouragent.fun/api/v1/jobs?limit=50"):Promise.resolve({ok:false,status:0,data:null,skipped:true}),
      optionalRevenueSourcesEnabled?getJson("https://api-signal.withagi.space/api/v1/bounties"):Promise.resolve({ok:false,status:0,data:null,skipped:true}),
      getJson("https://api.agentsouk.dev/v1/demand")
    ]);

    result.sources={
      taskmarket:{ok:tm.ok,status:tm.status},
      deskcrew:{ok:dc.ok,status:dc.status},
      ugig:{page1:{ok:ug1.ok,status:ug1.status},page2:{ok:ug2.ok,status:ug2.status},page3:{ok:ug3.ok,status:ug3.status},page4:{ok:ug4.ok,status:ug4.status}},
      moltjobs:{ok:molt.ok,status:molt.status},
      basedagents:{ok:ba.ok,status:ba.status},
      taskbounty:{ok:tb.ok,status:tb.status},
      mya:{ok:mya.ok,status:mya.status,skipped:Boolean(mya.skipped)},
      withagi_signal:{ok:withagi.ok,status:withagi.status,skipped:Boolean(withagi.skipped)},
      agent_souk:{ok:agentSouk.ok,status:agentSouk.status}
    };

    const candidates:any[]=[];

    const tasks=Array.isArray(tm.data?.tasks)?tm.data.tasks:[];
    for(const t of tasks){
      const reward=Number(t.reward||t.rewardUsdc||0)/1000000;
      const id=String(t.id||"");
      if(!id||!Number.isFinite(reward)||reward<1) continue;
      const status=String(t.status||"open").toLowerCase();
      if(status!=="open") continue;
      const deadline=t.expiryTime||t.deadline||null;
      const tags=Array.isArray(t.tags)?t.tags:[];
      candidates.push({
        fp:"taskmarket:"+id,source:"taskmarket",
        title:String(t.description||"Taskmarket bounty").slice(0,180),
        description:clip(t.description,2200),reward,netReward:reward*.925,
        chain:"Base",externalId:id,deadline,tags,applicants:Number(t.submissions||t.awardCount||0),
        liveStatus:"open",actionUrl:"https://taskmarket.dev/tasks/"+id,
        evidence:{platform:"Taskmarket",task_id:id,status:t.status,mode:t.mode,tags,requester:t.requester||null,reward_usdc:reward,source_url:"https://api.taskmarket.dev/api/tasks/"+id}
      });
    }

    const bounties=Array.isArray(dc.data?.bounties)?dc.data.bounties:(Array.isArray(dc.data)?dc.data:[]);
    for(const b of bounties){
      const reward=Number(b.bountyUsd||b.rewardUsd||b.reward||0);
      const id=String(b.ticketId||b.id||"");
      if(!id||!Number.isFinite(reward)||reward<1) continue;
      const entrants=Number(b.entrants||0);
      const fee=Number(b.toolPriceUsd||.06);
      candidates.push({
        fp:"deskcrew:"+id,source:"deskcrew",
        title:String(b.subject||b.title||"DeskCrew bounty").slice(0,180),
        description:clip(b.description||b.body||b.subject,2200),
        reward,netReward:Math.max(0,reward*.85-fee),
        chain:String(b.payoutNetwork||"unknown"),externalId:id,
        deadline:b.closingTime||b.decidesAt||null,tags:Array.isArray(b.tags)?b.tags:[],
        applicants:entrants,liveStatus:"open",actionUrl:"https://deskcrew.io/arena",
        evidence:{platform:"DeskCrew",ticket_id:id,bounty_usd:reward,payout_network:b.payoutNetwork||null,entrants,entry_fee_usd:fee,source_url:"https://deskcrew.io/arena"}
      });
    }

    const ugigs=[
      ...(Array.isArray(ug1.data?.gigs)?ug1.data.gigs:[]),
      ...(Array.isArray(ug2.data?.gigs)?ug2.data.gigs:[]),
      ...(Array.isArray(ug3.data?.gigs)?ug3.data.gigs:[]),
      ...(Array.isArray(ug4.data?.gigs)?ug4.data.gigs:[])
    ];
    const seenUg=new Set<string>();
    for(const g of ugigs){
      const id=String(g.id||""); if(!id||seenUg.has(id)) continue; seenUg.add(id);
      if(String(g.status||"").toLowerCase()!=="active") continue;
      if(g.listing_type && String(g.listing_type).toLowerCase()!=="hiring") continue;
      const min=Number(g.budget_min||0), max=Number(g.budget_max||0), reward=max||min;
      const coin=normalizedCoin(g.payment_coin||"");
      if(!(reward>=3)||!viableCoin(coin)) continue;
      const applicants=Number(g.applications_count||0);
      const updated=g.updated_at||g.created_at||null;
      const hours=hoursSince(updated);
      const crypto=coin.startsWith("usdc")||coin==="usdt";
      candidates.push({
        fp:"ugig:"+id,source:"ugig",
        title:String(g.title||"uGig paid work").slice(0,180),
        description:clip(g.description,2400),
        reward,netReward:reward,chain:coin,
        externalId:id,deadline:g.duration||null,
        tags:Array.isArray(g.skills_required)?g.skills_required:[],
        applicants,liveStatus:"open",actionUrl:"https://ugig.net/gigs/"+id,
        score:score(reward,applicants,hours,crypto),
        evidence:{
          platform:"ugig.net",gig_id:id,status:g.status,listing_type:g.listing_type||"hiring",category:g.category||null,
          budget_min:min,budget_max:max,payment_coin:g.payment_coin||null,
          duration:g.duration||null,applications_count:applicants,
          source_url:"https://ugig.net/gigs/"+id
        }
      });
    }

    const moltRows=Array.isArray(molt.data?.data)?molt.data.data:[];
    for(const j of moltRows){
      const reward=Number(j.budgetUsdc||0);
      if(String(j.status||"").toUpperCase()!=="OPEN"||!j.funded||reward<1) continue;
      const id=String(j.id||""); if(!id) continue;
      candidates.push({
        fp:"moltjobs:"+id,source:"moltjobs",
        title:String(j.title||"MoltJobs task").slice(0,180),
        description:clip(j.inputData?.generalDescription||j.title,2200),
        reward,netReward:reward*.95,chain:"USDC/Base",externalId:id,
        deadline:j.deadlineAt||null,tags:Array.isArray(j.requiredSkills)?j.requiredSkills:[],
        applicants:0,liveStatus:"open",actionUrl:"https://moltjobs.io/",
        score:score(reward,0,hoursSince(j.updatedAt||j.createdAt),true),
        evidence:{
          platform:"MoltJobs",job_id:id,status:j.status,funded:true,budget_usdc:reward,
          purpose:j.purpose||null,escrow_tx_hash:j.escrowTxHash||null,
          chain_id:j.chainId||null,token_symbol:j.tokenSymbol||null,
          source_url:"https://api.moltjobs.io/v1/jobs/"+id
        }
      });
    }


    const baRows=Array.isArray(ba.data?.tasks)?ba.data.tasks:(Array.isArray(ba.data)?ba.data:[]);
    for(const t of baRows){
      const id=String(t.id||t.task_id||""); const status=String(t.status||"open").toLowerCase();
      const b=t.bounty||t.reward||{};
      const amountDisplay=Number(b.amount_display??t.amount_display??0)||0;
      const amountAtomic=Number(b.amount_atomic??t.amount_atomic??0)/1000000;
      const reward=amountDisplay||amountAtomic;
      const token=String(b.token||t.token||"USDC").toUpperCase();
      if(!id||status!=="open"||!Number.isFinite(reward)||reward<1) continue;
      const applicants=Number(t.claims_count||t.submissions_count||t.submissions||0)||0;
      const category=String(t.category||t.capability||"agent_task");
      candidates.push({
        fp:"basedagents:"+id,source:"basedagents",title:String(t.title||"BasedAgents task").slice(0,180),
        description:clip(t.description||t.spec||t.instructions,2400),reward,netReward:reward*.98,
        chain:String(b.network||t.network||"eip155:8453"),externalId:id,
        deadline:t.deadline||t.expires_at||null,tags:Array.isArray(t.capabilities)?t.capabilities:[category],
        applicants,liveStatus:"open",actionUrl:"https://basedagents.ai/tasks/"+id,
        score:score(reward,applicants,hoursSince(t.updated_at||t.created_at),true),
        evidence:{
          platform:"BasedAgents",task_id:id,status:t.status,title:t.title||null,
          bounty:{amount_display:amountDisplay||null,amount_atomic:String(b.amount_atomic||t.amount_atomic||""),token,network:b.network||t.network||"eip155:8453"},
          category,capabilities:t.capabilities||[],source_url:"https://api.basedagents.ai/v1/tasks/"+id
        }
      });
    }

    const tbRows=Array.isArray(tb.data?.tasks)?tb.data.tasks:(Array.isArray(tb.data)?tb.data:[]);
    for(const t of tbRows){
      const id=String(t.id||t.task_id||"");
      const status=String(t.status||t.state||"open").toLowerCase();
      const cents=Number(t.bounty_cents??t.reward_cents??0);
      const direct=Number(t.bounty_usd??t.reward_usd??t.reward??t.amount_usd??0);
      const reward=direct || (Number.isFinite(cents)&&cents>0?cents/100:0);
      if(!id||status!=="open"||!Number.isFinite(reward)||reward<1) continue;
      const applicants=Number(t.submissions_count||t.submission_count||t.submissions||0)||0;
      const rails=Array.isArray(t.payout_methods)?t.payout_methods:(Array.isArray(t.payment_methods)?t.payment_methods:[]);
      const crypto=rails.length===0 || rails.some((x:any)=>/usdc|usdt|eth|btc|crypto/i.test(JSON.stringify(x)));
      const language=String(t.language||t.primary_language||"");
      candidates.push({
        fp:"taskbounty:"+id,source:"taskbounty",title:String(t.title||t.name||"TaskBounty bounty").slice(0,180),
        description:clip(t.description||t.summary||t.issue_body,2400),
        reward,netReward:reward*.80,chain:crypto?"USDC/crypto":"USD",externalId:id,
        deadline:t.deadline||t.expires_at||null,tags:Array.isArray(t.tags)?t.tags:(language?[language]:[]),
        applicants,liveStatus:"open",actionUrl:"https://www.task-bounty.com/task/"+id,
        score:score(reward,applicants,hoursSince(t.updated_at||t.created_at),crypto),
        evidence:{
          platform:"TaskBounty",task_id:id,status:t.status||t.state,title:t.title||null,
          bounty_usd:reward,payout_methods:rails,language,github_repo_url:t.github_repo_url||null,
          github_issue_url:t.github_issue_url||null,source_url:"https://www.task-bounty.com/task/"+id
        }
      });
    }

    const withagiRows=Array.isArray(withagi.data?.bounties)?withagi.data.bounties:(Array.isArray(withagi.data)?withagi.data:[]);
    for(const b of withagiRows){
      const id=String(b.id||b.bounty_id||b.task_id||"");
      const status=String(b.status||b.state||"open").toLowerCase();
      const rewardUsd=Number(b.reward_usd??b.bounty_usd??b.usd_value??b.value_usd??0)||0;
      if(!id||!["open","available","unclaimed","active"].includes(status)||rewardUsd<1) continue;
      const applicants=Number(b.claims_count||b.applicants||b.submissions_count||0)||0;
      candidates.push({
        fp:"withagi:"+id,source:"withagi_signal",
        title:String(b.title||b.task_title||"WithAGI bounty").slice(0,180),
        description:clip(b.description||b.detail||b.acceptance_criteria,2400),
        reward:rewardUsd,netReward:rewardUsd*.96,
        chain:String(b.payment_network||b.network||"ETH"),externalId:id,
        deadline:b.deadline||b.expires_at||null,
        tags:Array.isArray(b.tags)?b.tags:(Array.isArray(b.capabilities)?b.capabilities:[]),
        applicants,liveStatus:"open",actionUrl:"https://signal.withagi.space/bounties/"+id,
        score:score(rewardUsd,applicants,hoursSince(b.updated_at||b.created_at),true),
        evidence:{
          platform:"WithAGI The Signal",bounty_id:id,status:b.status||b.state,title:b.title||b.task_title||null,
          reward_usd:rewardUsd,network:b.payment_network||b.network||"ETH",
          source_url:"https://api-signal.withagi.space/api/v1/bounties"
        }
      });
    }

    const demand=agentSouk.data||{};
    const soukRows=Array.isArray(demand.bounties)?demand.bounties:
      Array.isArray(demand.open_bounties)?demand.open_bounties:
      Array.isArray(demand.jobs)?demand.jobs:
      Array.isArray(demand.items)?demand.items:
      [];
    for(const j of soukRows){
      const id=String(j.id||j.job_id||j.bounty_id||"");
      const status=String(j.status||j.state||"open").toLowerCase();
      const rawAmount=j.reward_usdc??j.bounty_usdc??j.price_usdc??j.amount_usdc??j.reward??j.price??0;
      let reward=Number(rawAmount)||0;
      if(reward>10000 && reward%1===0) reward=reward/1000000;
      if(!id||!["open","available","unclaimed","active","posted"].includes(status)||reward<1) continue;
      const applicants=Number(j.applicants||j.claims_count||j.submissions_count||0)||0;
      candidates.push({
        fp:"agentsouk:"+id,source:"agent_souk",
        title:String(j.title||j.name||j.description||"Agent Souk demand").slice(0,180),
        description:clip(j.description||j.prompt||j.requirements||j.input_schema,2400),
        reward,netReward:reward*.97,chain:"USDC/Base",externalId:id,
        deadline:j.deadline||j.expires_at||null,
        tags:Array.isArray(j.tags)?j.tags:(Array.isArray(j.capabilities)?j.capabilities:[]),
        applicants,liveStatus:"open",actionUrl:"https://api.agentsouk.dev/v1/jobs/"+id,
        score:score(reward,applicants,hoursSince(j.updated_at||j.created_at),true),
        evidence:{
          platform:"Agent Souk",job_id:id,status:j.status||j.state,title:j.title||j.name||null,
          reward_usdc:reward,network:"Base",payment:"USDC",
          source_url:"https://api.agentsouk.dev/v1/demand"
        }
      });
    }

    const myaRows=Array.isArray(mya.data?.jobs)?mya.data.jobs:(Array.isArray(mya.data)?mya.data:[]);
    for(const j of myaRows){
      const id=String(j.id||j.job_id||"");
      const status=String(j.status||"open").toLowerCase();
      const rawReward=j.reward??j.reward_usdc??j.bounty??j.payment??"";
      const rewardMatch=String(rawReward).match(/([0-9]+(?:\\.[0-9]+)?)/);
      const reward=Number.isFinite(Number(rawReward))?Number(rawReward):(rewardMatch?Number(rewardMatch[1]):0);
      if(!id||status!=="open"||!Number.isFinite(reward)||reward<1) continue;
      const applicants=Number(j.applications_count||j.applicants||j.claims_count||0)||0;
      candidates.push({
        fp:"mya:"+id,source:"monetizeyouragent",title:String(j.title||j.name||"Monetize Your Agent job").slice(0,180),
        description:clip(j.description||j.summary||j.details,2400),
        reward,netReward:reward*.96,chain:"USDC/Base",externalId:id,
        deadline:j.deadline||j.expires_at||null,tags:Array.isArray(j.skills)?j.skills:(Array.isArray(j.capabilities)?j.capabilities:[]),
        applicants,liveStatus:"open",actionUrl:"https://monetizeyouragent.fun/api/v1/jobs/"+id,
        score:score(reward,applicants,hoursSince(j.updated_at||j.created_at),true),
        evidence:{
          platform:"Monetize Your Agent",job_id:id,status:j.status,title:j.title||j.name||null,
          raw_reward:String(rawReward),network:"Base",payment:"USDC",
          source_url:"https://monetizeyouragent.fun/api/v1/jobs/"+id
        }
      });
    }

    candidates.sort((a,b)=>(Number(b.score||score(b.reward,b.applicants,0,viableCoin(b.chain)))-Number(a.score||0)) || (b.netReward-a.netReward));
    result.discovered=candidates.length;

    for(const c of candidates.slice(0,200)){
      const verifiedAt=new Date().toISOString();
      const risk=assessRisk(c);
      const safeStatus=risk.risk_class==="GREEN"?"money_candidate":"human_review";
      const {data:exists}=await sb.from("opportunities").select("id,status,metadata").eq("fingerprint",c.fp).maybeSingle();

      if(exists){
        const preserved=exists.status==="submitted_waiting"||exists.status==="technical_blocked"||exists.status==="settled";
        const status=preserved?exists.status:safeStatus;
        const metadata={
          ...(exists.metadata||{}),
          origin:"midad_money_hunter_v11",
          funded_signal:true,
          requires_human_gate:true,
          execution_write:false,
          application_ready:c.source==="ugig" && risk.risk_class==="GREEN" && ugigApplicationLaneAllowed,
          risk_class:risk.risk_class,
          risk_flags:risk.flags,
          requires_human_review:risk.requires_human_review,
          automation_allowed:risk.automation_allowed,
          payment_coin:c.evidence?.payment_coin||c.chain||null,
          applicants:c.applicants||0,
          last_verified_at:verifiedAt
        };
        const {error}=await sb.from("opportunities").update({
          status,title:c.title,description:c.description,evidence:c.evidence,
          offer:{reward_usd:c.reward,net_reward_usd:c.netReward,chain:c.chain,external_id:c.externalId,deadline:c.deadline,applicants:c.applicants||0,action_url:c.actionUrl},
          opportunity_type:"paid_work",confidence:.9,expected_value:Math.max(0,c.netReward),
          metadata,score:Number(c.score||score(c.reward,c.applicants,hoursSince(c.evidence?.updated_at),viableCoin(c.chain)))
        }).eq("id",exists.id);
        if(error) result.skipped++; else {result.updated++;if(exists.status!==status)result.reconciled++;}
        continue;
      }

      const s=Number(c.score||score(c.reward,c.applicants,0,viableCoin(c.chain)));
      const {error}=await sb.from("opportunities").insert({
        user_id:profile.id,source:c.source,title:c.title,score:s,status:safeStatus,
        evidence:c.evidence,offer:{reward_usd:c.reward,net_reward_usd:c.netReward,chain:c.chain,external_id:c.externalId,deadline:c.deadline,applicants:c.applicants||0,action_url:c.actionUrl},
        opportunity_type:"paid_work",description:c.description,confidence:.9,expected_value:Math.max(0,c.netReward),
        fingerprint:c.fp,
        metadata:{
          origin:"midad_money_hunter_v11",funded_signal:true,requires_human_gate:true,
          execution_write:false,application_ready:c.source==="ugig" && risk.risk_class==="GREEN" && ugigApplicationLaneAllowed,
          risk_class:risk.risk_class,risk_flags:risk.flags,
          requires_human_review:risk.requires_human_review,automation_allowed:risk.automation_allowed,
          payment_coin:c.evidence?.payment_coin||c.chain||null,
          applicants:c.applicants||0,last_verified_at:verifiedAt
        }
      });
      if(error) result.skipped++; else result.created++;
    }

    result.duration_ms=Date.now()-started;
    if(engineRunId){
      await sb.from("engine_runs").update({
        status:"completed",
        result,
        completed_at:new Date().toISOString(),
        attempt_count:1,
        latency_ms:result.duration_ms,
        providers_used:Object.keys(result.sources||{})
      }).eq("id",engineRunId);
    }
    return json({ok:true,result});
  }catch(e){
    result.error=clip(e);
    result.duration_ms=Date.now()-started;
    if(engineRunId){
      await sb.from("engine_runs").update({
        status:"failed",
        result,
        error:clip(e),
        completed_at:new Date().toISOString(),
        attempt_count:1,
        latency_ms:result.duration_ms,
        providers_used:Object.keys(result.sources||{})
      }).eq("id",engineRunId);
    }
    return json({ok:false,error:clip(e),result},500);
  }
});