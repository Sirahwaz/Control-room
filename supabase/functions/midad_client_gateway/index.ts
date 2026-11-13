import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleAgentMailRequest } from "./agentmail.ts";
import { prepareOutreach } from "./outreach.ts";
import { selectNegotiableCryptoRoutes, classifyPaymentIntent, classifyClientFallback, paymentIntentCreationDecision, buildPaymentIntentApprovalEvidence, paymentRouteReadinessDecision } from "./negotiation.js";

const H={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"content-type,authorization,x-midad-ingest-key,x-midad-agentmail-admin-key",
  "access-control-allow-methods":"POST,OPTIONS"
};

const json=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers:H});
const clip=(v:any,n=4000)=>String(v??"").trim().slice(0,n);
const num=(v:any)=>{const n=Number(v);return Number.isFinite(n)?n:null};
const confidence=(v:any)=>{const n=num(v);return n===null?0:Math.max(0,Math.min(1,n>1?n/100:n))};

function parseModelJson(text:string){
  const raw=String(text||"").trim();
  const fenced=raw.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"").trim();
  try{return JSON.parse(fenced)}catch{}
  const a=fenced.indexOf("{"),b=fenced.lastIndexOf("}");
  if(a>=0&&b>a){try{return JSON.parse(fenced.slice(a,b+1))}catch{}}
  return null;
}

function classifyFallback(text:string){
  return classifyClientFallback(text);
}

async function ownerId(admin:any){
  const {data}=await admin.from("profiles").select("id").limit(1).maybeSingle();
  return data?.id||null;
}

async function callOrchestrator(task:string,context:any){
  const url=Deno.env.get("SUPABASE_URL")!;
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ik=Deno.env.get("MIDAD_INGEST_KEY")!;
  const r=await fetch(url+"/functions/v1/midad_orchestrator",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "authorization":"Bearer "+sk,
      "x-midad-ingest-key":ik
    },
    body:JSON.stringify({task,role:"content",context})
  });
  const txt=await r.text();
  let j:any={};try{j=JSON.parse(txt)}catch{j={raw:txt}};
  if(!r.ok||!j?.success)throw new Error("orchestrator_unavailable");
  return String(j.final||"");
}

async function telegramToken(admin:any){
  const env=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
  const {data}=await admin.from("bot_configs").select("telegram_bot_token").eq("active",true).eq("platform","telegram").limit(1).maybeSingle();
  return data?.telegram_bot_token||env;
}

async function sendTelegram(token:string,chatId:string,text:string){
  if(!token)return {ok:false,error:"telegram_token_missing"};
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text:clip(text,4096)})
  });
  const j=await r.json().catch(()=>({}));
  return {ok:r.ok&&j?.ok===true,telegram:j};
}

async function sendAgentMail(inboxId:string,to:string,subject:string,text:string,idempotencyKey:string){
  const apiKey=Deno.env.get("AGENTMAIL_API_KEY")||"";
  if(!apiKey)return {ok:false,error:"agentmail_api_key_missing"};
  const bracketed=to.match(/<([^<>]+)>/);
  const recipient=String(bracketed?.[1]||to).trim();
  if(!inboxId||!/^\S+@\S+\.\S+$/.test(recipient))return {ok:false,error:"agentmail_recipient_or_inbox_invalid"};
  const response=await fetch("https://api.agentmail.to/v0/inboxes/"+encodeURIComponent(inboxId)+"/messages/send",{
    method:"POST",
    headers:{
      "authorization":"Bearer "+apiKey,
      "content-type":"application/json",
      "Idempotency-Key":idempotencyKey
    },
    body:JSON.stringify({to:recipient,subject:clip(subject,500),text:clip(text,8000)})
  });
  const payload=await response.json().catch(()=>({}));
  return {ok:response.ok,message_id:payload?.message_id||null,thread_id:payload?.thread_id||null,error:response.ok?null:"agentmail_send_failed"};
}

async function audit(admin:any,userId:string,p:any){
  await admin.from("midad_audit_log").insert({
    user_id:userId,
    event_type:clip(p.event_type,80)||"agent_event",
    actor_type:clip(p.actor_type,20)||"system",
    actor_ref:clip(p.actor_ref,160)||null,
    action:clip(p.action,120)||"unknown",
    subject_type:clip(p.subject_type,80)||null,
    subject_id:clip(p.subject_id,160)||null,
    status:clip(p.status,40)||"recorded",
    risk_class:["low","medium","high","critical"].includes(String(p.risk_class))?String(p.risk_class):"low",
    summary:clip(p.summary,2000)||null,
    details:p.details&&typeof p.details==="object"?p.details:{}
  });
}

