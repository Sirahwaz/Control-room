import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")||"";
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(URL,KEY);
const H={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type,x-order-key"
};

const PRODUCTS:any={
  "payment-path-mini-v1":{name:"Single-Path Checkout Diagnostic",usd:5,description:"One public checkout/payment/webhook/reconciliation path review with written findings and a reproducible retest checklist. No account access, funds handling, or transactions."},
  "miner-microscope-v1":{name:"Miner Microscope Audit",usd:39,description:"Worker-by-worker mining diagnostic snapshot with anomaly evidence and recovery checklist."},
  "opportunity-radar-v1":{name:"Opportunity Radar Pack",usd:25,description:"Fresh paid-opportunity shortlist with evidence, blockers and proposal starter."},
  "research-revenue-sprint-v1":{name:"Research-to-Revenue Sprint",usd:79,description:"Source-backed findings, contradictions, testable hypotheses and action blueprint."},
  "bug-fix-sprint-v1":{name:"Bug Fix Sprint",usd:54,description:"One reproducible Python or TypeScript bug fixed with tests."},
  "data-rescue-pack-v1":{name:"Data Rescue Pack",usd:34,description:"One CSV or JSON file cleaned, converted or validated with tests."},
  "decision-research-brief-v1":{name:"Decision Research Brief",usd:44,description:"Focused source-cited research with a decision summary."},
  "code-health-review-v1":{name:"Code Health Review",usd:74,description:"Python/JavaScript bug, security and performance review."}
};

const json=(v:any,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clean=(v:any,n=200)=>String(v??"").trim().slice(0,n);
function jsonObject(value:any){
  if(value&&typeof value==="object"&&!Array.isArray(value))return value;
  if(typeof value==="string"){try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))return parsed;}catch{}}
  return {};
}

function publicPayment(intent:any){
  return {
    id:intent.id,
    status:intent.status,
    reconciliation_status:intent.reconciliation_status||"pending",
    amount_fiat:intent.amount_fiat,
    fiat_currency:intent.fiat_currency,
    settlement_asset:intent.settlement_asset,
    network:intent.network,
    quoted_crypto_amount:intent.quoted_crypto_amount,
    wallet_address:intent.wallet_address,
    expires_at:intent.expires_at
  };
}

function reuseInstructions(payment:any){
  const status=String(payment?.status||"").toLowerCase();
  const reconciliation=String(payment?.reconciliation_status||"").toLowerCase();
  if(status==="reconciled"||reconciliation==="matched")
    return "تمت مطابقة الدفع في سجل MIDAD. لا ترسل دفعة أخرى؛ راجع حالة التسليم.";
  if(["detected","verified","paid","waiting"].includes(status)||["manual_review","mismatch","unreconciled"].includes(reconciliation))
    return "الدفع قيد التحقق أو يحتاج مراجعة. لا ترسل دفعة ثانية.";
  return "تمت إعادة استخدام الفاتورة النشطة. ادفع المبلغ الدقيق فقط قبل انتهاء الصلاحية.";
}

async function ownerId(){
  const {data}=await db.from("profiles").select("id").limit(1).maybeSingle();
  return data?.id||null;
}

