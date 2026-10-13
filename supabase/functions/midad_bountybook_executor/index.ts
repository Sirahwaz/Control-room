import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const BOUNTY="https://api.bountybook.ai";

const json=(v:any,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});

async function autonomyKey(){
  const {data,error}=await db.rpc("midad_get_autonomy_key");
  if(error||!data)throw new Error("autonomy_key_unavailable");
  return String(data);
}
async function authorized(req:Request){
  const a=req.headers.get("authorization")||"";
  if(SERVICE_KEY && a===`Bearer ${SERVICE_KEY}`)return true;
  const k=req.headers.get("x-midad-autonomy-key")||"";
  return !!k && k===await autonomyKey();
}
async function fetchJson(url:string,init:RequestInit={}){
  const r=await fetch(url,init);
  const txt=await r.text();
  let data:any; try{data=txt?JSON.parse(txt):null}catch{data={raw:txt}};
  return {ok:r.ok,status:r.status,data,headers:r.headers};
}
async function nativeSign(message:string,platform="bountybook"){
  const r=await fetch(`${SUPABASE_URL}/functions/v1/midad_native_wallet`,{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${SERVICE_KEY}`},
    body:JSON.stringify({action:"sign_message",chain:"EVM",platform,message})
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.ok)throw new Error(`native_sign_failed:${data.error||r.status}`);
  return data;
}
async function authSession(address:string){
  const n=await fetchJson(`${BOUNTY}/auth/nonce?address=${encodeURIComponent(address)}`);
  if(!n.ok||!n.data?.nonce)throw new Error(`bounty_nonce_${n.status}`);
  const signed=await nativeSign(String(n.data.nonce),"bountybook_auth");
  const v=await fetchJson(`${BOUNTY}/auth/verify`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({address,signature:signed.signature})
  });
  if(!v.ok||!v.data?.token)throw new Error(`bounty_verify_${v.status}`);
  return {token:String(v.data.token),expires_at:v.data.expiresAt||null};
}
async function getAgentAddress(){
  const {data,error}=await db.from("midad_native_signer_accounts").select("address").eq("chain","EVM").eq("status","ACTIVE").limit(1).single();
  if(error||!data?.address)throw new Error("native_evm_signer_unavailable");
  return String(data.address);
}
async function getJob(jobId:string){
  const r=await fetchJson(`${BOUNTY}/jobs/${encodeURIComponent(jobId)}`);
  if(!r.ok)throw new Error(`bounty_job_${r.status}`);
  return r.data;
}
async function ensureRevenueJob(job:any,state:string,extra:any={}){
  const {data:opp}=await db.from("opportunities").select("id").eq("source","bountybook").or(`offer->>external_id.eq.${job.id},evidence->>job_id.eq.${job.id}`).limit(1).maybeSingle();
  const opportunityId=opp?.id||null;
  const row={opportunity_id:opportunityId,platform:"bountybook",external_ref:job.id,job_title:job.title,state,automation_level:"auto",
    execution_policy:{mode:"midad_native_executor",claim:"wallet_auth",submit:"inline_or_cid",financial_transfers:"blocked"},
    payment_policy:{asset:"USDC",network:"Base",escrow:"oracle_verified",withdrawal:"human_gate"},
    payout:{budget_usdc:Number(job.budget_usdc??job.budgetUsdc??0),payout_status:job.payout_status??"none",executor_address:job.executor_address??null},
    metadata:{source:"midad_bountybook_executor",chain_id:job.chain_id||"8453",claimed_at:job.claimed_at||null,...extra},
    blocker_code:null,blocker_detail:null,next_action:state==="IN_PROGRESS"?"build_and_submit":"monitor_status",started_at:state==="IN_PROGRESS"?new Date().toISOString():null};
  const existing=await db.from("midad_revenue_jobs").select("id").eq("external_ref",job.id).eq("platform","bountybook").limit(1).maybeSingle();
  if(existing.data?.id){
    await db.from("midad_revenue_jobs").update(row).eq("id",existing.data.id);
    return existing.data.id;
  }
  const ins=await db.from("midad_revenue_jobs").insert(row).select("id").single();
  if(ins.error)throw new Error("revenue_job_create_failed");
  return ins.data.id;
}
async function claim(jobId:string){
  const address=await getAgentAddress();
  const job=await getJob(jobId);
  if(String(job.status)!=="open"){
    return {ok:false,action:"claim",job_id:jobId,status:"NOT_OPEN",external_status:job.status,executor_address:job.executor_address||null};
  }
  const session=await authSession(address);
  const c=await fetchJson(`${BOUNTY}/jobs/${encodeURIComponent(jobId)}/claim`,{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.token}`},
    body:JSON.stringify({executorAddress:address})
  });
  if(c.status===409){
    const q=await fetchJson(`${BOUNTY}/jobs/${encodeURIComponent(jobId)}/queue`,{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.token}`},
      body:JSON.stringify({agentAddress:address})
    });
    if(q.ok){
      return {ok:true,action:"queue",job_id:jobId,executor_address:address,queue:c.data||q.data};
    }
  }
  if(!c.ok)throw new Error(`bounty_claim_${c.status}:${JSON.stringify(c.data).slice(0,800)}`);
  const claimed=await getJob(jobId);
  const revenueJobId=await ensureRevenueJob(claimed,"IN_PROGRESS",{claim_response:c.data});
  const opps=await db.from("opportunities").select("id,metadata").eq("source","bountybook").or(`offer->>external_id.eq.${jobId},evidence->>job_id.eq.${jobId}`).limit(1);
  if(opps.data?.[0]){
    const md={...(opps.data[0].metadata||{}),claimed:true,claimed_at:new Date().toISOString(),executor_address:address,external_status:claimed.status};
    await db.from("opportunities").update({metadata:md,updated_at:new Date().toISOString()}).eq("id",opps.data[0].id);
    await db.from("midad_first_mover_queue").update({state:"CLAIMED",automation_ready:false,signature_required:false,blocker_code:null,blocker_detail:null,next_action:"build_and_submit",last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("opportunity_id",opps.data[0].id);
  }
  await db.from("midad_revenue_runs").insert({revenue_job_id:revenueJobId,opportunity_id:opps.data?.[0]?.id||null,action:"bountybook_claim",actor:"midad_bountybook_executor",ok:true,external_status:c.status,result:{job_id:jobId,executor_address:address}});
  return {ok:true,action:"claim",job_id:jobId,executor_address:address,revenue_job_id:revenueJobId,external_status:c.status,job:claimed};
}
async function submit(jobId:string,outputData:any,outputCID?:string){
  const address=await getAgentAddress(),job=await getJob(jobId);
  if(job.status!=="claimed"&&job.status!=="in_progress"&&job.status!=="submitted")throw new Error(`job_not_submittable:${job.status}`);
  const session=await authSession(address);
  const body:any={executorAddress:address};
  if(outputCID)body.outputCID=outputCID; else body.outputData=outputData;
  const r=await fetchJson(`${BOUNTY}/jobs/${encodeURIComponent(jobId)}/submit`,{
    method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.token}`},body:JSON.stringify(body)
  });
  if(!r.ok)throw new Error(`bounty_submit_${r.status}:${JSON.stringify(r.data).slice(0,1200)}`);
  const after=await getJob(jobId);
  const rev=await db.from("midad_revenue_jobs").select("id,opportunity_id").eq("platform","bountybook").eq("external_ref",jobId).limit(1).maybeSingle();
  if(rev.data?.id){
    const payoutTxHash=String(after.payout_tx_hash||"");
    let chainReceipt:any=null;
    if(payoutTxHash){
      const {data:receiptRows,error:receiptError}=await db.from("midad_wallet_receipts")
        .select("id,asset,network,mint,direction,amount,commitment,evidence")
        .eq("tx_hash",payoutTxHash).eq("direction","inbound").eq("asset","USDC").eq("network","base").limit(10);
      if(!receiptError)chainReceipt=(receiptRows||[]).find((r:any)=>{
        const ev=r.evidence&&typeof r.evidence==="object"?r.evidence:{};
        return String(r.mint||"").toLowerCase()==="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
          &&String(r.commitment||"").toLowerCase()==="finalized"&&Number(r.amount)>0
          &&ev.independently_verified===true&&ev.token_contract_verified===true&&Number(ev.chain_id)===8453
          &&String(ev.contract_address||"").toLowerCase()==="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
      })||null;
    }
    const externalSaysPaid=after.status==="verified"||after.payout_status==="paid";
    const state=externalSaysPaid&&chainReceipt?"PAID":"PENDING_PAYOUT";
    await db.from("midad_revenue_jobs").update({state,delivered_at:new Date().toISOString(),paid_at:state==="PAID"?new Date().toISOString():null,payout:{budget_usdc:Number(after.budget_usdc??0),payout_status:after.payout_status||"none",payout_tx_hash:payoutTxHash||null,chain_receipt_id:chainReceipt?.id||null,chain_receipt_confirmed:Boolean(chainReceipt),verification_result:after.verification_result||null},proof_bundle:{submission:r.data},next_action:state==="PAID"?"reconcile_revenue":"verify_onchain_receipt"}).eq("id",rev.data.id);
    await db.from("midad_revenue_runs").insert({revenue_job_id:rev.data.id,opportunity_id:rev.data.opportunity_id,action:"bountybook_submit",actor:"midad_bountybook_executor",ok:true,external_status:r.status,result:{job_id:jobId,external_status:after.status,payout_status:after.payout_status||null}});
  }
  return {ok:true,action:"submit",job_id:jobId,executor_address:address,external_status:after.status,payout_status:after.payout_status||"none",verification:after.verification_result||null,result:r.data};
}