async function callPolicyEngine(input:any){
  const url=Deno.env.get("SUPABASE_URL")!,sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,ik=Deno.env.get("MIDAD_INGEST_KEY")!;
  try{
    const r=await fetch(url+"/functions/v1/midad_policy_engine",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},
      body:JSON.stringify(input)
    });
    const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={}};
    return r.ok?j:{ok:false,error:"policy_engine_error"};
  }catch{return {ok:false,error:"policy_engine_unavailable"}}
}
async function policies(admin:any,userId:string){
  const {data}=await admin.from("midad_agent_policies")
    .select("policy_key,mode,priority,enabled,conditions,actions")
    .eq("user_id",userId).eq("enabled",true).order("priority",{ascending:true});
  return data||[];
}

async function loadNegotiableCryptoRoutes(admin:any){
  const {data:routes,error:routeError}=await admin.from("midad_revenue_routes")
    .select("id,label,asset,network,route_kind,active,auto_route,requires_approval,metadata")
    .eq("owner_scope","midad").eq("route_kind","receive").eq("active",true);
  if(routeError||!routes?.length)return [];
  const {data:monitors,error:monitorError}=await admin.from("midad_wallet_monitor_state")
    .select("route_id,status,last_scan_at,metadata").in("route_id",routes.map((r:any)=>r.id));
  if(monitorError)return [];
  const byRoute=new Map((monitors||[]).map((m:any)=>[String(m.route_id),m]));
  const joined=routes.map((route:any)=>({...route,monitor:byRoute.get(String(route.id))||null}));
  return selectNegotiableCryptoRoutes(joined);
}

async function getOrCreateClient(admin:any,userId:string,p:any){
  const externalRef=clip(p.external_customer_ref,200)||null;
  if(externalRef){
    const {data}=await admin.from("midad_client_profiles").select("*")
      .eq("user_id",userId).eq("external_ref",externalRef).maybeSingle();
    if(data)return data;
  }
  const {data,error}=await admin.from("midad_client_profiles").insert({
    user_id:userId,external_ref:externalRef,display_name:clip(p.client_name,160)||null,
    contact:clip(p.contact,240)||null,detected_language:clip(p.language,32)||null,
    preferred_language:clip(p.target_language,32)||null,
    metadata:{channel:clip(p.channel,40)||"unknown"}
  }).select("*").single();
  if(error)throw new Error("client_profile_create_failed");
  return data;
}

async function getOrCreateConversation(admin:any,userId:string,clientId:string,p:any){
  const channel=clip(p.channel,40)||"unknown";
  const thread=clip(p.external_thread_id,200)||null;
  if(thread){
    const {data}=await admin.from("midad_conversations").select("*")
      .eq("user_id",userId).eq("channel",channel).eq("external_thread_id",thread).maybeSingle();
    if(data){
      if(channel==="agentmail" && clip(p.inbox_id,240)){
        const metadata={...(data.metadata||{}),provider:"agentmail",inbox_id:clip(p.inbox_id,240)};
        await admin.from("midad_conversations").update({metadata}).eq("id",data.id);
        data.metadata=metadata;
      }
      return data;
    }
  }
  const {data,error}=await admin.from("midad_conversations").insert({
    user_id:userId,client_id:clientId,channel,external_thread_id:thread,
    language:clip(p.language,32)||null,topic:clip(p.topic,200)||null,
    metadata:channel==="agentmail"?{provider:"agentmail",inbox_id:clip(p.inbox_id,240)||null}:{},
    last_message_at:new Date().toISOString()
  }).select("*").single();
  if(error)throw new Error("conversation_create_failed");
  return data;
}

