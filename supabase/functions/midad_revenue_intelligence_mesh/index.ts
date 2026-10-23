import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { qualifyRevenueCandidate, REVENUE_MESH_VERSION, shouldReconcileExpiredOpportunity, toPersistedRevenueGateDecision } from "./revenue_qualification_gates.ts";
import { basedAgentsQualificationEvidence, bountyBookQualificationEvidence, explicitSharedRewardEvidence, extractQualificationEvidence, superteamQualificationEvidence, taskmarketOfficialFeeEvidence } from "./revenue_adapter_qualification.ts";
const DB_URL=Deno.env.get("SUPABASE_DB_URL")||"";
const sql=DB_URL?postgres(DB_URL,{max:2,idle_timeout:5,connect_timeout:10,ssl:"require",prepare:false}):null;
const AGENT="midad_revenue_intelligence_mesh_v1";
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-autonomy-key"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clip=(v:unknown,n=1500)=>String(v??"").slice(0,n);
function db(){if(!sql)throw new Error("supabase_db_url_missing");return sql;}
function num(v:any,f=0){if(v===null||v===undefined||v==="")return f;const n=Number(v);return Number.isFinite(n)?n:f;}
async function secret(name:string){const r=await db()`select decrypted_secret from vault.decrypted_secrets where name=${name} order by updated_at desc limit 1`;return typeof r[0]?.decrypted_secret==="string"?r[0].decrypted_secret:"";}
async function authorized(req:Request){const got=req.headers.get("x-midad-autonomy-key")||"";if(!got)return false;const exp=await secret("midad_autonomy_key");if(!exp)return false;const h=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");return await h(got)===await h(exp);}
async function sha(v:unknown){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(typeof v==="string"?v:JSON.stringify(v)));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");}
async function fetchJson(url:string,extraHeaders:Record<string,string>={}){
 const t=Date.now();
 let last:any={ok:false,status:0,body:null,contentType:"",elapsed:0,excerpt:"",hash:null,error:"fetch_failed"};
 for(let attempt=1;attempt<=2;attempt++){
  try{
   const r=await fetch(url,{headers:{accept:"application/json","user-agent":"MIDAD-Revenue-Intelligence/1.0 read-only",...extraHeaders},signal:AbortSignal.timeout(10000)});
   const raw=await r.text();let body:any=null;try{body=JSON.parse(raw);}catch{}
   last={ok:r.ok,status:r.status,body,contentType:r.headers.get("content-type")||"",elapsed:Date.now()-t,excerpt:clip(raw,900),hash:await sha(raw),error:r.ok?null:clip(body?.message||body?.error||"http_"+r.status,300)};
   if(r.ok || attempt===2 || ![429,502,503,504].includes(r.status)) return last;
  }catch(e){
   last={ok:false,status:0,body:null,contentType:"",elapsed:Date.now()-t,excerpt:"",hash:null,error:clip((e as any)?.message||e,300)};
   if(attempt===2) return last;
  }
  await new Promise(resolve=>setTimeout(resolve,350));
 }
 return last;
}
function dt(v:any):Date|null{if(v===null||v===undefined||v===""||v===0||v==="0")return null;const n=(typeof v==="number"||(typeof v==="string"&&/^\d+$/.test(v)))?Number(v):NaN;const d=Number.isFinite(n)?new Date(n>1e12?n:n*1000):new Date(String(v));return Number.isFinite(d.getTime())?d:null;}
function fit(c:any){const s=(String(c.title||"")+" "+String(c.description||"")+" "+(c.tags||[]).join(" ")+" "+(c.caps||[]).join(" ")).toLowerCase();const words: Array<[string, number]>=[["python",12],["typescript",12],["javascript",9],["api",12],["automation",13],["test",8],["qa",8],["research",8],["data",8],["payment",10],["webhook",8],["json",7],["documentation",5],["technical",5],["mobile",5],["docker",5],["crypto",6],["latency",7],["uptime",7],["csv",6],["svg",5]];let n=22;for(const [w,v] of words)if(s.includes(w))n+=v;return Math.min(100,n);}
function fresh(d:Date|null){if(!d)return 45;const h=(d.getTime()-Date.now())/3600000;if(h<=0)return 0;if(h<6)return 20;if(h<24)return 45;if(h<72)return 70;if(h<168)return 88;return 100;}
function classify(c:any){
 const reasons:string[]=[];
 const exp=c.deadline as Date|null;
 const asset=String(c.asset||"").toUpperCase();
 const amount=num(c.amount,0),cost=num(c.cost,0),bond=num(c.bond,0);
 const fitScore=fit(c);
 const competition=Math.min(100,Math.round(10+Math.log2(Math.max(1,num(c.competition,0))+1)*15));
 const freshness=fresh(exp);
 const payout=Math.max(0,Math.min(100,Math.round(num(c.payoutConfidence,0)*100)));
 let decision="DISCOVERY_ONLY",status="DISCOVERED",next="verify_payout_and_terms",payoutState=c.payoutProofStatus||"unverified";
 if(c.test){decision="DUPLICATE_OR_TEST";status="BLOCKED";next="none";reasons.push("test_or_nonclaimable_listing");}
 else if(exp&&exp.getTime()<=Date.now()){decision="STALE";status="STALE";next="none";reasons.push("deadline_expired");}
 else if(cost>0||bond>0){decision="BLOCKED_UPFRONT_COST";status="BLOCKED";next="no_spend_policy_block";reasons.push(cost>0?"upfront_cost_required":"claim_bond_required");if(bond>0)reasons.push("bond_can_be_slashed_or_lost");}
 else if(!["USDC","USDT","BTC","ETH","SOL","DAI","EURC"].includes(asset)){decision="BLOCKED_PAYOUT";status="BLOCKED";payoutState="blocked";next="verify_listing_specific_crypto_payout";reasons.push("listing_specific_crypto_asset_not_proven");}
 else if(!c.paymentProof){decision="BLOCKED_PAYOUT";status="BLOCKED";next="verify_task_funding_and_settlement";reasons.push("task_specific_funding_or_payment_path_not_proven");}
 else {
  const gate=qualifyRevenueCandidate({
   region_eligible:c.regionEligible===true,
   kyc_status:c.kyc,
   identity_eligible:c.identityEligible===true,
   asset:c.asset,network:c.network,
   gross_usd:amount,
   individual_reward_usd:c.individualRewardUsd,
   payout_split_count:c.payoutSplitCount,
   reward_is_shared_pool:c.rewardIsSharedPool===true,
   platform_fee_usd:num(c.platformFee,0),
   network_fee_usd:num(c.networkFee,0),
   claim_fee_usd:num(c.claimFee,0),
   submission_fee_usd:num(c.submissionFee,0),
   upfront_cost_usd:cost+bond,
   fee_schedule_verified:c.feeScheduleVerified===true,
   acceptance_probability:c.acceptanceProbability,
   payout_confidence:c.payoutConfidence
  });
  if(gate.blockers.length){decision=toPersistedRevenueGateDecision("BLOCKED_ELIGIBILITY_OR_NET");status="BLOCKED";next="verify_eligibility_and_individual_net";reasons.push(...gate.blockers);payoutState="unverified";}
  else {decision="READY_FOR_REVIEW";status="QUALIFIED";next="prepare_execution_plan_operator_review";reasons.push(c.sourceSlug==="taskmarket_api"&&hasConfirmedTaskmarketProof(c.evidenceMeta?.onchain_verification)?"task_specific_usdc_escrow_independently_verified_with_12_confirmations":"crypto_asset_and_task_level_payment_evidence_present_but_external_chain_confirmation_is_separate");}
 }
 const unresolvedSharedPool=(c.rewardIsSharedPool===true||num(c.payoutSplitCount,0)>1)&&!(typeof c.individualRewardUsd==="number"&&Number.isFinite(c.individualRewardUsd)&&c.individualRewardUsd>=0);const net=unresolvedSharedPool?null:Math.round((amount-num(c.platformFee,0)-num(c.networkFee,0)-num(c.claimFee,0)-num(c.submissionFee,0)-cost-bond)*1e6)/1e6;
 let priority=Math.round(fitScore*.42+payout*.31+freshness*.17+(100-competition)*.10);
 if(decision.startsWith("BLOCKED"))priority=Math.min(priority,35);
 if(decision==="STALE"||decision==="DUPLICATE_OR_TEST")priority=0;
 return{decision,status,next,payoutState,reasons,fitScore,competition,freshness,payout,priority,net};
}
async function evidence(runId:string,oppId:string|null,c:any,claim:string,excerpt:string,confidence:number,http:number|null,hash:string|null,kind="public_task_record"){await db()`INSERT INTO public.midad_revenue_intel_evidence(run_id,opportunity_id,source_slug,external_id,evidence_kind,evidence_url,claim,excerpt,confidence,http_status,content_sha256,metadata) VALUES(${runId}::uuid,${oppId}::uuid,${c.sourceSlug},${c.externalId},${kind},${c.sourceUrl||c.url||""},${clip(claim,900)},${clip(excerpt,2300)},${confidence},${http},${hash},${db().json(c.evidenceMeta||{})}::jsonb)`;}
async function save(runId:string,c:any){const d=db(),g=classify(c),ev={extractor:AGENT,raw:c.raw||{},retrieved_at:new Date().toISOString(),payout:{asset:c.asset||null,network:c.network||null,amount:c.amount??null,provider_reported_net_reward_usd:c.providerNetRewardUsd??null,proof_url:c.payoutProofUrl||null,task_specific_payment_signal:Boolean(c.paymentProof),proof_status:g.payoutState,confidence:num(c.payoutConfidence,0),reported_tx_hash:c.tx||null,independent_chain_confirmation:hasConfirmedTaskmarketProof(c.evidenceMeta?.onchain_verification),confirmations:c.evidenceMeta?.onchain_verification?.confirmations??null,onchain_verification:c.evidenceMeta?.onchain_verification??null},costs:{upfront_usd:num(c.cost,0),claim_bond_usd:num(c.bond,0),estimated_fee_usd:num(c.fee,0)},fee_policy:{platform_fee_usd:c.platformFee??null,network_fee_usd:c.networkFee??null,claim_fee_usd:c.claimFee??null,submission_fee_usd:c.submissionFee??null,schedule_verified:c.feeScheduleVerified===true,schedule_evidence_url:c.feeScheduleEvidenceUrl||null},eligibility_policy:{agent_submission_eligible:c.agentSubmissionEligible??null,human_claim_required:c.humanClaimRequired??null,provider_escrow_funded:c.escrowFunded??null,provider_payout_settled:c.payoutIsSettled??null},gates:g.reasons,source_notes:c.notes||[]};const rows=await d`INSERT INTO public.midad_revenue_intel_opportunities(source_slug,external_id,title,description,url,external_status,compensation_amount,compensation_asset,payout_network,payout_class,payout_proof_status,payout_confidence,escrow_funded,payment_tx_hash,payout_proof_url,payout_proof_checked_at,upfront_cost_usd,claim_bond_usd,estimated_fee_usd,estimated_net_usd,estimated_effort_hours,deadline,region_gate,kyc_gate,identity_gate,fit_score,payout_score,freshness_score,competition_score,priority_score,gate_decision,gate_reasons,status,next_action,required_capabilities,evidence,last_seen_at,updated_at)
VALUES(${c.sourceSlug},${c.externalId},${clip(c.title,500)},${clip(c.description,6000)},${c.url||null},${c.externalStatus||null},${c.amount===null?null:num(c.amount)},${c.asset||null},${c.network||null},${c.payoutClass||"UNKNOWN"},${g.payoutState},${num(c.payoutConfidence,0)},${c.escrowFunded??null},${c.tx||null},${c.payoutProofUrl||null},${c.evidenceMeta?.onchain_verification?.checked_at?new Date(c.evidenceMeta.onchain_verification.checked_at):(c.paymentProof?new Date():null)},${num(c.cost,0)},${num(c.bond,0)},${num(c.fee,0)},${c.amount===null?null:g.net},${c.effortHours??null},${c.deadline},${c.region||"unknown"},${c.kyc||"unknown"},${c.identity||"unknown"},${g.fitScore},${g.payout},${g.freshness},${g.competition},${g.priority},${g.decision},string_to_array(${g.reasons.join(String.fromCharCode(31))}, chr(31)),${g.status},${g.next},string_to_array(${(c.caps||[]).join(String.fromCharCode(31))}, chr(31)),${d.json(ev)}::jsonb,now(),now())
ON CONFLICT(source_slug,external_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,url=EXCLUDED.url,external_status=EXCLUDED.external_status,compensation_amount=EXCLUDED.compensation_amount,compensation_asset=EXCLUDED.compensation_asset,payout_network=EXCLUDED.payout_network,payout_class=EXCLUDED.payout_class,payout_proof_status=EXCLUDED.payout_proof_status,payout_confidence=EXCLUDED.payout_confidence,escrow_funded=EXCLUDED.escrow_funded,payment_tx_hash=EXCLUDED.payment_tx_hash,payout_proof_url=EXCLUDED.payout_proof_url,payout_proof_checked_at=COALESCE(EXCLUDED.payout_proof_checked_at,public.midad_revenue_intel_opportunities.payout_proof_checked_at),upfront_cost_usd=EXCLUDED.upfront_cost_usd,claim_bond_usd=EXCLUDED.claim_bond_usd,estimated_fee_usd=EXCLUDED.estimated_fee_usd,estimated_net_usd=EXCLUDED.estimated_net_usd,estimated_effort_hours=EXCLUDED.estimated_effort_hours,deadline=EXCLUDED.deadline,fit_score=EXCLUDED.fit_score,payout_score=EXCLUDED.payout_score,freshness_score=EXCLUDED.freshness_score,competition_score=EXCLUDED.competition_score,priority_score=EXCLUDED.priority_score,gate_decision=EXCLUDED.gate_decision,gate_reasons=EXCLUDED.gate_reasons,status=CASE WHEN public.midad_revenue_intel_opportunities.status IN ('PAID','CLAIMED','IN_PROGRESS','DELIVERED','AWAITING_ACCEPTANCE') THEN public.midad_revenue_intel_opportunities.status ELSE EXCLUDED.status END,next_action=CASE WHEN public.midad_revenue_intel_opportunities.status IN ('PAID','CLAIMED','IN_PROGRESS','DELIVERED','AWAITING_ACCEPTANCE') THEN public.midad_revenue_intel_opportunities.next_action ELSE EXCLUDED.next_action END,required_capabilities=EXCLUDED.required_capabilities,evidence=EXCLUDED.evidence,last_seen_at=now(),updated_at=now()
RETURNING id,source_slug,external_id,title,status,gate_decision,priority_score,estimated_net_usd`;const o=rows[0];await evidence(runId,o.id,c,"Observed live public listing; payment and cost gates are separately recorded.",JSON.stringify({title:c.title,amount:c.amount,asset:c.asset,network:c.network,tx:c.tx,status:c.externalStatus,notes:c.notes||[]}),num(c.payoutConfidence,0),c.httpStatus??200,c.contentHash||null);if(g.decision==="READY_FOR_REVIEW"){const qs=[["payout_verifier","independent_payment_proof","Recheck the current task, asset/network, reported escrow evidence and deadline. A listing field is not independent proof of on-chain settlement; do not claim or submit."],["skill_matcher","capability_match","Match this task to MIDAD's proven coding, API, automation, QA, data and technical research abilities. Do not claim the task."],["execution_planner","delivery_plan","Prepare a bounded work plan, deliverables, acceptance checks and effort estimate. Do not publish, claim, sign or submit externally."]];for(const [role,type,text] of qs)await d`INSERT INTO public.midad_revenue_intel_work_queue(dedupe_key,opportunity_id,agent_role,task_type,status,priority,instructions) VALUES(${c.sourceSlug+":"+c.externalId+":"+type+":v1"},${o.id}::uuid,${role},${type},'QUEUED',${g.priority},${text}) ON CONFLICT(dedupe_key) DO NOTHING`;}else if(g.decision==="BLOCKED_PAYOUT")await d`INSERT INTO public.midad_revenue_intel_work_queue(dedupe_key,opportunity_id,agent_role,task_type,status,priority,instructions,blocker) VALUES(${c.sourceSlug+":"+c.externalId+":payout-recheck:v1"},${o.id}::uuid,'payout_verifier','independent_payment_proof','QUEUED',${Math.max(1,g.priority)},'Find official evidence for exact task-level reward, asset, network and funded payout. Keep blocked if proof is absent.','Task-specific payout proof is missing or not independently verified.') ON CONFLICT(dedupe_key) DO NOTHING`;return{...o,decision:g.decision,reasons:g.reasons};}
function taskmarket(body:any,httpStatus:number){const ts=Array.isArray(body?.tasks)?body.tasks:[];return ts.map((t:any)=>{const splitEvidence=explicitSharedRewardEvidence(t.title,t.description),amount=num(t.netReward,0)/1e6,deadline=dt(t.expiryTime),tx=String(t.escrowTxHash||""),noStake=t.stakeRequired===false||String(t.stakeRequired)==="false",stakeRequired=t.stakeRequired===true||String(t.stakeRequired)==="true",stakeBps=num(t.stakeBps,0),claimBond=stakeRequired?(stakeBps>0?amount*stakeBps/10000:amount):0,open=String(t.status||"").toLowerCase()==="open"&&String(t.phase||"").toLowerCase()==="active"&&t.submissionWindowOpen!==false&&(!deadline||deadline.getTime()>Date.now()),tags=Array.isArray(t.tags)?t.tags.map(String):[],test=/\b(?:do not claim|selfaudit|compatibility probe|test task)\b/i.test(String(t.title||"")+" "+String(t.description||""));return{sourceSlug:"taskmarket_api",sourceUrl:"https://api.taskmarket.dev/api/tasks?status=open&sort=reward_desc&limit=50",externalId:String(t.id||""),title:String(t.title||String(t.description||"").split(/\r?\n/).map((x:string)=>x.trim()).find((x:string)=>x.length>2)||t.referenceCode||"Untitled Taskmarket task"),description:String(t.description||""),url:"https://taskmarket.dev/tasks/"+encodeURIComponent(String(t.id||"")),externalStatus:open?"open":String(t.status||t.phase||"unknown"),amount:amount>0?amount:null,asset:amount>0?"USDC":null,network:"Base",payoutClass:"C1_NATIVE_CRYPTO",payoutProofStatus:tx?"official_crypto_policy":"unverified",payoutConfidence:tx?0.78:0.25,paymentProof:Boolean(open&&amount>0&&tx&&noStake),escrowFunded:null,tx:tx||null,payoutProofUrl:"https://docs.taskmarket.dev/concepts/fees-payments",cost:0,bond:claimBond,fee:0,effortHours:null,deadline,region:"unknown",kyc:"unknown",identity:"unknown",caps:tags,tags,competition:num(t.submissionCount,0),test:test||!open,notes:["Taskmarket feed supplies escrowTxHash; current run did not independently verify the tx on-chain.","Net reward is from the API; the task is competitive and not a guaranteed individual payout.",...(splitEvidence.rewardIsSharedPool?["Task description explicitly splits the USDC pool across multiple answers; do not display pool-level netReward as one entrant’s net payout."]:[]),...(stakeRequired&&stakeBps<=0?["Stake is required but the basis points are absent; estimated bond is conservatively set to the full listed net reward."]:[])],...taskmarketOfficialFeeEvidence(t),...splitEvidence,raw:t,httpStatus,contentHash:null};}).filter((c:any)=>c.externalId&&c.title);}
function based(body:any,httpStatus:number){const ts=Array.isArray(body?.tasks)?body.tasks:[];return ts.map((t:any)=>{const bounty=t.bounty&&typeof t.bounty==="object"?t.bounty:{},amountRaw=t.bounty_amount??bounty.amount_atomic??bounty.amount,amount=num(amountRaw,0)/1e6,token=String(t.bounty_token||bounty.token||"").toUpperCase(),deadline=dt(t.expires_at||t.expired_at),title=String(t.title||""),desc=String(t.description||""),test=/\b(?:selfaudit|do not claim|compatibility probe|test task)\b/i.test(title+" "+desc),has=amount>0&&token==="USDC";return{sourceSlug:"basedagents_api",sourceUrl:"https://api.basedagents.ai/v1/tasks?status=open&limit=50",externalId:String(t.task_id||t.id||""),title:title||"Untitled BasedAgents task",description:desc,url:"https://app.basedagents.ai/tasks/"+encodeURIComponent(String(t.task_id||t.id||"")),externalStatus:String(t.status||"unknown"),amount:has?amount:null,asset:has?token:null,network:has?String(t.bounty_network||bounty.network||"eip155:8453"):"Base",payoutClass:"C1_NATIVE_CRYPTO",payoutProofStatus:"unverified",payoutConfidence:has?0.68:0.25,paymentProof:false,escrowFunded:null,tx:null,payoutProofUrl:"https://registry.basedagents.ai/.well-known/basedagents.json",cost:0,bond:0,fee:0,effortHours:null,deadline,region:"unknown",kyc:"unknown",identity:"unknown",caps:Array.isArray(t.required_capabilities)?t.required_capabilities.map(String):[],tags:Array.isArray(t.required_capabilities)?t.required_capabilities.map(String):[],competition:t.claimed_by_agent_id?1:0,test:test||String(t.status||"")!=="open",notes:has?["Task advertises USDC; task-specific escrow/funding must be confirmed from the official payment endpoint before any claim.","Official docs require a verified payout wallet; they do not establish this user\u2019s region, KYC or identity eligibility."]:["No task-level bounty attached; pay-at-accept funding is not proven in this response."],...basedAgentsQualificationEvidence(t),...extractQualificationEvidence(t,"basedagents_api"),raw:t,httpStatus,contentHash:null};}).filter((c:any)=>c.externalId&&c.title);}

function bountybook(body:any,httpStatus:number){
 const ts=Array.isArray(body?.jobs)?body.jobs:[];
 return ts.map((t:any)=>{
  const id=String(t.id||"");
  const title=String(t.title||"Untitled BountyBook job");
  const desc=String(t.description||"");
  const amount=num(t.budget_usdc,0);
  const chain=String(t.chain_id||"");
  const deadline=dt(t.deadline);
  const status=String(t.status||"");
  const open=status.toLowerCase()==="open"&&!t.flagged&&(!deadline||deadline.getTime()>Date.now());
  const test=/\b(?:do not claim|selfaudit|compatibility probe|test task|synthetic test)\b/i.test(title+" "+desc);
  const tags=Array.isArray(t.tags)?t.tags.map(String):[];
  return {
   sourceSlug:"bountybook_api",sourceUrl:"https://api.bountybook.ai/jobs?status=open&limit=50",
   externalId:id,title,description:desc,url:"https://www.bountybook.ai/job/"+encodeURIComponent(id),
   externalStatus:status,amount:amount>0?amount:null,asset:amount>0&&chain==="8453"?"USDC":null,
   network:chain==="8453"?"Base":(chain||"unknown"),payoutClass:"C1_NATIVE_CRYPTO",
   payoutProofStatus:"unverified",payoutConfidence:0.25,paymentProof:false,escrowFunded:null,
   tx:null,payoutProofUrl:"https://api.bountybook.ai/.well-known/x402",
   cost:0,bond:0,fee:0,effortHours:num(t.estimated_minutes,0)>0?num(t.estimated_minutes)/60:null,
   deadline,region:"unknown",kyc:"unknown",identity:"unknown",
   caps:tags.concat([String(t.job_type||"task")]),tags,competition:0,test:test||!open,
   notes:["Public feed lists the job and budget but does not itself prove this individual job's escrow balance.","BountyBook x402 discovery docs indicate USDC/Base and escrow-at-post by default; task-specific funded escrow must be verified before claim.","Historical payout reliability should be checked separately; no claim or wallet signing is performed."],
   ...extractQualificationEvidence(t,"bountybook_api"),...bountyBookQualificationEvidence(t),raw:t,httpStatus,contentHash:null
  };
 }).filter((c:any)=>c.externalId&&c.title);
}
function taskmarketProofDecision(status:any,hasTransfer:boolean,hasTaskEvent:boolean,confirmations:any){
 const n=Number(confirmations);
 if(String(status||"").toLowerCase()!=="0x1")return{verified:false,reason:"transaction_not_successful",confirmations:Number.isFinite(n)?n:0,required_confirmations:12};
 if(!hasTransfer)return{verified:false,reason:"exact_usdc_escrow_transfer_missing",confirmations:Number.isFinite(n)?n:0,required_confirmations:12};
 if(!hasTaskEvent)return{verified:false,reason:"matching_task_escrow_event_missing",confirmations:Number.isFinite(n)?n:0,required_confirmations:12};
 if(!Number.isFinite(n)||n<12)return{verified:false,reason:"insufficient_confirmations",confirmations:Number.isFinite(n)?n:0,required_confirmations:12};
 return{verified:true,reason:"successful_base_receipt_with_exact_usdc_escrow_transfer_task_id_and_12_confirmations",confirmations:n,required_confirmations:12};
}
function hasConfirmedTaskmarketProof(proof:any){const n=Number(proof?.confirmations);return proof?.verified===true&&Number.isFinite(n)&&n>=12;}
async function verifyTaskmarketReceipt(c:any){
 const tx=String(c.tx||""),taskId=String(c.externalId||"").toLowerCase();
 if(!/^0x[a-f0-9]{64}$/i.test(tx)||!/^0x[a-f0-9]{64}$/i.test(taskId))return{verified:false,reason:"missing_transaction_or_task_id",checked_at:new Date().toISOString()};
 try{
  const rpc="https://mainnet.base.org";
  const res=await fetch(rpc,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_getTransactionReceipt",params:[tx]}),signal:AbortSignal.timeout(7000)});
  const payload=await res.json(),rec=payload?.result;
  if(!res.ok||!rec)return{verified:false,reason:!rec?"receipt_not_found":"rpc_http_"+res.status,checked_at:new Date().toISOString(),rpc_endpoint:rpc};
  const usdc="0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913".toLowerCase(),escrow="0xddc6cc3e4d11c1f3527b867c7dad4ed9869c33f7".toLowerCase(),market="0x8e28bb2c54443f54030ff9f2bc1f1794c017f0ca".toLowerCase();
  const transferTopic="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",taskEventTopic="0x9573067352184cdb0845d8f374abc3145d43ee03be86df46bc054dd12a48ac6d";
  const feeBps=num(c.raw?.platformFeeBps,750),netMicro=BigInt(Math.max(0,Math.round(num(c.raw?.netReward,0))));
  const grossExpected=feeBps<10000?(netMicro*10000n/BigInt(10000-feeBps)):0n,logs=Array.isArray(rec.logs)?rec.logs:[];
  const transfer=logs.find((l:any)=>String(l.address||"").toLowerCase()===usdc&&String(l.topics?.[0]||"").toLowerCase()===transferTopic&&String(l.topics?.[2]||"").toLowerCase()==="0x000000000000000000000000"+escrow.slice(2)&&BigInt(l.data||"0x0")===grossExpected);
  const taskEvent=logs.find((l:any)=>String(l.address||"").toLowerCase()===market&&String(l.topics?.[0]||"").toLowerCase()===taskEventTopic&&String(l.topics?.[1]||"").toLowerCase()===taskId&&BigInt(l.data||"0x0")===grossExpected);
  const latestRes=await fetch(rpc,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:2,method:"eth_blockNumber",params:[]}),signal:AbortSignal.timeout(7000)}),latestPayload=await latestRes.json();
  const latestHex=String(latestPayload?.result||""),receiptHex=String(rec.blockNumber||"");
  if(!latestRes.ok||!/^0x[0-9a-f]+$/i.test(latestHex)||!/^0x[0-9a-f]+$/i.test(receiptHex))return{verified:false,reason:"latest_block_or_receipt_block_unavailable",status:rec.status||null,block_number:rec.blockNumber||null,tx_hash:rec.transactionHash||tx,checked_at:new Date().toISOString(),rpc_endpoint:rpc};
  const latestBlock=BigInt(latestHex),receiptBlock=BigInt(receiptHex),confirmations=latestBlock>=receiptBlock?Number(latestBlock-receiptBlock+1n):0,decision=taskmarketProofDecision(rec.status,Boolean(transfer),Boolean(taskEvent),confirmations);
  return{verified:decision.verified,reason:decision.reason,confirmations,required_confirmations:12,status:rec.status||null,block_number:rec.blockNumber||null,latest_block:latestHex,tx_hash:rec.transactionHash||tx,token_address:transfer?.address||null,escrow_recipient:transfer?.topics?.[2]||null,gross_amount_atomic:grossExpected.toString(),task_id:taskId,task_event_contract:taskEvent?.address||null,checked_at:new Date().toISOString(),rpc_endpoint:rpc};
 }catch(e){return{verified:false,reason:"rpc_verification_error",error:clip((e as any)?.message||e,250),checked_at:new Date().toISOString(),rpc_endpoint:"https://mainnet.base.org"};}
}
function chainBounties(body:any,httpStatus:number,sourceSlug:string,network:string,sourceUrl:string,chainId:number){
 const ts=Array.isArray(body?.bounties)?body.bounties:[];
 return ts.map((t:any)=>{
  const id=String(t.jobId??t.id??"");
  const reward=num(t.reward,0)/1e6;
  const deadline=dt(t.deadline);
  const tags=Array.isArray(t.tags)?t.tags.map(String):[];
  const bondRequired=Boolean(t.requireWorkerBond);
  const bond=bondRequired?Math.max(0.5,reward*0.15):0;
  const open=!t.isTaken&&!t.resolved&&!t.cancelled&&!t.inDispute&&reward>0&&(!deadline||deadline.getTime()>Date.now());
  const contest=Boolean(t.contest);
  const test=/\b(?:selfaudit|do not claim|compatibility probe|test task)\b/i.test(tags.join(" ")+" "+String(t.category||""));
  return {
   sourceSlug,sourceUrl,externalId:id,
   title:String(t.title||((network==="Monad"?"NadBounty":network==="Base"?"BaseBounty":"ArcBounty")+" on-chain bounty #"+id)),
   description:"",url:"https://"+(network==="Monad"?"nadbounty.app":network==="Base"?"www.basebounty.app":"arcbounty.app")+"/bounty/"+encodeURIComponent(id),
   externalStatus:open?"open":t.isTaken?"taken":t.resolved?"resolved":"closed",
   amount:reward>0?reward:null,asset:reward>0?"USDC":null,network,
   payoutClass:"C1_NATIVE_CRYPTO",payoutProofStatus:"unverified",payoutConfidence:0.25,
   paymentProof:false,
   escrowFunded:null,
   tx:null,payoutProofUrl:sourceUrl,
   cost:0,bond,fee:reward*(num(body?.feeBps,100)/10000),
   effortHours:contest?0.15:0.5,deadline,region:"unknown",kyc:"unknown",identity:"unknown",
   caps:tags.concat([String(t.category||""),"USDC",network]),tags,
   competition:num(t.entryCount??t.entriesCount??t.submissionsCount,0),
   test,testOrDuplicate:test,
   notes:["The public endpoint reports listing status and chain ID but does not prove this task has funded escrow.","Task-specific transfer/event or contract funding state has not been independently verified; keep payout blocked until proof exists.","No wallet signature, task claim or submission has been made. Worker bond requirements remain blocked by MIDAD no-upfront-spend policy."],
   ...extractQualificationEvidence(t,sourceSlug),raw:{...t,network,chainId,contest},httpStatus,contentHash:null
  };
 }).filter((c:any)=>c.externalId&&c.title&&c.externalStatus==="open");
}
function superteam(body:any,httpStatus:number,sourceSlug="superteam_agent_api",sourceUrl="https://superteam.fun/api/agents/listings/live?take=50"){const ts=Array.isArray(body?.listings)?body.listings:(Array.isArray(body?.data)?body.data:(Array.isArray(body)?body:[]));return ts.map((t:any)=>{const p=t.compensation||t.payout||{},asset=String(p.asset||p.token||t.payoutAsset||"").toUpperCase(),amount=num(p.amount??t.amount,0),slug=String(t.slug||t.id||"");const url=String(t.url||t.official_listing_url||(slug?"https://superteam.fun/earn/listing/"+slug:""));return{sourceSlug,sourceUrl,externalId:slug,title:String(t.title||"Untitled Superteam listing"),description:String(t.description||t.summary||""),url,externalStatus:String(t.status||"live"),amount:amount>0?amount:null,asset:asset||null,network:String(p.network||t.network||"unknown"),payoutClass:"C2_PROGRAM_CONDITIONAL_CRYPTO",payoutProofStatus:"unverified",payoutConfidence:0.2,paymentProof:false,escrowFunded:null,tx:null,payoutProofUrl:url,cost:0,bond:0,fee:0,effortHours:null,deadline:dt(t.deadline||t.expiresAt||t.expires_at),region:"unknown",kyc:"unknown",identity:"unknown",caps:Array.isArray(t.required_skills)?t.required_skills.map(String):[],tags:Array.isArray(t.required_skills)?t.required_skills.map(String):[],competition:num(t.submissions,0),test:false,notes:["Listing-specific crypto asset, chain, funding, KYC and region terms require direct proof."],...superteamQualificationEvidence(t),...extractQualificationEvidence(t,sourceSlug),raw:t,httpStatus,contentHash:null};}).filter((c:any)=>c.externalId&&c.title&&["open","live","active"].includes(String(c.externalStatus||"").toLowerCase()));}

