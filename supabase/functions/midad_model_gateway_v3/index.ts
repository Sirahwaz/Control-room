import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { parseModelCatalog } from "./model-catalog.mjs";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const db = DB_URL ? postgres(DB_URL,{max:1,idle_timeout:5,connect_timeout:10,ssl:"require",prepare:false}) : null;
const APIMIX_KEY = Deno.env.get("MIDAD_APMIX_API_KEY") || "";
const BASE_URL = (Deno.env.get("MIDAD_APMIX_BASE_URL") || "https://api.apmix.ai/v1").replace(/\/$/,"");
const H = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"https://sirahwaz.github.io","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-ingest-key,x-midad-autonomy-key"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clip=(v:unknown,n=6000)=>String(v??"").slice(0,n);
function needDb(){if(!db)throw new Error("supabase_db_url_missing");return db;}
async function secret(name:string){const d=needDb();const r=await d`select decrypted_secret from vault.decrypted_secrets where name=${name} order by created_at desc limit 1`;return typeof r[0]?.decrypted_secret==="string"?r[0].decrypted_secret:"";}
async function authOK(req:Request){
 const supplied=req.headers.get("x-midad-autonomy-key")||"";
 const ingest=req.headers.get("x-midad-ingest-key")||"";
 if(ingest&&Deno.env.get("MIDAD_INGEST_KEY")&&ingest===Deno.env.get("MIDAD_INGEST_KEY"))return true;
 if(!supplied)return false;
 const expected=await secret("midad_autonomy_key");
 return !!expected&&supplied===expected;
}
function taskClass(task:string){
 const s=String(task||"generic").toLowerCase();
 if(s==="revenue_triage"||s.includes("revenue")||s.includes("income"))return "revenue_triage";
 if(s==="opportunity_classify"||s.includes("opportunity"))return "opportunity_classify";
 if(s==="market_analysis"||s.includes("market")||s.includes("trade"))return "market_analysis";
 if(s==="osint_synthesis"||s.includes("osint"))return "osint_synthesis";
 if(s==="client_proposal"||s.includes("proposal")||s.includes("client"))return "client_proposal";
 if(s==="research_compression"||s.includes("research"))return "research_compression";
 return "generic";
}
async function getRoute(tc:string){const d=needDb();const r=await d`select provider_slug,model,max_output_tokens,budget_class,metadata from midad_private.model_routes where task_class=${tc} and enabled=true order by priority asc,created_at asc limit 1`;return r[0]||null;}
async function logRun(p:any){try{const d=needDb();await d`insert into midad_private.model_runs(request_ref,task_class,provider_slug,model,status,latency_ms,prompt_tokens,completion_tokens,weighted_tokens,http_status,error_code,error_message,metadata) values (${p.p_request_ref},${p.p_task_class},${p.p_provider_slug},${p.p_model},${p.p_status},${p.p_latency_ms},${p.p_prompt_tokens},${p.p_completion_tokens},${p.p_weighted_tokens},${p.p_http_status},${p.p_error_code},${p.p_error_message},${d.json(p.p_metadata||{})}::jsonb)`;}catch(_){}}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(req.method==="GET"){
  try{const route=await getRoute("generic");if(!route)return json({ok:false,state:"FAILED",service:"midad_model_gateway_v3",configured:Boolean(APIMIX_KEY),error:"no_model_route"},503);return json({ok:true,state:"CONFIGURED",service:"midad_model_gateway_v3",version:5,provider:String(route.provider_slug||"apmix"),configured:Boolean(APIMIX_KEY),route_configured:true,inference_tested:false,base_url:BASE_URL,default_model:String(route.model),task_class:"generic",budget_class:String(route.budget_class||"unknown"),live_execution:false});}
  catch(e){return json({ok:false,state:"FAILED",service:"midad_model_gateway_v3",error:clip((e as any)?.message||e,250)},503)}
 }
 if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
 try{if(!(await authOK(req)))return json({ok:false,error:"unauthorized"},401)}catch{return json({ok:false,error:"auth_check_failed"},500)}
 if(!APIMIX_KEY)return json({ok:false,state:"PENDING",error:"apmix_secret_missing",required_secret:"MIDAD_APMIX_API_KEY"},503);
 const body=await req.json().catch(()=>({}));const action=String(body.action||"chat").toLowerCase();const tc=taskClass(String(body.task_class||body.task||"generic"));const ref=String(body.request_ref||crypto.randomUUID());
 let route:any;try{route=await getRoute(tc)}catch(e){return json({ok:false,state:"FAILED",error:"model_route_read_failed",detail:clip((e as any)?.message||e,200)},503)}
 if(!route)return json({ok:false,state:"FAILED",error:"no_model_route",task_class:tc},503);
 const model=String(body.model||route.model);
 if(action==="status")return json({ok:true,state:"VERIFIED",provider:"apmix",model,task_class:tc,route,secret_configured:true});
 if(action==="models"){
  const started=Date.now();
  try{
   const r=await fetch(BASE_URL+"/models",{headers:{"authorization":"Bearer "+APIMIX_KEY,"accept":"application/json"},signal:AbortSignal.timeout(25000)});
   const t=await r.text();
   let j:any={};
   try{j=JSON.parse(t)}catch{j={raw:t}};
   const catalog=parseModelCatalog(j);
   const catalogOk=Boolean(r.ok&&catalog.models.length>0);
   await logRun({p_request_ref:ref,p_task_class:"models",p_provider_slug:"apmix",p_model:"catalog",p_status:catalogOk?"ok":"error",p_latency_ms:Date.now()-started,p_prompt_tokens:null,p_completion_tokens:null,p_weighted_tokens:null,p_http_status:r.status,p_error_code:catalogOk?null:(!r.ok?"APMIX_MODELS_ERROR":"APMIX_MODELS_EMPTY_OR_UNKNOWN_SHAPE"),p_error_message:catalogOk?null:clip(j?.error?.message||j?.message||("catalog_not_found:"+catalog.shape),500),p_metadata:{source:"midad_model_gateway_v3_direct_db",catalog_shape:catalog.shape,model_count:catalog.models.length,top_level_keys:catalog.top_level_keys}});
   if(!r.ok)return json({ok:false,state:"FAILED",error:"apmix_models_failed",http_status:r.status,catalog_shape:catalog.shape},502);
   if(!catalog.models.length)return json({ok:false,state:"FAILED",error:"apmix_models_empty_or_unrecognized",http_status:r.status,catalog_shape:catalog.shape,top_level_keys:catalog.top_level_keys},502);
   return json({ok:true,state:"VERIFIED",provider:"apmix",models:catalog.models,catalog_shape:catalog.shape,model_count:catalog.models.length});
  }catch(e){return json({ok:false,state:"FAILED",error:"apmix_models_exception",detail:clip((e as any)?.message||e,200)},502)}
 }
 if(action==="usage"){
  const started=Date.now();
  try{
   const r=await fetch(BASE_URL+"/usage",{headers:{"authorization":"Bearer "+APIMIX_KEY,"accept":"application/json"},signal:AbortSignal.timeout(25000)});
   const t=await r.text();
   let j:any={};
   try{j=JSON.parse(t)}catch{j={raw:t}};
   const keys=j&&typeof j==="object"?Object.keys(j).sort().slice(0,24):[];
   const providerRequestId=r.headers.get("x-apmix-request-id")||null;
   const usageOk=Boolean(r.ok&&!(j&&typeof j==="object"&&"error" in j));
   await logRun({p_request_ref:ref,p_task_class:"usage",p_provider_slug:"apmix",p_model:"usage",p_status:usageOk?"ok":"error",p_latency_ms:Date.now()-started,p_prompt_tokens:null,p_completion_tokens:null,p_weighted_tokens:null,p_http_status:r.status,p_error_code:usageOk?null:String(j?.error?.code||"APMIX_USAGE_ERROR"),p_error_message:usageOk?null:clip(j?.error?.message||j?.message||("usage_request_failed:"+r.status),500),p_metadata:{source:"midad_model_gateway_v3_usage_preflight",provider_request_id:providerRequestId,top_level_keys:keys}});
   if(!usageOk)return json({ok:false,state:"FAILED",error:"apmix_usage_failed",http_status:r.status,provider_error_code:j?.error?.code||null,provider_request_id:providerRequestId,top_level_keys:keys},502);
   return json({ok:true,state:"VERIFIED",provider:"apmix",usage:j,provider_request_id:providerRequestId});
  }catch(e){return json({ok:false,state:"FAILED",error:"apmix_usage_exception",detail:clip((e as any)?.message||e,200)},502)}
 }
 if(action!=="chat")return json({ok:false,error:"unsupported_action",allowed:["status","models","usage","chat"]},400);
 const messages=Array.isArray(body.messages)?body.messages.slice(-24):[{role:"user",content:clip(body.prompt,14000)}];
 if(!messages.length||!messages.some((m:any)=>String(m?.content||"").trim()))return json({ok:false,error:"prompt_or_messages_required"},400);
 const maxTokens=Math.max(64,Math.min(4000,Number(body.max_output_tokens||route.max_output_tokens||1200)));const temperature=typeof body.temperature==="number"?Math.max(0,Math.min(1,body.temperature)):0.2;const started=Date.now();
 try{const r=await fetch(BASE_URL+"/chat/completions",{method:"POST",headers:{"authorization":"Bearer "+APIMIX_KEY,"content-type":"application/json","accept":"application/json"},body:JSON.stringify({model,messages,max_tokens:maxTokens,temperature}),signal:AbortSignal.timeout(60000)});const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};const usage=j?.usage||{},answer=j?.choices?.[0]?.message?.content||"",ok=Boolean(r.ok&&answer);
 await logRun({p_request_ref:ref,p_task_class:tc,p_provider_slug:"apmix",p_model:model,p_status:ok?"ok":"error",p_latency_ms:Date.now()-started,p_prompt_tokens:Number.isFinite(Number(usage.prompt_tokens))?Number(usage.prompt_tokens):null,p_completion_tokens:Number.isFinite(Number(usage.completion_tokens))?Number(usage.completion_tokens):null,p_weighted_tokens:Number.isFinite(Number(usage.total_tokens))?Number(usage.total_tokens):null,p_http_status:r.status,p_error_code:ok?null:"APMIX_CHAT_ERROR",p_error_message:ok?null:clip(j?.error?.message||j?.message||t,500),p_metadata:{route_class:tc,budget_class:route.budget_class,finish_reason:j?.choices?.[0]?.finish_reason||null}});
 if(!r.ok)return json({ok:false,state:"FAILED",provider:"apmix",model,error:"apmix_chat_failed",http_status:r.status,request_ref:ref},502);
 if(!answer)return json({ok:false,state:"FAILED",provider:"apmix",model,error:"apmix_empty_answer",request_ref:ref},502);
 return json({ok:true,state:"VERIFIED",provider:"apmix",model,task_class:tc,request_ref:ref,answer,usage:{prompt_tokens:usage.prompt_tokens??null,completion_tokens:usage.completion_tokens??null,total_tokens:usage.total_tokens??null},latency_ms:Date.now()-started});
 }catch(e){await logRun({p_request_ref:ref,p_task_class:tc,p_provider_slug:"apmix",p_model:model,p_status:"error",p_latency_ms:Date.now()-started,p_prompt_tokens:null,p_completion_tokens:null,p_weighted_tokens:null,p_http_status:null,p_error_code:"APMIX_FETCH_EXCEPTION",p_error_message:clip((e as any)?.message||e,500),p_metadata:{route_class:tc,budget_class:route.budget_class}});return json({ok:false,state:"FAILED",error:"apmix_request_exception",detail:clip((e as any)?.message||e,200),request_ref:ref},502)}
});