async function handleClientMessage(admin:any,userId:string,p:any){
  const textIn=clip(p.text,12000);
  if(!textIn) return {ok:false,error:"text_required"};
  const client=await getOrCreateClient(admin,userId,p);
  await audit(admin,userId,{event_type:"agent_event",actor_type:"client",actor_ref:clip(p.external_message_id,160),action:"client_message_received",subject_type:"conversation",subject_id:client.id,status:"recorded",risk_class:"low",summary:"رسالة عميل واردة إلى MIDAD Client Gateway",details:{channel:p.channel}});

  const convo=await getOrCreateConversation(admin,userId,client.id,p);

  await admin.from("midad_messages").insert({
    user_id:userId,conversation_id:convo.id,external_message_id:clip(p.external_message_id,200)||null,
    direction:"in",sender_role:"client",original_text:textIn,
    detected_language:clip(p.language,32)||null
  });

  const {data:recent}=await admin.from("midad_messages")
    .select("direction,sender_role,original_text,normalized_text,detected_language,target_language,intent,final_text,approval_status,created_at")
    .eq("conversation_id",convo.id).order("created_at",{ascending:false}).limit(12);

  const ps=await policies(admin,userId);
  const {data:voiceProfile}=await admin.from("midad_voice_profiles")
    .select("name,default_language,tone,formality,style_rules,preferred_terms,forbidden_terms,negotiation_rules,pricing_rules,signature")
    .eq("user_id",userId).eq("profile_key","owner_default").eq("active",true).maybeSingle();
  const cryptoPaymentRoutes=await loadNegotiableCryptoRoutes(admin).catch(()=>[]);
  const businessProfile={
    communication_auto:ps.find(x=>x.policy_key==="communication.low_risk_auto")||null,
    negotiation_gate:ps.find(x=>x.policy_key==="communication.negotiation_gate")||null,
    uncertainty_gate:ps.find(x=>x.policy_key==="ai.uncertainty")||null,
    payment_gate:ps.find(x=>x.policy_key==="payment.verification_gate")||null,
    crypto_payment_routes:cryptoPaymentRoutes,
    voice:voiceProfile||null
  };

  const fallback=classifyFallback(textIn);
  const task=[
    "You are MIDAD Client Communication Agent.",
    "Return ONLY valid JSON with keys: detected_language, target_language, intent, risk_class, confidence, summary_ar, draft_response.",
    "Understand the customer's meaning; do not translate word-for-word.",
    "Preserve the owner's authority and professional voice.",
    "CRYPTO-FIRST NEGOTIATION: Be commercially assertive, confident, concise and persistent within reasonable limits. Lead with an approved crypto settlement option when a verified route is available; explain the exact asset and network, and disclose that the payer may pay network fees. Never be rude, deceptive, coercive, threatening, or spam a client. Respect a clear refusal and offer an approved alternative if one exists.",
    "VERIFIED CRYPTO PAYMENT ROUTES: "+JSON.stringify(cryptoPaymentRoutes),
    "Only describe a crypto asset/network as currently available when it appears in VERIFIED CRYPTO PAYMENT ROUTES. A route with readiness=sender_ata_setup_required is CONDITIONAL: say the sending wallet may need to create the recipient token account during transfer, confirm that the payer wallet supports this and any network/rent fee, and obtain owner confirmation before issuing checkout details. Never describe a conditional route as ready checkout or as an issued invoice. If the list is empty, say you can confirm compatibility before issuing an invoice.",
    "Never reveal or invent wallet addresses, token contracts, QR codes, payment URIs, private keys, or signing instructions in a negotiation reply. Use the approved checkout/invoice flow to present exact payment details after explicit agreement and route validation.",
    "Never create a payment intent, issue an invoice, change a wallet destination, sign or send a transaction, or claim payment received from a customer message. Payment confirmation requires independent reconciliation by MIDAD payment verification.",
    "Do not change approved price, discount floor, scope, delivery date, refund terms, or legal commitments. Draft a counteroffer only within supplied approved boundaries; otherwise request owner approval.",
    "If a route has requires_approval=true, clearly state that the payment option needs owner confirmation; never present it as an automatically available checkout. If requires_customer_token_account_setup=true, disclose the conditional token-account setup explicitly and do not promise the payer wallet will perform it automatically.",
    "Never invent prices, delivery dates, discounts, legal commitments, payment confirmation, or capabilities.",
    "For requests needing owner approval, draft a professional response that does not make the commitment.",
    "For a normal low-risk question, produce a natural customer-facing answer in the customer's language.",
    "The internal summary must be clear Arabic.",
    "Use the OWNER VOICE PROFILE below. Do not change business commitments; use it only for wording, tone, terminology and negotiation boundaries.",
    "OWNER VOICE PROFILE: "+JSON.stringify(voiceProfile||{}),
    "Customer message: "+textIn
  ].join("\n");

  let ai:any=null, modelRaw="";
  try{modelRaw=await callOrchestrator(task,{client,conversation:convo,recent_messages:recent||[],fallback,policies:businessProfile,crypto_payment_routes:cryptoPaymentRoutes});ai=parseModelJson(modelRaw)}catch{}

  if(!ai) ai={
    detected_language:clip(p.language,32)||"unknown",
    target_language:clip(p.language,32)||"en",
    intent:fallback.intent,risk_class:fallback.risk_class,confidence:.45,
    summary_ar:"تعذر اكتمال التحليل الآلي بدرجة ثقة كافية؛ يلزم مراجعة.",
    draft_response:"شكرًا لرسالتك. سأراجع التفاصيل وأؤكد لك المعلومات النهائية."
  };

  ai.confidence=confidence(ai.confidence);
  const autoPolicy=businessProfile.communication_auto;
  const gatePolicy=businessProfile.negotiation_gate;
  const allowedIntents=Array.isArray(autoPolicy?.conditions?.intent)?autoPolicy.conditions.intent:[];
  const gatedTriggers=Array.isArray(gatePolicy?.conditions?.trigger)?gatePolicy.conditions.trigger:[];
  const paymentIntentDetected=fallback.intent==="payment_question";
  const intent=String(paymentIntentDetected?"payment_question":ai.intent||fallback.intent);
  const risk=String(paymentIntentDetected?"medium":ai.risk_class||fallback.risk_class);
  const policyDecision=await callPolicyEngine({
    scope:"client_communication",action:intent,risk_class:risk,intent,
    low_confidence:ai.confidence<.85,
    high_impact_action:risk==="high"||risk==="critical",
    missing_evidence:false,conflicting_sources:false
  });
  const centralNeedsApproval=policyDecision?.decision==="require_approval"||policyDecision?.decision==="block";
  const needsApproval = centralNeedsApproval || risk!=="low" || !allowedIntents.includes(intent) || gatedTriggers.includes(intent) || ai.confidence<.85;

  await admin.from("midad_messages").insert({
    user_id:userId,conversation_id:convo.id,direction:"out",sender_role:"agent",
    detected_language:ai.detected_language,target_language:ai.target_language,
    intent,ai_draft:clip(ai.draft_response,8000),confidence:ai.confidence,
    approval_status:needsApproval?"pending":"approved",
    final_text:needsApproval?null:clip(ai.draft_response,8000),
    metadata:{agent:"midad_client_gateway_v1",summary_ar:clip(ai.summary_ar,2000),risk_class:risk,model_parse_ok:Boolean(modelRaw),policy_decision:policyDecision?.decision||"unknown",policy_key:policyDecision?.policy_key||null}
  });

  await admin.from("midad_messages").update({normalized_text:clip(ai.summary_ar,4000),intent})
    .eq("id", (await admin.from("midad_messages").select("id").eq("conversation_id",convo.id).eq("direction","in").order("created_at",{ascending:false}).limit(1).maybeSingle()).data?.id || "");

  if(needsApproval){
    const {data:approval}=await admin.from("midad_approvals").insert({
      user_id:userId,subject_type:"client_message",subject_id:convo.id,
      action:"send_client_reply",risk_class:risk==="critical"?"critical":risk==="high"?"high":"medium",
      reason:clip(ai.summary_ar,2000),evidence:{client_id:client.id,conversation_id:convo.id,draft:clip(ai.draft_response,8000),intent,confidence:ai.confidence}
    }).select("id,status").single();
    const interimReply="شكرًا لرسالتك. سأراجع التفاصيل وأؤكد لك المعلومات النهائية.";
    if(p.send!==false && String(p.channel).toLowerCase()==="telegram"){
      const token=await telegramToken(admin);
      const chat=String(p.external_customer_ref||"").replace(/^telegram:/,"");
      await sendTelegram(token,chat,interimReply);
    }
    await audit(admin,userId,{event_type:"approval_created",actor_type:"agent",action:"create_client_reply_approval",subject_type:"client_message",subject_id:convo.id,status:"pending",risk_class:risk==="critical"?"critical":risk==="high"?"high":"medium",summary:clip(ai.summary_ar,2000),details:{approval_id:approval?.id||null,client_id:client.id,intent,confidence:ai.confidence,interim_sent:p.send!==false}});
    return {
      ok:true,mode:"approval_required",conversation_id:convo.id,client_id:client.id,
      approval_id:approval?.id||null,reply:interimReply
    };
  }

  const shouldSend=p.send!==false;
  if(shouldSend && String(p.channel).toLowerCase()==="telegram"){
    const token=await telegramToken(admin);
    const sent=await sendTelegram(token,clip(p.external_customer_ref,"1000").replace(/^telegram:/,""),ai.draft_response);
    if(sent.ok)return {ok:true,mode:"auto_sent",conversation_id:convo.id,client_id:client.id,reply:ai.draft_response};
    return {ok:true,mode:"queued",conversation_id:convo.id,client_id:client.id,reply:ai.draft_response,delivery_error:sent.error||"telegram_send_failed"};
  }
  return {ok:true,mode:"drafted",conversation_id:convo.id,client_id:client.id,reply:ai.draft_response};
}

