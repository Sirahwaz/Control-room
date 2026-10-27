import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")||"";
const SK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const INGEST_KEY=Deno.env.get("MIDAD_INGEST_KEY")||"";
const db=createClient(URL,SK,{auth:{persistSession:false,autoRefreshToken:false}});
const BASE_RPC=Deno.env.get("MIDAD_BASE_RPC_URL")||"https://mainnet.base.org";
const RPC_POOL=[BASE_RPC,"https://base-rpc.publicnode.com","https://public.1rpc.io/base"].filter((v,i,a)=>a.indexOf(v)===i);
let lastGoodRpc=BASE_RPC;
const rpcLabel=(v:string)=>{try{return v===BASE_RPC?"configured_rpc":new globalThis.URL(v).hostname}catch{return "rpc_provider"}};
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
  const choices=[lastGoodRpc,...RPC_POOL.filter(v=>v!==lastGoodRpc)];
  for(const endpoint of choices){
    try{
      const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:Date.now(),method,params}),signal:AbortSignal.timeout(8000)});
      const j=await r.json().catch(()=>null);
      if(!r.ok||j?.error){
        errors.push(rpcLabel(endpoint)+":"+String(j?.error?.message||r.status||"rpc_error").slice(0,120));
        continue;
      }
      lastGoodRpc=endpoint;
      return j.result;
    }catch(e){
      errors.push(rpcLabel(endpoint)+":"+String((e as any)?.name||"fetch_error").slice(0,80));
    }
  }
  throw new Error("base_rpc_all_providers_failed:"+errors.join("|").slice(0,600));
}
async function authorized(req:Request){
  const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(SK&&bearer===SK)return true;
  const k=req.headers.get("x-midad-autonomy-key")||"";
  if(!k)return false;
  const {data}=await db.rpc("midad_get_autonomy_key");
  return !!data && k===String(data);
}

async function verifierReadiness(){
  if(!URL||!SK||!INGEST_KEY)return false;
  try{
    const response=await fetch(URL+"/functions/v1/midad_payment_verifier",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+SK,"x-midad-ingest-key":INGEST_KEY},
      body:JSON.stringify({action:"status"}),
      signal:AbortSignal.timeout(10000)
    });
    const data=await response.json().catch(()=>({}));
    const c=data?.capabilities||{};
    return response.ok&&data?.ok===true&&data?.status==="ready"&&Number(data?.version)===35
      &&c.exact_asset_network===true&&c.exact_usdc_micro_units===true
      &&c.exact_token_micro_units===true&&c.multi_asset_stablecoins===true
      &&c.recipient_binding===true&&c.canonical_chain_token===true&&c.finality_evidence===true;
  }catch{return false}
}

async function mergeReceiptEvidence(receiptId:string, patch:any){
  const {data:row,error}=await db.from("midad_wallet_receipts").select("evidence").eq("id",receiptId).maybeSingle();
  if(error)throw new Error("base_receipt_evidence_read_failed:"+error.message);
  const current=row?.evidence&&typeof row.evidence==="object"&&!Array.isArray(row.evidence)?row.evidence:{};
  const update:any={evidence:{...current,...patch}};
  // Link a receipt to an invoice only after the strict verifier confirms an exact match.
  if(patch?.payment_intent_matched===true && patch?.payment_intent_id){
    update.matched_payment_intent_id=String(patch.payment_intent_id);
  }
  const {error:writeError}=await db.from("midad_wallet_receipts").update(update).eq("id",receiptId);
  if(writeError)throw new Error("base_receipt_evidence_write_failed:"+writeError.message);
}

