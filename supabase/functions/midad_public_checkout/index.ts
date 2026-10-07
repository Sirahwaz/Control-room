import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")||"";
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(URL,KEY);
const H={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"POST,OPTIONS",
  "access-control-allow-headers":"content-type,x-order-key"
};

const PRODUCTS:any={
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

async function ownerId(){
  const {data}=await db.from("profiles").select("id").limit(1).maybeSingle();
  return data?.id||null;
}

async function chooseWallet(){
  const {data:routes,error}=await db.from("midad_revenue_routes")
    .select("id,asset,network,wallet_id,address_ref,active,auto_route,requires_approval,metadata")
    .eq("active",true).eq("auto_route",true).eq("route_kind","receive")
    .eq("asset","USDC").eq("network","solana")
    .order("updated_at",{ascending:false});
  if(error) throw error;
  const sorted=(routes||[]).sort((a:any,b:any)=>{
    const pa=Number(a?.metadata?.priority??100), pb=Number(b?.metadata?.priority??100);
    return pa-pb;
  });
  const r=sorted[0];
  if(!r) return null;
  const {data:w}=await db.from("midad_wallets")
    .select("id,label,chain,address,purpose,watch_only,active")
    .eq("id",r.wallet_id).eq("active",true).maybeSingle();
  if(!w?.address) return null;
  return {route:r,wallet:w};
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

async function main(req:Request){
  if(req.method==="OPTIONS") return json(null,204);
  if(req.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);
  try{
    const body=await req.json().catch(()=>({}));
    const productId=clean(body.product_id||body.product||body.slug,80);
    const p=PRODUCTS[productId];
    if(!p) return json({ok:false,error:"unknown_product",products:Object.entries(PRODUCTS).map(([id,x]:any)=>({id,name:x.name,usd:x.usd}))},400);

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
        .in("status",["created","quoted","detected","paid"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(existing) return json({ok:true,reused:true,payment_intent:existing,product:p});
    }

    const {count}=await db.from("midad_payment_intents")
      .select("id",{count:"exact",head:true})
      .eq("user_id",oid).eq("metadata->>created_by","midad_public_checkout_v1")
      .gte("created_at",new Date(Date.now()-3600000).toISOString());
    if((count||0)>=30) return json({ok:false,error:"checkout_rate_limited"},429);

    const target=await chooseWallet();
    if(!target) return json({ok:false,error:"revenue_receive_wallet_unavailable"},503);

    const expires=Math.max(15,Math.min(180,Number(body.expires_in_minutes||60)));
    const metadata={
      created_by:"midad_public_checkout_v1",
      product_id:productId,
      product_name:p.name,
      price_usd:p.usd,
      pricing:"fixed_usdc_price",
      fee_profile:target.route.metadata?.fee_profile||null,
      verification:target.route.metadata?.verification||null,
      public_order_key:key||null,
      route_id:target.route.id,
      wallet_id:target.wallet.id,
      customer_name:customerName||null,
      customer_email:customerEmail||null,
      customer_requirements:customerRequirements||null,
      attribution
    };

    const {data:intent,error}=await db.from("midad_payment_intents").insert({
      user_id:oid,
      amount_fiat:p.usd,
      fiat_currency:"USD",
      settlement_asset:"USDC",
      network:"solana",
      quoted_crypto_amount:p.usd,
      fx_rate:1,
      quote_source:"fixed_usdc_price",
      wallet_address:target.wallet.address,
      expires_at:new Date(Date.now()+expires*60000).toISOString(),
      status:"quoted",
      confirmations_required:1,
      reconciliation_status:"pending",
      metadata
    }).select("id,status,amount_fiat,fiat_currency,settlement_asset,network,quoted_crypto_amount,wallet_address,expires_at,metadata").single();
    if(error) throw error;

    // Add a tiny per-order micro-amount (1–900 micro-USDC) to make same-price orders
    // unambiguous on-chain while keeping the advertised USD price unchanged.
    const uuidHex=intent.id.replace(/-/g,"").slice(0,8);
    const micro=((parseInt(uuidHex,16)||1)%900)+1;
    const uniqueQuote=Number((p.usd + micro/1_000_000).toFixed(6));
    const uniqueMetadata={...(intent.metadata||{}),unique_quote_micro_usdc:micro,base_price_usd:p.usd,unique_quote_reason:"collision_resistance"};
    const {data:updatedIntent,error:updateIntentError}=await db.from("midad_payment_intents").update({
      quoted_crypto_amount:uniqueQuote,
      metadata:uniqueMetadata,
      updated_at:new Date().toISOString()
    }).eq("id",intent.id).select("id,status,amount_fiat,fiat_currency,settlement_asset,network,quoted_crypto_amount,wallet_address,expires_at,metadata").single();
    if(updateIntentError) throw updateIntentError;

    const {error:orderError}=await db.from("midad_store_orders").insert({
      payment_intent_id:intent.id,
      product_id:productId,
      product_name:p.name,
      public_order_key:key||null,
      customer_name:customerName||null,
      customer_email:customerEmail||null,
      customer_requirements:customerRequirements||null,
      status:"AWAITING_PAYMENT",
      metadata:{
        price_usd:p.usd,
        settlement_asset:"USDC",
        network:"solana",
        route_id:target.route.id,
        wallet_id:target.wallet.id,
        source:"midad_public_checkout_v6",
        attribution
      }
    });
    if(orderError) throw orderError;

    const mint=target.route.metadata?.verification?.token_mint||null;
    const paymentUri=mint
      ? "solana:"+encodeURIComponent(target.wallet.address)+"?amount="+encodeURIComponent(String(updatedIntent.quoted_crypto_amount))+"&spl-token="+encodeURIComponent(mint)+"&label="+encodeURIComponent("MIDAD "+p.name)+"&message="+encodeURIComponent("MIDAD payment "+intent.id.slice(0,8))
      : null;

    return json({
      ok:true,
      product:{id:productId,...p},
      payment:{...updatedIntent,watch_only:target.wallet.watch_only},
      receiving:{asset:"USDC",network:"solana",route_id:target.route.id,wallet_id:target.wallet.id,wallet_address:target.wallet.address,mint},
      fees:{
        midad_receive_fee_usd:Number(target.route.metadata?.fee_profile?.midad_receive_fee_usd??0),
        midad_outbound_fee_usd:Number(target.route.metadata?.fee_profile?.midad_outbound_fee_usd??0),
        payer_network_fee:Boolean(target.route.metadata?.fee_profile?.payer_network_fee??true),
        payer_ata_creation_cost_possible:Boolean(target.route.metadata?.fee_profile?.payer_ata_creation_cost_possible??true)
      },
      payment_uri:paymentUri,
      attribution,
      order:{status:"AWAITING_PAYMENT",customer_contact_collected:Boolean(customerEmail||customerName||customerRequirements)},
      instructions:"Pay the exact quoted USDC amount on Solana to the displayed receiving address. The tiny micro-USDC component uniquely identifies this order; it is not a separate MIDAD fee. MIDAD charges no inbound receive fee; the sender/network may incur normal transaction or token-account creation costs. The system verifies the on-chain receipt automatically; no outbound transfer is performed."
    });
  }catch(e){
    return json({ok:false,error:"public_checkout_error",detail:String(e).slice(0,400)},500);
  }
}
Deno.serve(main);