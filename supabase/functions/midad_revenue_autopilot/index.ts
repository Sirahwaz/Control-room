import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")||"";
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(URL,KEY);

const H={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"POST,OPTIONS",
  "access-control-allow-headers":"content-type,x-midad-autonomy-key"
};
const json=(v:any,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clip=(v:any,n=500)=>String(v??"").trim().slice(0,n);
const num=(v:any)=>{const x=Number(v);return Number.isFinite(x)?x:0};
function submissionError(x:any){
  return clip(
    x?.error ||
    x?.data?.error ||
    x?.data?.data?.error ||
    x?.message ||
    x?.data?.message ||
    x?.data?.data?.message ||
    "",
    1200
  );
}
function tailoredCoverLetter(o:any,b:any){
  const title=clip(o?.title||b?.title||"this task",180);
  const text=(title+" "+clip(o?.description||"",900)).toLowerCase();
  let fit="";
  let deliverable="";
  if(/claim.?check|fact.?check|source verification|research|primary source|evidence/.test(text)){
    fit="My fit: source verification, primary-source cross-checking, evidence synthesis, and concise cited reporting.";
    deliverable="I will return the verified claim, primary-source basis, citation links, a compact evidence table, and a clear confidence/verdict note.";
  }else if(/security|audit|solidity|smart contract|vulnerability/.test(text)){
    fit="My fit: defensive security review, reproducible findings, severity-based triage, and evidence-backed remediation notes.";
    deliverable="I will provide prioritized findings, reproduction or validation evidence, severity, and actionable remediation notes.";
  }else if(/openapi|swagger|fastapi|flask|api documentation|api/.test(text)){
    fit="My fit: API contract cleanup, OpenAPI consistency checks, examples, and QA validation.";
    deliverable="I will deliver a validated OpenAPI package, endpoint/example checks, and a concise change/QA report.";
  }else if(/csv|json|dataset|pandas|numpy|reconciliation|conversion|data/.test(text)){
    fit="My fit: deterministic data validation, conversion, reconciliation, and tested outputs.";
    deliverable="I will deliver the converted/validated data, test evidence, and a reconciliation note covering important discrepancies.";
  }else if(/python|typescript|javascript|bug|debug|code review|performance/.test(text)){
    fit="My fit: reproducible debugging, code review, testing, and documented fixes.";
    deliverable="I will isolate the issue, implement a scoped fix, run targeted tests, and document the result.";
  }else if(/automation|workflow|n8n|make\b|agent|crm|webhook/.test(text)){
    fit="My fit: API/workflow automation, explicit error handling, and testable handoff.";
    deliverable="I will provide the working flow, integration details, error handling, and a compact acceptance-test record.";
  }else{
    fit="My fit: tightly scoped implementation, testing, evidence-backed delivery, and clear handoff.";
    deliverable="I will define the scope, deliver a testable result, and document the verification evidence.";
  }
  return clip(
    "I can deliver «"+title+"» with a clear scope and verifiable output.\n"+
    fit+"\n"+deliverable+"\n"+
    "I will confirm the acceptance criteria and payment terms before beginning work that exceeds the agreed scope.\n\n"+
    "Delivery: "+clip(o?.offer?.deadline||b?.metadata?.deadline||"24 hours",100)+".\n"+
    "Payment asset: "+clip(o?.offer?.chain||o?.evidence?.payment_coin||"USDC",40)+".\n"+
    "Agent execution is disclosed; the output will be tested and evidence-backed.",
    5000
  );
}

async function authorized(req:Request){
  const auth=req.headers.get("authorization")||"";
  if(KEY && auth==="Bearer "+KEY) return true;
  const k=req.headers.get("x-midad-autonomy-key")||"";
  if(!k) return false;
  const {data,error}=await db.rpc("midad_get_autonomy_key");
  return !error && data && k===String(data);
}

async function policy(){
  const {data}=await db.from("midad_revenue_policy").select("*").eq("owner_scope","midad").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  return data||{
    enabled:false,default_automation:"manual",allow_auto_submission:false,allow_auto_delivery:false,
    min_opportunity_score:80,min_delivery_confidence:.75,max_auto_submissions_per_hour:0,max_auto_submissions_per_day:0
  };
}

async function callInternal(slug:string,body:any){
  const r=await fetch(URL+"/functions/v1/"+slug,{
    method:"POST",
    headers:{"content-type":"application/json","x-midad-autonomy-key":await autonomyKey()},
    body:JSON.stringify(body)
  });
  const t=await r.text(); let data:any={}; try{data=JSON.parse(t)}catch{data={raw:t}};
  return {ok:r.ok,status:r.status,data};
}

async function autonomyKey(){
  const {data,error}=await db.rpc("midad_get_autonomy_key");
  if(error||!data) throw new Error("autonomy_key_unavailable");
  return String(data);
}

async function recordRun(opportunityId:string|null,jobId:string|null,action:string,ok:boolean,result:any,error:string|null=null){
  await db.from("midad_revenue_runs").insert({
    revenue_job_id:jobId||null,
    opportunity_id:opportunityId||null,
    action,actor:"midad_revenue_autopilot",
    ok,
    external_status:result?.status??null,
    request_ref:result?.request_ref||result?.application_id||null,
    result:result||{},
    error:error||null
  });
}

async function submitUGIG(o:any,b:any,jobId:string){
  const gigId=clip(o.offer?.external_id||o.evidence?.gig_id||o.metadata?.external_id,120);
  if(!gigId) return {ok:false,error:"gig_id_missing"};
  const cover=tailoredCoverLetter(o,b);
  const r=await callInternal("midad_ugig_gateway",{
    action:"apply",
    gig_id:gigId,
    cover_letter:cover,
    proposed_rate:num(o.offer?.reward_usd)||undefined,
    proposed_timeline:clip(o.offer?.deadline||o.evidence?.duration||"24 hours",120),
    source:"midad_revenue_autopilot",
    revenue_job_id:jobId
  });
  return {ok:r.ok&&r.data?.ok!==false,status:r.status,data:r.data,gig_id:gigId};
}

async function pollUGIGApplications(){
  const r=await callInternal("midad_ugig_gateway",{action:"applications"});
  if(!r.ok || r.data?.ok===false) return {ok:false,status:r.status,error:r.data?.error||"applications_poll_failed"};

  const apps = Array.isArray(r.data?.applications) ? r.data.applications :
    Array.isArray(r.data?.data?.applications) ? r.data.data.applications :
    Array.isArray(r.data?.results) ? r.data.results : [];

  const byGig=new Map<string,any>();
  for(const a of apps){
    const gigId=String(a?.gig_id||a?.gig?.id||"");
    if(gigId) byGig.set(gigId,a);
  }

  const {data:jobs}=await db.from("midad_revenue_jobs")
    .select("id,opportunity_id,external_ref,state,metadata")
    .eq("platform","ugig")
    .in("state",["IN_PROGRESS","AUTO_ACCEPTED","DELIVERED","PENDING_PAYOUT"])
    .order("updated_at",{ascending:false})
    .limit(100);

  let observed=0,accepted=0,rejected=0,pending=0,unmatched=0,archived=0;
  const changed:any[]=[];

  for(const job of jobs||[]){
    const app=byGig.get(String(job.external_ref||""));
    if(!app){ unmatched++; continue; }

    const status=String(app.status||"").toLowerCase();
    const meta={...(job.metadata||{})};
    meta.application_id=String(app.id||meta.application_id||"");
    meta.application_status=status||String(meta.application_status||"unknown");
    meta.application_updated_at=app.updated_at||meta.application_updated_at||null;
    meta.application_last_observed_at=new Date().toISOString();
    meta.application_observation_source="midad_ugig_gateway:/applications/my";

    let nextAction=job.state==="DELIVERED"?"verify_payout":"poll_application_and_wait_for_acceptance";
    let newState=job.state;

    if(["pending","reviewing","shortlisted"].includes(status)){
      newState="IN_PROGRESS"; pending++;
      nextAction="poll_application_and_wait_for_acceptance";
    }else if(status==="accepted"){
      newState="AUTO_ACCEPTED"; accepted++;
      nextAction="prepare_delivery";
    }else if(["rejected","withdrawn"].includes(status)){
      newState="REJECTED"; rejected++;
      nextAction="close_rejected";
    }else if(["archived","expired","closed"].includes(status)){
      // Closed external applications are terminal for automation; never re-submit them blindly.
      newState="BLOCKED"; archived++;
      nextAction="manual_revalidation";
      meta.blocker_code="UGIG_APPLICATION_ARCHIVED";
      meta.blocker_detail="External application is archived/expired/closed; verify the live gig and account state before any retry.";
    }else if(status===""){
      pending++;
    }

    const {error}=await db.from("midad_revenue_jobs").update({
      state:newState,
      next_action:nextAction,
      metadata:meta,
      blocker_code:newState==="BLOCKED"?"UGIG_APPLICATION_ARCHIVED":null,
      blocker_detail:newState==="BLOCKED"?String(meta.blocker_detail||"Manual revalidation required before retry."):null,
      started_at:job.state==="IN_PROGRESS"||job.state==="AUTO_ACCEPTED"?undefined:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",job.id);

    if(!error){
      observed++;
      if(newState!==job.state || meta.application_status!==String(job.metadata?.application_status||"")){
        changed.push({job_id:job.id,gig_id:job.external_ref,status,new_state:newState,next_action:nextAction});
      }
      if(job.opportunity_id){
        const opportunityStatus=newState==="AUTO_ACCEPTED"?"accepted_waiting_delivery":newState==="REJECTED"?"rejected":newState==="BLOCKED"?"archived":"submitted_waiting";
        await db.from("opportunities").update({status:opportunityStatus,updated_at:new Date().toISOString()}).eq("id",job.opportunity_id);
      }
    }
  }
  return {ok:true,applications:apps.length,matched:observed,accepted,rejected,pending,archived,unmatched,changed};
}


async function processStoredBountyBook(){
  const {data:jobs,error}=await db.from("midad_revenue_jobs")
    .select("id,opportunity_id,external_ref,state,next_action,work_artifacts")
    .eq("platform","bountybook")
    .eq("state","IN_PROGRESS")
    .eq("next_action","submit_stored_deliverable")
    .order("updated_at",{ascending:true})
    .limit(3);
  if(error) return {ok:false,error:error.message,selected:0,submitted:0,failed:0,items:[]};
  let submitted=0,failed=0;
  const items:any[]=[];
  for(const job of jobs||[]){
    const r=await callInternal("midad_bountybook_executor",{
      action:"submit_stored_deliverable",
      job_id:job.external_ref
    });
    await recordRun(job.opportunity_id,job.id,"bountybook_auto_submit",r.ok&&r.data?.ok!==false,r,r.ok?null:clip(r.data?.error||r.status,700));
    if(r.ok&&r.data?.ok!==false){
      submitted++;
      items.push({job_id:job.id,external_ref:job.external_ref,ok:true,result:r.data});
    }else{
      failed++;
      items.push({job_id:job.id,external_ref:job.external_ref,ok:false,error:r.data?.error||r.status});
    }
  }
  return {ok:true,selected:(jobs||[]).length,submitted,failed,items};
}

async function reconcileBountyBook(){
  const {data:jobs,error}=await db.from("midad_revenue_jobs")
    .select("id,opportunity_id,external_ref,state,next_action,payout,metadata")
    .eq("platform","bountybook")
    .in("state",["PENDING_PAYOUT","IN_PROGRESS"])
    .order("updated_at",{ascending:true})
    .limit(20);
  if(error) return {ok:false,error:error.message,checked:0,paid:0,verified:0,items:[]};
  let checked=0,paid=0,verified=0;
  const items:any[]=[];
  for(const job of jobs||[]){
    const r=await callInternal("midad_bountybook_executor",{action:"status",job_id:job.external_ref});
    if(!r.ok||r.data?.ok===false){
      items.push({job_id:job.id,external_ref:job.external_ref,ok:false,error:r.data?.error||r.status});
      continue;
    }
    checked++;
    const ext=r.data.job||{};
    const status=String(ext.status||"").toLowerCase();
    const payoutStatus=String(ext.payout_status||"").toLowerCase();
    let newState=job.state;
    let next=job.next_action;
    if(payoutStatus==="paid" || status==="paid" || status==="verified"){
      newState="PAID"; next="reconcile_revenue"; paid++;
      verified++;
    }else if(["submitted","verifying","in_review"].includes(status)){
      newState="PENDING_PAYOUT"; next="verify_payout";
    }else if(status==="open" && job.state==="PENDING_PAYOUT"){
      newState="READY"; next="repair_or_reclaim";
    }
    const payout={
      ...(job.payout||{}),
      budget_usdc:Number(ext.budget_usdc??job.payout?.budget_usdc??0),
      payout_status:ext.payout_status||job.payout?.payout_status||"none",
      payout_tx_hash:ext.payout_tx_hash||job.payout?.payout_tx_hash||null,
      verification_result:ext.verification_result||job.payout?.verification_result||null
    };
    const meta={
      ...(job.metadata||{}),
      external_status:ext.status||null,
      external_checked_at:new Date().toISOString(),
      external_payout_status:ext.payout_status||null,
      external_verification_result:ext.verification_result||null
    };
    await db.from("midad_revenue_jobs").update({
      state:newState,next_action:next,payout,metadata:meta,
      paid_at:newState==="PAID"?new Date().toISOString():null,
      updated_at:new Date().toISOString()
    }).eq("id",job.id);
    if(newState==="PAID" && job.opportunity_id){
      await db.from("opportunities").update({status:"paid",updated_at:new Date().toISOString()}).eq("id",job.opportunity_id);
    }
    items.push({job_id:job.id,external_ref:job.external_ref,status,new_state:newState,payout_status:payout.payout_status});
  }
  return {ok:true,checked,paid,verified,items};
}

async function processPaidStoreOrders(){
  const revenuePolicy=await policy();
  const {data:intents,error:intentError}=await db.from("midad_payment_intents")
    .select("id,status,amount_fiat,fiat_currency,settlement_asset,network,quoted_crypto_amount,wallet_address,received_tx_hash,verified_at,paid_at,metadata")
    .eq("status","paid")
    .eq("metadata->>created_by","midad_public_checkout_v1")
    .order("paid_at",{ascending:true})
    .limit(50);
  if(intentError) return {ok:false,error:intentError.message,checked:0,opened:0,existing:0,items:[]};

  let checked=0,opened=0,existing=0; const items:any[]=[];
  for(const intent of intents||[]){
    const {data:order,error:orderError}=await db.from("midad_store_orders")
      .select("*").eq("payment_intent_id",intent.id).limit(1).maybeSingle();
    if(orderError || !order) continue;
    checked++;

    if(order.fulfillment_job_id){
      existing++;
      if(order.status==="AWAITING_PAYMENT"){
        await db.from("midad_store_orders").update({
          status:"PAID",
          paid_at:intent.paid_at||new Date().toISOString(),
          updated_at:new Date().toISOString()
        }).eq("id",order.id);
      }
      continue;
    }

    const jobPayload={
      platform:"midad_store",
      external_ref:String(intent.id),
      job_title:String(order.product_name||intent.metadata?.product_name||"MIDAD Store Order"),
      state:"AUTO_ACCEPTED",
      automation_level:"auto",
      started_at:new Date().toISOString(),
      next_action:"fulfill_midad_store_order",
      execution_policy:{
        auto_submission:false,
        auto_delivery:Boolean(revenuePolicy.allow_auto_delivery),
        risk_class:"GREEN",
        source:"midad_public_checkout_v6"
      },
      payment_policy:{
        asset:String(intent.settlement_asset||"USDC"),
        network:String(intent.network||"solana"),
        crypto_first:true,
        inbound_only:true,
        receipt_verified:true,
        auto_withdraw:false,
        auto_trade:false,
        received_tx_hash:intent.received_tx_hash||null
      },
      work_artifacts:{
        product_id:order.product_id,
        product_name:order.product_name,
        customer_name:order.customer_name||null,
        customer_email:order.customer_email||null,
        requirements:order.customer_requirements||"",
        payment_intent_id:intent.id,
        fulfillment_state:"PAID_AWAITING_EXECUTION"
      },
      proof_bundle:{
        payment_status:"verified",
        payment_intent_id:intent.id,
        received_tx_hash:intent.received_tx_hash||null,
        verified_at:intent.verified_at||null,
        wallet_address:intent.wallet_address||null
      },
      payout:{
        revenue_amount_usd:Number(intent.amount_fiat||0),
        payment_asset:intent.settlement_asset||"USDC",
        network:intent.network||"solana",
        realized_revenue:true
      },
      metadata:{
        created_by:"midad_revenue_autopilot_store_v1",
        store_order_id:order.id,
        customer_contact_available:Boolean(order.customer_email||order.customer_name),
        requirements_present:Boolean(order.customer_requirements)
      }
    };

    const {data:job,error:jobError}=await db.from("midad_revenue_jobs")
      .insert(jobPayload).select("id,state,next_action").single();
    if(jobError){
      items.push({order_id:order.id,payment_intent_id:intent.id,ok:false,error:jobError.message});
      continue;
    }

    const {error:updateError}=await db.from("midad_store_orders").update({
      status:"FULFILLING",
      fulfillment_job_id:job.id,
      paid_at:intent.paid_at||new Date().toISOString(),
      updated_at:new Date().toISOString(),
      metadata:{
        ...(order.metadata||{}),
        payment_verified:true,
        payment_intent_id:intent.id,
        received_tx_hash:intent.received_tx_hash||null,
        fulfillment_job_id:job.id
      }
    }).eq("id",order.id);

    if(!updateError){
      await recordRun(null,job.id,"store_paid_order_opened",true,{
        order_id:order.id,
        payment_intent_id:intent.id,
        revenue_job_id:job.id,
        amount_usd:Number(intent.amount_fiat||0),
        asset:intent.settlement_asset||"USDC",
        tx_hash:intent.received_tx_hash||null
      });
      opened++;
      items.push({order_id:order.id,payment_intent_id:intent.id,revenue_job_id:job.id,ok:true});
    }
  }
  return {ok:true,checked,opened,existing,items};
}

async function launchOffers(p:any){
  // Independent account-health hard gate: policy toggles alone must never override an external spam/suspension flag.
  const {data:ugigAccount,error:ugigHealthError}=await db.from("midad_platform_accounts")
    .select("account_status,metadata,verification_snapshot")
    .eq("platform_key","ugig").eq("owner_scope","midad").eq("brand_key","midad_ai").maybeSingle();
  if(ugigHealthError || !ugigAccount) {
    return {selected:0,submitted:0,skipped:0,reason:"ugig_account_health_unavailable_fail_closed"};
  }
  const ugigMetadata=ugigAccount.metadata||{};
  const ugigVerification=ugigAccount.verification_snapshot||{};
  const externalSpamFlag=ugigMetadata.external_profile_is_spam===true ||
    String(ugigMetadata.external_profile_status||"").toUpperCase()==="SPAM_REVIEW" ||
    String(ugigVerification.external_profile_is_spam||"").toLowerCase()==="true";
  if(externalSpamFlag || ["BLOCKED","SUSPENDED","REJECTED"].includes(String(ugigAccount.account_status||"").toUpperCase()) ||
     String(ugigMetadata.submission_gate||"").toUpperCase()==="BLOCKED") {
    return {
      selected:0,submitted:0,skipped:0,
      reason:"ugig_external_account_health_block",
      account_status:ugigAccount.account_status||null,
      external_profile_status:ugigMetadata.external_profile_status||null,
      external_profile_is_spam:Boolean(externalSpamFlag),
      next_action:"obtain_official_platform_clearance_before_reenabling_submissions"
    };
  }
  if(!p.enabled || p.default_automation!=="auto" || !p.allow_auto_submission) return {selected:0,submitted:0,skipped:0,reason:"policy_gate"};
  if(p.allow_auto_ugig===false) return {selected:0,submitted:0,skipped:0,reason:"ugig_channel_paused_by_policy"};
  const since1h=new Date(Date.now()-3600000).toISOString();
  const since1d=new Date(Date.now()-86400000).toISOString();
  const {count:h}=await db.from("midad_revenue_runs").select("id",{count:"exact",head:true}).eq("action","auto_submit_ugig").eq("ok",true).gte("created_at",since1h);
  const {count:d}=await db.from("midad_revenue_runs").select("id",{count:"exact",head:true}).eq("action","auto_submit_ugig").eq("ok",true).gte("created_at",since1d);
  const hourLeft=Math.max(0,num(p.max_auto_submissions_per_hour)-(h||0));
  const dayLeft=Math.max(0,num(p.max_auto_submissions_per_day)-(d||0));
  const limit=Math.min(5,hourLeft,dayLeft);
  if(limit<=0) return {selected:0,submitted:0,skipped:0,reason:"rate_gate",hourly_used:h||0,daily_used:d||0};

  const {data:ops,error}=await db.from("opportunities")
    .select("id,user_id,source,title,score,status,confidence,description,expected_value,offer,evidence,metadata")
    .eq("status","money_candidate")
    .eq("source","ugig")
    .gte("score",num(p.min_opportunity_score)||80)
    .gte("confidence",.75)
    .eq("metadata->>risk_class","GREEN")
    .eq("metadata->>application_ready","true")
    .eq("metadata->>automation_allowed","true")
    .eq("metadata->>requires_human_review","false")
    .eq("metadata->>execution_decision","ELIGIBLE")
    .gte("updated_at",new Date(Date.now()-7*86400000).toISOString())
    .order("score",{ascending:false}).limit(limit*3);
  if(error) throw error;

  let submitted=0,skipped=0; const sample:any[]=[]; const skipReasons:any[]=[];
  for(const o of ops||[]){
    if(submitted>=limit) break;
    // Hard execution boundary: quarantined opportunities must never reach blueprint creation or external submission.
    if(o.metadata?.midad_quarantine?.execution_locked===true){
      skipped++;
      skipReasons.push({opportunity_id:o.id,reason:"safety_quarantine_locked"});
      continue;
    }
    const {data:exists}=await db.from("midad_revenue_jobs")
      .select("id,state,blocker_code,metadata,updated_at")
      .eq("opportunity_id",o.id)
      .order("updated_at",{ascending:false})
      .limit(1)
      .maybeSingle();
    if(exists && String(exists.state||"")!=="BLOCKED"){
      skipped++;
      skipReasons.push({opportunity_id:o.id,reason:"existing_job",state:exists.state});
      continue;
    }
    if(exists && String(exists.state||"")==="BLOCKED" && (
      String(exists.blocker_code||"")==="UGIG_APPLICATION_ARCHIVED" ||
      String(exists.metadata?.blocker_code||"")==="UGIG_APPLICATION_ARCHIVED" ||
      ["archived","expired","closed"].includes(String(exists.metadata?.application_status||"").toLowerCase())
    )){
      skipped++;
      skipReasons.push({opportunity_id:o.id,reason:"external_application_archived_manual_revalidation_required"});
      await db.from("opportunities").update({status:"archived",updated_at:new Date().toISOString()}).eq("id",o.id);
      continue;
    }
    if(exists && String(exists.state||"")==="BLOCKED"){
      await db.from("midad_revenue_jobs").update({
        state:"SUPERSEDED",
        next_action:"retry_with_tailored_submission",
        metadata:{...(exists.metadata||{}),superseded_at:new Date().toISOString()}
      }).eq("id",exists.id);
    }

    const bresp=await callInternal("midad_income_factory",{action:"prepare_blueprint",opportunity_id:o.id});
    if(!bresp.ok || !bresp.data?.ok){skipped++;skipReasons.push({opportunity_id:o.id,reason:"blueprint_failed",detail:bresp.data?.error||bresp.status}); continue;}
    const b=bresp.data.blueprint;

    const gigId=clip(o.offer?.external_id||o.evidence?.gig_id||o.metadata?.external_id,120);
    if(!gigId){skipped++;skipReasons.push({opportunity_id:o.id,reason:"gig_id_missing"});continue;}

    const jobPayload={
      opportunity_id:o.id,
      blueprint_id:b?.id||null,
      platform:"ugig",
      external_ref:gigId,
      job_title:o.title,
      state:"AUTO_ACCEPTED",
      automation_level:"auto",
      execution_policy:{auto_submission:true,auto_delivery:Boolean(p.allow_auto_delivery),risk_class:"GREEN",source:"midad_revenue_autopilot"},
      payment_policy:{asset:o.evidence?.payment_coin||o.offer?.chain||"USDC",crypto_first:true,inbound_only:true,auto_withdraw:false,auto_trade:false},
      work_artifacts:{blueprint_id:b?.id||null,proposal:b?.proposal_draft||null,deliverables:b?.deliverables||[],acceptance_tests:b?.acceptance_tests||[]},
      proof_bundle:{source_url:o.offer?.action_url||o.evidence?.source_url||null,evidence:o.evidence||{}},
      payout:{expected_usd:o.offer?.net_reward_usd||o.offer?.reward_usd||null,payment_asset:o.evidence?.payment_coin||o.offer?.chain||null},
      next_action:"auto_submit_ugig",
      metadata:{created_by:"midad_revenue_autopilot_v1",score:o.score,delivery_confidence:o.metadata?.delivery_confidence||null}
    };
    const {data:job,error:je}=await db.from("midad_revenue_jobs").insert(jobPayload).select("*").single();
    if(je){skipped++;skipReasons.push({opportunity_id:o.id,reason:"job_insert_failed",detail:je.message});continue;}

    const res=await submitUGIG(o,b,job.id);
    await recordRun(o.id,job.id,"auto_submit_ugig",res.ok,res,res.ok?null:submissionError(res));
    if(res.ok){
      submitted++;
      await db.from("midad_revenue_jobs").update({
        state:"IN_PROGRESS",
        started_at:new Date().toISOString(),
        deadline_at:new Date(Date.now()+24*3600000).toISOString(),
        next_action:"poll_application_and_wait_for_acceptance",
        metadata:{
          ...job.metadata,
          submission:res.data||res,
          application_id:res.data?.data?.application?.id||res.data?.application?.id||res.data?.application_id||null,
          application_status:res.data?.data?.application?.status||res.data?.application?.status||"pending",
          application_updated_at:res.data?.data?.application?.updated_at||res.data?.application?.updated_at||new Date().toISOString(),
          application_observed_at:new Date().toISOString()
        }
      }).eq("id",job.id);
      await db.from("opportunities").update({status:"submitted_waiting",updated_at:new Date().toISOString()}).eq("id",o.id);
      sample.push({opportunity_id:o.id,job_id:job.id,score:o.score,gig_id:gigId});
    }else{
      await db.from("midad_revenue_jobs").update({
        state:"BLOCKED",
        blocker_code:"UGIG_SUBMIT_FAILED",
        blocker_detail:submissionError(res),
        next_action:"retry_next_cycle"
      }).eq("id",job.id);
    }
  }
  return {selected:(ops||[]).length,submitted,skipped,sample,skip_reasons:skipReasons};
}

function solRpc(method:string,params:any[]){
  return fetch("https://api.mainnet-beta.solana.com",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:Date.now()+Math.random(),method,params})
  }).then(async r=>({ok:r.ok,data:await r.json()}));
}