async function reconcileExactBaseReceipt(input:{receiptId:string;walletAddress:string;txHash:string;amount:number;confirmations:number;evidence:any;}){
  const blockTime=Number(input.evidence?.block_timestamp||0);
  if(!Number.isFinite(blockTime)||blockTime<=0)throw new Error("base_receipt_block_timestamp_missing");
  const observedAt=new Date(blockTime*1000).toISOString();
  const {data:candidates,error:candidateError}=await db.from("midad_payment_intents")
    .select("id,quoted_crypto_amount,created_at,expires_at,status,settlement_asset,network,wallet_address")
    .eq("wallet_address",input.walletAddress).eq("settlement_asset","USDC").eq("network","base")
    .in("status",["created","quoted","waiting","detected","verified","expired"])
    .lte("created_at",observedAt).gt("expires_at",observedAt)
    .eq("quoted_crypto_amount",input.amount).limit(3);
  if(candidateError)throw new Error("base_invoice_match_query_failed:"+candidateError.message);
  const exact=(candidates||[]).filter((c:any)=>Number.isFinite(Number(c.quoted_crypto_amount))
    &&Math.round(Number(c.quoted_crypto_amount)*1_000_000)===Math.round(input.amount*1_000_000));
  if(exact.length!==1){
    const patch={payment_intent_matched:false,payment_intent_match_status:exact.length===0?"unmatched_no_exact_active_intent":"manual_review_multiple_exact_intents",payment_intent_candidate_count:exact.length,payment_intent_match_checked_at:new Date().toISOString()};
    await mergeReceiptEvidence(input.receiptId,patch);
    return {...patch,payment_verifier_calls:0};
  }
  if(!INGEST_KEY)throw new Error("base_payment_verifier_ingest_key_missing");
  const intentId=String(exact[0].id);
  const callVerifier=async(action:string,extra:any={})=>{
    const response=await fetch(URL+"/functions/v1/midad_payment_verifier",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+SK,"x-midad-ingest-key":INGEST_KEY},
      body:JSON.stringify({action,payment_intent_id:intentId,...extra}),
      signal:AbortSignal.timeout(15000)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok===false||data?.error)throw new Error("base_payment_verifier_"+action+":"+(data?.error||response.status));
    return data;
  };
  const {data:prior,error:priorError}=await db.from("midad_payment_events")
    .select("id,provider,asset,network,observed_amount,evidence")
    .eq("payment_intent_id",intentId).eq("tx_hash",input.txHash)
    .order("occurred_at",{ascending:false}).limit(1).maybeSingle();
  if(priorError)throw new Error("base_prior_payment_event_query_failed:"+priorError.message);
  if(prior){
    const priorEvidence=prior.evidence&&typeof prior.evidence==="object"?prior.evidence:{};
    const priorMatches=String(prior.asset||"").toUpperCase()==="USDC"
      &&String(prior.network||"").toLowerCase()==="base"
      &&Math.round(Number(prior.observed_amount||0)*1_000_000)===Math.round(input.amount*1_000_000)
      &&String(priorEvidence.recipient||"").toLowerCase()===input.walletAddress.toLowerCase()
      &&Number(priorEvidence.chain_id)===CHAIN_ID
      &&String(priorEvidence.contract_address||"").toLowerCase()===USDC.toLowerCase()
      &&priorEvidence.token_contract_verified===true;
    if(!priorMatches){
      const patch={payment_intent_matched:false,payment_intent_id:intentId,payment_intent_match_status:"manual_review_existing_event_mismatch",payment_intent_match_checked_at:new Date().toISOString()};
      await mergeReceiptEvidence(input.receiptId,patch);
      return {...patch,payment_verifier_calls:0};
    }
  }else{
    await callVerifier("record_event",{
      event_type:"onchain_receipt_observed",provider:"base_rpc",tx_hash:input.txHash,
      asset:"USDC",network:"base",observed_amount:input.amount,confirmations:input.confirmations,
      evidence:input.evidence,occurred_at:observedAt
    });
  }
  const verified=await callVerifier("reconcile",{tx_hash:input.txHash});
  const {data:confirmed,error:confirmError}=await db.from("midad_payment_intents")
    .select("status,reconciliation_status,received_tx_hash,paid_at").eq("id",intentId).maybeSingle();
  if(confirmError)throw new Error("base_reconciled_intent_read_failed:"+confirmError.message);
  const flags=verified?.reconciliation||{};
  const matched=verified?.status==="reconciled"
    &&flags.assetOk===true&&flags.networkOk===true&&flags.amountOk===true
    &&flags.confirmationsOk===true&&flags.txOk===true
    &&flags.recipientOk===true&&flags.chainEvidenceOk===true&&flags.independentEvidence===true
    &&String(confirmed?.status||"")==="paid"
    &&String(confirmed?.reconciliation_status||"")==="matched"
    &&String(confirmed?.received_tx_hash||"")===input.txHash
    &&Boolean(confirmed?.paid_at);
  const patch={payment_intent_matched:matched,payment_intent_id:intentId,payment_intent_match_status:matched?"reconciled":String(verified?.status||"manual_review"),payment_verifier_result:flags,payment_intent_match_checked_at:new Date().toISOString()};
  await mergeReceiptEvidence(input.receiptId,patch);
  return {...patch,payment_verifier_calls:prior?1:2};
}