async function requestPaymentIntentApproval(admin:any,userId:string,p:any){
  let evidence:any;
  try{evidence=buildPaymentIntentApprovalEvidence(p)}catch{return {ok:false,error:"payment_intent_request_invalid"};}
  const {data:route,error:routeError}=await admin.from("midad_revenue_routes")
    .select("id,label,asset,network,route_kind,owner_scope,active,metadata")
    .eq("id",evidence.route_id).maybeSingle();
  if(routeError||!route||route.owner_scope!=="midad"||route.route_kind!=="receive"||route.active!==true
    ||String(route.asset).toUpperCase()!==evidence.settlement_asset
    ||String(route.network).toLowerCase()!==evidence.network
    ||route.metadata?.canonical!==true) return {ok:false,error:"payment_route_not_eligible"};
  const {data:monitor,error:monitorError}=await admin.from("midad_wallet_monitor_state")
    .select("status,last_scan_at,metadata").eq("route_id",evidence.route_id).maybeSingle();
  if(monitorError)return {ok:false,error:"payment_monitor_state_unavailable"};
  const readiness=paymentRouteReadinessDecision(route,monitor);
  if(!readiness.ready)return {ok:false,error:readiness.error||"payment_route_not_ready"};
  const {data:client}=await admin.from("midad_client_profiles").select("id").eq("id",evidence.client_id).eq("user_id",userId).maybeSingle();
  if(!client)return {ok:false,error:"payment_client_not_found"};
  const {data:conversation}=await admin.from("midad_conversations").select("id,client_id").eq("id",evidence.conversation_id).eq("user_id",userId).maybeSingle();
  if(!conversation||conversation.client_id!==evidence.client_id)return {ok:false,error:"payment_conversation_not_found"};
  const {data:agreement}=await admin.from("midad_messages").select("id,original_text,created_at")
    .eq("id",evidence.agreement_message_id).eq("user_id",userId).eq("conversation_id",evidence.conversation_id)
    .eq("direction","in").eq("sender_role","client").maybeSingle();
  if(!agreement||!agreement.original_text||!agreement.created_at
    ||new Date(agreement.created_at).getTime()<Date.now()-7*24*60*60*1000
    ||new Date(agreement.created_at).getTime()>Date.now()+30000)return {ok:false,error:"customer_agreement_message_not_found"};
  evidence.customer_agreement_text=String(agreement.original_text).slice(0,12000);
  const {data:approval,error}=await admin.from("midad_approvals").insert({
    user_id:userId,subject_type:"payment_intent_request",subject_id:evidence.route_id,
    action:"create_payment_intent",risk_class:"high",
    reason:"Owner approval required for "+evidence.amount_fiat+" "+evidence.fiat_currency+" via "+evidence.network+" "+evidence.settlement_asset,
    evidence,
    expires_at:evidence.expires_at
  }).select("id,status,expires_at").single();
  if(error||!approval)throw new Error("payment_approval_request_failed");
  await audit(admin,userId,{event_type:"approval_created",actor_type:"agent",action:"create_payment_intent_approval",subject_type:"payment_intent_request",subject_id:approval.id,status:"pending",risk_class:"high",summary:"طلب موافقة مالك على إصدار طلب دفع مرتبط بمسار استلام محدد.",details:{approval_id:approval.id,route_id:evidence.route_id,amount_fiat:evidence.amount_fiat,fiat_currency:evidence.fiat_currency,asset:evidence.settlement_asset,network:evidence.network,expires_at:evidence.expires_at}});
  return {ok:true,mode:"approval_required",approval_id:approval.id,status:approval.status,expires_at:approval.expires_at,route_label:route.label};
}