async function submitStored(jobId:string){
  const rev=await db.from("midad_revenue_jobs")
    .select("id,platform,external_ref,state,work_artifacts")
    .eq("platform","bountybook").eq("external_ref",jobId).limit(1).maybeSingle();
  if(rev.error||!rev.data) throw new Error("revenue_job_not_found");
  if(!["IN_PROGRESS","READY"].includes(String(rev.data.state))) throw new Error(`revenue_job_not_ready:${rev.data.state}`);
  const files=Array.isArray(rev.data.work_artifacts)?rev.data.work_artifacts:[];
  if(files.length===0) throw new Error("stored_deliverable_missing");
  return await submit(jobId,{files});
}

async function main(req:Request){
  if(!(await authorized(req)))return json({ok:false,error:"unauthorized"},401);
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const b=await req.json().catch(()=>({})),action=String(b.action||"").toLowerCase();
  try{
    if(action==="status"){const job=await getJob(String(b.job_id));return json({ok:true,job});}
    if(action==="claim"){return json(await claim(String(b.job_id)));}
    if(action==="submit"){return json(await submit(String(b.job_id),b.output_data,b.output_cid));}
    if(action==="submit_stored_deliverable"){return json(await submitStored(String(b.job_id)));}
    return json({ok:false,error:"unknown_action"},400);
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},400)}
}
Deno.serve(main);