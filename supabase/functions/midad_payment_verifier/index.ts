import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H={"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","access-control-allow-headers":"content-type,authorization,x-midad-ingest-key","access-control-allow-methods":"POST,OPTIONS"};
const json=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers:H});
const clip=(v:any,n=4000)=>String(v??"").trim().slice(0,n);
const n=(v:any)=>{const x=Number(v);return Number.isFinite(x)?x:null};
const VERIFIER_VERSION=35;
const VERIFIER_CAPABILITIES={
  exact_asset_network:true,
  exact_usdc_micro_units:true,
  exact_token_micro_units:true,
  multi_asset_stablecoins:true,
  recipient_binding:true,
  canonical_chain_token:true,
  finality_evidence:true
};


function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed; } catch {}
  }
  return {};
}
function evaluateReceiptReconciliation(input) {
  const intent = input.intent || {};
  const event = input.event || {};
  const route = input.route || null;
  const wallet = input.wallet || null;
  const monitor = input.monitor || null;
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const intentMeta = asObject(intent.metadata);
  const routeMeta = asObject(route?.metadata);
  const verification = asObject(routeMeta.verification);
  const monitorMeta = asObject(monitor?.metadata);
  const eventEvidence = asObject(event.evidence);
  const net = String(intent.network || "").toLowerCase();
  const asset = String(intent.settlement_asset || "").toUpperCase();
  const isBase = net === "base";
  const isSolana = net === "solana";
  const tokenConfig = ({
    "base:USDC": {token:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals:6},
    "solana:USDC": {token:"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals:6},
    "solana:USDT": {token:"Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals:6},
    "solana:EURC": {token:"HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr", decimals:6}
  } as Record<string,{token:string;decimals:number}>)[net+":"+asset] || null;
  const supportedNetwork = Boolean(tokenConfig);
  const expectedToken = tokenConfig?.token || "";
  const tokenContract = String(verification.token_contract || verification.token_mint || "").trim();
  const receiptCandidates = (input.receipts || []).filter((r) =>
    r &&
    String(r.wallet_id || "") === String(route?.wallet_id || "") &&
    String(r.tx_hash || "") === String(event.tx_hash || "") &&
    String(r.asset || "") === String(intent.settlement_asset || "") &&
    String(r.network || "") === String(intent.network || "") &&
    String(r.direction || "") === "inbound" &&
    (isBase
      ? String(r.mint || "").toLowerCase() === tokenContract.toLowerCase()
      : String(r.mint || "") === tokenContract) &&
    (r.matched_payment_intent_id == null || String(r.matched_payment_intent_id) === String(intent.id))
  );
  const receipt = receiptCandidates.length === 1 ? receiptCandidates[0] : null;
  const receiptEvidence = asObject(receipt?.evidence);
  const eq = (a, b, insensitive = true) => insensitive
    ? String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase()
    : String(a ?? "") === String(b ?? "");
  const micros = (v) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x <= 0) return null;
    return Math.round(x * 1_000_000);
  };
  const expectedMicros = micros(intent.quoted_crypto_amount);
  const eventEpoch = isBase ? Number(eventEvidence.block_timestamp) : isSolana ? Number(eventEvidence.block_time) : NaN;
  const receiptEpoch = isBase ? Number(receiptEvidence.block_timestamp) : isSolana ? Number(receiptEvidence.block_time) : NaN;
  const chainTimeConsistent = Number.isFinite(eventEpoch) && eventEpoch > 0
    && Number.isFinite(receiptEpoch) && receiptEpoch > 0
    && Math.abs(eventEpoch - receiptEpoch) <= 1;
  const chainObservedAtMs = eventEpoch * 1000;
  const intentCreatedAtMs = Date.parse(intent.created_at || "");
  const intentExpiresAtMs = Date.parse(intent.expires_at || "");
  const paymentWithinIntentWindow = Boolean(
    chainTimeConsistent &&
    Number.isFinite(intentCreatedAtMs) &&
    Number.isFinite(intentExpiresAtMs) &&
    intentCreatedAtMs <= chainObservedAtMs &&
    chainObservedAtMs < intentExpiresAtMs
  );
  // An invoice that expired after an on-chain payment is eligible for reconciliation.
  // Explicitly cancelled or failed intents remain blocked.
  const inactive = ["cancelled", "failed"].includes(String(intent.status || "").toLowerCase());
  const intentActive = paymentWithinIntentWindow && !inactive;
  const publicCheckout = String(intentMeta.created_by || "") === "midad_public_checkout_v1";
  const routeOk = Boolean(route &&
    String(intentMeta.route_id || "") === String(route.id || "") &&
    route.active === true &&
    route.route_kind === "receive" &&
    String(route.asset || "") === String(intent.settlement_asset || "") &&
    String(route.network || "") === String(intent.network || "") &&
    tokenContract &&
    eq(tokenContract, expectedToken, !isSolana) &&
    (!publicCheckout || (route.auto_route === true && String(routeMeta.canonical) === "true"))
  );
  const addressCompareInsensitive = isBase;
  const walletOk = Boolean(wallet &&
    wallet.active === true &&
    String(wallet.id || "") === String(route?.wallet_id || "") &&
    wallet.address &&
    intent.wallet_address &&
    eq(wallet.address, intent.wallet_address, addressCompareInsensitive)
  );
  const scanTime = Date.parse(monitor?.last_scan_at || "");
  const monitorFresh = Boolean(monitor &&
    String(monitor.status || "") === "VERIFIED" &&
    Number.isFinite(scanTime) &&
    scanTime >= now - 10 * 60 * 1000 &&
    scanTime <= now + 30 * 1000
  );
  const monitorMetadataOk = isBase
    ? Number(monitorMeta.chain_id) === 8453 &&
      eq(monitorMeta.token_contract, expectedToken, true) &&
      eq(monitorMeta.wallet_address, wallet?.address, true)
    : isSolana
      ? eq(monitorMeta.mint, expectedToken, false) &&
        String(monitorMeta.asset || "").toUpperCase() === asset &&
        Number(monitorMeta.token_accounts || 0) > 0 &&
        monitorMeta.payment_reconciliation_ready === true
      : false;
  const monitorOk = monitorFresh && monitorMetadataOk;
  const receiptUnique = receiptCandidates.length === 1;
  const assetOk = Boolean(
    tokenConfig &&
    String(intent.settlement_asset || "").toUpperCase() === asset &&
    eq(event.asset, intent.settlement_asset, true) &&
    (!receipt || String(receipt.asset || "").toUpperCase() === asset)
  );
  const networkOk = Boolean(
    supportedNetwork &&
    eq(event.network, intent.network, true) &&
    (!route || String(route.network || "") === String(intent.network || ""))
  );
  const observedMicros = micros(event.observed_amount);
  const receiptMicros = micros(receipt?.amount);
  const amountOk = expectedMicros !== null && observedMicros === expectedMicros && receiptMicros === expectedMicros;
  const txOk = Boolean(event.tx_hash &&
    (!intent.received_tx_hash || String(intent.received_tx_hash) === String(event.tx_hash)) &&
    (!receipt || String(receipt.tx_hash || "") === String(event.tx_hash))
  );
  const eventRecipientOk = isBase
    ? eq(eventEvidence.recipient, wallet?.address, true)
    : isSolana && eq(eventEvidence.wallet_address, wallet?.address, false);
  const receiptRecipientOk = isBase
    ? eq(receiptEvidence.recipient, wallet?.address, true)
    : isSolana && eq(receiptEvidence.wallet_address, wallet?.address, false);
  const recipientOk = Boolean(walletOk && eventRecipientOk && receiptRecipientOk);
  const chainEventOk = isBase
    ? Number(eventEvidence.chain_id) === 8453 &&
      eventEvidence.token_contract_verified === true &&
      eq(eventEvidence.contract_address, expectedToken, true)
    : isSolana &&
      eventEvidence.mint_verified === true &&
      String(eventEvidence.expected_mint || "") === expectedToken &&
      String(eventEvidence.observed_mint || "") === expectedToken;
  const chainReceiptOk = isBase
    ? Number(receiptEvidence.chain_id) === 8453 &&
      receiptEvidence.token_contract_verified === true &&
      eq(receiptEvidence.contract_address, expectedToken, true)
    : isSolana &&
      receiptEvidence.mint_verified === true &&
      String(receiptEvidence.expected_mint || "") === expectedToken &&
      String(receiptEvidence.observed_mint || "") === expectedToken;
  const chainEvidenceOk = Boolean(chainEventOk && chainReceiptOk);
  let confirmationsOk = false;
  if (isBase) {
    const required = Math.max(3, Number(intent.confirmations_required || 0), Number(verification.confirmations_required || 0));
    const eventFinal = eventEvidence.finality === "finalized" || Number(event.confirmations || 0) >= required;
    const receiptFinal = receiptEvidence.finality === "finalized" || Number(receiptEvidence.confirmations || 0) >= required;
    confirmationsOk = eventFinal && receiptFinal;
  } else if (isSolana) {
    confirmationsOk = eventEvidence.commitment === "finalized" && receiptEvidence.commitment === "finalized";
  }
  const independentEvidence = Boolean(
    event.provider &&
    eventEvidence.independently_verified === true &&
    eventEvidence.verifier &&
    eventEvidence.verifier_ref &&
    receiptEvidence.independently_verified === true &&
    receiptEvidence.verifier &&
    receiptEvidence.verifier_ref
  );
  const duplicateIntentOk = Number(input.otherMatchingIntentCount ?? 0) === 0;
  const duplicateTxOk = Number(input.otherMatchingTxCount ?? 0) === 0;
  const storeOrderOk = !publicCheckout ||
    (Number(input.storeOrderCount ?? 0) === 1 && String(input.storeOrderStatus || "") === "AWAITING_PAYMENT");
  const matched = Boolean(
    intentActive && paymentWithinIntentWindow && supportedNetwork && routeOk && walletOk && monitorOk &&
    receiptUnique && assetOk && networkOk && amountOk && txOk &&
    recipientOk && chainEvidenceOk && confirmationsOk && independentEvidence &&
    duplicateIntentOk && duplicateTxOk && storeOrderOk
  );
  return {
    matched,
    intentActive,
    chainTimeConsistent,
    paymentWithinIntentWindow,
    routeOk,
    walletOk,
    monitorOk,
    receiptUnique,
    assetOk,
    networkOk,
    amountOk,
    txOk,
    recipientOk,
    chainEvidenceOk,
    confirmationsOk,
    independentEvidence,
    duplicateIntentOk,
    duplicateTxOk,
    storeOrderOk,
    receipt_id: receipt?.id || null
  };
}