function immunefiPublicJson(body:any,httpStatus:number,sourceUrl:string,sourceSlug="immunefi"){
 const ts=Array.isArray(body)?body:(Array.isArray(body?.bounties)?body.bounties:(Array.isArray(body?.data)?body.data:[]));
 return ts.map((t:any)=>{
  const slug=String(t.slug||t.id||"");
  const title=String(t.project||t.name||t.title||"Immunefi program "+slug);
  const rewardsText=JSON.stringify(t.rewards||t.reward||t);
  const m=rewardsText.match(/\b(USDC|USDT|BTC|ETH|SOL|DAI|EURC)\b/i);
  const asset=m?m[1].toUpperCase():null;
  const maxRaw=t.maxBounty??t.max_bounty??null;
  const amount=typeof maxRaw==="number"?maxRaw:(Number(String(maxRaw||"").replace(/[$,]/g,""))||0);
  const deadline=dt(t.endDate||t.end_date||t.deadline);
  const open=!deadline||deadline.getTime()>Date.now();
  const url="https://immunefi.com/bug-bounty/"+encodeURIComponent(slug)+"/information/";
  return {sourceSlug,sourceUrl,externalId:slug,title,description:String(t.programType||t.projectType||"Immunefi bug bounty program"),url,externalStatus:open?"open":"closed",amount:asset&&amount>0?amount:null,asset,network:"unknown",payoutClass:"C2_PROGRAM_CONDITIONAL_CRYPTO",payoutProofStatus:"unverified",payoutConfidence:asset?0.35:0.15,paymentProof:false,escrowFunded:null,tx:null,payoutProofUrl:url,cost:0,bond:0,fee:0,effortHours:null,deadline,region:"unknown",kyc:t.kyc===true?"required":"unknown",identity:"eligibility_and_account_check_required",caps:(Array.isArray(t.language)?t.language.map(String):[]).concat(Array.isArray(t.ecosystem)?t.ecosystem.map(String):[]),tags:Array.isArray(t.ecosystem)?t.ecosystem.map(String):[],competition:0,test:!open,notes:["Immunefi-hosted public program index; validate reward, eligibility, region, KYC and scope against the linked official program page.","Maximum bounty is not an expected reward; no task-level funding or payout is proven by this index.","No security testing, report submission, registration or account action is performed."],...extractQualificationEvidence(t,sourceSlug),raw:t,httpStatus,contentHash:null};
 }).filter((c:any)=>c.externalId&&c.title);
}
function officialAirdropJson(body:any,httpStatus:number,sourceSlug:string,sourceUrl:string){
 const ts=Array.isArray(body)?body:(Array.isArray(body?.airdrops)?body.airdrops:(Array.isArray(body?.campaigns)?body.campaigns:(Array.isArray(body?.data)?body.data:[])));
 return ts.map((t:any)=>{
  const id=String(t.id||t.slug||t.campaignId||t.campaign_id||"");
  const title=String(t.title||t.name||t.project||"Official airdrop campaign");
  const status=String(t.status||t.state||"unknown").toLowerCase();
  const deadline=dt(t.deadline||t.endDate||t.end_date||t.expiresAt||t.expires_at);
  const asset=String(t.tokenSymbol||t.token_symbol||t.asset||t.rewardAsset||t.reward_asset||"").toUpperCase();
  const validAsset=["USDC","USDT","BTC","ETH","SOL","DAI","EURC"].includes(asset)?asset:null;
  const fee=num(t.claimFeeUsd??t.claim_fee_usd??t.requiredGasUsd??t.required_gas_usd??t.upfrontCostUsd??t.upfront_cost_usd,0);
  const purchase=Boolean(t.purchaseRequired??t.purchase_required??t.buyRequired??t.buy_required);
  const open=["active","live","open","claimable"].includes(status)&&(!deadline||deadline.getTime()>Date.now());
  const url=String(t.officialUrl||t.official_url||t.url||t.claimUrl||t.claim_url||"");
  return {sourceSlug,sourceUrl,externalId:id,title,description:String(t.description||t.summary||""),url,externalStatus:open?"open":status,amount:null,asset:validAsset,network:String(t.network||t.chain||"unknown"),payoutClass:"C2_PROGRAM_CONDITIONAL_CRYPTO",payoutProofStatus:"unverified",payoutConfidence:validAsset?0.3:0.1,paymentProof:false,escrowFunded:null,tx:null,payoutProofUrl:url,cost:purchase?Math.max(1,fee):fee,bond:0,fee:0,effortHours:null,deadline,region:"unknown",kyc:"unknown",identity:"eligibility_unverified",caps:["airdrop","official_campaign_check"],tags:["airdrop"],competition:0,test:!open,notes:["Airdrop feed is discovery only; confirm the linked official campaign and exact token/network before review.","No purchase, swap, bridge, gas payment, wallet connection or signature is permitted.","A listing or eligibility claim is not proof of a funded distribution."],...extractQualificationEvidence(t,sourceSlug),raw:t,httpStatus,contentHash:null};
 }).filter((c:any)=>c.externalId&&c.title&&c.externalStatus==="open");
}
async function selfTest(){
 const failures:string[]=[];
 const st=superteam({listings:[{slug:"test-live",title:"USDC contest",status:"live",compensation:{amount:25,asset:"USDC"}}]},200);
 if(st.length!==1)failures.push("superteam_live_listing_not_discovered");
 const im=immunefiPublicJson([{slug:"sample",project:"Sample",maxBounty:1000,endDate:null,rewards:[{asset:"USDC"}]}],200,"https://mirror.example/programs.json");
 if(im.length!==1)failures.push("immunefi_program_not_parsed");
 else if(im[0].sourceSlug!=="immunefi")failures.push("immunefi_source_slug_fk_mismatch");
 else if(classify(im[0]).decision!=="BLOCKED_PAYOUT")failures.push("immunefi_without_task_payment_not_blocked");
 const air=officialAirdropJson({airdrops:[{id:"gas-required",title:"Gas required",status:"active",tokenSymbol:"USDC",claimFeeUsd:0.5,officialUrl:"https://example.org/claim"}]},200,"test_airdrop","https://example.org/feed.json");
 if(air.length!==1)failures.push("official_airdrop_not_parsed");
 else if(classify(air[0]).decision!=="BLOCKED_UPFRONT_COST")failures.push("airdrop_upfront_fee_not_blocked");
 const unknown=classify({title:"Unknown reward",asset:null,amount:null,cost:0,bond:0,fee:0,payoutConfidence:0,paymentProof:false,payoutProofStatus:"unverified",deadline:null});
 if(unknown.decision!=="BLOCKED_PAYOUT")failures.push("unknown_asset_not_blocked");
 const tmGood=taskmarketProofDecision("0x1",true,true,12);if(!tmGood.verified)failures.push("taskmarket_12_confirmations_not_accepted");
 const tmLow=taskmarketProofDecision("0x1",true,true,1);if(tmLow.verified||tmLow.reason!=="insufficient_confirmations")failures.push("taskmarket_low_confirmations_not_rejected");
 if(taskmarketProofDecision("0x0",true,true,100).verified)failures.push("taskmarket_reverted_receipt_not_rejected");
 if(taskmarketProofDecision("0x1",false,true,100).verified)failures.push("taskmarket_missing_usdc_transfer_not_rejected");
 if(taskmarketProofDecision("0x1",true,false,100).verified)failures.push("taskmarket_missing_task_event_not_rejected");
 if(hasConfirmedTaskmarketProof({verified:true,confirmations:11}))failures.push("summary_below_confirmation_threshold");
 if(!hasConfirmedTaskmarketProof({verified:true,confirmations:12}))failures.push("summary_at_confirmation_threshold");
 const chain=chainBounties({chainId:8453,feeBps:100,bounties:[{id:"live-but-unproven",reward:5000000,isTaken:false,resolved:false,cancelled:false,inDispute:false,deadline:0,requireWorkerBond:false}]},200,"basebounty_api","Base","https://www.basebounty.app/api/bounties",8453);
 if(chain.length!==1||chain[0].paymentProof!==false||classify(chain[0]).decision!=="BLOCKED_PAYOUT")failures.push("chain_bounty_without_funding_evidence_not_blocked");
 return {ok:failures.length===0,tests:15,failures,scope:"deterministic parser and payout-gate regression tests; no external writes"};
}