function tokenBalances(bal:any[],owner:string){
  const map=new Map<string,{mint:string,decimals:number,raw:number}>();
  for(const x of bal||[]){
    if(String(x.owner||"")!==owner) continue;
    const mint=String(x.mint||"");
    const dec=Number(x.uiTokenAmount?.decimals||0);
    const raw=Number(x.uiTokenAmount?.amount||0);
    if(!mint) continue;
    const cur=map.get(mint)||{mint,decimals:dec,raw:0};
    cur.raw+=raw; cur.decimals=dec; map.set(mint,cur);
  }
  return map;
}

async function watchSolanaWallets(){
  const {data:wallets}=await db.from("midad_wallets")
    .select("id,label,address,chain,purpose,active,watch_only")
    .eq("active",true).eq("chain","solana")
    .in("purpose",["revenue_receiving","SERVICES"]);
  const receipts:any[]=[];
  for(const w of wallets||[]){
    if(!w.address) continue;
    const sigR=await solRpc("getSignaturesForAddress",[w.address,{limit:20,commitment:"finalized"}]);
    const sigs=Array.isArray(sigR.data?.result)?sigR.data.result:[];
    for(const s of sigs){
      if(!s?.signature || s.err) continue;
      const txHash=String(s.signature);
      const {data:already}=await db.from("midad_wallet_receipts").select("id").eq("wallet_id",w.id).eq("tx_hash",txHash).limit(1).maybeSingle();
      if(already) continue;
      const txR=await solRpc("getTransaction",[txHash,{encoding:"jsonParsed",commitment:"finalized",maxSupportedTransactionVersion:0}]);
      const tx=txR.data?.result;
      if(!tx?.meta || tx.meta.err) continue;

      let changes:any[]=[];
      const keys=tx.transaction?.message?.accountKeys||[];
      const idx=keys.findIndex((k:any)=>String(k?.pubkey||k)===String(w.address));
      if(idx>=0){
        const delta=(Number(tx.meta.postBalances?.[idx]||0)-Number(tx.meta.preBalances?.[idx]||0))/1e9;
        if(delta>0) changes.push({asset:"SOL",mint:null,amount:delta,decimals:9,kind:"native_balance_delta"});
      }
      const pre=tokenBalances(tx.meta.preTokenBalances,w.address);
      const post=tokenBalances(tx.meta.postTokenBalances,w.address);
      const mints=new Set<string>([...pre.keys(),...post.keys()]);
      for(const mint of mints){
        const a=pre.get(mint), b=post.get(mint);
        const raw=(b?.raw||0)-(a?.raw||0);
        if(raw<=0) continue;
        const dec=b?.decimals??a?.decimals??0;
        const asset=mint==="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"?"USDC":"SPL:"+mint.slice(0,12);
        changes.push({asset,mint,amount:raw/Math.pow(10,dec),decimals:dec,kind:"token_balance_delta"});
      }

      for(const c of changes){
        const evidence={source:"solana_rpc",commitment:"finalized",slot:tx.slot||null,signature:txHash,independently_verified:true,verifier:"midad_revenue_autopilot",verifier_ref:txHash,watch_only:Boolean(w.watch_only)};
        const {data:receipt,error}=await db.from("midad_wallet_receipts").insert({
          wallet_id:w.id,tx_hash:txHash,asset:c.asset,mint:c.mint||null,network:"solana",
          amount:c.amount,direction:"inbound",slot:tx.slot||null,commitment:"finalized",evidence
        }).select("*").single();
        if(error && !String(error.message).toLowerCase().includes("duplicate")) continue;

        // Match against an unpaid public checkout intent for this exact receiving address and asset.
        if(c.asset==="USDC"){
          const {data:intent}=await db.from("midad_payment_intents")
            .select("*").eq("wallet_address",w.address).eq("settlement_asset","USDC").eq("network","solana")
            .in("status",["quoted","detected"]).gt("expires_at",new Date().toISOString())
            .lte("quoted_crypto_amount",c.amount).order("created_at",{ascending:true}).limit(1).maybeSingle();
          if(intent){
            const observed={payment_intent_id:intent.id,user_id:intent.user_id,event_type:"inbound_finalized",provider:"solana_rpc",tx_hash:txHash,asset:"USDC",network:"solana",observed_amount:c.amount,confirmations:1,evidence,occurred_at:new Date().toISOString()};
            const {data:ev}=await db.from("midad_payment_events").insert(observed).select("*").single();
            await db.from("midad_payment_intents").update({
              status:"paid",reconciliation_status:"matched",received_tx_hash:txHash,
              verified_at:new Date().toISOString(),paid_at:new Date().toISOString(),updated_at:new Date().toISOString()
            }).eq("id",intent.id);
            if(receipt?.id) await db.from("midad_wallet_receipts").update({matched_payment_intent_id:intent.id}).eq("id",receipt.id);
            await recordRun(null,null,"wallet_inbound_verified",true,{payment_intent_id:intent.id,receipt_id:receipt?.id,tx_hash:txHash,asset:"USDC",amount:c.amount,event_id:ev?.id});
          }
        }
        receipts.push({wallet_id:w.id,tx_hash:txHash,asset:c.asset,amount:c.amount,receipt_id:receipt?.id||null});
      }
    }
  }
  return {wallets:(wallets||[]).length,receipts};
}