async function audit(sb:any,userId:string,p:any){
  await sb.from("midad_audit_log").insert({
    user_id:userId,event_type:p.event_type||"payment_event",actor_type:p.actor_type||"provider",
    action:p.action||"payment_verification",subject_type:"payment_intent",subject_id:p.subject_id,
    status:p.status||"recorded",risk_class:p.risk_class||"medium",
    summary:p.summary||null,details:p.details||{}
  });
}


async function syncPublicStoreOrderPaid(sb:any,intent:any,paidAt:string|null){
  if(String(asObject(intent?.metadata).created_by||"")!=="midad_public_checkout_v1")
    return {ok:true,skipped:true,reason:"not_public_checkout"};
  if(!paidAt)return {ok:false,reason:"verified_payment_timestamp_missing"};

  const {data:orders,error:readError}=await sb.from("midad_store_orders")
    .select("id,status,paid_at").eq("payment_intent_id",intent.id).limit(2);
  if(readError)return {ok:false,reason:"store_order_read_failed"};
  if(!orders||orders.length!==1)return {ok:false,reason:"store_order_not_unique",count:(orders||[]).length};

  const before=orders[0];
  if(before.status==="AWAITING_PAYMENT"){
    const {error:updateError}=await sb.from("midad_store_orders").update({
      status:"PAID",paid_at:paidAt,updated_at:new Date().toISOString()
    }).eq("id",before.id).eq("status","AWAITING_PAYMENT");
    if(updateError)return {ok:false,reason:"store_order_paid_update_failed"};
  }else if(["PAID","FULFILLING","NEEDS_CUSTOMER_INPUT","DELIVERED"].includes(String(before.status||""))&&!before.paid_at){
    const {error:timestampError}=await sb.from("midad_store_orders").update({
      paid_at:paidAt,updated_at:new Date().toISOString()
    }).eq("id",before.id).eq("status",before.status).is("paid_at",null);
    if(timestampError)return {ok:false,reason:"store_order_paid_timestamp_update_failed"};
  }

  const {data:after,error:verifyError}=await sb.from("midad_store_orders")
    .select("id,status,paid_at").eq("payment_intent_id",intent.id).limit(2);
  if(verifyError)return {ok:false,reason:"store_order_state_verification_failed"};
  if(!after||after.length!==1)return {ok:false,reason:"store_order_not_unique_after_update",count:(after||[]).length};
  const final=after[0];
  if(["PAID","FULFILLING","NEEDS_CUSTOMER_INPUT","DELIVERED"].includes(String(final.status||""))&&final.paid_at){
    return {ok:true,order_id:final.id,status:final.status,paid_at:final.paid_at};
  }
  return {ok:false,reason:"store_order_status_requires_review",order_status:final.status||null};
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
    if(body.action==="status"){
      return json({ok:true,status:"ready",service:"midad_payment_verifier",version:VERIFIER_VERSION,capabilities:VERIFIER_CAPABILITIES});
    }
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
      if(!intentId)return json({error:"payment_intent_id_required"},400);
      const {data:intent,error:intentReadError}=await sb.from("midad_payment_intents").select("*").eq("id",intentId).eq("user_id",profile.id).maybeSingle();
      if(intentReadError)throw intentReadError;
      if(!intent)return json({error:"payment_intent_not_found"},404);
      if(intent.status==="paid"&&intent.reconciliation_status==="matched"){
        const storeOrderSync=await syncPublicStoreOrderPaid(sb,intent,intent.paid_at||null);
        if(!storeOrderSync.ok)await audit(sb,profile.id,{subject_id:intentId,action:"sync_store_order_after_verified_payment",status:"pending_manual_review",risk_class:"medium",summary:"الدفع مطابق مسبقًا؛ حالة طلب المتجر تحتاج إلى مزامنة أو مراجعة. لا تحويل ولا توقيع.",details:{store_order_sync:storeOrderSync,live_transfer:false,settlement_performed:false}});
        return json({ok:true,status:"reconciled",idempotent:true,store_order_sync:storeOrderSync,live_transfer:false,settlement_performed:false});
      }
      const intentStatus=String(intent.status||"").toLowerCase();
      const expiresAt=Date.parse(intent.expires_at||"");
      if(["cancelled","failed"].includes(intentStatus)||!Number.isFinite(expiresAt)){
        await audit(sb,profile.id,{subject_id:intentId,action:"reconcile_payment",status:"manual_review",risk_class:"high",summary:"تم إيقاف المطابقة لأن نية الدفع ملغاة/فاشلة أو بلا انتهاء صالح؛ لم يحدث تحويل.",details:{intent_status:intent.status,live_transfer:false,settlement_performed:false}});
        return json({ok:true,status:"manual_review",reason:"intent_cancelled_failed_or_expiry_missing",live_transfer:false,settlement_performed:false});
      }
      const requestedTxHash=clip(body.tx_hash,200);
      let eventQuery:any=sb.from("midad_payment_events").select("*").eq("payment_intent_id",intentId);
      if(requestedTxHash){
        eventQuery=String(intent.network||"").toLowerCase()==="base"
          ?eventQuery.ilike("tx_hash",requestedTxHash)
          :eventQuery.eq("tx_hash",requestedTxHash);
      }
      const {data:events,error:eventReadError}=await eventQuery.order("occurred_at",{ascending:false}).limit(20);
      if(eventReadError)throw eventReadError;
      const latest=(events||[])[0];
      if(!latest)return json({ok:true,status:"unreconciled",reason:requestedTxHash?"no_payment_event_for_requested_tx":"no_payment_event",live_transfer:false,settlement_performed:false});
      if(requestedTxHash&&(
        String(intent.network||"").toLowerCase()==="base"
          ?String(latest.tx_hash||"").toLowerCase()!==requestedTxHash.toLowerCase()
          :String(latest.tx_hash||"")!==requestedTxHash
      ))return json({ok:true,status:"manual_review",reason:"requested_tx_hash_mismatch",live_transfer:false,settlement_performed:false});

      const latestEvidence=asObject(latest.evidence);
      const latestEpoch=String(intent.network||"").toLowerCase()==="base"
        ?Number(latestEvidence.block_timestamp)
        :String(intent.network||"").toLowerCase()==="solana"
          ?Number(latestEvidence.block_time):NaN;
      const chainObservedAt=Number.isFinite(latestEpoch)&&latestEpoch>0
        ?new Date(latestEpoch*1000).toISOString():null;

      const markReview=async(reason:string,checks:any={})=>{
        const {error:updateError}=await sb.from("midad_payment_intents").update({
          status:String(intent.status||"").toLowerCase()==="expired"?"expired":"detected",
          reconciliation_status:"manual_review",
          received_tx_hash:intent.received_tx_hash||latest.tx_hash||null,
          verified_at:null,paid_at:null,updated_at:new Date().toISOString()
        }).eq("id",intentId).eq("user_id",profile.id);
        if(updateError)throw updateError;
        await audit(sb,profile.id,{subject_id:intentId,action:"reconcile_payment",status:"manual_review",risk_class:"high",summary:"المطابقة الآلية لم تستوفِ قيد الإيصال المستقل أو شروط سلامة قاعدة البيانات؛ لا تحويل ولا توقيع.",details:{reason,...checks,live_transfer:false,settlement_performed:false}});
        return json({ok:true,status:"manual_review",reason,reconciliation:checks,live_transfer:false,settlement_performed:false});
      };

      const routeId=String(asObject(intent.metadata).route_id||"");
      let route:any=null,wallet:any=null,monitor:any=null,receipts:any[]=[];
      const isUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(routeId);
      if(isUuid){
        const {data,error}=await sb.from("midad_revenue_routes").select("*").eq("id",routeId).eq("active",true).eq("route_kind","receive").eq("asset",intent.settlement_asset).eq("network",intent.network).maybeSingle();
        if(error)throw error;
        route=data;
      }
      if(route){
        const {data,error}=await sb.from("midad_wallets").select("id,address,active,watch_only,chain").eq("id",route.wallet_id).eq("active",true).maybeSingle();
        if(error)throw error;
        wallet=data;
        const {data:monitorData,error:monitorError}=await sb.from("midad_wallet_monitor_state").select("route_id,status,last_scan_at,metadata").eq("route_id",route.id).maybeSingle();
        if(monitorError)throw monitorError;
        monitor=monitorData;
        const routeMeta=asObject(route.metadata);
        const verification=asObject(routeMeta.verification);
        const tokenContract=String(verification.token_contract||verification.token_mint||"").trim();
        if(tokenContract&&latest.tx_hash){
          let receiptQuery:any=sb.from("midad_wallet_receipts").select("id,wallet_id,tx_hash,asset,mint,network,amount,direction,matched_payment_intent_id,evidence,commitment")
            .eq("wallet_id",route.wallet_id).eq("asset",intent.settlement_asset).eq("network",intent.network).eq("direction","inbound");
          receiptQuery=String(intent.network||"").toLowerCase()==="base"
            ?receiptQuery.eq("tx_hash",latest.tx_hash).ilike("mint",tokenContract)
            :receiptQuery.eq("tx_hash",latest.tx_hash).eq("mint",tokenContract);
          const {data:receiptData,error:receiptError}=await receiptQuery.limit(3);
          if(receiptError)throw receiptError;
          receipts=receiptData||[];
        }
      }

      let otherMatchingIntentCount=0,otherMatchingTxCount=0,storeOrderCount=0,storeOrderStatus="";
      if(wallet&&intent.wallet_address&&intent.quoted_crypto_amount!=null&&chainObservedAt){
        const {count,error}=await sb.from("midad_payment_intents").select("id",{count:"exact",head:true})
          .neq("id",intentId).ilike("wallet_address",String(intent.wallet_address))
          .eq("settlement_asset",intent.settlement_asset).eq("network",intent.network)
          .eq("quoted_crypto_amount",intent.quoted_crypto_amount)
          .lte("created_at",chainObservedAt).gt("expires_at",chainObservedAt);
        if(error)throw error;
        otherMatchingIntentCount=count||0;
      }else if(wallet&&intent.wallet_address&&intent.quoted_crypto_amount!=null){
        // Missing chain timestamp is a hard blocker, not evidence of uniqueness.
        otherMatchingIntentCount=-1;
      }
      if(latest.tx_hash){
        let txDupQuery:any=sb.from("midad_payment_intents").select("id",{count:"exact",head:true}).neq("id",intentId);
        txDupQuery=String(intent.network||"").toLowerCase()==="base"
          ?txDupQuery.ilike("received_tx_hash",String(latest.tx_hash))
          :txDupQuery.eq("received_tx_hash",String(latest.tx_hash));
        const {count,error}=await txDupQuery;
        if(error)throw error;
        otherMatchingTxCount=count||0;
      }
      if(String(asObject(intent.metadata).created_by||"")==="midad_public_checkout_v1"){
        const {data:orders,error:ordersError}=await sb.from("midad_store_orders").select("id,status").eq("payment_intent_id",intentId).limit(2);
        if(ordersError)throw ordersError;
        storeOrderCount=(orders||[]).length;
        storeOrderStatus=String(orders?.[0]?.status||"");
      }
      const checks=evaluateReceiptReconciliation({
        intent,event:latest,route,wallet,monitor,receipts,now:Date.now(),
        otherMatchingIntentCount,otherMatchingTxCount,storeOrderCount,storeOrderStatus
      });
      if(!checks.matched){
        const reason=!checks.routeOk?"route_not_verified":
          !checks.walletOk?"receiving_wallet_not_verified":
          !checks.monitorOk?"wallet_monitor_stale_or_missing_required_metadata":
          !checks.receiptUnique?"exact_verified_inbound_receipt_missing_or_ambiguous":
          !checks.assetOk?"asset_mismatch":
          !checks.networkOk?"network_mismatch":
          !checks.amountOk?"exact_amount_mismatch":
          !checks.txOk?"transaction_hash_mismatch":
          !checks.recipientOk?"recipient_wallet_mismatch":
          !checks.chainEvidenceOk?"canonical_chain_or_token_evidence_missing":
          !checks.confirmationsOk?"finality_or_confirmations_insufficient":
          !checks.independentEvidence?"independent_verifier_evidence_missing":
          !checks.duplicateIntentOk?"multiple_matching_payment_intents":
          !checks.duplicateTxOk?"transaction_already_assigned_to_another_intent":
          !checks.storeOrderOk?"store_order_not_uniquely_payable":
          !checks.paymentWithinIntentWindow?"payment_outside_intent_validity_window":
          !checks.intentActive?"intent_cancelled_failed_or_payment_time_invalid":"reconciliation_requirements_not_met";
        return await markReview(reason,checks);
      }

      const receipt=receipts.find((r:any)=>String(r.id)===String(checks.receipt_id));
      if(!receipt)return await markReview("exact_verified_inbound_receipt_missing_or_ambiguous",checks);
      if(receipt.matched_payment_intent_id==null){
        const {data:claimed,error:claimError}=await sb.from("midad_wallet_receipts").update({matched_payment_intent_id:intentId})
          .eq("id",receipt.id).is("matched_payment_intent_id",null).select("id,matched_payment_intent_id").maybeSingle();
        if(claimError)throw claimError;
        if(!claimed)return await markReview("receipt_claim_conflict",{...checks,receiptUnique:false});
      }else if(String(receipt.matched_payment_intent_id)!==intentId){
        return await markReview("receipt_claim_conflict",{...checks,receiptUnique:false});
      }
      const verifiedAt=new Date().toISOString();
      const {data:updatedIntent,error:updateError}=await sb.from("midad_payment_intents").update({
        status:"paid",reconciliation_status:"matched",received_tx_hash:latest.tx_hash,
        verified_at:verifiedAt,paid_at:verifiedAt,updated_at:verifiedAt
      }).eq("id",intentId).eq("user_id",profile.id).select("id,status,reconciliation_status,received_tx_hash,paid_at").maybeSingle();
      if(updateError)return await markReview("database_paid_guard_rejected",{...checks,guard_error:String(updateError.message||updateError).slice(0,300)});
      if(!updatedIntent||updatedIntent.status!=="paid"||updatedIntent.reconciliation_status!=="matched"||String(updatedIntent.received_tx_hash||"")!==String(latest.tx_hash||"")||!updatedIntent.paid_at){
        return await markReview("payment_intent_update_not_verified",{...checks});
      }
      const storeOrderSync=await syncPublicStoreOrderPaid(sb,intent,verifiedAt);
      if(!storeOrderSync.ok)await audit(sb,profile.id,{subject_id:intentId,action:"sync_store_order_after_verified_payment",status:"pending_manual_review",risk_class:"medium",summary:"تم التحقق من الدفع لكن حالة طلب المتجر لم تتزامن بالكامل؛ لا تحويل ولا توقيع.",details:{store_order_sync:storeOrderSync,live_transfer:false,settlement_performed:false}});
      await audit(sb,profile.id,{subject_id:intentId,action:"reconcile_payment",status:"reconciled",risk_class:"medium",summary:"تمت مطابقة دفعة واردة مع إيصال سلسلة مستقل واحد، دون تنفيذ تحويل أو توقيع.",details:{...checks,receipt_id:receipt.id,route_id:route.id,store_order_sync:storeOrderSync,live_transfer:false,settlement_performed:false}});
      return json({ok:true,status:"reconciled",reconciliation:checks,receipt_id:receipt.id,store_order_sync:storeOrderSync,live_transfer:false,settlement_performed:false,financial_actions:{transfers:0,signatures:0,settlement_performed:false}});
    }

    return json({error:"unknown_action"},400);
  }catch(e){return json({ok:false,error:String(e).slice(0,1000)},500)}
});