async function chooseWallet(settlementAsset:string,requestedNetwork:string){
  const allowedNetworks=settlementAsset==="USDC"?["solana","base"]:settlementAsset==="USDT"?["solana"]:[];
  if(!allowedNetworks.length)return null;
  if(requestedNetwork&&!allowedNetworks.includes(requestedNetwork))return null;
  const {data:routes,error}=await db.from("midad_revenue_routes")
    .select("id,asset,network,wallet_id,address_ref,active,auto_route,requires_approval,metadata")
    .eq("active",true).eq("auto_route",true).eq("route_kind","receive")
    .eq("asset",settlementAsset).in("network",requestedNetwork?[requestedNetwork]:allowedNetworks)
    .order("updated_at",{ascending:false});
  if(error)throw error;
  const sorted=(routes||[]).sort((a:any,b:any)=>Number(a?.metadata?.priority??100)-Number(b?.metadata?.priority??100));
  const SOLANA_TOKEN_MINTS:Record<string,string>={
    USDC:"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT:"Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
  };
  const BASE_USDC_CONTRACT="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  for(const r of sorted){
    if(String(r.metadata?.canonical??"").toLowerCase()!=="true")continue;
    const {data:w,error:walletError}=await db.from("midad_wallets")
      .select("id,label,chain,address,purpose,watch_only,active").eq("id",r.wallet_id).eq("active",true).maybeSingle();
    if(walletError)throw walletError;
    if(!w?.address)continue;
    const {data:monitor,error:monitorError}=await db.from("midad_wallet_monitor_state")
      .select("status,error_count,last_scan_at,metadata").eq("route_id",r.id).maybeSingle();
    if(monitorError)throw monitorError;
    const scannedAt=Date.parse(String(monitor?.last_scan_at||""));
    const scanAgeMs=Date.now()-scannedAt;
    const network=String(r.network||"").toLowerCase();
    const monitorMetadata=jsonObject(monitor?.metadata);
    const tokenAccounts=Number(monitorMetadata.token_accounts||0);
    const configuredMint=String(r.metadata?.verification?.token_mint||"");
    const chainId=Number(monitorMetadata.chain_id||0);
    const tokenContract=String(monitorMetadata.token_contract||"").toLowerCase();
    const paymentReconciliationReady=monitorMetadata.payment_reconciliation_ready===true;
    const tokenMonitorMatches=network==="solana"
      ? configuredMint===SOLANA_TOKEN_MINTS[settlementAsset]
        &&String(monitorMetadata.mint||"")===configuredMint
        &&String(monitorMetadata.asset||"").toUpperCase()===settlementAsset
        &&paymentReconciliationReady
        &&(tokenAccounts>0 || (monitorMetadata.sender_ata_creation_supported===true && monitorMetadata.signature_scan_complete===true))
      : network==="base"&&settlementAsset==="USDC"
        ? chainId===8453&&tokenContract===BASE_USDC_CONTRACT.toLowerCase()&&paymentReconciliationReady
        : false;
    const acceptedMonitorStatus=monitor?.status==="VERIFIED"
      ||(network==="solana"&&monitor?.status==="READY_AWAITING_FIRST_TOKEN_ACCOUNT"&&tokenAccounts===0&&monitorMetadata.sender_ata_creation_supported===true);
    const ready=acceptedMonitorStatus&&Number(monitor?.error_count||0)===0&&tokenMonitorMatches
      &&Number.isFinite(scannedAt)&&scanAgeMs>=-60_000&&scanAgeMs<=10*60_000;
    if(!ready)continue;
    return {route:r,wallet:w,monitor:{status:monitor.status,last_scan_at:monitor.last_scan_at,token_accounts:tokenAccounts,chain_id:chainId,token_contract:tokenContract,mint:monitorMetadata.mint||null,asset:monitorMetadata.asset||null,payment_reconciliation_ready:paymentReconciliationReady,sender_ata_creation_supported:monitorMetadata.sender_ata_creation_supported===true,signature_scan_complete:monitorMetadata.signature_scan_complete===true}};
  }
  return null;
}

function cleanAttribution(v:any){
  const src=(v&&typeof v==="object")?v:{};
  const keys=["utm_source","utm_medium","utm_campaign","utm_content","utm_term","ref","lane","landing_path"];
  const out:any={distribution_version:"mesh-v1"};
  for(const k of keys){
    const val=String(src[k]??"").trim();
    if(val) out[k]=val.slice(0,160);
  }
  out.channel=String(out.utm_source||out.ref||"direct").slice(0,160);
  out.captured_at=String(src.captured_at||new Date().toISOString()).slice(0,60);
  return out;
}