async function runRoute(route:any){
  let routeId:string|null=String(route?.id||"");
  try{
  if(!route?.wallet_id) throw new Error("base_usdc_route_missing");
  const {data:wallet,error:we}=await db.from("midad_wallets")
    .select("id,label,chain,address,purpose,watch_only,active")
    .eq("id",route.wallet_id).eq("active",true).maybeSingle();
  if(we)throw we;
  if(!wallet?.address)return {ok:false,status:"BLOCKED",reason:"base_usdc_wallet_missing"};
  const paymentReconciliationReady=await verifierReadiness();
  if(!paymentReconciliationReady)throw new Error("strict_payment_verifier_capability_unavailable");

  const actualChainId=hexToNum(await rpc("eth_chainId",[]));
  if(actualChainId!==CHAIN_ID)throw new Error("base_rpc_wrong_chain:"+actualChainId);
  const latestHex=await rpc("eth_blockNumber",[]);
  const latest=hexToNum(latestHex);
  let finalBlock=latest-3;
  let finalityMode="confirmations";
  try{
    const b=await rpc("eth_getBlockByNumber",["finalized",false]);
    if(b?.number){finalBlock=Math.min(latest-3,hexToNum(b.number));finalityMode="finalized";}
  }catch{}
  if(finalBlock<0)finalBlock=0;

  const {data:state,error:stateReadError}=await db.from("midad_wallet_monitor_state")
    .select("last_slot,last_signature,latest_balance,metadata")
    .eq("route_id",route.id).maybeSingle();
  if(stateReadError)throw new Error("base_monitor_cursor_read_failed:"+stateReadError.message);
  const previous=Number(state?.last_slot||0);
  // On the first run, inspect a recent window. Once a cursor exists, continue from it
  // in bounded chunks so RPC outages do not permanently skip receipts older than 2,000 blocks.
  const hasCursor=state?.last_slot!==null&&state?.last_slot!==undefined&&previous>0;
  const from=hasCursor?previous+1:Math.max(0,finalBlock-1999);
  const to=Math.min(finalBlock,from+1999);
  const scanCaughtUp=previous>=finalBlock||to>=finalBlock;

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

  // Store a single receipt per transaction: the database idempotency key is transaction-based,
  // so multiple USDC Transfer logs in one transaction must be aggregated, not overwrite each other.
  const txGroups=new Map<string,{block:number;log_indices:number[];senders:string[];raw:bigint}>();
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
    if(raw<=0n)continue;
    let group=txGroups.get(txHash);
    if(!group){group={block,log_indices:[],senders:[],raw:0n};txGroups.set(txHash,group);}
    group.raw+=raw;
    group.log_indices.push(logIndex);
    if(!group.senders.some(x=>same(x,sender)))group.senders.push(sender);
  }
  const receipts:any[]=[];
  const blockTimeCache=new Map<number,number>();
  for(const [txHash,group] of txGroups){
    const {block,log_indices,senders,raw}=group;
    const amount=Number(raw)/10**DECIMALS;
    if(!(amount>0)||!Number.isFinite(amount))continue;
    let blockTimestamp=blockTimeCache.get(block)||0;
    if(!blockTimestamp){
      const header=await rpc("eth_getBlockByNumber",["0x"+block.toString(16),false]);
      blockTimestamp=hexToNum(header?.timestamp||"0x0");
      if(!(blockTimestamp>0))throw new Error("base_receipt_block_timestamp_missing:"+block);
      blockTimeCache.set(block,blockTimestamp);
    }
    const confirmations=Math.max(0,latest-block);
    const commitment=finalityMode==="finalized"?"finalized":"confirmed";
    const evidence={
      independently_verified:true,
      verifier:"base_rpc",
      rpc_provider:rpcLabel(lastGoodRpc),
      verifier_ref:txHash+":"+log_indices.join(","),
      source:"midad_base_usdc_monitor",
      chain_id:CHAIN_ID,
      contract_address:USDC,
      token_contract_verified:true,
      recipient:wallet.address,
      sender:senders.length===1?senders[0]:null,
      senders,
      block_number:block,
      block_timestamp:blockTimestamp,
      log_indices,
      confirmations,
      finality:finalityMode==="finalized"?"finalized":"at_least_3_confirmations",
      observed_raw_amount:raw.toString(),
      decimals:DECIMALS,
      transfer_event_signature:TRANSFER
    };
    const ins=await db.from("midad_wallet_receipts").upsert({
      wallet_id:wallet.id,
      tx_hash:txHash,
      asset:"USDC",
      mint:USDC,
      network:"base",
      amount,
      direction:"inbound",
      slot:block,
      commitment,
      evidence
    },{onConflict:"wallet_id,tx_hash,asset,mint,direction"}).select("id").maybeSingle();
    if(ins.error)throw new Error("base_receipt_persist_failed:"+ins.error.message);
    const reconciliation=ins.data?.id
      ?await reconcileExactBaseReceipt({receiptId:ins.data.id,walletAddress:wallet.address,txHash,amount,confirmations,evidence})
      :{payment_intent_matched:false,payment_intent_match_status:"receipt_id_unavailable",payment_verifier_calls:0};
    receipts.push({receipt_id:ins.data?.id||null,tx_hash:txHash,amount,block,confirmations,senders,log_indices,commitment,...reconciliation});
  }

  let balance=0;
  const balanceHex=await rpc("eth_call",[{
    to:USDC,
    data:"0x70a08231000000000000000000000000"+wallet.address.slice(2).toLowerCase()
  },"latest"]);
  balance=Number(hexToBig(balanceHex))/10**DECIMALS;

  const stateWrite=await db.from("midad_wallet_monitor_state").upsert({
    route_id:route.id,
    last_scan_at:new Date().toISOString(),
    last_signature:receipts[receipts.length-1]?.tx_hash||state?.last_signature||null,
    last_slot:Math.max(previous,to),
    latest_balance:balance,
    latest_balance_updated_at:new Date().toISOString(),
    status:"VERIFIED",
    error_count:0,
    last_error:null,
    metadata:{
      provider:rpcLabel(lastGoodRpc),
      wallet_address:wallet.address,
      chain_id:CHAIN_ID,
      token_contract:USDC,
      decimals:DECIMALS,
      latest_block:latest,
      finalized_block:finalBlock,
      scanned_from:from,
      scanned_to:to,
      receipts_detected:receipts.length,
      payment_reconciliation_ready:paymentReconciliationReady&&scanCaughtUp,
      payment_verifier_calls:receipts.reduce((sum:number,r:any)=>sum+Number(r.payment_verifier_calls||0),0),
      scan_caught_up:scanCaughtUp
    },
    updated_at:new Date().toISOString()
  },{onConflict:"route_id"});
  if(stateWrite.error)throw new Error("base_monitor_state_persist_failed:"+stateWrite.error.message);

  return {
    ok:true,
    service:"midad_base_usdc_monitor",
    network:"base",
    wallet_address:wallet.address,
    token_contract:USDC,
    latest_block:latest,
    finalized_block:finalBlock,
    scanned_from:from,
    scanned_to:to,
    current_balance_usdc:balance,
    receipts_detected:receipts.length,
    payment_reconciliation_ready:paymentReconciliationReady&&scanCaughtUp,
    scan_caught_up:scanCaughtUp,
    receipts
  };
  }catch(e){
    const message=String((e as any)?.message||e).slice(0,700);
    if(routeId){
      try{
        const {data:prior}=await db.from("midad_wallet_monitor_state").select("error_count,metadata").eq("route_id",routeId).maybeSingle();
        const priorMeta=prior?.metadata&&typeof prior.metadata==="object"?prior.metadata:{};
        await db.from("midad_wallet_monitor_state").upsert({
          route_id:routeId,
          last_scan_at:new Date().toISOString(),
          status:"DEGRADED",
          error_count:Number(prior?.error_count||0)+1,
          last_error:message,
          metadata:{...priorMeta,provider:rpcLabel(lastGoodRpc),failure_stage:"base_usdc_monitor",last_failure_at:new Date().toISOString(),last_error:message},
          updated_at:new Date().toISOString()
        },{onConflict:"route_id"});
      }catch(e2){
        console.error("base_monitor_degraded_state_write_failed",String((e2 as any)?.message||e2).slice(0,180));
      }
    }
    throw e;
  }
}


