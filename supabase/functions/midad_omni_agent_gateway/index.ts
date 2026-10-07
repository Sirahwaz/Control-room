import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"POST,OPTIONS",
  "access-control-allow-headers":"content-type,x-midad-bridge-token"
};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const clip=(v:any,n=20000)=>String(v??"").trim().slice(0,n);

async function sha256(value:string){
  const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function sessionFor(sb:any, raw:string){
  const hash=await sha256(raw);
  const {data,error}=await sb.from("midad_human_bridge_sessions")
    .select("id,owner_user_id,status,expires_at")
    .eq("token_hash",hash).maybeSingle();
  if(error||!data) return null;
  if(data.status!=="ACTIVE" || new Date(data.expires_at).getTime()<=Date.now()){
    await sb.from("midad_human_bridge_sessions").update({status:"EXPIRED"}).eq("id",data.id);
    return null;
  }
  await sb.from("midad_human_bridge_sessions").update({last_seen_at:new Date().toISOString()}).eq("id",data.id);
  return data;
}

function safeJson(text:string){
  try{return JSON.parse(text)}
  catch{
    const match=text.match(/\{[\s\S]*\}/);
    if(match) try{return JSON.parse(match[0])}catch{}
    return {raw:text};
  }
}

async function gemini(reqBody:any){
  const key=Deno.env.get("GEMINI_API_KEY")||"";
  if(!key) return {ok:false,error:"gemini_not_configured"};
  const model=clip(reqBody.model,120)||Deno.env.get("MIDAD_GEMINI_TEXT_MODEL")||"gemini-3.8-flash";
  const payload:any={model,input:reqBody.input};
  if(reqBody.response_format) payload.response_format=reqBody.response_format;
  if(reqBody.tools) payload.tools=reqBody.tools;
  const r=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
    method:"POST",
    headers:{"content-type":"application/json","x-goog-api-key":key},
    body:JSON.stringify(payload)
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) return {ok:false,error:"gemini_request_failed",status:r.status,detail:data};
  return {ok:true,data};
}

function outputText(data:any){
  if(data?.output_text) return String(data.output_text);
  if(data?.output?.text) return String(data.output.text);
  for(const s of (data?.steps||[]).slice().reverse()){
    for(const c of (s?.content||[])){
      if((c?.type==="text"||c?.type==="output_text") && c?.text) return String(c.text);
    }
  }
  return "";
}

function outputImage(data:any){
  if(data?.output_image?.data) return {data:data.output_image.data,mime_type:data.output_image.mime_type||"image/png"};
  for(const s of (data?.steps||[]).slice().reverse()){
    for(const c of (s?.content||[])){
      if(c?.type==="image" && c?.data) return {data:c.data,mime_type:c.mime_type||"image/png"};
    }
  }
  return null;
}

function textInput(prompt:string, system:string, images:any[]=[]){
  const input:any[]=[{type:"text",text:system+"\n\nUSER REQUEST:\n"+clip(prompt,18000)}];
  for(const img of images.slice(0,4)){
    if(img?.data && img?.mime_type) input.push({type:"image",mime_type:clip(img.mime_type,80),data:clip(img.data,8000000)});
  }
  return input;
}

