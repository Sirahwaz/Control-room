import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,x-midad-bridge-token"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const clip=(v:any,n=20000)=>String(v??"").trim().slice(0,n);
async function sha(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")}
async function session(sb:any,raw:string){const {data}=await sb.from("midad_human_bridge_sessions").select("id,owner_user_id,status,expires_at").eq("token_hash",await sha(raw)).maybeSingle();if(!data||data.status!=="ACTIVE"||new Date(data.expires_at).getTime()<=Date.now())return null;await sb.from("midad_human_bridge_sessions").update({last_seen_at:new Date().toISOString()}).eq("id",data.id);return data}
async function native(prompt:string,context:any){const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";if(!url||!sk||!ik)return {ok:false,error:"native_unavailable"};const r=await fetch(url+"/functions/v1/midad_orchestrator",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify({task:prompt,role:"reasoning",context})});const t=await r.text();let d:any={};try{d=JSON.parse(t)}catch{d={raw:t}};return r.ok&&d.success?{ok:true,output:d.final||"",model:d.selected_model||null,run_id:d.run_id}: {ok:false,error:"native_failed",detail:d}}
async function gemini(input:any,model="gemini-3.8-flash",tools:any[]=[],generation_config:any={thinking_level:"medium",thinking_summaries:"auto"}){const key=Deno.env.get("GEMINI_API_KEY")||"";if(!key)return {ok:false,error:"gemini_not_configured"};const r=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":key},body:JSON.stringify({model,input,tools:tools.length?tools:undefined,generation_config})});const d=await r.json().catch(()=>({}));return r.ok?{ok:true,data:d}:{ok:false,error:"gemini_failed",status:r.status,detail:d}}
function outText(d:any){if(d?.output_text)return String(d.output_text);for(const s of (d?.steps||[]).slice().reverse())for(const c of (s?.content||[]))if((c?.type==="text"||c?.type==="output_text")&&c?.text)return String(c.text);return ""}
function outImage(d:any){if(d?.output_image?.data)return d.output_image;for(const s of (d?.steps||[]).slice().reverse())for(const c of (s?.content||[]))if(c?.type==="image"&&c?.data)return c;return null}
function input(prompt:string,images:any[]=[]){const a:any[]=[{type:"text",text:clip(prompt,18000)}];for(const i of images.slice(0,4))if(i?.data&&i?.mime_type)a.push({type:"image",data:clip(i.data,8000000),mime_type:clip(i.mime_type,80)});return a}

async function ownerProfile(sb:any,userId:string,overlay:any={}){
  const [p,b,v,st]=await Promise.all([
    sb.from("profiles").select("full_name,business_name,avatar_url,plan").eq("id",userId).maybeSingle(),
    sb.from("brand_kits").select("business_name,logo_url,description,target_audience,dialect,tone,products,contact_info").eq("user_id",userId).order("updated_at",{ascending:false}).limit(1).maybeSingle(),
    sb.from("midad_voice_profiles").select("profile_key,name,default_language,tone,formality,style_rules,preferred_terms,forbidden_terms,signature,active,version").eq("user_id",userId).eq("active",true).order("updated_at",{ascending:false}).limit(1).maybeSingle(),
    sb.from("midad_strategy_profiles").select("key,version,policy,confidence,last_evaluated_at").order("updated_at",{ascending:false}).limit(3)
  ]);
  const bp=b.data||{}, pp=p.data||{}, vp=v.data||{};
  const ci=(bp.contact_info&&typeof bp.contact_info==="object")?bp.contact_info:{};
  const contact:any={};
  for(const [k,val] of Object.entries(ci)){
    const key=String(k).toLowerCase();
    if(/email|e-?mail/.test(key)) contact.email=String(val??"").slice(0,320);
    else if(/phone|mobile|tel/.test(key)) contact.phone=String(val??"").slice(0,80);
    else if(/website|site|url|portfolio/.test(key)) contact.website=String(val??"").slice(0,500);
    else if(/location|city|country|address/.test(key)) contact.location=String(val??"").slice(0,320);
  }
  let products:any[]=Array.isArray(bp.products)?bp.products:[]; 
  const serviceNames=products.slice(0,30).map((x:any)=>typeof x==="string"?x:(x?.name||x?.title||"")).filter(Boolean);
  return {
    full_name:pp.full_name||overlay?.name||"",
    business_name:pp.business_name||bp.business_name||overlay?.business_name||"",
    avatar_url:pp.avatar_url||bp.logo_url||overlay?.avatar_url||"",
    role:overlay?.role||"",
    bio:bp.description||overlay?.bio||"",
    skills:overlay?.skills||"",
    target_audience:bp.target_audience||"",
    dialect:bp.dialect||"MSA",
    tone:bp.tone||"Professional",
    service_description:bp.description||"",
    services:serviceNames,
    contact,
    voice:{name:vp.name||"",language:vp.default_language||null,tone:vp.tone||null,formality:vp.formality||null,signature:vp.signature||null,preferred_terms:vp.preferred_terms||[]},
    strategy_profiles:st.data||[]
  };
}
const SAFE_PROFILE_KEYS=["full_name","business_name","role","bio","skills","target_audience","service_description","services","email","phone","website","location","language","timezone","dialect"];
const BLOCKED_FIELD=/password|passwd|secret|private|seed|recovery|otp|one[- ]time|2fa|security code|captcha|kyc|identity|passport|government id|driver.?s license|ssn|tax id|bank|routing|card number|credit card|cvv|signature|wallet|api key|token/i;
function safeProfileValue(snapshot:any,key:string){
  const v = key==="email"?snapshot.contact?.email:key==="phone"?snapshot.contact?.phone:key==="website"?snapshot.contact?.website:key==="location"?snapshot.contact?.location:key==="language"?snapshot.voice?.language:null;
  if(v!==null&&v!==undefined)return String(v);
  const x=snapshot?.[key];
  if(Array.isArray(x))return x.join(", ");
  if(x===null||x===undefined)return "";
  if(typeof x==="object")return "";
  return String(x);
}


async function persistCommunicationSignal(sb:any,ownerId:string,body:any,result:any,conversationId:string){
  const channel=clip(body.channel||"customer_support",64);
  const externalRef=clip(body.external_ref||body.client_ref||body.external_message_id,240)||("conversation:"+conversationId);
  const clientContact=clip(body.client_contact||body.contact,320)||null;
  const clientName=clip(body.client_name||body.display_name,320)||null;
  const conf=Number.isFinite(Number(result?.confidence))?Math.max(0,Math.min(1,Number(result.confidence))):null;
  const clientMetadata={
    source:"communication_intelligence",
    conversation_id:conversationId,
    channel,
    inferred_fields:{
      intent:result?.intent||null,
      requirements:Array.isArray(result?.extracted_requirements)?result.extracted_requirements.slice(0,20):[],
      confidence:conf
    }
  };
  let clientProfileId:string|null=null;
  const old=await sb.from("midad_client_profiles").select("id,display_name,contact,preferred_language,detected_language,communication_style,metadata").eq("user_id",ownerId).eq("external_ref",externalRef).maybeSingle();
  const base:any={
    user_id:ownerId,
    external_ref:externalRef,
    display_name:clientName,
    contact:clientContact,
    preferred_language:clip(body.client_preferred_language||result?.target_language,40)||null,
    detected_language:clip(result?.detected_language,40)||null,
    communication_style:clip(result?.sentiment,80)||null,
    trust_level:old.data?.trust_level||"unknown",
    notes:clip(result?.internal_arabic_summary,1800)||null,
    metadata:clientMetadata
  };
  if(old.data?.id){
    const patch:any={updated_at:new Date().toISOString(),metadata:{...(old.data?.metadata||{}),...clientMetadata}};
    for(const k of ["display_name","contact","preferred_language","detected_language","communication_style","notes"]) if(base[k]) patch[k]=base[k];
    const up=await sb.from("midad_client_profiles").update(patch).eq("id",old.data.id).select("id").maybeSingle();
    clientProfileId=up.data?.id||old.data.id;
  }else{
    const ins=await sb.from("midad_client_profiles").insert(base).select("id").single();
    clientProfileId=ins.data?.id||null;
  }

  const ls=result?.lead_signal;
  const qualified=Boolean(ls?.qualified===true||ls?.is_lead===true||ls===true);
  const leadScore=Number.isFinite(Number(ls?.score))?Math.max(0,Math.min(1,Number(ls.score))):(qualified?.75:0);
  if(qualified && leadScore>=0.55){
    const source="communication";
    const need=clip(
      (Array.isArray(result?.extracted_requirements)?result.extracted_requirements.join("; "):"")+
      (result?.intent?" | intent: "+result.intent:""),
      1800
    );
    const recent=await sb.from("leads").select("id,metadata").eq("user_id",ownerId).eq("source",source).eq("contact",clientContact||externalRef).order("created_at",{ascending:false}).limit(20);
    const exists=(recent.data||[]).some((x:any)=>x?.metadata?.conversation_id===conversationId);
    if(!exists){
      await sb.from("leads").insert({
        user_id:ownerId,
        source,
        name:clientName||externalRef,
        contact:clientContact||externalRef,
        need:need||clip(result?.internal_arabic_summary,1800)||"Communication-derived lead",
        stage:"new",
        metadata:{
          conversation_id:conversationId,
          client_profile_id:clientProfileId,
          score:leadScore,
          reason:clip(ls?.reason,1200),
          detected_language:result?.detected_language||null,
          channel
        }
      });
    }
  }
  return {client_profile_id:clientProfileId,lead_created:qualified&&leadScore>=0.55};
}

const SYS="MIDAD Omni Agent: high-reliability agentic planner. Prefer MIDAD Native orchestration; use specialized Gemini capability when useful. Never bypass authentication, human verification, identity checks or signatures. Never collect recovery secrets. Explain gates, evidence, expected result and fallback.";
Deno.serve(async req=>{if(req.method==="OPTIONS")return new Response("ok",{headers:H});if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");const body=await req.json().catch(()=>({}));const action=clip(body.action||"capabilities",80).toLowerCase();
try{
if(action==="capabilities")return json({ok:true,service:"midad_omni_agent_gateway",version:5,primary:"midad-native",specialists:["gemini","gemini-live-translate","gemini-notebook"],fallbacks:["tinyfish"],capabilities:["plan","automation_plan","communication","communication_memory","profile_snapshot","form_plan","live_token","gemini_text","gemini_image","research","vision_inspect","notebook_route","human_intervention"],secrets:"server-side-only"});
if(action==="notebook_route")return json({ok:true,provider:"gemini-notebook",mode:"official-ui-handoff",url:"https://notebooklm.google.com/",enterprise_api_ready:Boolean(Deno.env.get("GOOGLE_CLOUD_PROJECT"))});
const raw=clip(req.headers.get("x-midad-bridge-token")||body.bridge_token,500);const s=await session(sb,raw);if(!s)return json({ok:false,error:"bridge_session_invalid_or_expired"},401);

if(action==="live_token"){
  const allowed=["ar","en","fa","fr","de","es","tr","hi","ur","zh-Hans","ja","ko","it","pt","ru","nl","pl"];
  const target=allowed.includes(clip(body.target_language||"en",32))?clip(body.target_language||"en",32):"en";
  const key=Deno.env.get("GEMINI_API_KEY")||"";
  if(!key)return json({ok:false,error:"gemini_not_configured"},503);
  const now=Date.now();
  const expireTime=new Date(now+30*60*1000).toISOString();
  const newSessionExpireTime=new Date(now+60*1000).toISOString();
  const constraints={
    model:"models/gemini-3.5-live-translate-preview",
    config:{
      responseModalities:["AUDIO"],
      inputAudioTranscription:{},
      outputAudioTranscription:{},
      translationConfig:{targetLanguageCode:target,echoTargetLanguage:true}
    }
  };
  const tr=await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens",{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":key},body:JSON.stringify({uses:1,expireTime,newSessionExpireTime,liveConnectConstraints:constraints})});
  const d=await tr.json().catch(()=>({}));
  if(!tr.ok||!d?.name)return json({ok:false,error:"live_token_failed",status:tr.status,detail:d},503);
  return json({ok:true,action,provider:"gemini-live-translate",token:d.name,model:constraints.model,target_language:target,expires_at:expireTime,new_session_expires_at:newSessionExpireTime});
}
if(action==="profile_snapshot"){
  return json({ok:true,action,profile:await ownerProfile(sb,s.owner_user_id,body.profile||{}),source:"supabase_truth_plus_local_overlay"});
}
if(action==="form_plan"){
  const page=body.page&&typeof body.page==="object"?body.page:{};
  const fields=Array.isArray(page.fields)?page.fields.slice(0,160):[];
  if(!fields.length)return json({ok:false,error:"page_fields_required"},400);
  const snapshot=await ownerProfile(sb,s.owner_user_id,body.profile||{});
  const sanitizedFields=fields.map((f:any,i:number)=>({
    index:i,
    tag:clip(f?.tag||"",20),
    type:clip(f?.type||"",40).toLowerCase(),
    name:clip(f?.name||"",160),
    id:clip(f?.id||"",160),
    placeholder:clip(f?.placeholder||"",300),
    aria_label:clip(f?.aria_label||"",300),
    label:clip(f?.label||"",400),
    autocomplete:clip(f?.autocomplete||"",80),
    required:Boolean(f?.required)
  }));
  const spec=SYS+"\nAct as MIDAD Form/Profile Intelligence Agent. Map webpage form fields to ONLY truthful owner-profile values already present in OWNER_PROFILE. Do not invent or transform facts. Allowed source keys: "+SAFE_PROFILE_KEYS.join(", ")+" . Never map credentials, OTP/2FA, passwords, CAPTCHA, KYC/identity documents, tax IDs, bank/card/payment fields, private keys, wallet addresses, signatures, or consent/legal attestations. Never submit the form. Return STRICT JSON: {\"field_actions\":[{\"field_index\":0,\"source_key\":\"full_name\",\"confidence\":0.0,\"rationale\":\"...\"}],\"blocked_fields\":[{\"field_index\":0,\"reason\":\"...\"}],\"missing_required\":[\"...\"],\"human_gate_required\":false,\"expected_result\":\"...\"}. Only create an action when confidence >= 0.86 and the field meaning clearly matches the source.\nOWNER_PROFILE="+JSON.stringify(snapshot)+"\nPAGE_FIELDS="+JSON.stringify(sanitizedFields);
  const n=await native(spec,{app:"midad-omni-agent",mode:"form_plan",owner_user_id:s.owner_user_id});
  let plan:any=null;
  if(n.ok) plan=parse(n.output);
  else {
    const x=await gemini(input(spec),"gemini-3.8-flash",[],{thinking_level:"high",thinking_summaries:"auto"});
    if(x.ok) plan=parse(outText(x.data));
  }
  if(!plan||typeof plan!=="object")return json({ok:false,error:"form_plan_unavailable"},503);
  const actions=Array.isArray(plan.field_actions)?plan.field_actions:[];
  const safeActions=actions.map((a:any)=>{
    const i=Number(a?.field_index), key=String(a?.source_key||"");
    if(!Number.isInteger(i)||i<0||i>=sanitizedFields.length||!SAFE_PROFILE_KEYS.includes(key))return null;
    const f=sanitizedFields[i]; const descriptor=[f.tag,f.type,f.name,f.id,f.placeholder,f.aria_label,f.label,f.autocomplete].join(" ");
    if(BLOCKED_FIELD.test(descriptor))return null;
    if(["password","file","hidden"].includes(f.type))return null;
    const value=safeProfileValue(snapshot,key);
    if(!value)return null;
    return {field_index:i,source_key:key,value,confidence:Math.max(0,Math.min(1,Number(a.confidence)||0)),rationale:clip(a.rationale,600)};
  }).filter(Boolean);
  return json({ok:true,action,provider:n?.ok?"midad-native":"gemini",profile:snapshot,field_actions:safeActions,blocked_fields:Array.isArray(plan.blocked_fields)?plan.blocked_fields.slice(0,80):[],missing_required:Array.isArray(plan.missing_required)?plan.missing_required.slice(0,40):[],human_gate_required:Boolean(plan.human_gate_required),expected_result:clip(plan.expected_result,1000)});
}
const prompt=clip(body.prompt,18000);if(["plan","automation_plan","communication","gemini_text","research","vision_inspect"].includes(action)&&!prompt)return json({ok:false,error:"prompt_required"},400);
if(action==="communication"){
 const target=clip(body.target_language||"en",32),source=clip(body.source_language||"auto",32),channel=clip(body.channel||"customer_support",64),role=clip(body.agent_role||"support",64),tone=clip(body.tone||"professional_warm",64),mode=clip(body.mode||"reply_translate",64),conversationId=clip(body.conversation_id,80)||crypto.randomUUID();
 const owner=await ownerProfile(sb,s.owner_user_id,body.profile||{});
 const spec=SYS+"\nAct as MIDAD Global Communication Intelligence. Understand the incoming message even when it is in another language. Produce a truthful, culturally appropriate professional draft using ONLY OWNER_PROFILE and CONTEXTS. Never invent facts, commitments, prices, dates, identities or approvals. Never send automatically. Also extract a concise client intent for downstream Revenue Intelligence. Return STRICT JSON with keys detected_language,internal_arabic_summary,intent,urgency,sentiment,extracted_requirements,reply_target,reply_arabic,translation_arabic,confidence,risk_flags,send_readiness,next_action,lead_signal. lead_signal MUST be {qualified:boolean,score:0..1,reason:string}; set qualified=true only when the message shows a plausible commercial/service opportunity, not for greetings or noise.\nSOURCE="+source+" TARGET="+target+" CHANNEL="+channel+" ROLE="+role+" TONE="+tone+" MODE="+mode+"\nOWNER_PROFILE="+JSON.stringify(owner)+"\nCONTEXTS="+JSON.stringify(body.context||[])+"\nINCOMING:\n"+prompt;
 let result:any,provider="midad-native",run_id=null,selected_model=null;
 const n=await native(spec,{app:"midad-omni-agent",mode:"communication",target_language:target,owner_user_id:s.owner_user_id});
 if(n.ok){result=parse(n.output);run_id=n.run_id;selected_model=n.model}
 else{const x=await gemini(input(spec),"gemini-3.8-flash",[],{thinking_level:"high",thinking_summaries:"auto"});if(!x.ok)return json(x,503);provider="gemini";result=parse(outText(x.data));}
 const textOut=String(result?.reply_target||"");
 const aiDraft=textOut||"";
 try{
   await sb.from("midad_messages").insert({
     user_id:s.owner_user_id,conversation_id:conversationId,external_message_id:clip(body.external_message_id,240)||null,
     direction:"in",sender_role:"client",original_text:prompt,normalized_text:clip(result?.internal_arabic_summary||prompt,12000),
     detected_language:clip(result?.detected_language||source,40),target_language:target,intent:clip(result?.intent,240)||null,
     ai_draft:aiDraft||null,final_text:null,approval_status:"not_required",
     confidence:Number.isFinite(Number(result?.confidence))?Number(result.confidence):null,
     metadata:{channel,role,tone,mode,provider,lead_signal:result?.lead_signal||null,run_id}
   });
 }catch(_){}
 let revenue:any={client_profile_id:null,lead_created:false};
 try{revenue=await persistCommunicationSignal(sb,s.owner_user_id,body,result,conversationId)}catch(_){}
 return json({ok:true,action,provider,output_text:aiDraft,result,conversation_id:conversationId,run_id,selected_model,revenue});
}
if(action==="plan"){const n=await native(SYS+"\nPlan this user mission. Return JSON with title,intent,mode,steps,gates,evidence,expected_result,fallback. USER:\n"+prompt,{profile:body.context?.profile||{},app:"midad-omni-agent"});if(n.ok)return json({ok:true,action,provider:"midad-native",output_text:n.output,plan:parse(n.output),run_id:n.run_id,selected_model:n.model});}
if(action==="automation_plan"){const spec=SYS+"\nCreate an allowlisted Automation Recipe. Allowed step types: navigate,click,type_non_secret,select,wait,extract_public_text,screenshot,human_gate,verify. Never create secret-entry or bypass steps. Return JSON: title,steps,preconditions,expected_result,fallback. USER:\n"+prompt;const n=await native(spec,{app:"midad-omni-agent",mode:"automation_plan"});if(n.ok)return json({ok:true,action,provider:"midad-native",output_text:n.output,plan:parse(n.output),run_id:n.run_id,selected_model:n.model});}
const imgs=(body.images||[]).map((x:any)=>({data:x?.data,mime_type:x?.mime_type||x?.mimeType})).filter((x:any)=>x.data&&x.mime_type);
if(action==="vision_inspect"){const g=await gemini(input(SYS+"\nInspect this UI/image and identify visible fields, blockers and safe next steps. Do not infer hidden secrets.\n"+prompt,imgs),"gemini-3.8-flash",[],{thinking_level:"high",thinking_summaries:"auto"});return g.ok?json({ok:true,action,provider:"gemini",output_text:outText(g.data),raw:g.data}):json(g,503);}
if(action==="research")return (async()=>{const g=await gemini(input(SYS+"\nResearch this request using fresh web evidence. Return sources, confidence, caveats and next actions.\n"+prompt),"gemini-3.8-flash",[{type:"google_search"}],{thinking_level:"high",thinking_summaries:"auto"});return g.ok?json({ok:true,action,provider:"gemini",output_text:outText(g.data),raw:g.data}):json(g,503)})();
if(action==="gemini_text")return (async()=>{const g=await gemini(input(SYS+"\nAnswer the user's task with explicit assumptions and next actions.\n"+prompt,imgs),"gemini-3.8-flash",[],{thinking_level:clip(body.thinking_level,10)||"high",thinking_summaries:"auto"});return g.ok?json({ok:true,action,provider:"gemini",output_text:outText(g.data),raw:g.data}):json(g,503)})();
if(action==="gemini_image"){const ref=body.reference_image?String(body.reference_image):"";const m=ref.match(/^data:([^;]+);base64,(.+)$/s);const g=await gemini(input(prompt,m?[{data:m[2],mime_type:m[1]}]:[]),"gemini-3-pro-image",[],{});if(!g.ok)return json(g,503);const img=outImage(g.data);return img?json({ok:true,action,provider:"gemini",mime_type:img.mime_type||"image/png",image_data:img.data}):json({ok:false,error:"image_output_missing"},502)}
return json({ok:false,error:"unsupported_action"},400)}catch(e){return json({ok:false,error:String(e).slice(0,1600)},500)}
});
function parse(t:string){try{return JSON.parse(t)}catch{const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a>=0&&b>a)try{return JSON.parse(t.slice(a,b+1))}catch{}return {raw:t}}}