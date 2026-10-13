import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H={"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","access-control-allow-headers":"content-type,authorization,x-midad-ingest-key","access-control-allow-methods":"POST,OPTIONS"};
const json=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers:H});
const clip=(v:any,n=4000)=>String(v??"").trim().slice(0,n);
const n=(v:any)=>{const x=Number(v);return Number.isFinite(x)?x:null};

async function audit(sb:any,userId:string,p:any){
  await sb.from("midad_audit_log").insert({
    user_id:userId,event_type:p.event_type||"payment_event",actor_type:p.actor_type||"provider",
    action:p.action||"payment_verification",subject_type:"payment_intent",subject_id:p.subject_id,
    status:p.status||"recorded",risk_class:p.risk_class||"medium",
    summary:p.summary||null,details:p.details||{}
  });
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(req.headers.get("authorization")!=="Bearer "+sk||req.headers.get("x-midad-ingest-key")!==ik)return json({error:"unauthorized"},401);
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,sk);
  const {data:profile}=await sb.from("profiles").select("id").limit(1).maybeSingle();
  if(!profile?.id)return json({error:"system_profile_missing"},503);
  const body=await req.json().catch(()=>({}));
  try{
    if(body.action==="record_event"){
      const intentId=clip(body.payment_intent_id,80);
      if(!intentId)return json({error:"payment_intent_id_required"},400);
      const {data:intent}=await sb.from("midad_payment_intents").select("*").eq("id",intentId).eq("user_id",profile.id).maybeSingle();
      if(!intent)return json({error:"payment_intent_not_found"},404);
      const event={
        user_id:profile.id,payment_intent_id:intentId,event_type:clip(body.event_type,80)||"observed",
        provider:clip(body.provider,80)||null,tx_hash:clip(body.tx_hash,200)||null,
        asset:clip(body.asset,32)||null,network:clip(body.network,80)||null,
        observed_amount:n(body.observed_amount),confirmations:n(body.confirmations)||0,
        evidence:body.evidence&&typeof body.evidence==="object"?body.evidence:{},
        occurred_at:body.occurred_at||new Date().toISOString()
      };
      const {data:ev,error:ee}=await sb.from("midad_payment_events").insert(event).select("*").single();
      if(ee)throw ee;
      await sb.from("midad_payment_intents").update({
        received_tx_hash:event.tx_hash||intent.received_tx_hash||null,
        status:"detected",
        reconciliation_status:"pending",
        updated_at:new Date().toISOString()
      }).eq("id",intentId).eq("user_id",profile.id);
      await audit(sb,profile.id,{subject_id:intentId,action:"record_payment_observation",status:"detected",summary:"تم تسجيل دليل دفع خارجي؛ لم يُعتبر الدفع مكتملًا.",details:{event_id:ev.id,provider:event.provider,asset:event.asset,network:event.network}});
      return json({ok:true,status:"detected",payment_event:ev});
    }

    if(body.action==="reconcile"){
      const intentId=clip(body.payment_intent_id,80);
      const {data:intent}=await sb.from("midad_payment_intents").select("*").eq("id",intentId).eq("user_id",profile.id).maybeSingle();
      if(!intent)return json({error:"payment_intent_not_found"},404);
      const {data:events}=await sb.from("midad_payment_events").select("*").eq("payment_intent_id",intentId).order("occurred_at",{ascending:false}).limit(20);
      const latest=(events||[])[0];
      if(!latest)return json({ok:true,status:"unreconciled",reason:"no_payment_event"});
      const assetOk=Boolean(intent.settlement_asset&&latest.asset&&String(intent.settlement_asset).toUpperCase()===String(latest.asset).toUpperCase());
      const networkOk=Boolean(intent.network&&latest.network&&String(intent.network).toLowerCase()===String(latest.network).toLowerCase());
      const expectedAmount=n(intent.quoted_crypto_amount);
      const observedAmount=n(latest.observed_amount);
      const amountOk=expectedAmount!==null&&expectedAmount>0&&observedAmount!==null&&Math.round(expectedAmount*1_000_000)===Math.round(observedAmount*1_000_000);
      const confirmations=Number(latest.confirmations||0);
      const confirmationsOk=confirmations>=Number(intent.confirmations_required||0);
      const txOk=Boolean(latest.tx_hash);
      const independentEvidence=Boolean(
        latest.provider &&
        latest.evidence &&
        latest.evidence.independently_verified===true &&
        latest.evidence.verifier &&
        latest.evidence.verifier_ref &&
        (String(latest.network||"").toLowerCase()!=="solana" || latest.evidence.mint_verified===true)
      );
      const matched=assetOk&&networkOk&&amountOk&&confirmationsOk&&txOk&&independentEvidence;
      const status=matched?"reconciled":"manual_review";
      await sb.from("midad_payment_intents").update({
        status:matched?"paid":"detected",
        reconciliation_status:matched?"matched":"manual_review",
        received_tx_hash:latest.tx_hash||intent.received_tx_hash||null,
        verified_at:matched?new Date().toISOString():null,
        paid_at:matched?new Date().toISOString():null,
        updated_at:new Date().toISOString()
      }).eq("id",intentId).eq("user_id",profile.id);
      await audit(sb,profile.id,{subject_id:intentId,action:"reconcile_payment",status,risk_class:matched?"medium":"high",summary:matched?"تمت مطابقة دليل الدفع وفق الحقول المتاحة.":"فشل شرط واحد أو أكثر؛ يلزم تحقق يدوي مستقل.",details:{assetOk,networkOk,amountOk,confirmationsOk,txOk,independentEvidence}});
      return json({ok:true,status,reconciliation:{assetOk,networkOk,amountOk,confirmationsOk,txOk,independentEvidence}});
    }

    return json({error:"unknown_action"},400);
  }catch(e){return json({ok:false,error:String(e).slice(0,1000)},500)}
});