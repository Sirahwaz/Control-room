import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")||"";
const SK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(URL,SK,{auth:{persistSession:false,autoRefreshToken:false}});
const BASE_RPC=Deno.env.get("MIDAD_BASE_RPC_URL")||"https://mainnet.base.org";
const BASE_RPC_FALLBACKS=[...new Set([BASE_RPC,"https://base-rpc.publicnode.com","https://public.1rpc.io/base","https://mainnet.base.org"])];
const USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSFER="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const CHAIN_ID=8453;
const DECIMALS=6;
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const same=(a:any,b:any)=>String(a||"").toLowerCase()===String(b||"").toLowerCase();
const hexToBig=(h:string)=>BigInt(h||"0x0");
const hexToNum=(h:string)=>Number(hexToBig(h));
const addrTopic=(a:string)=>"0x"+"0".repeat(24)+a.slice(2).toLowerCase();

async function rpc(method:string,params:any[]){
  const errors:string[]=[];
  for(const endpoint of BASE_RPC_FALLBACKS){
    try{
      const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:Date.now(),method,params}),signal:AbortSignal.timeout(10000)});
      const j=await r.json().catch(()=>null);
      if(!r.ok||j?.error){
        const msg=String(j?.error?.message||r.status||"error").slice(0,240);
        errors.push(endpoint.replace(/^https?:\/\//,"").split("/")[0]+":"+msg);
        continue;
      }
      return j.result;
    }catch(e){
      errors.push(endpoint.replace(/^https?:\/\//,"").split("/")[0]+":"+String((e as any)?.message||e).slice(0,180));
    }
  }
  throw new Error("base_rpc_all_providers_failed:"+errors.slice(0,5).join(" | ").slice(0,800));
}
async function authorized(req:Request){
  const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(SK&&bearer===SK)return true;
  const k=req.headers.get("x-midad-autonomy-key")||"";
  if(!k)return false;
  const {data}=await db.rpc("midad_get_autonomy_key");
  return !!data && k===String(data);
}

async function scanRoute(route:any){
  const {data:wallet,error:we}=await db.from("midad_wallets")
    .select("id,label,chain,address,purpose,watch_only,active")
    .eq("id",route.wallet_id).eq("active",true).maybeSingle();
  if(we)throw we;
  if(!wallet?.address){
    await db.from("midad_wallet_monitor_state").upsert({
      route_id:route.id,last_scan_at:new Date().toISOString(),status:"BLOCKED",
      last_error:"base_usdc_wallet_missing",updated_at:new Date().toISOString()
    },{onConflict:"route_id"});
    return {ok:false,route_id:route.id,label:route.label,status:"BLOCKED",reason:"base_usdc_wallet_missing"};
  }

  const latestHex=await rpc("eth_blockNumber",[]);
  const latest=hexToNum(latestHex);
  const chainId=hexToNum(await rpc("eth_chainId",[]));
  if(chainId!==CHAIN_ID)throw new Error("wrong_chain_id:"+chainId);
  let finalBlock=latest-3;
  let finalizedTagAvailable=false;
  try{
    const b=await rpc("eth_getBlockByNumber",["finalized",false]);
    if(b?.number){finalBlock=Math.min(latest-3,hexToNum(b.number));finalizedTagAvailable=true;}
  }catch{}
  if(finalBlock<0)finalBlock=0;

  const {data:state}=await db.from("midad_wallet_monitor_state")
    .select("last_slot,last_signature,latest_balance,metadata")
    .eq("route_id",route.id).maybeSingle();
  const previous=Number(state?.last_slot||0);
  const from=Math.max(previous+1,Math.max(0,finalBlock-2000));
  const to=Math.min(finalBlock,from+1999);

  let logs:any[]=[];
  if(from<=to){
    for(let start=from;start<=to;start+=500){
      const end=Math.min(to,start+499);
      const part=await rpc("eth_getLogs",[{
        address:USDC,
        fromBlock:"0x"+start.toString(16),
        toBlock:"0x"+end.toString(16),
        topics:[TRANSFER,null,addrTopic(wallet.address)]
      }]);
      if(Array.isArray(part))logs.push(...part);
    }
  }

  const receipts:any[]=[];
  const paymentMatches:any[]=[];
  for(const log of Array.isArray(logs)?logs:[]){
    const block=hexToNum(log.blockNumber);
    if(block>finalBlock)continue;
    const txHash=String(log.transactionHash||"");
    const logIndex=hexToNum(log.logIndex||"0x0");
    const fromTopic=String(log.topics?.[1]||"");
    const toTopic=String(log.topics?.[2]||"");
    const sender="0x"+fromTopic.slice(-40);
    const recipient="0x"+toTopic.slice(-40);
    if(!txHash||!same(recipient,wallet.address)||!same(log.address,USDC))continue;
    const raw=hexToBig(log.data||"0x0");
    const amount=Number(raw)/10**DECIMALS;
    if(!(amount>0))continue;
    const confirmations=Math.max(0,latest-block);
    const evidence={
      independently_verified:true,verifier:"base_rpc",verifier_ref:txHash+":"+logIndex,
      source:"midad_base_usdc_monitor_v5",chain_id:CHAIN_ID,contract_address:USDC,
      token_contract_verified:true,recipient:wallet.address,sender,block_number:block,log_index:logIndex,
      confirmations,finality:finalizedTagAvailable?"finalized":"3_confirmations",
      observed_raw_amount:raw.toString(),decimals:DECIMALS,transfer_event_signature:TRANSFER
    };
    const ins=await db.from("midad_wallet_receipts").upsert({
      wallet_id:wallet.id,tx_hash:txHash,asset:"USDC",mint:USDC,network:"base",amount,
      direction:"inbound",slot:block,commitment:finalizedTagAvailable?"finalized":"confirmed",evidence
    },{onConflict:"wallet_id,tx_hash,asset,mint,direction"}).select("id").maybeSingle();
    if(ins.error)continue;
    const receiptId=ins.data?.id||null;
    let matchedIntent:any=null;
    // Match only an unexpired public checkout invoice for the same receiver, chain, token and exact atomic amount.
    const lowerAmount=Math.max(0,amount-0.000001);
    const upperAmount=amount+0.000001;
    const {data:candidateIntents,error:intentQueryError}=await db.from("midad_payment_intents")
      .select("id,user_id,settlement_asset,network,quoted_crypto_amount,wallet_address,expires_at,status,received_tx_hash,metadata")
      .eq("wallet_address",wallet.address).eq("settlement_asset","USDC").eq("network","base")
      .in("status",["created","quoted","waiting","detected"])
      .gt("expires_at",new Date().toISOString())
      .gte("quoted_crypto_amount",Number(lowerAmount.toFixed(6)))
      .lte("quoted_crypto_amount",Number(upperAmount.toFixed(6)))
      .limit(20);
    if(intentQueryError)throw intentQueryError;
    const exact=(candidateIntents||[]).filter((it:any)=>
      it.metadata?.created_by==="midad_public_checkout_v1" &&
      (!it.received_tx_hash||String(it.received_tx_hash).toLowerCase()===txHash.toLowerCase()) &&
      BigInt(Math.round(Number(it.quoted_crypto_amount)*1_000_000))===raw
    );
    if(exact.length===1){
      matchedIntent=exact[0];
      const nowIso=new Date().toISOString();
      const {data:existingEvent,error:existingEventError}=await db.from("midad_payment_events")
        .select("id").eq("payment_intent_id",matchedIntent.id).eq("tx_hash",txHash)
        .eq("event_type","inbound_finalized").limit(1).maybeSingle();
      if(existingEventError)throw existingEventError;
      if(!existingEvent){
        const {error:eventInsertError}=await db.from("midad_payment_events").insert({
          user_id:matchedIntent.user_id,payment_intent_id:matchedIntent.id,
          event_type:"inbound_finalized",provider:"base_rpc",tx_hash:txHash,
          asset:"USDC",network:"base",observed_amount:amount,confirmations,
          evidence:{...evidence,matched_by:"exact_usdc_atomic_amount_and_receiver",independently_verified:true,
            verifier:"base_rpc",verifier_ref:txHash+":"+logIndex,token_contract_verified:true},
          occurred_at:nowIso
        });
        if(eventInsertError){
          const {data:raceEvent,error:raceError}=await db.from("midad_payment_events")
            .select("id").eq("payment_intent_id",matchedIntent.id).eq("tx_hash",txHash)
            .eq("event_type","inbound_finalized").limit(1).maybeSingle();
          if(raceError||!raceEvent)throw eventInsertError;
        }
      }
      const {error:intentUpdateError}=await db.from("midad_payment_intents").update({
        status:"paid",reconciliation_status:"matched",received_tx_hash:txHash,
        verified_at:nowIso,paid_at:nowIso,updated_at:nowIso
      }).eq("id",matchedIntent.id).eq("user_id",matchedIntent.user_id);
      if(intentUpdateError)throw intentUpdateError;
      if(receiptId){
        const {error:receiptMatchError}=await db.from("midad_wallet_receipts")
          .update({matched_payment_intent_id:matchedIntent.id}).eq("id",receiptId);
        if(receiptMatchError)throw receiptMatchError;
      }
      const {error:orderPaidError}=await db.from("midad_store_orders").update({
        status:"PAID",paid_at:nowIso,updated_at:nowIso
      }).eq("payment_intent_id",matchedIntent.id).eq("status","AWAITING_PAYMENT");
      if(orderPaidError)throw orderPaidError;
      paymentMatches.push({payment_intent_id:matchedIntent.id,tx_hash:txHash,amount,product_id:matchedIntent.metadata?.product_id||null});
    }
    receipts.push({receipt_id:receiptId,tx_hash:txHash,amount,block,confirmations,sender,matched_payment_intent_id:matchedIntent?.id||null});
  }

  const balanceHex=await rpc("eth_call",[{
    to:USDC,data:"0x70a08231000000000000000000000000"+wallet.address.slice(2).toLowerCase()
  },"latest"]);
  const balance=Number(hexToBig(balanceHex))/10**DECIMALS;
  const now=new Date().toISOString();
  const {error:stateError}=await db.from("midad_wallet_monitor_state").upsert({
    route_id:route.id,last_scan_at:now,last_signature:receipts[receipts.length-1]?.tx_hash||state?.last_signature||null,
    last_slot:Math.max(previous,to),latest_balance:balance,latest_balance_updated_at:now,status:"VERIFIED",
    error_count:0,last_error:null,metadata:{provider:"base_rpc_fallbacks",chain_id:CHAIN_ID,token_contract:USDC,
      decimals:DECIMALS,latest_block:latest,finalized_block:finalBlock,scanned_from:from,scanned_to:to,
      receipts_detected:receipts.length,wallet_address:wallet.address},updated_at:now
  },{onConflict:"route_id"});
  if(stateError)throw stateError;
  return {ok:true,route_id:route.id,label:route.label,wallet_id:wallet.id,wallet_address:wallet.address,
    latest_block:latest,finalized_block:finalBlock,scanned_from:from,scanned_to:to,
    current_balance_usdc:balance,receipts_detected:receipts.length,payment_intents_marked_paid:paymentMatches.length,payment_matches:paymentMatches,receipts};
}
async function run(){
  const {data:routes,error}=await db.from("midad_revenue_routes")
    .select("id,label,wallet_id,address_ref,active,auto_route,requires_approval,metadata")
    .eq("active",true).eq("auto_route",true).eq("asset","USDC").eq("network","base").eq("route_kind","receive")
    .order("created_at",{ascending:true});
  if(error)throw error;
  if(!routes?.length)return {ok:false,service:"midad_base_usdc_monitor",status:"BLOCKED",reason:"base_usdc_route_missing",routes:[]};
  const results:any[]=[];
  for(const route of routes){
    try{results.push(await scanRoute(route));}
    catch(e){
      const message=String((e as any)?.message||e).slice(0,1000);
      try{
        const {data:oldState}=await db.from("midad_wallet_monitor_state").select("error_count,metadata").eq("route_id",route.id).maybeSingle();
        const oldMeta=oldState?.metadata&&typeof oldState.metadata==="object"&&!Array.isArray(oldState.metadata)?oldState.metadata:{};
        await db.from("midad_wallet_monitor_state").upsert({
          route_id:route.id,last_scan_at:new Date().toISOString(),status:"DEGRADED",
          error_count:Number(oldState?.error_count||0)+1,last_error:message,
          metadata:{...oldMeta,provider:"base_rpc_fallbacks",error_at:new Date().toISOString()},
          updated_at:new Date().toISOString()
        },{onConflict:"route_id"});
      }catch{}
      results.push({ok:false,route_id:route.id,label:route.label,status:"DEGRADED",error:message});
    }
  }
  return {
    ok:results.some(x=>x.ok),service:"midad_base_usdc_monitor",version:6,network:"base",
    scanned_routes:results.length,verified_routes:results.filter(x=>x.ok).length,
    receipts_detected:results.reduce((n,x)=>n+Number(x.receipts_detected||0),0),payment_intents_marked_paid:results.reduce((n,x)=>n+Number(x.payment_intents_marked_paid||0),0),payment_matches:results.flatMap((x:any)=>Array.isArray(x.payment_matches)?x.payment_matches:[]),routes:results,
    financial_actions:{transfers:0,payment_verifier_calls:0,settlement_router_calls:0,payment_intents_modified:0}
  };
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  if(!(await authorized(req)))return json({ok:false,error:"unauthorized"},401);
  try{
    const body=await req.json().catch(()=>({}));
    return json(await run());
  }catch(e){
    const message=String((e as any)?.message||e).slice(0,1000);
    try{
      const {data:routes}=await db.from("midad_revenue_routes").select("id").eq("active",true).eq("auto_route",true).eq("asset","USDC").eq("network","base").eq("route_kind","receive");
      for(const route of routes||[]){
        const {data:old}=await db.from("midad_wallet_monitor_state").select("error_count,metadata").eq("route_id",route.id).maybeSingle();
        const oldMeta=old?.metadata&&typeof old.metadata==="object"&&!Array.isArray(old.metadata)?old.metadata:{};
        await db.from("midad_wallet_monitor_state").upsert({
          route_id:route.id,last_scan_at:new Date().toISOString(),status:"DEGRADED",
          error_count:Number(old?.error_count||0)+1,last_error:message,
          metadata:{...oldMeta,provider:"base_rpc_fallbacks",error_at:new Date().toISOString()},
          updated_at:new Date().toISOString()
        },{onConflict:"route_id"});
      }
    }catch{}
    return json({ok:false,error:message},500);
  }
});