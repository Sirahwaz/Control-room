import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,x-midad-bridge-token,x-midad-ingest-key"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const clip=(v:any,n=3000)=>String(v??"").trim().slice(0,n);
async function sha256(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");}
function token(){const b=new Uint8Array(32);crypto.getRandomValues(b);let s="";for(const x of b)s+=String.fromCharCode(x);return btoa(s).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
function pairingCode(){const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";const b=new Uint8Array(8);crypto.getRandomValues(b);return Array.from(b,x=>a[x%a.length]).join("");}
async function internal(req:Request){const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";const ik=Deno.env.get("MIDAD_INGEST_KEY")||"";return Boolean((sk&&req.headers.get("authorization")==="Bearer "+sk)||(ik&&req.headers.get("x-midad-ingest-key")===ik));}
async function getSession(sb:any,raw:string){
  const hash=await sha256(raw);
  const {data,error}=await sb.from("midad_human_bridge_sessions").select("*").eq("token_hash",hash).maybeSingle();
  if(error||!data)return null;
  if(data.status!=="ACTIVE"||new Date(data.expires_at).getTime()<=Date.now()){await sb.from("midad_human_bridge_sessions").update({status:"EXPIRED"}).eq("id",data.id);return null;}
  await sb.from("midad_human_bridge_sessions").update({last_seen_at:new Date().toISOString()}).eq("id",data.id);
  return data;
}
async function publicProfile(sb:any,userId:string){
  const [p,b,i,w,c]=await Promise.all([
    sb.from("profiles").select("full_name,business_name,avatar_url,plan").eq("id",userId).maybeSingle(),
    sb.from("brand_kits").select("business_name,logo_url,description,target_audience,dialect,tone,products,contact_info").eq("user_id",userId).order("updated_at",{ascending:false}).limit(1).maybeSingle(),
    sb.from("integrations").select("provider,status,scopes").eq("user_id",userId).order("updated_at",{ascending:false}).limit(50),
    sb.from("midad_native_signer_accounts").select("label,chain,address,status,purpose").eq("status","ACTIVE"),
    sb.from("midad_wallet_connectors").select("connector_key,provider,mode,chains,capabilities,approval_model,active").eq("active",true).order("provider")
  ]);
  const brand=b.data||{};
  return {
    identity:{full_name:p.data?.full_name||null,business_name:p.data?.business_name||brand.business_name||null,avatar_url:p.data?.avatar_url||brand.logo_url||null},
    positioning:{description:brand.description||null,target_audience:brand.target_audience||null,dialect:brand.dialect||null,tone:brand.tone||null},
    products:brand.products||[],
    contact_info:brand.contact_info||{},
    connected_accounts:(i.data||[]).map((x:any)=>({provider:x.provider,status:x.status,scopes:x.scopes||[]})),
    public_wallets:(w.data||[]).map((x:any)=>({label:x.label,chain:x.chain,address:x.address,purpose:x.purpose})),
    wallet_connectors:(c.data||[]).map((x:any)=>({connector_key:x.connector_key,provider:x.provider,mode:x.mode,chains:x.chains||[],capabilities:x.capabilities||[],approval_model:x.approval_model}))
  };
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
  const body=await req.json().catch(()=>({}));
  const action=clip(body.action||"capabilities",60).toLowerCase();
  try{
    if(action==="capabilities")return json({ok:true,service:"midad_human_bridge",version:2,client_contract:"human-bridge-v1",capabilities:["pair_device","list_tasks","ack_task","complete_task","list_browser_jobs","profile","heartbeat","revoke_session"]});
    if(action==="pair_start"){
      if(!(await internal(req)))return json({ok:false,error:"unauthorized"},401);
      const ownerUserId=clip(body.owner_user_id,80); if(!ownerUserId)return json({ok:false,error:"owner_user_id_required"},400);
      const plain=pairingCode(),hash=await sha256(plain),expiresAt=new Date(Date.now()+10*60*1000).toISOString();
      const ins=await sb.from("midad_human_bridge_pairings").insert({owner_user_id:ownerUserId,code_hash:hash,device_name:clip(body.device_name,160)||null,metadata:(body.metadata&&typeof body.metadata==="object")?body.metadata:{},expires_at:expiresAt}).select("id,expires_at").single();
      if(ins.error)return json({ok:false,error:"pairing_create_failed",detail:ins.error.message},500);
      return json({ok:true,pairing_id:ins.data.id,code:plain,expires_at:expiresAt});
    }
    if(action==="pair_from_control_room"){
      const controlRoomToken=clip(body.control_room_token,500);
      if(!controlRoomToken)return json({ok:false,error:"control_room_token_required"},401);
      const sessionHash=await sha256(controlRoomToken);
      const {data:cr,error:crErr}=await sb.from("control_room_sessions").select("id,active,created_at,last_used_at,telegram_user_id").eq("token_hash",sessionHash).eq("active",true).maybeSingle();
      if(crErr||!cr)return json({ok:false,error:"control_room_session_invalid"},401);
      const ageMs=Date.now()-new Date(cr.created_at).getTime();
      if(!Number.isFinite(ageMs)||ageMs>30*24*60*60*1000)return json({ok:false,error:"control_room_session_expired"},401);
      const {data:ownerRows}=await sb.from("midad_agent_policies").select("user_id").eq("policy_key","new$way.operator_delegation").eq("enabled",true).limit(2);
      if(!ownerRows?.length)return json({ok:false,error:"owner_identity_not_found"},404);
      const ownerIds=[...new Set(ownerRows.map((x:any)=>String(x.user_id)).filter(Boolean))];
      if(ownerIds.length!==1)return json({ok:false,error:"owner_identity_ambiguous"},409);
      const ownerUserId=ownerIds[0];
      const plain=pairingCode(),hash=await sha256(plain),expiresAt=new Date(Date.now()+10*60*1000).toISOString();
      const ins=await sb.from("midad_human_bridge_pairings").insert({
        owner_user_id:ownerUserId,
        code_hash:hash,
        device_name:clip(body.device_name,160)||"MIDAD Human Bridge",
        metadata:{source:"control_room",control_room_session_id:cr.id,telegram_user_id:cr.telegram_user_id||null},
        expires_at:expiresAt
      }).select("id,expires_at").single();
      if(ins.error)return json({ok:false,error:"pairing_create_failed",detail:ins.error.message},500);
      await sb.from("control_room_sessions").update({last_used_at:new Date().toISOString()}).eq("id",cr.id);
      return json({ok:true,pairing_id:ins.data.id,code:plain,expires_at:expiresAt,device_name:clip(body.device_name,160)||"MIDAD Human Bridge"});
    }

    if(action==="pair_complete"){
      const c=clip(body.code,40).toUpperCase(),deviceId=clip(body.device_id,160);
      if(!c||!deviceId)return json({ok:false,error:"code_and_device_id_required"},400);
      const {data:pair,error}=await sb.from("midad_human_bridge_pairings").select("*").eq("code_hash",await sha256(c)).eq("status","OPEN").maybeSingle();
      if(error||!pair)return json({ok:false,error:"invalid_or_expired_pairing_code"},401);
      if(new Date(pair.expires_at).getTime()<=Date.now()){await sb.from("midad_human_bridge_pairings").update({status:"EXPIRED"}).eq("id",pair.id);return json({ok:false,error:"pairing_code_expired"},401);}
      const raw=token(),expiresAt=new Date(Date.now()+30*24*60*60*1000).toISOString();
      const ins=await sb.from("midad_human_bridge_sessions").insert({owner_user_id:pair.owner_user_id,token_hash:await sha256(raw),device_id:deviceId,device_name:clip(body.device_name,160)||pair.device_name||null,status:"ACTIVE",expires_at:expiresAt,metadata:{paired_from:pair.id}}).select("id,owner_user_id,device_id,device_name,expires_at,status").single();
      if(ins.error)return json({ok:false,error:"session_create_failed"},500);
      await sb.from("midad_human_bridge_pairings").update({status:"USED",used_at:new Date().toISOString()}).eq("id",pair.id);
      return json({ok:true,session:ins.data,bridge_token:raw});
    }
    const raw=clip(req.headers.get("x-midad-bridge-token")||body.bridge_token,500); if(!raw)return json({ok:false,error:"bridge_token_required"},401);
    const session=await getSession(sb,raw); if(!session)return json({ok:false,error:"bridge_session_invalid_or_expired"},401);
    if(action==="heartbeat")return json({ok:true,expires_at:session.expires_at,last_seen_at:new Date().toISOString()});
    if(action==="profile")return json({ok:true,profile:await publicProfile(sb,session.owner_user_id)});
    if(action==="list_tasks"){
      const {data,error}=await sb.from("midad_human_tasks").select("id,type,priority,risk_class,blocking,title,instruction,reason,status,requested_by_agent,action_url,evidence,response_data,approval_id,requested_at,expires_at,acknowledged_at,completed_at,created_at,updated_at").eq("user_id",session.owner_user_id).in("status",["OPEN","ACKNOWLEDGED"]).order("priority",{ascending:false}).order("created_at",{ascending:false}).limit(Math.min(50,Math.max(1,Number(body.limit||25))));
      if(error)return json({ok:false,error:error.message},500); return json({ok:true,tasks:data||[]});
    }
    if(action==="ack_task"||action==="complete_task"){
      const taskId=clip(body.task_id,80); if(!taskId)return json({ok:false,error:"task_id_required"},400);
      const status=action==="ack_task"?"ACKNOWLEDGED":"COMPLETED"; const patch:any={status,updated_at:new Date().toISOString()};
      if(status==="ACKNOWLEDGED")patch.acknowledged_at=new Date().toISOString();
      else {patch.completed_at=new Date().toISOString();patch.response_data=(body.response_data&&typeof body.response_data==="object")?body.response_data:{};}
      const {data,error}=await sb.from("midad_human_tasks").update(patch).eq("id",taskId).eq("user_id",session.owner_user_id).select("id,status,title,action_url,updated_at,evidence").maybeSingle();
      if(error)return json({ok:false,error:error.message},500); if(!data)return json({ok:false,error:"task_not_found"},404);

      let resume={ok:false,skipped:true};
      const browserJobId=data.evidence?.browser_job_id||null;
      if(browserJobId && status==="COMPLETED"){
        const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
        const ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
        const base=Deno.env.get("SUPABASE_URL")||"";
        const rr=await fetch(base+"/functions/v1/midad_browser_agent_gateway",{
          method:"POST",
          headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},
          body:JSON.stringify({
            action:"complete_human_gate",
            job_id:browserJobId,
            response_data:{human_task_id:taskId,completed_from:"midad-human-bridge"}
          })
        });
        resume=await rr.json().catch(()=>({ok:false}));
      }
      return json({ok:true,task:data,resume});
    }

    if(action==="create_connection_request"){
      const providerName=clip(body.provider_name,180),kind=clip(body.kind||"wallet",40);
      const targetUrl=clip(body.target_url,1500);
      if(!providerName)return json({ok:false,error:"provider_name_required"},400);
      if(targetUrl){
        try{
          const u=new URL(targetUrl);
          if(u.protocol!=="https:")return json({ok:false,error:"target_url_must_use_https"},400);
        }catch{return json({ok:false,error:"invalid_target_url"},400);}
      }
      const idempotency="bridge-connection:"+kind+":"+providerName.toLowerCase()+":"+(targetUrl||"");
      const existing=await sb.from("midad_human_tasks").select("id,title,status,action_url,created_at").eq("user_id",session.owner_user_id).eq("idempotency_key",idempotency).maybeSingle();
      if(existing.data)return json({ok:true,idempotent:true,task:existing.data});
      const title="MIDAD — ربط "+(kind==="exchange"?"بورصة / Exchange":kind==="wallet"?"محفظة / Wallet":"منصة")+" جديدة: "+providerName;
      const instruction="افتح الرابط الرسمي وسجّل/اربط المنصة بالطريقة التي تعرضها بنفسها. لا تدخل Private Key أو Seed Phrase في MIDAD. أي توقيع أو OTP أو KYC يبقى إجراءً بشريًا داخل الصفحة. بعد إكمال الربط ارجع إلى التطبيق وأكد الإكمال.";
      const ins=await sb.from("midad_human_tasks").insert({
        user_id:session.owner_user_id,
        type:"CONNECTION",
        priority:90,
        risk_class:"high",
        blocking:true,
        title,
        instruction,
        reason:"MIDAD requested an explicit human-gated connection for a new external wallet/exchange/platform.",
        requested_by_agent:"midad_human_bridge",
        action_url:targetUrl||null,
        evidence:{connection_kind:kind,provider_name:providerName,requires_human:true},
        idempotency_key:idempotency
      }).select("id,title,status,action_url,created_at").single();
      if(ins.error)return json({ok:false,error:"connection_task_create_failed",detail:ins.error.message},500);
      return json({ok:true,task:ins.data});
    }

    if(action==="list_browser_jobs"){
      const {data,error}=await sb.from("midad_browser_jobs").select("id,agent_key,platform_key,objective,state,session_ref,current_url,human_gate,blocker,evidence,next_action,attempt_count,last_error,started_at,completed_at,created_at,updated_at").eq("owner_user_id",session.owner_user_id).order("updated_at",{ascending:false}).limit(Math.min(50,Math.max(1,Number(body.limit||25))));
      if(error)return json({ok:false,error:error.message},500); return json({ok:true,jobs:data||[]});
    }
    if(action==="revoke_session"){await sb.from("midad_human_bridge_sessions").update({status:"REVOKED",revoked_at:new Date().toISOString()}).eq("id",session.id);return json({ok:true,revoked:true});}
    return json({ok:false,error:"unsupported_action"},400);
  }catch(e){return json({ok:false,error:String(e).slice(0,1500)},500);}
});