const SYSTEM="You are the MIDAD Omni Agent reasoning core. You are a high-reliability multimodal planner.\n"+
"Principles: truthful automation, least privilege, evidence before action, provider neutrality, human approval for identity/auth/security/irreversible money actions.\n"+
"Never bypass CAPTCHA, KYC, 2FA, access controls, signatures, or identity checks. Instead create a human gate and resume after confirmation.\n"+
"Never ask for seed phrases, private keys, passwords, OTP values, or service credentials.\n"+
"Prefer MIDAD Native first; use specialized providers by capability; TinyFish is fallback only.\n"+
"Return concise, executable structure with explicit risks, gates, expected result, and fallback.";

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:H});
  if(req.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);

  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
  const body=await req.json().catch(()=>({}));
  const action=clip(body.action||"capabilities",60).toLowerCase();

  try{
    if(action==="capabilities") return json({
      ok:true,service:"midad_omni_agent_gateway",version:1,
      primary_provider:"midad-native",fallbacks:["tinyfish"],
      capabilities:["plan","automation_plan","gemini_text","gemini_image","research","vision_inspect","notebook_route"],
      human_gates:["captcha","kyc","2fa","signature","irreversible_finance"],
      secrets_policy:"server_side_only"
    });

    if(action==="notebook_route") return json({
      ok:true,provider:"gemini-notebook",mode:"browser_handoff",
      url:"https://notebooklm.google.com/",
      enterprise_api_ready:Boolean(Deno.env.get("GOOGLE_CLOUD_PROJECT")),
      note:"Consumer Gemini Notebook is routed through its official UI. Gemini Notebook Enterprise APIs can be enabled server-side when a licensed Google Cloud environment is configured."
    });

    const raw=clip(req.headers.get("x-midad-bridge-token")||body.bridge_token,500);
    if(!raw) return json({ok:false,error:"bridge_token_required"},401);
    const session=await sessionFor(sb,raw);
    if(!session) return json({ok:false,error:"bridge_session_invalid_or_expired"},401);

    if(action==="gemini_text"||action==="vision_inspect"||action==="plan"||action==="automation_plan"||action==="research"){
      const prompt=clip(body.prompt,18000);
      if(!prompt) return json({ok:false,error:"prompt_required"},400);
      let system=SYSTEM;
      if(action==="automation_plan"){
        system+="\nYou are generating an Automation Recipe. Allowed step types ONLY: navigate, click, type_non_secret, select, wait, extract_public_text, screenshot, human_gate, verify. Never create steps for passwords, OTPs, secret keys, bypasses, or irreversible transfers. Return JSON: {\"title\":string,\"steps\":[{\"type\":string,\"target\":string,\"value\":string|null,\"human_gate\":boolean,\"risk\":\"low|medium|high\"}],\"preconditions\":[string],\"expected_result\":string,\"fallback\":[string]}";
      } else if(action==="plan"){
        system+="\nReturn JSON: {\"title\":string,\"intent\":string,\"mode\":\"execute|human_gate|research|draft\",\"steps\":[string],\"gates\":[string],\"evidence\":[string],\"expected_result\":string,\"fallback\":[string]}";
      } else if(action==="research"){
        system+="\nUse Google Search grounding when useful. Return evidence-aware research with source titles/URLs when available, confidence, caveats, and next actions.";
      } else if(action==="vision_inspect"){
        system+="\nInspect supplied images or UI captures. Identify visible fields, blockers, required human actions, and safe next steps. Do not infer secrets or hidden credentials.";
      }
      const imgs=(body.images||[]).map((x:any)=>({data:x?.data,mime_type:x?.mime_type||x?.mimeType})).filter((x:any)=>x.data&&x.mime_type);
      const g=await gemini({model:body.model||null,input:textInput(prompt,system,imgs),tools:action==="research"?[{type:"google_search"}]:undefined});
      if(!g.ok) return json(g,503);
      const t=outputText(g.data);
      return json({ok:true,action,owner_user_id:session.owner_user_id,provider:"gemini",output_text:t,plan:(action==="plan"||action==="automation_plan")?safeJson(t):undefined,raw:g.data});
    }

    if(action==="gemini_image"){
      const prompt=clip(body.prompt,12000);
      if(!prompt) return json({ok:false,error:"prompt_required"},400);
      const reference=body.reference_image ? String(body.reference_image) : "";
      const match=reference.match(/^data:([^;]+);base64,(.+)$/s);
      const imgs=match?[{data:match[2],mime_type:match[1]}]:[];
      const input=textInput(prompt,SYSTEM+"\nGenerate or edit a useful professional image. Preserve identity when the user explicitly asks for an edit of a reference photo. Do not generate fake identity documents or deceptive impersonation.",imgs);
      const g=await gemini({
        model:body.model||Deno.env.get("MIDAD_GEMINI_IMAGE_MODEL")||"gemini-nano-banana-2.1",
        input,
        response_format:{type:"image",mime_type:"image/png",aspect_ratio:clip(body.aspect_ratio,10)||"1:1",image_size:clip(body.image_size,10)||"1K"}
      });
      if(!g.ok) return json(g,503);
      const img=outputImage(g.data);
      if(!img) return json({ok:false,error:"gemini_image_missing",raw:g.data},502);
      return json({ok:true,action,owner_user_id:session.owner_user_id,provider:"gemini",mime_type:img.mime_type,image_data:img.data});
    }

    return json({ok:false,error:"unsupported_action"},400);
  }catch(e){
    return json({ok:false,error:String(e).slice(0,2000)},500);
  }
});