async function createPaymentIntentFromApproval(admin:any,userId:string,p:any){
  const gate=paymentIntentCreationDecision(p);
  if(!gate.allowed)return {ok:false,status:"blocked",error:gate.error,http_status:gate.http_status};
  const {data,error}=await admin.rpc("midad_create_payment_intent_from_approval",{
    p_approval_id:String(p.approval_id).trim(),p_user_id:userId
  });
  if(error)throw new Error("secure_payment_intent_rpc_failed");
  if(!data?.ok)return {ok:false,status:"blocked",error:data?.error||"payment_intent_creation_blocked",http_status:409};
  await audit(admin,userId,{event_type:"payment_created",actor_type:"system",action:"create_approved_payment_intent",subject_type:"payment_intent",subject_id:data.payment_intent?.id,status:"created",risk_class:"high",summary:"إصدار طلب دفع بعد استهلاك موافقة مالك والتحقق الحي من مسار الاستلام.",details:{approval_id:p.approval_id,route_id:data.payment_intent?.route_id,idempotent:data.idempotent===true}});
  return {ok:true,mode:"payment_intent_created",idempotent:data.idempotent===true,payment_intent:data.payment_intent};
}

async function decideApproval(admin:any,userId:string,p:any){
  const approvalId=clip(p.approval_id,80);
  const decision=String(p.decision||"").toLowerCase();
  if(!approvalId||!["approved","rejected","cancelled"].includes(decision))return {ok:false,error:"approval_id_and_valid_decision_required"};
  const {data:a,error:ae}=await admin.from("midad_approvals").select("*").eq("id",approvalId).eq("user_id",userId).maybeSingle();
  if(ae||!a)return {ok:false,error:"approval_not_found"};
  if(a.status!=="pending")return {ok:false,error:"approval_not_pending"};
  if(a.evidence?.outreach_key && (!a.expires_at || new Date(a.expires_at).getTime()<=Date.now()))return {ok:false,error:"outreach_approval_expired"};
  if(a.evidence?.outreach_key && (a.evidence.suppression_checked!==true || !a.evidence.source_url || !a.evidence.lawful_basis || !a.evidence.basis_evidence))return {ok:false,error:"outreach_evidence_incomplete"};
  if(a.subject_type==="payment_intent_request" && a.action==="create_payment_intent"){
    if(decision!=="approved"){
      const {data:updated,error:updateError}=await admin.from("midad_approvals").update({
        status:decision,decision_note:clip(p.note,2000)||null,decided_at:new Date().toISOString(),decided_by:"owner"
      }).eq("id",approvalId).eq("user_id",userId).eq("status","pending").select("id,status").maybeSingle();
      if(updateError||!updated)return {ok:false,error:"payment_approval_decision_conflict"};
      return {ok:true,status:decision,approval_id:approvalId};
    }
    if(!a.expires_at||new Date(a.expires_at).getTime()<=Date.now())return {ok:false,error:"payment_approval_expired"};
    const {data:updated,error:updateError}=await admin.from("midad_approvals").update({
      status:"approved",decision_note:clip(p.note,2000)||"Owner approved exact payment terms",decided_at:new Date().toISOString(),decided_by:"owner"
    }).eq("id",approvalId).eq("user_id",userId).eq("status","pending").select("id,status").maybeSingle();
    if(updateError||!updated)return {ok:false,error:"payment_approval_decision_conflict"};
    const ev=a.evidence||{};
    await audit(admin,userId,{event_type:"approval_decided",actor_type:"owner",action:"approve_payment_intent_request",subject_type:"payment_intent_request",subject_id:approvalId,status:"approved",risk_class:"high",summary:"اعتماد شروط طلب دفع محدد؛ لا يعني ذلك إنشاء فاتورة أو إثبات استلام أموال.",details:{approval_id:approvalId,route_id:ev.route_id,amount_fiat:ev.amount_fiat,asset:ev.settlement_asset,network:ev.network}});
    return {ok:true,status:"approved",approval_id:approvalId,issuance_requires_fresh_route_verification:true};
  }
  if(decision!=="approved"){
    await admin.from("midad_approvals").update({status:decision,decision_note:clip(p.note,2000)||null,decided_at:new Date().toISOString(),decided_by:"owner"}).eq("id",approvalId);
    await admin.from("midad_messages").update({approval_status:decision==="rejected"?"rejected":"pending"})
      .eq("conversation_id",a.subject_id).eq("direction","out").eq("approval_status","pending");
    return {ok:true,status:decision};
  }
  const ev=a.evidence||{};
  const draft=clip(ev.draft,8000);
  if(!draft)return {ok:false,error:"approval_draft_missing"};
  const {data:convo}=await admin.from("midad_conversations").select("*").eq("id",a.subject_id).eq("user_id",userId).maybeSingle();
  if(!convo)return {ok:false,error:"conversation_not_found"};
  let delivery:any={ok:false,error:"delivery_not_configured"};
  if(String(convo.channel).toLowerCase()==="telegram"){
    const {data:client}=await admin.from("midad_client_profiles").select("external_ref").eq("id",ev.client_id).eq("user_id",userId).maybeSingle();
    const chat=String(client?.external_ref||"").replace(/^telegram:/,"");
    delivery=await sendTelegram(await telegramToken(admin),chat,draft);
  }else if(String(convo.channel).toLowerCase()==="agentmail"){
    const {data:client}=await admin.from("midad_client_profiles").select("contact").eq("id",ev.client_id).eq("user_id",userId).maybeSingle();
    const inboxId=clip(convo.metadata?.inbox_id,240);
    const recipient=clip(client?.contact,320);
    const subject=String(convo.topic||"").toLowerCase().startsWith("re:")?String(convo.topic):"Re: "+clip(convo.topic,450);
    delivery=await sendAgentMail(inboxId,recipient,subject,draft,"midad-approval-"+approvalId);
  }
  await admin.from("midad_approvals").update({
    status:delivery.ok?"approved":"pending",
    decision_note:clip(p.note,2000)||null,
    decided_at:delivery.ok?new Date().toISOString():null,
    decided_by:"owner"
  }).eq("id",approvalId);
  if(delivery.ok){
    await admin.from("midad_messages").update({approval_status:"approved",final_text:draft})
      .eq("conversation_id",a.subject_id).eq("direction","out").eq("approval_status","pending");
  }
  await audit(admin,userId,{event_type:"approval_decided",actor_type:"owner",action:"approval_decide",subject_type:"approval",subject_id:approvalId,status:delivery.ok?"approved":"pending",risk_class:a.risk_class||"medium",summary:decision==="approved"?"اعتماد مسودة عميل وإرسالها.":"تحديث قرار موافقة.",details:{decision,delivery_ok:delivery.ok,conversation_id:a.subject_id}});
  return {ok:true,status:delivery.ok?"approved":"pending",delivery};
}