async function run(){
  const {data:routes,error}=await db.from("midad_revenue_routes")
    .select("id,label,wallet_id,address_ref,active,auto_route,requires_approval,metadata")
    .eq("active",true).eq("auto_route",true)
    .eq("asset","USDC").eq("network","base").eq("route_kind","receive")
    .order("created_at",{ascending:true});
  if(error) throw error;
  if(!routes?.length) return {ok:false,service:"midad_base_usdc_monitor",network:"base",status:"BLOCKED",reason:"base_usdc_route_missing",routes_checked:0,financial_actions:{transfers:0,signatures:0,settlement_performed:false}};
  const results:any[]=[];
  for(const route of routes){
    try{
      results.push({...await runRoute(route),route_id:route.id,label:route.label});
    }catch(e){
      results.push({ok:false,service:"midad_base_usdc_monitor",network:"base",route_id:route.id,label:route.label,status:"DEGRADED",error:String((e as any)?.message||e).slice(0,700),financial_actions:{transfers:0,signatures:0,settlement_performed:false}});
    }
  }
  return {
    ...(results[0]||{}),
    ok:results.length>0&&results.every(r=>r.ok===true),
    service:"midad_base_usdc_monitor",
    network:"base",
    routes_checked:routes.length,
    routes:results,
    financial_actions:{transfers:0,signatures:0,settlement_performed:false,payment_reconciliation_calls:results.reduce((sum,r)=>sum+Number(r.receipts?.reduce((n:any,x:any)=>n+Number(x.payment_verifier_calls||0),0)||0),0)}
  };
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  if(!(await authorized(req)))return json({ok:false,error:"unauthorized"},401);
  try{
    const body=await req.json().catch(()=>({}));
    return json(await run());
  }catch(e){
    return json({ok:false,error:String((e as any)?.message||e).slice(0,1000)},500);
  }
});