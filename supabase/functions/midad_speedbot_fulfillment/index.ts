import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const URL = Deno.env.get("SUPABASE_URL") || "";
const DATABASE_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const sql = DATABASE_URL ? postgres(DATABASE_URL,{max:1,idle_timeout:5,connect_timeout:10,ssl:"require",prepare:false}) : null;
const SERVICE_ID = "service_b55a499aa43848cd96f4d213e1d8bdfa";
const SERVICE_VERSION = 1;
const H = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-autonomy-key"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const clip=(s:unknown,n=700)=>String(s??"").slice(0,n);
function needDb(){if(!sql)throw new Error("supabase_db_url_missing");return sql;}
async function secret(name:string){const d=needDb();const rows=await d`select decrypted_secret from vault.decrypted_secrets where name=${name} order by created_at desc limit 1`;return typeof rows[0]?.decrypted_secret==="string"?rows[0].decrypted_secret:"";}
async function authOK(req:Request){
 const supplied=req.headers.get("x-midad-autonomy-key")||"";
 if(!supplied)return false;
 const expected=await secret("midad_autonomy_key");
 if(!expected)return false;
 const digest=async(v:string)=>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");};
 return (await digest(supplied))===(await digest(expected));
}
async function key(){const k=await secret("midad_speedbot_revenue_predator_key");if(!k)throw new Error("speedbot_agent_key_unavailable_from_vault");return k;}
async function speedbot(path:string,init:RequestInit={}){
 const k=await key();const h=new Headers(init.headers);h.set("Authorization","Bearer "+k);h.set("Content-Type","application/json");h.set("Accept","application/json");
 const r=await fetch("https://speedbot.dev"+path,{...init,headers:h,signal:AbortSignal.timeout(20000)});
 const t=await r.text();let j:any={};try{j=t?JSON.parse(t):{}}catch{j={raw:clip(t,300)}}
 if(!r.ok)throw new Error("speedbot_"+r.status+":"+clip(j?.error||j?.message||"request_failed",250));
 return j;
}
async function ai(prompt:string,requestRef:string){
 const autonomy=await secret("midad_autonomy_key");
 if(!autonomy)throw new Error("autonomy_key_unavailable_from_vault");
 const r=await fetch(URL+"/functions/v1/midad_ai_router",{
  method:"POST",headers:{"content-type":"application/json","x-midad-autonomy-key":autonomy},
  body:JSON.stringify({task_class:"research_compression",ai_mode:"revenue",request_ref:requestRef,prompt,max_output_tokens:4500,temperature:0.2}),
  signal:AbortSignal.timeout(65000)
 });
 const t=await r.text();let j:any={};try{j=t?JSON.parse(t):{}}catch{j={raw:clip(t,300)}}
 if(!r.ok||j?.ok===false)throw new Error("midad_ai_failed:"+clip(j?.error||j?.state||r.status,250));
 const answer=String(j?.answer||j?.final||j?.message||"").trim();
 if(!answer)throw new Error("midad_ai_empty");
 return answer;
}
async function saveFulfillment(row:any){
 const d=needDb();
 await d`
  insert into public.midad_speedbot_fulfillments
   (post_id,service_id,service_version,status,input,output,attempts,last_error,delivered_at,paid_at,updated_at)
  values
   (${row.post_id},${row.service_id},${row.service_version},${row.status},${d.json(row.input||{})}::jsonb,${d.json(row.output||{})}::jsonb,${Number(row.attempts||0)},${row.last_error??null},${row.delivered_at??null},${row.paid_at??null},now())
  on conflict (post_id) do update set
   service_id=excluded.service_id,service_version=excluded.service_version,status=excluded.status,
   input=excluded.input,output=excluded.output,attempts=excluded.attempts,last_error=excluded.last_error,
   delivered_at=coalesce(excluded.delivered_at,public.midad_speedbot_fulfillments.delivered_at),
   paid_at=coalesce(excluded.paid_at,public.midad_speedbot_fulfillments.paid_at),updated_at=now()
 `;
}
async function processOrder(o:any){
 const so=o?.service_order||{};const terms=so?.terms||{};const serviceId=String(so?.service_id||terms?.id||"");
 const version=Number(so?.service_version||terms?.version||0);const post=o?.post||{};const postId=String(post?.id||post?.post_id||"");
 const input=so?.input&&typeof so.input==="object"?so.input:{};
 if(serviceId!==SERVICE_ID||version!==SERVICE_VERSION)return{skipped:true,reason:"service_mismatch",post_id:postId||null,service_id:serviceId,service_version:version};
 if(!/^post_[a-f0-9]{32}$/.test(postId))return{skipped:true,reason:"invalid_post_id",post_id:postId||null};
 const brief=String(input?.brief||"").trim();
 const d=needDb();
 const existing=await d`select status,attempts from public.midad_speedbot_fulfillments where post_id=${postId} limit 1`;
 if(existing[0]?.status==="DELIVERED"||existing[0]?.status==="PAID")return{skipped:true,reason:"already_delivered",post_id:postId,status:existing[0].status};
 if(!brief){
  await saveFulfillment({post_id:postId,service_id:serviceId,service_version:version,status:"FAILED",input,output:{error:"brief_missing"},attempts:Number(existing[0]?.attempts||0),last_error:"brief_missing"});
  return{skipped:false,failed:true,post_id:postId,error:"brief_missing"};
 }
 const attempts=Number(existing[0]?.attempts||0)+1;
 await saveFulfillment({post_id:postId,service_id:serviceId,service_version:version,status:"PROCESSING",input,output:{},attempts,last_error:null});
 const acceptance=String(terms?.acceptance_criteria||"Address every supplied requirement; include reproducible verification checks and dated evidence; distinguish observations from inferences; identify missing information and limitations; provide actionable remediation steps without requiring private credentials or irreversible actions.");
 const description=String(terms?.description||"");
 const prompt=[
  "You are the MIDAD Revenue Fulfillment worker. Produce the final report for one already-awarded paid service order.",
  "SERVICE TITLE: Audit and verify one revenue or payment automation flow",
  "SERVICE DESCRIPTION: "+clip(description,2500),
  "ACCEPTANCE CRITERIA: "+clip(acceptance,3000),
  "BUYER INPUT:",clip(brief,7000),
  "Requirements:",
  "- Address supplied requirements; separate observations from inference.",
  "- Provide reproducible checks and dated evidence only when available.",
  "- State unknowns and limitations; give concrete remediation steps.",
  "- Do not invent access, tests, transactions, or external results.",
  "- Redact all secrets and private credentials if accidentally supplied.",
  "- Stay in scope; do not perform or recommend irreversible financial actions.",
  "Return only the final buyer-facing report."
 ].join("\n");
 try{
  const report=await ai(prompt,"speedbot-"+postId+"-v1");const body=clip(report,11500);
  const hashBuf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body));
  const sha=Array.from(new Uint8Array(hashBuf)).map(x=>x.toString(16).padStart(2,"0")).join("");
  const delivery=await speedbot("/api/exchange/deliver",{method:"POST",body:JSON.stringify({
   post_id:postId,body,
   result:{report:body,service_id:SERVICE_ID,service_version:SERVICE_VERSION,verification:{acceptance_criteria:acceptance,report_sha256:sha,generated_by:"MIDAD Revenue Fulfillment",generated_at:new Date().toISOString()}},
   sha256:sha,public_consent:true,request_id:"midad-"+postId+"-deliver-v1"
  })});
  await saveFulfillment({post_id:postId,service_id:serviceId,service_version:version,status:"DELIVERED",input,output:{report_sha256:sha,delivery_ok:true,delivery_result:delivery},attempts,last_error:null,delivered_at:new Date().toISOString()});
  return{skipped:false,post_id:postId,status:"DELIVERED",sha256:sha,delivery_ok:true};
 }catch(e){
  const msg=clip((e as any)?.message||e,600);
  await saveFulfillment({post_id:postId,service_id:serviceId,service_version:version,status:"RETRY",input,output:{},attempts,last_error:msg});
  return{skipped:false,post_id:postId,status:"RETRY",error:msg};
 }
}
async function cycle(){
 const orders=await speedbot("/api/exchange/orders?role=provider&status=awarded&limit=20");
 const arr=Array.isArray(orders?.orders)?orders.orders:[];
 const results=[];for(const o of arr)results.push(await processOrder(o));
 const paid=await speedbot("/api/exchange/orders?role=provider&status=paid&limit=20").catch(()=>({orders:[]}));
 const d=needDb();
 for(const o of (Array.isArray(paid?.orders)?paid.orders:[])){
  const postId=String(o?.post?.id||o?.post?.post_id||"");
  const txHash=String(o?.payout_tx_hash||o?.payout?.tx_hash||o?.payout?.transaction_hash||o?.payment?.tx_hash||o?.transaction_hash||"");
  if(!postId||!txHash)continue;
  const chainRows=await d`select id,asset,network,mint,direction,amount,commitment,evidence from public.midad_wallet_receipts where tx_hash=${txHash} and direction='inbound' and asset='USDC' and network='base' limit 10`;
  const chainReceipt=chainRows.find((r:any)=>{
   const ev=r.evidence&&typeof r.evidence==="object"?r.evidence:{};
   return String(r.mint||"").toLowerCase()==="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" && String(r.commitment||"").toLowerCase()==="finalized" && Number(r.amount)>0 && ev.independently_verified===true && ev.token_contract_verified===true && Number(ev.chain_id)===8453 && String(ev.contract_address||"").toLowerCase()==="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  });
  if(chainReceipt)await d`update public.midad_speedbot_fulfillments set status='PAID',paid_at=now(),output=coalesce(output,'{}'::jsonb)||jsonb_build_object('chain_receipt_id',${chainReceipt.id},'payout_tx_hash',${txHash}),updated_at=now() where post_id=${postId} and status='DELIVERED'`;
 }
 const counts=await d`select count(*)::int as total, count(*) filter(where status='DELIVERED')::int as delivered, count(*) filter(where status='RETRY')::int as retry, count(*) filter(where status='PAID')::int as paid from public.midad_speedbot_fulfillments`;
 return{ok:true,service:"midad_speedbot_fulfillment",version:3,service_id:SERVICE_ID,awarded_seen:arr.length,results,paid_seen:Array.isArray(paid?.orders)?paid.orders.length:0,fulfillment_counts:counts[0]};
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
 if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
 try{if(!(await authOK(req)))return json({ok:false,error:"unauthorized"},401)}catch{return json({ok:false,error:"auth_check_failed"},500)}
 let body:any={};try{body=await req.json()}catch{}
 if(body?.action==="diagnose"){
  try{
   const d=needDb();const a=await d`select length(decrypted_secret) as n from vault.decrypted_secrets where name='midad_speedbot_revenue_predator_key' order by updated_at desc limit 1`;
   const counts=await d`select count(*)::int as total,count(*) filter(where status='DELIVERED')::int as delivered,count(*) filter(where status='RETRY')::int as retry,count(*) filter(where status='PAID')::int as paid from public.midad_speedbot_fulfillments`;
   return json({ok:true,service:"midad_speedbot_fulfillment",version:3,database_connected:true,speedbot_key_length:a[0]?.n,fulfillment_counts:counts[0],auth:"verified"});
  }catch(e){return json({ok:false,service:"midad_speedbot_fulfillment",version:3,database_connected:false,error:clip((e as any)?.message||e,250)},500)}
 }
 try{return json(await cycle())}catch(e){return json({ok:false,service:"midad_speedbot_fulfillment",version:3,error:clip((e as any)?.message||e,500)},500)}
});