function validEmail(v:string){
  if(!v) return true;
  if(v.length>254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}


const PUBLIC_ORDER_KEY_RE=/^store-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handlePublicOrderAction(body:any,req:Request,action:string){
  const orderKey=clean(body.order_key||req.headers.get("x-order-key"),160);
  if(!PUBLIC_ORDER_KEY_RE.test(orderKey))
    return json({ok:false,error:"invalid_order_key"},400);

  const {data:order,error:orderReadError}=await db.from("midad_store_orders")
    .select("id,product_id,product_name,public_order_key,status,paid_at,delivered_at,fulfillment_job_id,payment_intent_id,customer_requirements,metadata")
    .eq("public_order_key",orderKey).maybeSingle();
  if(orderReadError)throw orderReadError;
  if(!order)return json({ok:false,error:"order_not_found"},404);

  const {data:intent,error:intentReadError}=await db.from("midad_payment_intents")
    .select("id,status,reconciliation_status,settlement_asset,network,quoted_crypto_amount,expires_at,paid_at")
    .eq("id",order.payment_intent_id).maybeSingle();
  if(intentReadError)throw intentReadError;
  if(!intent)return json({ok:false,error:"order_payment_record_missing"},409);

  const publicOrder=(row:any,statusOverride?:string,delivery:any=null)=>({
    id:row.id,
    product_id:row.product_id,
    product_name:row.product_name,
    status:statusOverride||row.status,
    paid_at:row.paid_at||intent.paid_at||null,
    delivered_at:row.delivered_at||null,
    payment_status:intent.status,
    payment_reconciliation_status:intent.reconciliation_status,
    payment_asset:intent.settlement_asset,
    payment_network:intent.network,
    delivery
  });

  if(action==="order_status"){
    let delivery:any=null;
    if(order.fulfillment_job_id){
      const {data:job,error:jobError}=await db.from("midad_store_fulfillment_jobs")
        .select("id,status,output,output_sha256,delivered_at,adapter_key")
        .eq("id",order.fulfillment_job_id).eq("order_id",order.id).maybeSingle();
      if(jobError)throw jobError;
      if(job){
        delivery={status:job.status,output_sha256:job.output_sha256||null,delivered_at:job.delivered_at||null};
        if(job.status==="DELIVERED"&&String(job.output?.report||"").trim()){
          delivery.artifact=job.output.report;
          delivery.adapter_key=job.adapter_key;
          delivery.generated_at=job.output.generated_at||null;
        }
      }
    }
    return json({ok:true,order:publicOrder(order,undefined,delivery)});
  }

  const requirements=clean(body.requirements||body.customer_requirements,5000);
  if(!requirements)return json({ok:false,error:"requirements_required"},400);
  if(order.status!=="PAID"||intent.status!=="paid"||intent.reconciliation_status!=="matched"||!intent.paid_at||!order.paid_at)
    return json({ok:false,error:"verified_paid_order_required_before_resuming_fulfillment"},409);
  if(order.delivered_at||order.status==="DELIVERED")
    return json({ok:false,error:"order_already_delivered"},409);

  const {data:job,error:jobReadError}=await db.from("midad_store_fulfillment_jobs")
    .select("id,status,output_sha256").eq("order_id",order.id).maybeSingle();
  if(jobReadError)throw jobReadError;
  if(!job)return json({ok:false,error:"fulfillment_job_not_found"},409);
  if(job.status==="DELIVERED")return json({ok:false,error:"order_already_delivered"},409);
  if(!["WAITING_FOR_INPUT","FAILED"].includes(String(job.status||"")))
    return json({ok:false,error:"fulfillment_not_accepting_input",fulfillment_status:job.status},409);

  const metadata=jsonObject(order.metadata);
  if(metadata.customer_input_updated_at&&String(order.customer_requirements||"")===requirements&&job.status==="QUEUED"){
    return json({ok:true,updated:true,idempotent:true,order:publicOrder(order),fulfillment_status:job.status});
  }
  const now=new Date().toISOString();
  const nextMetadata={...metadata,customer_input_updated_at:now,customer_input_update_count:Number(metadata.customer_input_update_count||0)+1};
  const {data:updated,error:updateError}=await db.from("midad_store_orders").update({
    customer_requirements:requirements,metadata:nextMetadata,updated_at:now
  }).eq("id",order.id).eq("public_order_key",orderKey).eq("status","PAID")
    .select("id,product_id,product_name,status,paid_at,delivered_at,fulfillment_job_id,payment_intent_id,public_order_key,customer_requirements,metadata")
    .maybeSingle();
  if(updateError)throw updateError;
  if(!updated)return json({ok:false,error:"order_changed_during_update_retry_status"},409);

  const {error:queueError}=await db.from("midad_store_fulfillment_jobs").update({
    status:"QUEUED",input_snapshot:{product_id:updated.product_id,requirements},last_error:null,updated_at:now
  }).eq("id",job.id).in("status",["WAITING_FOR_INPUT","FAILED"]);
  if(queueError)throw queueError;

  let kick:any={ok:false,error:"fulfillment_worker_not_invoked"};
  try{
    const response=await fetch(URL+"/functions/v1/midad_store_fulfillment",{
      method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+KEY},
      body:JSON.stringify({action:"process_order",order_id:order.id}),signal:AbortSignal.timeout(90000)
    });
    kick=await response.json().catch(()=>({ok:false,error:"fulfillment_worker_invalid_response"}));
    if(!response.ok)kick={...kick,http_status:response.status};
  }catch(e){kick={ok:false,error:String((e as any)?.message||e).slice(0,250)};}
  return json({ok:true,updated:true,order:publicOrder(updated),fulfillment: kick, message:"Requirements saved. Delivery status is reported separately from payment status."});
}