async function main(req:Request){
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(new URL(req.url).pathname.includes("/agentmail/"))return handleAgentMailRequest(req);
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  const auth=req.headers.get("authorization")||"";
  const supplied=req.headers.get("x-midad-ingest-key")||"";
  if(!sk||!ik||auth!=="Bearer "+sk||supplied!==ik)return json({error:"unauthorized"},401);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,sk);
  const body=await req.json().catch(()=>({}));
  const uid=await ownerId(admin); if(!uid)return json({error:"system_profile_missing"},503);
  try{
    if(body.action==="outreach_prepare")return json(await prepareOutreach(admin,uid,body,{getOrCreateClient,getOrCreateConversation,audit}));
    if(body.action==="client_message")return json(await handleClientMessage(admin,uid,body));
    if(body.action==="payment_intent_request"){
      const result=await requestPaymentIntentApproval(admin,uid,body);
      const status=result.ok?200:result.error==="payment_intent_request_invalid"?400:result.error?.includes("not_found")?404:409;
      return json(result,status);
    }
    if(body.action==="payment_intent_create"){
      const result=await createPaymentIntentFromApproval(admin,uid,body);
      return json(result,result.http_status||200);
    }
    if(body.action==="approval_decide")return json(await decideApproval(admin,uid,body));
    if(body.action==="health")return json({ok:true,service:"midad_client_gateway",version:2});
    return json({error:"unknown_action"},400);
  }catch(e){return json({error:String(e).slice(0,500)},500)}
}

Deno.serve(main);