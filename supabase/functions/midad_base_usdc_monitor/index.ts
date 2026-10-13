import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")||"";
const SK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
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

async function run(){
  let routeId:string|null=null;
  try{
  const {data:route,error:re}=await db.from("midad_revenue_routes")
    .select("id,label,wallet_id,address_ref,active,auto_route,requires_approval,metadata")
    .eq("active",true).eq("auto_route",true)
    .eq("asset","USDC").eq("network","base").eq("route_kind","receive")
    .limit(1).maybeSingle();
  if(re)throw re;
  if(!route?.wallet_id) return {ok:false,status:"BLOCKED",reason:"base_usdc_route_missing"};
  routeId=String(route.id);
  const {data:wallet,error:we}=await db.from("midad_wallets")
    .select("id,label,chain,address,purpose,watch_only,active")
    .eq("id",route.wallet_id).eq("active",true).maybeSingle();
  if(we)throw we;
  if(!wallet?.address)return {ok:false,status:"BLOCKED",reason:"base_usdc_wallet_missing"};

  const actualChainId=hexToNum(await rpc("eth_chainId",[]));
  if(actualChainId!==CHAIN_ID)throw new Error("base_rpc_wrong_chain:"+actualChainId);
  const latestHex=await rpc("eth_blockNumber",[]);
  const latest=hexToNum(latestHex);
  let finalBlock=latest-3;
  try{
    const b=await rpc("eth_getBlockByNumber",["finalized",false]);
    if(b?.number) finalBlock=Math.min(latest-3,hexToNum(b.number));
  }catch{}
  if(finalBlock<0)finalBlock=0;

  const {data:state}=await db.from("midad_wallet_monitor_state")
    .select("last_slot,latest_balance,metadata")
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
      independently_verified:true,
      verifier:"base_rpc",
      rpc_provider:rpcLabel(lastGoodRpc),
      verifier_ref:txHash+":"+logIndex,
      source:"midad_base_usdc_monitor",
      chain_id:CHAIN_ID,
      contract_address:USDC,
      token_contract_verified:true,
      recipient:wallet.address,
      sender,
      block_number:block,
      log_index:logIndex,
      confirmations,
      finality:"finalized_or_3_confirmations",
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
      commitment:"finalized",
      evidence
    },{onConflict:"wallet_id,tx_hash,asset,mint,direction"}).select("id").maybeSingle();
    if(ins.error)continue;
    receipts.push({receipt_id:ins.data?.id||null,tx_hash:txHash,amount,block,confirmations,sender});
  }

  let balance=0;
  const balanceHex=await rpc("eth_call",[{
    to:USDC,
    data:"0x70a08231000000000000000000000000"+wallet.address.slice(2).toLowerCase()
  },"latest"]);
  balance=Number(hexToBig(balanceHex))/10**DECIMALS;

  await db.from("midad_wallet_monitor_state").upsert({
    route_id:route.id,
    last_scan_at:new Date().toISOString(),
    last_signature:receipts[receipts.length-1]?.tx_hash||state?.last_signature||null,
    last_slot:to,
    latest_balance:balance,
    latest_balance_updated_at:new Date().toISOString(),
    status:"VERIFIED",
    error_count:0,
    last_error:null,
    metadata:{
      provider:rpcLabel(lastGoodRpc),
       chain_id:CHAIN_ID,
      token_contract:USDC,
      decimals:DECIMALS,
      latest_block:latest,
      finalized_block:finalBlock,
      scanned_from:from,
      scanned_to:to,
      receipts_detected:receipts.length
    },
    updated_at:new Date().toISOString()
  },{onConflict:"route_id"});

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