async function main(req:Request){
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:H});
  if(req.method==="GET") return json({ok:true,service:"midad_public_checkout",version:"21.0.0",mode:"read_only",products:Object.entries(PRODUCTS).map(([id,x]:any)=>({id,name:x.name,usd:x.usd,description:x.description})),note:"This endpoint is read-only; it does not test payment-route readiness or create invoices."});
  if(req.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);
  try{
    const body=await req.json().catch(()=>({}));
    const action=clean(body.action,40);
    if(action==="order_status"||action==="update_requirements")return await handlePublicOrderAction(body,req,action);
    const productId=clean(body.product_id||body.product||body.slug,80);
    const p=PRODUCTS[productId];
    if(!p) return json({ok:false,error:"unknown_product",products:Object.entries(PRODUCTS).map(([id,x]:any)=>({id,name:x.name,usd:x.usd}))},400);

    const settlementAsset=clean(body.settlement_asset||body.payment_asset||"USDC",16).toUpperCase();
    if(!["USDC","USDT"].includes(settlementAsset)){
      return json({ok:false,error:"unsupported_checkout_asset",supported:[{asset:"USDC",networks:["base","solana"]},{asset:"USDT",networks:["solana"]}],monitor_only_assets:[{asset:"EURC",network:"solana",reason:"EUR/USD pricing and EUR-denominated invoicing are not enabled"}]},400);
    }
    const requestedNetwork=clean(body.network,24).toLowerCase();
    const allowedNetworks=settlementAsset==="USDC"?["base","solana"]:["solana"];
    if(requestedNetwork&&!allowedNetworks.includes(requestedNetwork)){
      return json({ok:false,error:"unsupported_asset_network_pair",asset:settlementAsset,supported_networks:allowedNetworks},400);
    }

    const customerName=clean(body.customer_name,120);
    const customerEmail=clean(body.customer_email,254).toLowerCase();
    const customerRequirements=clean(body.requirements||body.customer_requirements,5000);
    const attribution=cleanAttribution(body.attribution);
    if(!validEmail(customerEmail)) return json({ok:false,error:"invalid_customer_email"},400);

    const oid=await ownerId();
    if(!oid) return json({ok:false,error:"system_profile_missing"},503);

    const key=clean(body.order_key||req.headers.get("x-order-key"),160);
    if(key){
      const {data:existing}=await db.from("midad_payment_intents")
        .select("id,status,reconciliation_status,amount_fiat,fiat_currency,settlement_asset,network,quoted_crypto_amount,wallet_address,expires_at,metadata")
        .eq("user_id",oid).contains("metadata",{public_order_key:key})
        .in("status",["created","quoted","detected","verified","paid","reconciled"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(existing){
        const payment=publicPayment(existing);
        const receiving={asset:payment.settlement_asset,network:payment.network,wallet_address:payment.wallet_address};
        return json({ok:true,reused:true,payment,payment_intent:payment,product:p,receiving,instructions:reuseInstructions(payment)});
      }
    }

    const {count}=await db.from("midad_payment_intents")
      .select("id",{count:"exact",head:true})
      .eq("user_id",oid).eq("metadata->>created_by","midad_public_checkout_v1")
      .gte("created_at",new Date(Date.now()-3600000).toISOString());
    if((count||0)>=30) return json({ok:false,error:"checkout_rate_limited"},429);

    const target=await chooseWallet(settlementAsset,requestedNetwork);
    if(!target) return json({ok:false,error:"revenue_receive_wallet_unavailable",reason:"RECEIVING_ROUTE_NOT_READY",asset:settlementAsset,network:requestedNetwork||null,message:"مسار استقبال الأصل والشبكة المختارين غير جاهز بعد. لم تُنشأ فاتورة؛ لم تُنشأ فاتورة ولا تُقبل دفعة قبل ثبوت جاهزية المراقبة."},503);

    const expires=Math.max(15,Math.min(180,Number(body.expires_in_minutes||60)));

    // Pre-allocate the UUID so the collision-resistant quote is finalized before
    // a single database RPC atomically creates both records.
    const intentId=crypto.randomUUID();
    const uuidHex=intentId.replace(/-/g,"").slice(0,8);
    const micro=((parseInt(uuidHex,16)||1)%900)+1;
    const uniqueQuote=Number((p.usd + micro/1_000_000).toFixed(6));
    const microField="unique_quote_micro_"+settlementAsset.toLowerCase();

    const metadata={
      created_by:"midad_public_checkout_v1",
      product_id:productId,
      product_name:p.name,
      price_usd:p.usd,
      pricing:settlementAsset==="USDC"?"fixed_usdc_price":"fixed_usdt_usd_par",
      fee_profile:target.route.metadata?.fee_profile||null,
      verification:target.route.metadata?.verification||null,
      public_order_key:key||null,
      route_id:target.route.id,
      wallet_id:target.wallet.id,
      customer_name:customerName||null,
      customer_email:customerEmail||null,
      customer_requirements:customerRequirements||null,
      [microField]:micro,
      base_price_usd:p.usd,
      unique_quote_asset:settlementAsset,
      unique_quote_reason:"collision_resistance",
      attribution
    };

    const intentPayload={
      id:intentId,
      user_id:oid,
      amount_fiat:p.usd,
      fiat_currency:"USD",
      settlement_asset:settlementAsset,
      network:target.route.network,
      quoted_crypto_amount:uniqueQuote,
      fx_rate:1,
      quote_source:settlementAsset==="USDC"?"fixed_usdc_price":"fixed_usdt_usd_par",
      wallet_address:target.wallet.address,
      expires_at:new Date(Date.now()+expires*60000).toISOString(),
      status:"quoted",
      confirmations_required:1,
      reconciliation_status:"pending",
      metadata
    };
    const orderPayload={
      product_id:productId,
      product_name:p.name,
      public_order_key:key||null,
      customer_name:customerName||null,
      customer_email:customerEmail||null,
      customer_requirements:customerRequirements||null,
      status:"AWAITING_PAYMENT",
      metadata:{
        price_usd:p.usd,
        settlement_asset:settlementAsset,
        network:target.route.network,
        route_id:target.route.id,
        wallet_id:target.wallet.id,
        source:"midad_public_checkout_v7",
        attribution
      }
    };

    // PostgreSQL runs the RPC in one statement transaction: if either insert
    // fails, neither the payment intent nor its store order is committed.
    const {data:created,error:createError}=await db.rpc("midad_create_public_checkout_order",{
      p_intent:intentPayload,
      p_order:orderPayload
    });
    if(createError)throw createError;
    const updatedIntent=created?.intent;
    if(!updatedIntent?.id||String(updatedIntent.id)!==intentId){
      throw new Error("atomic_checkout_result_invalid");
    }

    const checkoutNetwork=String(target.route.network||"").toLowerCase();
    const mint=checkoutNetwork==="solana"?(target.route.metadata?.verification?.token_mint||null):null;
    const paymentUri=checkoutNetwork==="solana"&&mint
      ? "solana:"+encodeURIComponent(target.wallet.address)+"?amount="+encodeURIComponent(String(updatedIntent.quoted_crypto_amount))+"&spl-token="+encodeURIComponent(mint)+"&label="+encodeURIComponent("MIDAD "+p.name)+"&message="+encodeURIComponent("MIDAD payment "+intent.id.slice(0,8))
      : null;

    return json({
      ok:true,
      product:{id:productId,...p},
      payment:publicPayment(updatedIntent),
      receiving:{asset:settlementAsset,network:target.route.network,route_id:target.route.id,wallet_id:target.wallet.id,wallet_address:target.wallet.address,mint,chain_id:target.monitor.chain_id||null,token_contract:target.monitor.token_contract||null,token_account_present:checkoutNetwork==="solana"?Number(target.monitor.token_accounts||0)>0:true,sender_ata_creation_supported:checkoutNetwork==="solana"&&target.monitor.sender_ata_creation_supported===true},
      fees:{
        midad_receive_fee_usd:Number(target.route.metadata?.fee_profile?.midad_receive_fee_usd??0),
        midad_outbound_fee_usd:Number(target.route.metadata?.fee_profile?.midad_outbound_fee_usd??0),
        payer_network_fee:Boolean(target.route.metadata?.fee_profile?.payer_network_fee??true),
        payer_ata_creation_cost_possible:checkoutNetwork==="solana"&&Number(target.monitor.token_accounts||0)===0
      },
      payment_uri:paymentUri,
      attribution,
      order:{status:"AWAITING_PAYMENT",customer_contact_collected:Boolean(customerEmail||customerName||customerRequirements)},
      instructions:`Pay the exact quoted ${settlementAsset} amount on ${checkoutNetwork==="base"?"Base mainnet":"Solana"} to the displayed receiving address. The small micro-${settlementAsset} component uniquely identifies this order; it is not a separate MIDAD fee. ${checkoutNetwork==="solana"&&Number(target.monitor.token_accounts||0)===0?"No token account exists yet for this asset. The sender's wallet must support creating the recipient's associated token account within the payment transaction; the sender pays any account-storage reserve and network fee. If the sending wallet cannot do this, do not submit the payment until account creation is supported. ":""}MIDAD charges no inbound receive fee; normal sender/network transaction costs may apply. The system verifies the on-chain receipt automatically; no outbound transfer is performed.`
    });
  }catch(e){
    return json({ok:false,error:"public_checkout_error",detail:String(e).slice(0,400)},500);
  }
}
Deno.serve(main);