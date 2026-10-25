import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { isReceiptMonitorRouteEligible } from "./route-policy.ts";

const DATABASE_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const db = DATABASE_URL ? postgres(DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10, ssl: "require", prepare: false }) : null;
const H = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-autonomy-key,x-midad-ingest-key"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clip=(v:unknown,n=500)=>String(v??"").slice(0,n);
const TRANSFER="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TOKENS:Record<string,{chainId:number;contract:string;confirmations:number;rpcs:string[];label:string}> = {
  ethereum:{chainId:1,contract:"0xdAC17F958D2ee523a2206206994597C13D831ec7",confirmations:12,rpcs:["https://ethereum-rpc.publicnode.com","https://eth.llamarpc.com","https://cloudflare-eth.com"],label:"Ethereum Mainnet"},
  avalanche:{chainId:43114,contract:"0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",confirmations:3,rpcs:["https://api.avax.network/ext/bc/C/rpc","https://avalanche-c-chain-rpc.publicnode.com"],label:"Avalanche C-Chain"}
};
function needDb(){if(!db)throw new Error("supabase_db_url_missing");return db;}
async function secret(name:string){const rows=await needDb().unsafe("select decrypted_secret from vault.decrypted_secrets where name=$1 order by updated_at desc limit 1",[name]);return typeof rows[0]?.decrypted_secret==="string"?rows[0].decrypted_secret:"";}
async function authorized(req:Request){
 const got=req.headers.get("x-midad-autonomy-key")||"",ingestGot=req.headers.get("x-midad-ingest-key")||"";
 if(!got&&!ingestGot)return false;
 const [autonomy,ingest]=await Promise.all([secret("midad_autonomy_key"),secret("MIDAD_INGEST_KEY")]);
 const hash=async(x:string)=>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(x));return Array.from(new Uint8Array(b)).map(v=>v.toString(16).padStart(2,"0")).join("");};
 return (!!got&&!!autonomy&&(await hash(got))===(await hash(autonomy))) || (!!ingestGot&&!!ingest&&(await hash(ingestGot))===(await hash(ingest)));
}
async function rpc(network:string,method:string,params:unknown[]){
 const cfg=TOKENS[network];if(!cfg)throw new Error("unsupported_network");
 const errors:string[]=[];
 for(const endpoint of cfg.rpcs){
  try{
   const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:Date.now(),method,params}),signal:AbortSignal.timeout(12000)});
   const j=await r.json().catch(()=>null);
   if(!r.ok)throw new Error("http_"+r.status);
   if(j?.error)throw new Error(clip(j.error.message,180));
   return j?.result;
  }catch(e){errors.push(endpoint+": "+clip(e instanceof Error?e.message:e,120));}
 }
 throw new Error(network+"_rpc_failed: "+errors.join(" | ").slice(0,500));
}
const numHex=(v:string)=>Number(BigInt(v||"0x0"));
const toTopic=(address:string)=>"0x"+address.toLowerCase().replace(/^0x/,"").padStart(64,"0");
async function scanRoute(route:any){
 const d=needDb(),network=String(route.network||"").toLowerCase(),cfg=TOKENS[network],wallet=route.wallet;
 if(!cfg)throw new Error("unsupported_network");
 if(!wallet?.address||!/^0x[a-fA-F0-9]{40}$/.test(wallet.address))throw new Error("receiving_evm_wallet_unavailable");
 if(String(route.metadata?.verification?.token_contract||"").toLowerCase()!==cfg.contract.toLowerCase())throw new Error("route_token_contract_mismatch");
 const [chainIdHex,latestHex]=await Promise.all([rpc(network,"eth_chainId",[]),rpc(network,"eth_blockNumber",[])]);
 const chainId=numHex(chainIdHex),latest=numHex(latestHex);
 if(chainId!==cfg.chainId)throw new Error("rpc_chain_id_mismatch");
 const finalBlock=Math.max(0,latest-cfg.confirmations);
 const stateRows=await d.unsafe("select last_slot,metadata from public.midad_wallet_monitor_state where route_id=$1 limit 1",[route.id]);
 const oldState=stateRows[0]||null;
 const start=oldState?.last_slot!=null?Math.max(0,Number(oldState.last_slot)+1):Math.max(0,finalBlock-5000);
 const transferTopic="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
 const aggregated=new Map<string,{raw:bigint;blocks:number;indexes:number[];logs:number}>();
 const chunkSize=750;
 for(let from=start;from<=finalBlock;from+=chunkSize){
  const to=Math.min(finalBlock,from+chunkSize-1);
  const logs=await rpc(network,"eth_getLogs",[{address:cfg.contract,fromBlock:"0x"+from.toString(16),toBlock:"0x"+to.toString(16),topics:[transferTopic,null,toTopic(wallet.address)]}]);
  for(const log of (logs||[]) as any[]){
   if(!log?.transactionHash||!log?.data)continue;
   const raw=BigInt(log.data);
   if(raw<=0n)continue;
   const tx=String(log.transactionHash).toLowerCase();
   const row=aggregated.get(tx)||{raw:0n,blocks:numHex(log.blockNumber),indexes:[],logs:0};
   row.raw+=raw;row.blocks=Math.max(row.blocks,numHex(log.blockNumber));row.indexes.push(numHex(log.logIndex));row.logs+=1;
   aggregated.set(tx,row);
  }
 }
 const iface="0x70a08231"+wallet.address.toLowerCase().replace(/^0x/,"").padStart(64,"0");
 const balanceHex=await rpc(network,"eth_call",[{to:cfg.contract,data:iface},"latest"]);
 const balanceRaw=BigInt(balanceHex||"0x0"),balance=Number(balanceRaw)/1_000_000;
 const receipts:any[]=[];
 for(const [txHash,row] of aggregated){
  const evidence={independently_verified:true,verifier:"evm_rpc",verifier_ref:txHash,source:"midad_multichain_usdt_monitor_v1",network,chain_id:cfg.chainId,token_contract:cfg.contract,token_contract_verified:true,wallet_address:wallet.address,amount_raw:row.raw.toString(),decimals:6,log_count:row.logs,log_indexes:row.indexes,block_number:row.blocks,confirmations_observed:Math.max(0,latest-row.blocks),finality_policy:cfg.confirmations,settlement_performed:false,payment_intent_matched:false};
  const amount=Number(row.raw)/1_000_000;
  const ins=await d.unsafe("insert into public.midad_wallet_receipts(wallet_id,tx_hash,asset,mint,network,amount,direction,slot,commitment,evidence) values($1,$2,'USDT',$3,$4,$5,'inbound',$6,'finalized',$7::jsonb) on conflict(wallet_id,tx_hash,asset,mint,direction) do update set amount=excluded.amount,slot=excluded.slot,commitment=excluded.commitment,evidence=excluded.evidence returning id",[wallet.id,txHash,cfg.contract,network,amount,row.blocks,JSON.stringify(evidence)]);
  receipts.push({receipt_id:ins[0]?.id||null,tx_hash:txHash,amount,block_number:row.blocks,evidence_status:"ONCHAIN_CONFIRMED_UNMATCHED"});
 }
 const metadata={provider:"evm_rpc_fallbacks",asset:"USDT",network,chain_id:cfg.chainId,token_contract:cfg.contract,decimals:6,latest_block:latest,finalized_block:finalBlock,scanned_from:start,scanned_to:finalBlock,receipts_detected:receipts.length,settlement_performed:false};
 const stateStatus="VERIFIED";
 await d.unsafe("insert into public.midad_wallet_monitor_state(route_id,last_scan_at,last_slot,latest_balance,latest_balance_updated_at,status,error_count,last_error,metadata,updated_at) values($1,now(),$2,$3,now(),$4,0,null,$5::jsonb,now()) on conflict(route_id) do update set last_scan_at=now(),last_slot=excluded.last_slot,latest_balance=excluded.latest_balance,latest_balance_updated_at=now(),status=excluded.status,error_count=0,last_error=null,metadata=excluded.metadata,updated_at=now()",[route.id,finalBlock,balance,stateStatus,JSON.stringify(metadata)]);
 return {route_id:route.id,label:route.label,network,asset:"USDT",wallet_address:wallet.address,token_contract:cfg.contract,balance,latest_block:latest,finalized_block:finalBlock,scanned_from:start,scanned_to:finalBlock,receipts};
}
async function run(){
 const d=needDb();
 const routes=(await d.unsafe("select r.id,r.label,r.asset,r.network,r.metadata,r.wallet_id,r.active,r.route_kind,jsonb_build_object('id',w.id,'address',w.address,'chain',w.chain,'watch_only',w.watch_only) as wallet from public.midad_revenue_routes r join public.midad_wallets w on w.id=r.wallet_id where r.active=true and r.route_kind='receive' and upper(r.asset)='USDT' and lower(r.network) in ('ethereum','avalanche') and w.active=true and w.metadata->>'provider'='trust_wallet' order by r.created_at asc")).filter(isReceiptMonitorRouteEligible);
 const results:any[]=[];
 for(const route of routes){
  try{results.push({ok:true,status:"VERIFIED",...(await scanRoute(route))});}
  catch(e){
   const message=clip(e instanceof Error?e.message:e,450);
   await d.unsafe("insert into public.midad_wallet_monitor_state(route_id,last_scan_at,status,error_count,last_error,metadata,updated_at) values($1,now(),'DEGRADED',1,$2,$3::jsonb,now()) on conflict(route_id) do update set last_scan_at=now(),status='DEGRADED',error_count=public.midad_wallet_monitor_state.error_count+1,last_error=excluded.last_error,metadata=excluded.metadata,updated_at=now()",[route.id,message,JSON.stringify({provider:"evm_rpc_fallbacks",asset:"USDT",network:route.network,settlement_performed:false})]);
   results.push({ok:false,route_id:route.id,label:route.label,network:route.network,status:"DEGRADED",error:message});
  }
 }
 return {ok:true,service:"midad_multichain_usdt_monitor",version:1,mode:"read_only_inbound_receipts",routes_checked:routes.length,routes,results,financial_actions:{transfers:0,trades:0,signatures:0,payment_events_modified:0,settlement_performed:false}};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
 if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
 try{if(!(await authorized(req)))return json({ok:false,error:"unauthorized"},401);}catch{return json({ok:false,error:"auth_check_failed"},500);}
 let body:any={};try{body=await req.json();}catch{}
 try{
  const d=needDb(),action=String(body?.action||"scan").toLowerCase();
  if(action==="status"){
   const rows=await d.unsafe("select s.route_id,r.label,r.asset,r.network,s.last_scan_at,s.last_slot,s.latest_balance,s.status,s.error_count,s.last_error,s.metadata,s.updated_at from public.midad_wallet_monitor_state s left join public.midad_revenue_routes r on r.id=s.route_id where lower(coalesce(r.network,'')) in ('ethereum','avalanche') order by s.updated_at desc");
   return json({ok:true,service:"midad_multichain_usdt_monitor",version:1,states:rows,read_only:true});
  }
  return json(await run());
 }catch(e){return json({ok:false,service:"midad_multichain_usdt_monitor",version:1,error:clip(e instanceof Error?e.message:e,700)},500);}
});