async function main(req:Request){
  if(req.method==="OPTIONS") return json(null,204);
  if(req.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);
  if(!(await authorized(req))) return json({ok:false,error:"unauthorized"},401);
  try{
    const p=await policy();
    const body=await req.json().catch(()=>({}));
    const action=clip(body.action||"cycle",40);
    if(action==="wallet_watch") return json({ok:true,watch:await watchSolanaWallets()});
    if(action==="poll_applications") return json({ok:true,poll:await pollUGIGApplications()});
    if(action==="reconcile_bountybook") return json({ok:true,reconcile:await reconcileBountyBook()});
    if(action==="process_bountybook") return json({ok:true,process:await processStoredBountyBook(),reconcile:await reconcileBountyBook()});
    if(action==="launch_offers"){
      const poll=await pollUGIGApplications();
      const reconcile=await reconcileBountyBook();
      const store=await processPaidStoreOrders();
      const process=await processStoredBountyBook();
      const launch=await launchOffers(p);
      return json({ok:true,poll,reconcile,store,process,launch});
    }
    if(action==="process_store_orders"){
      const store=await processPaidStoreOrders();
      return json({ok:true,store});
    }
    if(action==="cycle"){
      const poll=await pollUGIGApplications();
      const reconcile=await reconcileBountyBook();
      const store=await processPaidStoreOrders();
      const process=await processStoredBountyBook();
      const launch=await launchOffers(p);
      const watch=await watchSolanaWallets();
      return json({ok:true,service:"midad_revenue_autopilot",version:11,policy:{enabled:p.enabled,automation:p.default_automation,auto_submission:p.allow_auto_submission,auto_delivery:p.allow_auto_delivery,live_trade:Boolean(p.allow_auto_trade),auto_withdraw:Boolean(p.allow_auto_withdraw)},poll,reconcile,store,process,launch,watch});
    }
    if(action==="health") return json({ok:true,service:"midad_revenue_autopilot",version:11,live_trade:false,live_withdrawal:false});
    return json({ok:false,error:"unsupported_action"},400);
  }catch(e){return json({ok:false,error:"revenue_autopilot_error",detail:String(e).slice(0,1000)},500)}
}
Deno.serve(main);