async function discover(){const d=db();const feedRows=await d`SELECT slug,api_url AS url,metadata->>'revenue_intel_parser' AS parser_key,coalesce((metadata->>'max_items')::int,50) AS max_items,metadata->>'payout_network' AS payout_network,nullif(metadata->>'chain_id','')::int AS chain_id FROM public.midad_income_sources WHERE api_url IS NOT NULL AND metadata ? 'revenue_intel_parser' AND status LIKE 'active_discovery%' ORDER BY priority DESC LIMIT 20`;const feeds=feedRows.filter((f:any)=>['taskmarket','basedagents','bountybook','chain_bounties','immunefi_public_json','official_airdrop_json','superteam'].includes(String(f.parser_key||'')));const rr=await d`INSERT INTO public.midad_revenue_intel_runs(run_mode,status,sources_requested,started_at) VALUES('discover','running',${feeds.length},now()) RETURNING id`;const run=String(rr[0].id);const outcomes:any[]=[],errors:any[]=[],seen:any[]=[];let ok=0,up=0,ready=0,blockedCost=0,stale=0;for(const f of feeds){const parser=String(f.parser_key||"");const authHeaders:Record<string,string>={};if(parser==="superteam"){const k=await secret("midad:platform:superteam_fun:agent_api_key:e2c812f6-9416-42b4-aae3-73b2ed792baf");if(k)authHeaders.authorization="Bearer "+k;}const r=await fetchJson(f.url,authHeaders);outcomes.push({source:f.slug,ok:r.ok,http_status:r.status,elapsed_ms:r.elapsed,error:r.error});if(!r.ok||!r.body){errors.push({source:f.slug,http_status:r.status,error:r.error});await evidence(run,null,{sourceSlug:f.slug,externalId:"__feed__",sourceUrl:f.url,url:f.url,evidenceMeta:{content_type:r.contentType,elapsed_ms:r.elapsed,error:r.error}},"Public feed fetch failed for this run.",r.excerpt,0,r.status||null,r.hash,"feed_fetch_failure");await d`UPDATE public.midad_income_sources SET metadata=metadata||${d.json({last_feed_http_status:r.status,last_feed_error:r.error,last_feed_checked_at:new Date().toISOString()})}::jsonb,updated_at=now() WHERE slug=${f.slug}`;continue;}ok++;const candidates=parser==="taskmarket"?taskmarket(r.body,r.status):parser==="basedagents"?based(r.body,r.status):parser==="bountybook"?bountybook(r.body,r.status):parser==="chain_bounties"?chainBounties(r.body,r.status,String(f.slug),String(f.payout_network||"unknown"),String(f.url),Number(f.chain_id||0)):parser==="immunefi_public_json"?immunefiPublicJson(r.body,r.status,String(f.url),String(f.slug)):parser==="official_airdrop_json"?officialAirdropJson(r.body,r.status,String(f.slug),String(f.url)):parser==="superteam"?superteam(r.body,r.status,String(f.slug),String(f.url)):[];await d`UPDATE public.midad_income_sources SET last_verified_at=now(),metadata=metadata||${d.json({last_feed_http_status:r.status,last_feed_error:null,last_feed_checked_at:new Date().toISOString(),last_feed_count:candidates.length})}::jsonb,updated_at=now() WHERE slug=${f.slug}`;for(const c of candidates.slice(0,Math.max(1,Math.min(50,num(f.max_items,50))))){try{c.contentHash=await sha(c.raw||{});if(c.sourceSlug==="nadbounty_api"&&c.raw?.ipfsDescHash){const detail=await fetchJson("https://nadbounty.app/api/nad/bounties/"+encodeURIComponent(String(c.externalId))+"?full=1");if(detail.ok&&detail.body){const bb=detail.body.bounty||{};c.competition=Array.isArray(detail.body.entries)?detail.body.entries.length:c.competition;c.evidenceMeta={...(c.evidenceMeta||{}),onchain_detail:{chainId:detail.body.chainId,contractVersion:detail.body.contractVersion,sourceBlock:detail.body.sourceBlock,entries:c.competition,contestState:detail.body.contestState}};}const cid=String(c.raw.ipfsDescHash).replace(/^ipfs:\/\//,"");const spec=await fetchJson("https://gateway.pinata.cloud/ipfs/"+encodeURIComponent(cid));if(spec.ok&&spec.body){c.title=String(spec.body.title||c.title);c.description=String(spec.body.description||"");c.evidenceMeta={...(c.evidenceMeta||{}),task_spec_url:"https://gateway.pinata.cloud/ipfs/"+cid,task_spec_version:spec.body.version||null};}}if(c.sourceSlug==="taskmarket_api"&&c.tx){const proof=await verifyTaskmarketReceipt(c);c.evidenceMeta={...(c.evidenceMeta||{}),onchain_verification:proof};if(proof.verified){c.paymentProof=true;c.escrowFunded=true;c.payoutProofStatus="verified_task_escrow";c.payoutConfidence=1;c.payoutProofUrl="https://basescan.org/tx/"+c.tx;c.notes=[...(c.notes||[]),"Direct Base RPC verified successful receipt, exact USDC transfer into Taskmarket escrow wallet, and matching task-ID escrow event."];}else{c.paymentProof=false;c.escrowFunded=null;c.payoutProofStatus="unverified";c.payoutConfidence=0.25;c.notes=[...(c.notes||[]),"Taskmarket transaction proof did not satisfy all direct Base RPC escrow checks."];}}const saved=await save(run,c);seen.push(saved);up++;if(saved.decision==="READY_FOR_REVIEW")ready++;if(saved.decision==="BLOCKED_UPFRONT_COST")blockedCost++;if(saved.decision==="STALE")stale++;}catch(e){errors.push({source:f.slug,external_id:c.externalId,error:clip((e as any)?.message||e,300)});}}}
let staleReconciled=0;const expiredRows=await d`SELECT id,deadline,gate_decision,status FROM public.midad_revenue_intel_opportunities WHERE gate_decision='READY_FOR_REVIEW' AND upper(status)='QUALIFIED' AND deadline IS NOT NULL AND deadline<=now() ORDER BY deadline ASC LIMIT 500`;for(const row of expiredRows){if(!shouldReconcileExpiredOpportunity(row,new Date()))continue;const changed=await d`UPDATE public.midad_revenue_intel_opportunities SET gate_decision='STALE',status='STALE',next_action='none',priority_score=0,estimated_net_usd=NULL,gate_reasons=CASE WHEN 'deadline_expired'=ANY(gate_reasons) THEN gate_reasons ELSE array_append(gate_reasons,'deadline_expired') END,updated_at=now() WHERE id=${row.id}::uuid AND gate_decision='READY_FOR_REVIEW' AND upper(status)='QUALIFIED' AND deadline IS NOT NULL AND deadline<=now() RETURNING id`;staleReconciled+=changed.length;}stale+=staleReconciled;const summary={feeds:outcomes,scope:"public read-only discovery only",actions_taken:["live GET","deduplicated upsert","payout and upfront-cost gates","expired READY_FOR_REVIEW reconciliation","evidence ledger","specialist task queue"],actions_not_taken:["no registration","no claim","no external submission","no public application","no wallet signature","no purchase"],expired_ready_reconciled:staleReconciled,top_candidates:seen.filter(x=>x.decision==="READY_FOR_REVIEW").sort((a,b)=>num(b.priority_score)-num(a.priority_score)).slice(0,12)};
await d`UPDATE public.midad_revenue_intel_runs SET status=${errors.length===0?"completed":(ok>0?"partial":"failed")},sources_succeeded=${ok},candidates_seen=${seen.length},candidates_upserted=${up},payout_gate_pass=${ready},cost_gate_block=${blockedCost},stale_or_invalid=${stale},summary=${d.json(summary)}::jsonb,errors=${d.json(errors)}::jsonb,completed_at=now() WHERE id=${run}::uuid`;
return{ok:ok>0,service:"midad_revenue_intelligence_mesh",version:REVENUE_MESH_VERSION,run_id:run,sources_requested:feeds.length,sources_succeeded:ok,candidates_upserted:up,ready_for_review:ready,blocked_upfront_cost:blockedCost,stale_or_invalid:stale,feeds:outcomes,errors,top_candidates:summary.top_candidates};}
async function health(){const r=await db()`SELECT (SELECT count(*)::int FROM public.midad_revenue_intel_opportunities) AS opportunities,(SELECT count(*)::int FROM public.midad_revenue_intel_opportunities WHERE gate_decision='READY_FOR_REVIEW') AS ready_for_review,(SELECT count(*)::int FROM public.midad_revenue_intel_opportunities WHERE gate_decision='BLOCKED_UPFRONT_COST') AS blocked_upfront,(SELECT count(*)::int FROM public.midad_revenue_intel_opportunities WHERE gate_decision='BLOCKED_PAYOUT') AS blocked_payout,(SELECT count(*)::int FROM public.midad_revenue_intel_evidence) AS evidence_rows,(SELECT count(*)::int FROM public.midad_revenue_intel_work_queue WHERE status='QUEUED') AS queued_specialist_tasks,(SELECT count(*)::int FROM public.midad_revenue_intel_runs) AS runs,(SELECT max(created_at) FROM public.midad_revenue_intel_runs) AS latest_run`;return{ok:true,service:"midad_revenue_intelligence_mesh",version:REVENUE_MESH_VERSION,counts:r[0]||{},scope:"read-only discovery; never claims, signs or purchases"};}
async function queueView(){const r=await db()`SELECT w.id,w.agent_role,w.task_type,w.status,w.priority,w.instructions,w.blocker,w.created_at,o.source_slug,o.external_id,o.title,o.url,o.compensation_amount,o.compensation_asset,o.payout_network,o.gate_decision,o.priority_score,o.gate_reasons FROM public.midad_revenue_intel_work_queue w JOIN public.midad_revenue_intel_opportunities o ON o.id=w.opportunity_id WHERE w.status IN ('QUEUED','NEEDS_OPERATOR','BLOCKED') ORDER BY w.priority DESC,w.created_at LIMIT 100`;return{ok:true,count:r.length,items:r};}
Deno.serve(async req=>{if(req.method==="OPTIONS")return new Response("ok",{headers:H});if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);try{if(!(await authorized(req)))return json({ok:false,error:"unauthorized"},401);}catch{return json({ok:false,error:"auth_check_failed"},500);}let body:any={};try{body=await req.json();}catch{}try{const a=String(body?.action||"discover");if(a==="health")return json(await health());if(a==="queue")return json(await queueView());if(a==="self_test")return json(await selfTest());if(a==="discover"||a==="refresh")return json(await discover());return json({ok:false,error:"unsupported_action",supported_actions:["health","discover","refresh","queue","self_test"]},400);}catch(e){return json({ok:false,service:"midad_revenue_intelligence_mesh",version:REVENUE_MESH_VERSION,error:clip((e as any)?.message||e,700)},500);}});
