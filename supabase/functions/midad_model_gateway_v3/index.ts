import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { parseModelCatalog } from "./model-catalog.mjs";
import { resolveModelProvider, buildProviderHeaders } from "./provider-config.mjs";
import { buildOpenRouterCatalog } from "./openrouter-catalog.mjs";
import { buildOpenRouterRequestPolicy } from "./openrouter-request-policy.mjs";
import { evaluateGeminiRequestPolicy } from "./gemini-request-policy.mjs";
import { runOpenRouterDiscovery, getOpenRouterDiscoveryStatus, getOpenRouterRecommendations } from "./openrouter-discovery.mjs";
import { runOpenRouterAuthCheck } from "./openrouter-auth-check.mjs";
import { resolveModelGatewayAuthMode } from "./auth-policy.mjs";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const db = DB_URL ? postgres(DB_URL,{max:1,idle_timeout:5,connect_timeout:10,ssl:"require",prepare:false}) : null;
const APIMIX_KEY = Deno.env.get("MIDAD_APMIX_API_KEY") || "";
const BASE_URL = (Deno.env.get("MIDAD_APMIX_BASE_URL") || "https://api.apmix.ai/v1").replace(/\/$/,"");
const H = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"https://sirahwaz.github.io","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-ingest-key,x-midad-autonomy-key"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clip=(v:unknown,n=6000)=>String(v??"").slice(0,n);
function needDb(){if(!db)throw new Error("supabase_db_url_missing");return db;}
async function secret(name:string){const d=needDb();const r=await d`select decrypted_secret from vault.decrypted_secrets where name=${name} order by created_at desc limit 1`;return typeof r[0]?.decrypted_secret==="string"?r[0].decrypted_secret:"";}
async function authMode(req:Request){
 const autonomyHeader=req.headers.get("x-midad-autonomy-key")||"";
 const autonomySecret=autonomyHeader?await secret("midad_autonomy_key"):"";
 return resolveModelGatewayAuthMode({
  ingestHeader:req.headers.get("x-midad-ingest-key")||"",
  ingestSecret:Deno.env.get("MIDAD_INGEST_KEY")||"",
  autonomyHeader,
  autonomySecret
 });
}
function taskClass(task:string){
 const s=String(task||"generic").toLowerCase();
 if(s==="public_sanitized")return "public_sanitized";
 if(s==="revenue_triage"||s.includes("revenue")||s.includes("income"))return "revenue_triage";
 if(s==="opportunity_classify"||s.includes("opportunity"))return "opportunity_classify";
 if(s==="market_analysis"||s.includes("market")||s.includes("trade"))return "market_analysis";
 if(s==="osint_synthesis"||s.includes("osint"))return "osint_synthesis";
 if(s==="client_proposal"||s.includes("proposal")||s.includes("client"))return "client_proposal";
 if(s==="research_compression"||s.includes("research"))return "research_compression";
 if(s==="code_generation"||s.includes("code")||s.includes("coding"))return "code_generation";
 if(s==="vision_analysis"||s.includes("vision")||s.includes("image"))return "vision_analysis";
 if(s==="audio_tasks"||s.includes("audio")||s.includes("speech"))return "audio_tasks";
 if(s==="video_analysis"||s.includes("video"))return "video_analysis";
 if(s==="translation"||s.includes("translate"))return "translation";
 if(s==="agentic_tools"||s.includes("agentic")||s.includes("tool"))return "agentic_tools";
 if(s==="embeddings"||s.includes("embedding"))return "embeddings";
 if(s==="document_analysis"||s.includes("document")||s.includes("file"))return "document_analysis";
 if(s==="structured_generation"||s.includes("structured"))return "structured_generation";
 if(s==="general_reasoning")return "generic";
 return "generic";
}
async function getRoute(tc:string){const d=needDb();const r=await d`select provider_slug,model,max_output_tokens,budget_class,metadata from midad_private.model_routes where task_class=${tc} and enabled=true order by priority asc,created_at asc limit 1`;return r[0]||null;}
async function getProviderConfig(slug:string){
 const provider=String(slug||"apmix").toLowerCase();
 let cfg=resolveModelProvider(provider,{
  MIDAD_APMIX_API_KEY:APIMIX_KEY,
  MIDAD_APMIX_BASE_URL:BASE_URL,
  OPENAI_API_KEY:Deno.env.get("OPENAI_API_KEY")||Deno.env.get("MIDAD_OPENAI_API_KEY")||"",
  MIDAD_OPENAI_BASE_URL:Deno.env.get("MIDAD_OPENAI_BASE_URL")||"",
  MIDAD_OPENROUTER_API_KEY:await secret("MIDAD_OPENROUTER_API_KEY")||Deno.env.get("MIDAD_OPENROUTER_API_KEY")||"",
  MIDAD_OPENROUTER_BASE_URL:Deno.env.get("MIDAD_OPENROUTER_BASE_URL")||""
 });
 if(provider==="openai"&&!cfg.apiKey){
  const vaultKey=await secret("openai_api_key")||await secret("midad_openai_api_key");
  if(vaultKey)cfg=resolveModelProvider(provider,{OPENAI_API_KEY:vaultKey,MIDAD_OPENAI_BASE_URL:Deno.env.get("MIDAD_OPENAI_BASE_URL")||""});
 }
 if(provider==="gemini"&&!cfg.apiKey){
  const geminiVaultKey=await secret("MIDAD_GEMINI_API_KEY")||await secret("midad_gemini_api_key");
  if(geminiVaultKey)cfg=resolveModelProvider(provider,{
   MIDAD_GEMINI_API_KEY:geminiVaultKey,
   MIDAD_GEMINI_BASE_URL:Deno.env.get("MIDAD_GEMINI_BASE_URL")||""
  });
 }
 return cfg;
}
async function logRun(p:any){try{const d=needDb();await d`insert into midad_private.model_runs(request_ref,task_class,provider_slug,model,status,latency_ms,prompt_tokens,completion_tokens,weighted_tokens,http_status,error_code,error_message,metadata) values (${p.p_request_ref},${p.p_task_class},${p.p_provider_slug},${p.p_model},${p.p_status},${p.p_latency_ms},${p.p_prompt_tokens},${p.p_completion_tokens},${p.p_weighted_tokens},${p.p_http_status},${p.p_error_code},${p.p_error_message},${d.json(p.p_metadata||{})}::jsonb)`;}catch(_){}}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(req.method==="GET"){
  try{const route=await getRoute("generic");if(!route)return json({ok:false,state:"FAILED",service:"midad_model_gateway_v3",configured:false,error:"no_model_route"},503);const provider=await getProviderConfig(String(route.provider_slug||"apmix"));return json({ok:true,state:provider.configured?"CONFIGURED":"PENDING",service:"midad_model_gateway_v3",version:6,provider:provider.provider,configured:provider.configured,route_configured:true,inference_tested:false,base_url:provider.baseUrl,default_model:String(route.model),task_class:"generic",budget_class:String(route.budget_class||"unknown"),live_execution:false});}
  catch(e){return json({ok:false,state:"FAILED",service:"midad_model_gateway_v3",error:clip((e as any)?.message||e,250)},503)}
 }
 if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
 let callerAuthMode="unauthorized";try{callerAuthMode=await authMode(req);if(callerAuthMode==="unauthorized")return json({ok:false,error:"unauthorized"},401)}catch{return json({ok:false,error:"auth_check_failed"},500)}
 const body=await req.json().catch(()=>({}));const action=String(body.action||"chat").toLowerCase();const tc=taskClass(String(body.task_class||body.task||"generic"));const ref=String(body.request_ref||crypto.randomUUID());
 if(tc==="public_sanitized"&&callerAuthMode!=="autonomy")return json({ok:false,state:"BLOCKED",error:"public_sanitized_route_requires_autonomy_identity",inference_called:false},403);
 if(action==="auth_check"){
  try{
   const requestedProvider=String(body.provider||"openrouter").trim().toLowerCase();
   if(requestedProvider!=="openrouter")return json({ok:false,state:"BLOCKED",error:"auth_check_requires_openrouter_provider"},400);
   const providerConfig=await getProviderConfig("openrouter");
   const result=await runOpenRouterAuthCheck(providerConfig);
   return json(result.body,result.statusCode);
  }catch(_error){
   return json({ok:false,state:"FAILED",provider:"openrouter",error:"openrouter_auth_check_setup_failed"},502);
  }
 }
 if(action==="discover_models"){
  const apiKey=await secret("MIDAD_OPENROUTER_API_KEY")||Deno.env.get("MIDAD_OPENROUTER_API_KEY")||"";
  if(!apiKey)return json({ok:false,state:"PENDING",error:"model_provider_secret_missing",required_secret:"MIDAD_OPENROUTER_API_KEY"},503);
  const result=await runOpenRouterDiscovery({db:needDb(),apiKey,source:String(body.source||"manual").slice(0,80)});
  return json(result,result.ok?200:502);
 }
 if(action==="discovery_status"){
  return json({ok:true,state:"VERIFIED",service:"midad_openrouter_model_discovery",summary:await getOpenRouterDiscoveryStatus(needDb())});
 }
 if(action==="recommendations"){
  const limit=Math.max(1,Math.min(50,Number(body.limit||20)));
  const task=typeof body.filter_task_class==="string"?body.filter_task_class.trim().toLowerCase():"";
  const items=await getOpenRouterRecommendations(needDb(),task,limit);
  return json({ok:true,state:"VERIFIED",count:items.length,items});
 }
 if(action==="catalog"){
  const providerSlug=String(body.provider||"openrouter").trim().toLowerCase();
  if(providerSlug!=="openrouter")return json({ok:false,state:"BLOCKED",error:"catalog_provider_not_allowed"},400);
  const cfg=await getProviderConfig("openrouter");
  if(!cfg.configured)return json({ok:false,state:"PENDING",error:"model_provider_secret_missing",provider:"openrouter",required_secret:"MIDAD_OPENROUTER_API_KEY"},503);
  const headers=buildProviderHeaders(cfg);
  try{
   const [modelsResponse,providersResponse]=await Promise.all([
    fetch(cfg.baseUrl+"/models",{headers,signal:AbortSignal.timeout(25000)}),
    fetch(cfg.baseUrl+"/providers",{headers,signal:AbortSignal.timeout(25000)})
   ]);
   if(!modelsResponse.ok||!providersResponse.ok)return json({ok:false,state:"FAILED",error:"openrouter_catalog_request_failed",models_http_status:modelsResponse.status,providers_http_status:providersResponse.status},502);
   const [modelsPayload,providersPayload]=await Promise.all([modelsResponse.json(),providersResponse.json()]);
   const catalog=buildOpenRouterCatalog(modelsPayload,providersPayload,{query:body.query,limit:body.limit});
   if(!catalog.model_count_total||!catalog.provider_count)return json({ok:false,state:"FAILED",error:"openrouter_catalog_empty_or_unrecognized"},502);
   return json({ok:true,state:"VERIFIED",provider:"openrouter",catalog_source:"authenticated_get_only",inference_called:false,...catalog});
  }catch(e){return json({ok:false,state:"FAILED",error:"openrouter_catalog_exception",detail:clip((e as any)?.message||e,200)},502)}
 }
 let route:any;try{route=await getRoute(tc)}catch(e){return json({ok:false,state:"FAILED",error:"model_route_read_failed",detail:clip((e as any)?.message||e,200)},503)}
 if(!route)return json({ok:false,state:"FAILED",error:"no_model_route",task_class:tc},503);
 let providerConfig:any;try{providerConfig=await getProviderConfig(String(route.provider_slug||"apmix"));}catch(e){return json({ok:false,state:"FAILED",error:"unsupported_model_provider",provider:String(route.provider_slug||"")},503)}
 if(!providerConfig.configured)return json({ok:false,state:"PENDING",error:"model_provider_secret_missing",provider:providerConfig.provider,required_secret:providerConfig.provider==="openai"?"OPENAI_API_KEY":providerConfig.provider==="openrouter"?"MIDAD_OPENROUTER_API_KEY":providerConfig.provider==="gemini"?"MIDAD_GEMINI_API_KEY":"MIDAD_APMIX_API_KEY"},503);
 const model=String(body.model||route.model);



 if(action==="status")return json({ok:true,state:"VERIFIED",provider:providerConfig.provider,model,task_class:tc,route,secret_configured:true});
 if(action==="models"){
  const started=Date.now();
  try{
   const r=await fetch(providerConfig.baseUrl+"/models",{headers:buildProviderHeaders(providerConfig),signal:AbortSignal.timeout(25000)});
   const t=await r.text();
   let j:any={};
   try{j=JSON.parse(t)}catch{j={raw:t}};
   const catalog=parseModelCatalog(j);
   const catalogOk=Boolean(r.ok&&catalog.models.length>0);
   await logRun({p_request_ref:ref,p_task_class:"models",p_provider_slug:providerConfig.provider,p_model:"catalog",p_status:catalogOk?"ok":"error",p_latency_ms:Date.now()-started,p_prompt_tokens:null,p_completion_tokens:null,p_weighted_tokens:null,p_http_status:r.status,p_error_code:catalogOk?null:(!r.ok?"APMIX_MODELS_ERROR":"APMIX_MODELS_EMPTY_OR_UNKNOWN_SHAPE"),p_error_message:catalogOk?null:clip(j?.error?.message||j?.message||("catalog_not_found:"+catalog.shape),500),p_metadata:{source:"midad_model_gateway_v3_direct_db",catalog_shape:catalog.shape,model_count:catalog.models.length,top_level_keys:catalog.top_level_keys}});
   if(!r.ok)return json({ok:false,state:"FAILED",error:"apmix_models_failed",http_status:r.status,catalog_shape:catalog.shape},502);
   if(!catalog.models.length)return json({ok:false,state:"FAILED",error:"apmix_models_empty_or_unrecognized",http_status:r.status,catalog_shape:catalog.shape,top_level_keys:catalog.top_level_keys},502);
   return json({ok:true,state:"VERIFIED",provider:providerConfig.provider,models:catalog.models,catalog_shape:catalog.shape,model_count:catalog.models.length});
  }catch(e){return json({ok:false,state:"FAILED",error:"apmix_models_exception",detail:clip((e as any)?.message||e,200)},502)}
 }
 if(action==="usage"){
  if(providerConfig.provider!=="apmix")return json({ok:false,error:"usage_endpoint_not_supported_for_provider",provider:providerConfig.provider},400);
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
 if(action!=="chat")return json({ok:false,error:"unsupported_action",allowed:["status","catalog","models","usage","chat"]},400);
 const messages=Array.isArray(body.messages)?body.messages.slice(-24):[{role:"user",content:clip(body.prompt,14000)}];
 if(!messages.length||!messages.some((m:any)=>String(m?.content||"").trim()))return json({ok:false,error:"prompt_or_messages_required"},400);
 let openRouterPolicy:any=null;
 if(providerConfig.provider==="openrouter"){
  const decision=buildOpenRouterRequestPolicy({
   routeMetadata:route.metadata||{},
   budgetClass:route.budget_class,
   configuredModel:String(route.model||""),
   requestedModel:typeof body.model==="string"?body.model:undefined,
   dataClass:typeof body.data_class==="string"?body.data_class:undefined
  });
  if(!decision.ok)return json({ok:false,state:"BLOCKED",error:decision.error,provider:"openrouter",model:route.model,privacy_profile:String(route.metadata?.privacy_profile||"sensitive"),inference_called:false},403);
  openRouterPolicy=decision.provider;
 }
 if(providerConfig.provider==="gemini"){
  const geminiDecision=evaluateGeminiRequestPolicy({dataClass:body.data_class,routeMetadata:route.metadata||{}});
  if(!geminiDecision.ok)return json({ok:false,state:"BLOCKED",provider:"gemini",error:geminiDecision.error,inference_called:false},403);
 }
 const maxTokens=Math.max(64,Math.min(4000,Number(body.max_output_tokens||route.max_output_tokens||1200)));const temperature=typeof body.temperature==="number"?Math.max(0,Math.min(1,body.temperature)):0.2;
 const requestBody:any={model,messages,max_tokens:maxTokens,temperature};
 if(openRouterPolicy)requestBody.provider=openRouterPolicy;
 const started=Date.now();
 try{const r=await fetch(providerConfig.baseUrl+"/chat/completions",{method:"POST",headers:buildProviderHeaders(providerConfig,{contentType:true}),body:JSON.stringify(requestBody),signal:AbortSignal.timeout(60000)});const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};const usage=j?.usage||{},answer=j?.choices?.[0]?.message?.content||"",ok=Boolean(r.ok&&answer);
 await logRun({p_request_ref:ref,p_task_class:tc,p_provider_slug:providerConfig.provider,p_model:model,p_status:ok?"ok":"error",p_latency_ms:Date.now()-started,p_prompt_tokens:Number.isFinite(Number(usage.prompt_tokens))?Number(usage.prompt_tokens):null,p_completion_tokens:Number.isFinite(Number(usage.completion_tokens))?Number(usage.completion_tokens):null,p_weighted_tokens:Number.isFinite(Number(usage.total_tokens))?Number(usage.total_tokens):null,p_http_status:r.status,p_error_code:ok?null:"MODEL_PROVIDER_CHAT_ERROR",p_error_message:ok?null:clip(j?.error?.message||j?.message||t,500),p_metadata:{route_class:tc,budget_class:route.budget_class,privacy_profile:providerConfig.provider==="openrouter"?(route.metadata?.privacy_profile||"sensitive"):null,openrouter_provider_policy:openRouterPolicy?{zdr:openRouterPolicy.zdr??false,data_collection:openRouterPolicy.data_collection,allow_fallbacks:openRouterPolicy.allow_fallbacks,only:openRouterPolicy.only||null}:null,finish_reason:j?.choices?.[0]?.finish_reason||null}});
 if(!r.ok)return json({ok:false,state:"FAILED",provider:providerConfig.provider,model,error:"model_provider_chat_failed",http_status:r.status,request_ref:ref},502);
 if(!answer)return json({ok:false,state:"FAILED",provider:providerConfig.provider,model,error:"model_provider_empty_answer",request_ref:ref},502);
 return json({ok:true,state:"VERIFIED",provider:providerConfig.provider,model,task_class:tc,request_ref:ref,answer,usage:{prompt_tokens:usage.prompt_tokens??null,completion_tokens:usage.completion_tokens??null,total_tokens:usage.total_tokens??null},latency_ms:Date.now()-started});
 }catch(e){await logRun({p_request_ref:ref,p_task_class:tc,p_provider_slug:providerConfig.provider,p_model:model,p_status:"error",p_latency_ms:Date.now()-started,p_prompt_tokens:null,p_completion_tokens:null,p_weighted_tokens:null,p_http_status:null,p_error_code:"MODEL_PROVIDER_FETCH_EXCEPTION",p_error_message:clip((e as any)?.message||e,500),p_metadata:{route_class:tc,budget_class:route.budget_class}});return json({ok:false,state:"FAILED",error:"model_provider_request_exception",detail:clip((e as any)?.message||e,200),request_ref:ref},502)}
});