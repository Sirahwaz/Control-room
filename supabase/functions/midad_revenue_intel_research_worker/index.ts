import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
const VERSION = 8;
const DB_URL=Deno.env.get("SUPABASE_DB_URL")||"";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const sql=DB_URL?postgres(DB_URL,{max:2,idle_timeout:5,connect_timeout:10,ssl:"require",prepare:false}):null;
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-autonomy-key"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clip=(v:unknown,n=1000)=>String(v??"").slice(0,n);
function db(){if(!sql)throw new Error("supabase_db_url_missing");return sql;}
async function secret(name:string){const r=await db()`select decrypted_secret from vault.decrypted_secrets where name=${name} order by updated_at desc limit 1`;return typeof r[0]?.decrypted_secret==="string"?r[0].decrypted_secret:"";}
async function authOK(req:Request){const got=req.headers.get("x-midad-autonomy-key")||"";if(!got)return false;const expected=await secret("midad_autonomy_key");if(!expected)return false;const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,"0")).join("");return await hash(got)===await hash(expected);}
async function health(){const rows=await db()`SELECT
 (SELECT count(*)::int FROM public.midad_research_queue q JOIN public.midad_research_runs p ON p.id=q.source_run_id WHERE p.query LIKE 'MIDAD Revenue Intelligence Mesh:%' AND q.status='QUEUED') AS queued,
 (SELECT count(*)::int FROM public.midad_research_queue q JOIN public.midad_research_runs p ON p.id=q.source_run_id WHERE p.query LIKE 'MIDAD Revenue Intelligence Mesh:%' AND q.status='RUNNING') AS running,
 (SELECT count(*)::int FROM public.midad_research_queue q JOIN public.midad_research_runs p ON p.id=q.source_run_id WHERE p.query LIKE 'MIDAD Revenue Intelligence Mesh:%' AND q.status='COMPLETED') AS completed,
 (SELECT count(*)::int FROM public.midad_research_queue q JOIN public.midad_research_runs p ON p.id=q.source_run_id WHERE p.query LIKE 'MIDAD Revenue Intelligence Mesh:%' AND q.status='FAILED') AS failed,
 (SELECT max(q.created_at) FROM public.midad_research_queue q JOIN public.midad_research_runs p ON p.id=q.source_run_id WHERE p.query LIKE 'MIDAD Revenue Intelligence Mesh:%') AS latest_task`;
 return {ok:true,service:"midad_revenue_intel_research_worker",version:VERSION,counts:rows[0]||{},mode:"one public-source research task per invocation"};
}
async function processOne(){
 const d=db();
 const claimed=await d.begin(async tx=>{
  const rows=await tx`SELECT q.id,q.query,q.reason,q.source_run_id,q.priority,q.uncertainty_score,q.novelty_score,q.value_score,q.attempts,q.metadata,p.query AS program_query
   FROM public.midad_research_queue q
   JOIN public.midad_research_runs p ON p.id=q.source_run_id
   WHERE p.query LIKE 'MIDAD Revenue Intelligence Mesh:%' AND q.status='QUEUED'
   ORDER BY q.priority DESC,q.value_score DESC,q.novelty_score DESC,q.created_at ASC
   LIMIT 1 FOR UPDATE OF q SKIP LOCKED`;
  if(!rows.length)return null;
  const task=rows[0];
  await tx`UPDATE public.midad_research_queue SET status='RUNNING',attempts=attempts+1,started_at=now(),metadata=metadata || '{"worker":"midad_revenue_intel_research_worker_v1","execution":"public_source_research"}'::jsonb WHERE id=${task.id}`;
  await tx`UPDATE public.midad_research_runs SET status='running',started_at=coalesce(started_at,now()),updated_at=now() WHERE id=${task.source_run_id}`;
  return {...task,attempts:Number(task.attempts||0)+1};
 });
 if(!claimed)return {ok:true,service:"midad_revenue_intel_research_worker",version:VERSION,processed:false,reason:"no_queued_mesh_research"};
 const autonomyKey=await secret("midad_autonomy_key");
 if(!autonomyKey)throw new Error("midad_autonomy_key_missing");
 const role=String(claimed.metadata?.agent_role||"");
 const policies=role==="mining_provider_scout"?" Official provider evidence only: free/no-deposit withdrawable crypto, asset/network, minimum/fees, region/KYC and referral/account rules. Require explicit official permission for API/browser automation AND commercial use; otherwise exclude. No signups, claims, deposits, wallet signing, CAPTCHA bypass or unproven payout claims.":" Official/public sources only; report dated URLs, exact crypto asset/network, task-level payment/escrow proof, fees, KYC/region, upfront bonds and uncertainty. No accounts, submissions, claims, paid API calls or wallet signing."; 
 const rawQuestion=String(claimed.query||"");
 const prompt=(rawQuestion.slice(0,Math.max(120,480-policies.length))+policies).slice(0,500);
 const urlsByRole:Record<string,string[]>={
  market_source_scout:[],
  source_registry_auditor:[],
  payout_verifier:["https://jobbi.org/gigs.json?lane=agent&currency=USDC&limit=50","https://jobbi.org/gigs.json?lane=agent&currency=BTC&limit=50","https://www.task-force.app/docs/api","https://payapi.market/faq","https://taskerdata.com/terms-and-conditions","https://www.silencio.network/payout-rewards-terms","https://loopuman.com/browse-tasks","https://collaborators.build/"],
  payment_auditor:["https://payapi.market/faq","https://payapi.market/","https://www.task-force.app/docs/api","https://loopuman.com/browse-tasks","https://taskerdata.com/terms-and-conditions","https://www.silencio.network/payout-rewards-terms","https://www.j4c.app/how-escrow-works","https://docs.openx402.ai/building-a-server"],
  multichain_source_scout:["https://nadbounty.app/api/nad/bounties","https://www.basebounty.app/api/v1/bounties?status=open","https://arcbounty.app/api/v1/bounties?status=open","https://jobbi.org/gigs.json?lane=agent&currency=USDC&limit=50","https://jobbi.org/gigs.json?lane=agent&currency=BTC&limit=50","https://collaborators.build/","https://www.task-force.app/docs/api","https://loopuman.com/browse-tasks"],
  x402_revenue_researcher:["https://payapi.market/faq","https://payapi.market/","https://payapi.market/list","https://www.req402.com/","https://docs.openx402.ai/building-a-server","https://github.com/x402-foundation/x402/blob/main/docs/introduction.md","https://payrelayer.com/sdks/fastapi","https://docs.tools402.dev/reference/x402-protocol"],
  ai_training_scout:[],
  direct_client_scout:[],
   mining_provider_scout:["https://www.cloudminecrypto.com/faq","https://cloudminecrypto.com/terms_and_conditions.html","https://www.cloudminecrypto.com/withdrawals","https://www.cloudminecrypto.com/learn/free-bitcoin-mining","https://www.cloudminecrypto.com/learn/reward-rules","https://www.cloudminecrypto.com/referral","https://f2pool.io/","https://www.nicehash.com/"]
 };
 const urls=(urlsByRole[role]||[]).slice(0,8);
 let response:any=null,requestError:string|null=null;
 try{
  const isMining=role==="mining_provider_scout";
  const endpoint=isMining?SUPABASE_URL+"/functions/v1/midad_mining_provider_scout":SUPABASE_URL+"/functions/v1/midad_research_center";
  const requestBody=isMining?{action:"discover",query:prompt,urls}:{query:prompt,language:"en",urls,synthesize:false};
  const r=await fetch(endpoint,{
   method:"POST",
   headers:{"content-type":"application/json","accept":"application/json","x-midad-autonomy-key":autonomyKey},
   body:JSON.stringify(requestBody),
   signal:AbortSignal.timeout(70000)
  });
  const raw=await r.text();
  try{response=JSON.parse(raw);}catch{response={raw:clip(raw,1500)};}
  if(!r.ok||response?.ok===false)requestError=clip(response?.error||response?.message||("research_endpoint_http_"+r.status),500);
 }catch(e){requestError=clip((e as any)?.message||e,500);}
 const isMining=role==="mining_provider_scout";
 const stats=response?.stats||{};
 const researchRunId=response?.research_run_id||response?.run_id||null;
 const discovered=Number(isMining?(response?.sources_examined??stats.discovered??0):(stats.discovered||0));
 const usable=Number(isMining?(response?.usable_sources??stats.usable??0):(stats.usable||0));
 const acceptedByPolicy=Number(response?.accepted_by_policy||0);
 const policyRejections=Array.isArray(response?.rejected_by_policy)?response.rejected_by_policy:[];
 const exclusions=isMining&&Array.isArray(response?.exclusions)?response.exclusions.slice(0,30):[];
 const rejectedByPolicy=policyRejections.length;
 const citationCandidates=[
  ...(Array.isArray(response?.citations)?response.citations:[]),
  ...(Array.isArray(response?.sources)?response.sources:[]),
  ...(Array.isArray(response?.search?.sources)?response.search.sources:[]),
  ...exclusions.flatMap((x:any)=>Array.isArray(x?.source_urls)?x.source_urls:[])
 ];
 const citationMap=new Map<string,any>();
 for(const item of citationCandidates){
  const url=typeof item==="string"?item:String(item?.url||item?.uri||"");
  if(!/^https?:\/\//i.test(url))continue;
  if(!citationMap.has(url))citationMap.set(url,typeof item==="string"?{url}:item);
 }
 const citations=Array.from(citationMap.values()).slice(0,30);
 const successful=!requestError&&response?.ok===true&&Boolean(researchRunId);
 const resultMeta={
  worker:"midad_revenue_intel_research_worker_v3",
  executed_at:new Date().toISOString(),
  research_run_id:researchRunId,
  query:prompt,
  sources_discovered:discovered,
  usable_sources:usable,
  accepted_by_policy:isMining?acceptedByPolicy:null,
  rejected_by_policy:isMining?rejectedByPolicy:null,
  exclusions:isMining?exclusions:[],
  exclusions_count:isMining?exclusions.length:0,
  citations,
  citations_count:citations.length,
  answer_excerpt:clip(response?.answer||(isMining?JSON.stringify({exclusions:response?.exclusions,rejected_by_policy:response?.rejected_by_policy,notes:response?.notes,search:response?.search}):""),5000),
  error:requestError,
  external_actions:["none"],
  research_center_http_ok:!requestError,
  synthesis_skipped:Boolean(response?.synthesis?.skipped)
 };
 const nextStatus=successful?"COMPLETED":(Number(claimed.attempts||1)<2?"QUEUED":"FAILED");
 await d`UPDATE public.midad_research_queue SET status=${nextStatus},result_run_id=${researchRunId||null}::uuid,metadata=metadata || ${d.json(resultMeta)}::jsonb,completed_at=${successful?new Date():null} WHERE id=${claimed.id}`;
 const remain=await d`SELECT count(*)::int AS queued FROM public.midad_research_queue q JOIN public.midad_research_runs p ON p.id=q.source_run_id WHERE q.source_run_id=${claimed.source_run_id} AND q.status='QUEUED'`;
 const running=await d`SELECT count(*)::int AS running FROM public.midad_research_queue WHERE source_run_id=${claimed.source_run_id} AND status='RUNNING'`;
 const failed=await d`SELECT count(*)::int AS failed FROM public.midad_research_queue WHERE source_run_id=${claimed.source_run_id} AND status='FAILED'`;
 if(Number(remain[0]?.queued||0)===0&&Number(running[0]?.running||0)===0){
  await d`UPDATE public.midad_research_runs SET status=${Number(failed[0]?.failed||0)>0?"failed":"completed"},completed_at=now(),updated_at=now(),metadata=metadata || ${d.json({mesh_research_worker_completed:true,failed_tasks:Number(failed[0]?.failed||0)})}::jsonb WHERE id=${claimed.source_run_id}`;
 }
 return {ok:successful,service:"midad_revenue_intel_research_worker",version:VERSION,processed:true,task_id:claimed.id,task_reason:claimed.reason,status:nextStatus,research_run_id:response?.run_id||null,sources_discovered:Number(stats.discovered||0),usable_sources:usable,error:requestError};
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
 try{if(!(await authOK(req)))return json({ok:false,error:"unauthorized"},401);}catch{return json({ok:false,error:"auth_check_failed"},500);}
 let body:any={};try{body=await req.json();}catch{}
 try{const action=String(body?.action||"process");if(action==="health")return json(await health());if(action==="process")return json(await processOne());return json({ok:false,error:"unsupported_action",supported_actions:["health","process"]},400);}
 catch(e){return json({ok:false,service:"midad_revenue_intel_research_worker",version:VERSION,error:clip((e as any)?.message||e,700)},500);}
});