import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H={"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","access-control-allow-headers":"content-type,authorization,x-midad-ingest-key","access-control-allow-methods":"POST,OPTIONS"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const clip=(x:any,n=4000)=>String(x??"").slice(0,n);

async function getJson(url:string, timeoutMs=8000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"MIDAD-Money-Hunter/2.3"},signal:controller.signal});
    const t=await r.text(); let j:any={}; try{j=JSON.parse(t)}catch{j={raw:t}};
    return {ok:r.ok,status:r.status,data:j};
  }catch(e){
    return {ok:false,status:0,data:{error:String(e?.name||e||"fetch_failed")}};
  }finally{
    clearTimeout(timer);
  }
}

async function baseRpc(method:string, params:any[], timeoutMs=3500){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch("https://mainnet.base.org",{
      method:"POST",
      headers:{"content-type":"application/json","accept":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
      signal:controller.signal
    });
    if(!r.ok)return {ok:false,status:r.status,result:null};
    const data=await r.json().catch(()=>null);
    return {ok:!data?.error&&data?.result!==undefined,status:r.status,result:data?.result??null};
  }catch(e){return {ok:false,status:0,result:null,error:String((e as any)?.name||"rpc_failed")}}
  finally{clearTimeout(timer)}
}
async function tempoRpc(method:string, params:any[], timeoutMs=8000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch("https://rpc.tempo.xyz",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:controller.signal});
    if(!r.ok)return {ok:false,status:r.status,result:null};
    const data=await r.json().catch(()=>null);
    return {ok:!data?.error&&data?.result!==undefined,status:r.status,result:data?.result??null};
  }catch(e){return {ok:false,status:0,result:null,error:String((e as any)?.name||"rpc_failed")}}
  finally{clearTimeout(timer)}
}
function tempoPaddedAddress(address:string){
  const normalized=String(address||"").toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(normalized) ? "0x"+normalized.slice(2).padStart(64,"0") : "";
}
function evaluateTaskmarketTempoReceipt(input:any){
  const chainId=Number(input?.chainId);
  const taskId=String(input?.taskId||"").toLowerCase();
  const txHash=String(input?.txHash||"").toLowerCase();
  const requester=String(input?.requester||"").toLowerCase();
  const receipt=input?.receipt;
  const confirmations=Number(input?.confirmations);
  let expected:bigint;
  try{expected=BigInt(String(input?.rewardAtomic||"0"))}catch{return {ok:false,reason:"TEMPO_REWARD_INVALID",tx_hash:txHash||null}}
  if(chainId!==4217)return {ok:false,reason:"UNSUPPORTED_TASKMARKET_CHAIN",tx_hash:txHash||null,chain_id:Number.isFinite(chainId)?chainId:null};
  if(!/^0x[a-f0-9]{64}$/.test(taskId)||!/^0x[a-f0-9]{64}$/.test(txHash)||!/^0x[a-f0-9]{40}$/.test(requester))return {ok:false,reason:"TEMPO_TASK_OR_REQUESTER_ID_INVALID",tx_hash:txHash||null};
  if(expected<=0n)return {ok:false,reason:"TEMPO_REWARD_NONPOSITIVE",tx_hash:txHash};
  if(!receipt||typeof receipt!=="object")return {ok:false,reason:"TEMPO_RECEIPT_UNAVAILABLE",tx_hash:txHash};
  if(String(receipt.transactionHash||"").toLowerCase()!==txHash)return {ok:false,reason:"TEMPO_TX_HASH_MISMATCH",tx_hash:txHash};
  if(String(receipt.status||"").toLowerCase()!=="0x1")return {ok:false,reason:"TEMPO_ESCROW_TX_FAILED",tx_hash:txHash};
  const ousd="0x20c0000000000000000000006a37da5c996874be";
  const market="0xf4f4a00011b080ebc1e599a765d8bce7557b97e7";
  const relayer="0x3c0820e2dabd5feae1fd03b78079dee15c7f83d8";
  const transferTopic="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const taskCreatedTopic="0xe0dc4072f8420c56e984e9c6eec7bad2e5616825f0d1ca581bd96ff3e8eec948";
  const logs=Array.isArray(receipt.logs)?receipt.logs:[];
  const transfer=logs.find((log:any)=>{
    const topics=Array.isArray(log?.topics)?log.topics.map((t:any)=>String(t||"").toLowerCase()):[];
    if(log?.removed===true||String(log?.address||"").toLowerCase()!==ousd)return false;
    if(topics[0]!==transferTopic||topics[1]!==tempoPaddedAddress(relayer)||topics[2]!==tempoPaddedAddress(market))return false;
    try{return BigInt(String(log.data||"0x0"))===expected}catch{return false}
  });
  const taskEvent=logs.find((log:any)=>{
    const topics=Array.isArray(log?.topics)?log.topics.map((t:any)=>String(t||"").toLowerCase()):[];
    if(log?.removed===true||String(log?.address||"").toLowerCase()!==market)return false;
    if(topics[0]!==taskCreatedTopic||topics[1]!==taskId||topics[2]!==tempoPaddedAddress(requester))return false;
    try{return BigInt("0x"+String(log.data||"0x").slice(2,66))===expected}catch{return false}
  });
  if(!transfer)return {ok:false,reason:"TEMPO_OUSD_ESCROW_TRANSFER_NOT_MATCHED",tx_hash:txHash};
  if(!taskEvent)return {ok:false,reason:"TEMPO_TASK_CREATED_EVENT_NOT_MATCHED",tx_hash:txHash};
  if(!Number.isFinite(confirmations)||confirmations<12)return {ok:false,reason:"TEMPO_CONFIRMATIONS_INSUFFICIENT",tx_hash:txHash,confirmations:Number.isFinite(confirmations)?confirmations:0};
  return {ok:true,reason:"LIVE_TEMPO_OUSD_ESCROW_AND_TASK_EVENT_VERIFIED",tx_hash:txHash,task_id:taskId,requester,confirmations,asset:"OUSD",network:"Tempo",chain_id:4217,escrow_sender:relayer,escrow_recipient:market,escrow_amount_atomic:expected.toString(),expected_reward_atomic:expected.toString(),verified_at:new Date().toISOString(),source:"taskmarket_official_detail_plus_tempo_ousd_transfer_and_task_created_event"};
}
async function verifyTaskmarketTempoEscrow(detail:any){
  const txHash=String(detail?.escrowTxHash||detail?.escrow_tx_hash||"").toLowerCase().trim();
  const taskId=String(detail?.id||detail?.taskId||"").toLowerCase();
  const requester=String(detail?.requester||"").toLowerCase();
  if(Number(detail?.chainId??detail?.chain_id)!==4217)return {ok:false,reason:"UNSUPPORTED_TASKMARKET_CHAIN",tx_hash:txHash||null};
  if(!/^0x[a-f0-9]{64}$/.test(txHash)||!/^0x[a-f0-9]{64}$/.test(taskId)||!/^0x[a-f0-9]{40}$/.test(requester))return {ok:false,reason:"TEMPO_TASK_PAYOUT_FIELDS_INVALID",tx_hash:txHash||null};
  const status=String(detail?.status||"").toLowerCase(),phase=String(detail?.phase||"").toLowerCase();
  const expiry=Date.parse(String(detail?.expiryTime||detail?.deadline||""));
  if(status!=="open"||phase!=="active"||!Number.isFinite(expiry)||expiry<=Date.now())return {ok:false,reason:"TEMPO_TASK_CLOSED_OR_EXPIRED",tx_hash:txHash,expiry_at:Number.isFinite(expiry)?new Date(expiry).toISOString():null};
  if(detail?.stakeRequired!==false||detail?.submissionWindowOpen!==true)return {ok:false,reason:"TEMPO_STAKE_OR_SUBMISSION_WINDOW_UNVERIFIED",tx_hash:txHash};
  const workerSubmit=(Array.isArray(detail?.pendingActions)?detail.pendingActions:[]).find((a:any)=>String(a?.role||"").toLowerCase()==="worker"&&String(a?.action||"").toLowerCase()==="submit");
  if(!workerSubmit||workerSubmit.requiresPayment!==false)return {ok:false,reason:"TEMPO_WORKER_SUBMISSION_FEE_UNVERIFIED",tx_hash:txHash};
  const feeBps=Number(detail?.platformFeeBps??0);
  if(!Number.isFinite(feeBps)||feeBps!==0)return {ok:false,reason:"TEMPO_PLATFORM_FEE_MODEL_UNSUPPORTED",tx_hash:txHash,fee_bps:Number.isFinite(feeBps)?feeBps:null};
  let reward:bigint,netReward:bigint;
  try{reward=BigInt(String(detail?.reward??"0"));netReward=BigInt(String(detail?.netReward??detail?.reward??"0"))}catch{return {ok:false,reason:"TEMPO_REWARD_INVALID",tx_hash:txHash}}
  if(reward<=0n||reward!==netReward)return {ok:false,reason:"TEMPO_REWARD_OR_NET_MISMATCH",tx_hash:txHash,reward_atomic:reward.toString(),net_reward_atomic:netReward.toString()};
  const liveChain=await tempoRpc("eth_chainId",[]);
  if(!liveChain.ok||Number(liveChain.result)!==4217)return {ok:false,reason:"TEMPO_RPC_CHAIN_ID_MISMATCH",tx_hash:txHash,reported_chain_id:liveChain.result||null};
  const [receipt,head]=await Promise.all([tempoRpc("eth_getTransactionReceipt",[txHash]),tempoRpc("eth_blockNumber",[])]);
  if(!receipt.ok||!receipt.result)return {ok:false,reason:"TEMPO_RECEIPT_UNAVAILABLE",tx_hash:txHash};
  if(!head.ok||!head.result||!receipt.result.blockNumber)return {ok:false,reason:"TEMPO_BLOCK_HEIGHT_UNAVAILABLE",tx_hash:txHash};
  let confirmations=0;try{confirmations=Number(BigInt(head.result)-BigInt(receipt.result.blockNumber)+1n)}catch{return {ok:false,reason:"TEMPO_BLOCK_HEIGHT_INVALID",tx_hash:txHash}}
  const evaluated=evaluateTaskmarketTempoReceipt({chainId:liveChain.result,taskId,txHash,requester,rewardAtomic:reward.toString(),receipt:receipt.result,confirmations});
  return {...evaluated,expiry_at:new Date(expiry).toISOString(),worker_submit_requires_payment:false,submission_fee_verified:true,submission_fee_usd:0};
}
function taskmarketTempoSelfTest(){
  const taskId="0x"+"11".repeat(32),txHash="0x"+"22".repeat(32),requester="0x"+"44".repeat(20),reward=100000000n;
  const ousd="0x20c0000000000000000000006a37da5c996874be",market="0xf4f4a00011b080ebc1e599a765d8bce7557b97e7",relayer="0x3c0820e2dabd5feae1fd03b78079dee15c7f83d8";
  const transferTopic="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",taskTopic="0xe0dc4072f8420c56e984e9c6eec7bad2e5616825f0d1ca581bd96ff3e8eec948";
  const h=reward.toString(16).padStart(64,"0");
  const receipt:any={transactionHash:txHash,status:"0x1",blockNumber:"0x100",logs:[{address:ousd,topics:[transferTopic,tempoPaddedAddress(relayer),tempoPaddedAddress(market)],data:"0x"+h},{address:market,topics:[taskTopic,taskId,tempoPaddedAddress(requester),"0xa81913a500000000000000000000000000000000000000000000000000000000"],data:"0x"+h+"00".repeat(96)}]};
  const good=evaluateTaskmarketTempoReceipt({chainId:"0x1079",taskId,txHash,requester,rewardAtomic:reward.toString(),receipt,confirmations:12});
  const low=evaluateTaskmarketTempoReceipt({chainId:4217,taskId,txHash,requester,rewardAtomic:reward.toString(),receipt,confirmations:11});
  const wrongChain=evaluateTaskmarketTempoReceipt({chainId:8453,taskId,txHash,requester,rewardAtomic:reward.toString(),receipt,confirmations:100});
  const wrongAmount=evaluateTaskmarketTempoReceipt({chainId:4217,taskId,txHash,requester,rewardAtomic:"50000000",receipt,confirmations:100});
  const badRecipientReceipt={...receipt,logs:[{...receipt.logs[0],topics:[transferTopic,tempoPaddedAddress(relayer),tempoPaddedAddress("0x"+"33".repeat(20))]},receipt.logs[1]]};
  const badRecipient=evaluateTaskmarketTempoReceipt({chainId:4217,taskId,txHash,requester,rewardAtomic:reward.toString(),receipt:badRecipientReceipt,confirmations:100});
  const badTask=evaluateTaskmarketTempoReceipt({chainId:4217,taskId:"0x"+"55".repeat(32),txHash,requester,rewardAtomic:reward.toString(),receipt,confirmations:100});
  const reverted=evaluateTaskmarketTempoReceipt({chainId:4217,taskId,txHash,requester,rewardAtomic:reward.toString(),receipt:{...receipt,status:"0x0"},confirmations:100});
  const wrongTx=evaluateTaskmarketTempoReceipt({chainId:4217,taskId,txHash:"0x"+"66".repeat(32),requester,rewardAtomic:reward.toString(),receipt,confirmations:100});
  const tests=[["valid exact receipt accepted",good.ok===true],["low confirmations rejected",low.reason==="TEMPO_CONFIRMATIONS_INSUFFICIENT"],["wrong chain rejected",wrongChain.reason==="UNSUPPORTED_TASKMARKET_CHAIN"],["wrong amount rejected",wrongAmount.reason==="TEMPO_OUSD_ESCROW_TRANSFER_NOT_MATCHED"],["wrong recipient rejected",badRecipient.reason==="TEMPO_OUSD_ESCROW_TRANSFER_NOT_MATCHED"],["wrong task rejected",badTask.reason==="TEMPO_TASK_CREATED_EVENT_NOT_MATCHED"],["revert rejected",reverted.reason==="TEMPO_ESCROW_TX_FAILED"],["wrong TX hash rejected",wrongTx.reason==="TEMPO_TX_HASH_MISMATCH"]];
  const failures=tests.filter((t:any)=>!t[1]).map((t:any)=>t[0]);
  return {ok:failures.length===0,tests:tests.length,failures,scope:"pure Tempo receipt/gate tests; no RPC requests or writes",results:tests.map((t:any)=>({name:t[0],passed:t[1]}))};
}
async function verifyTaskmarketEscrow(detail:any){
  const chainId=Number(detail?.chainId??detail?.chain_id);
  if(chainId===4217)return verifyTaskmarketTempoEscrow(detail);
  if(chainId!==8453)return {ok:false,reason:"UNSUPPORTED_TASKMARKET_CHAIN",tx_hash:detail?.escrowTxHash||detail?.escrow_tx_hash||null,chain_id:Number.isFinite(chainId)?chainId:null};
  const txHash=String(detail?.escrowTxHash||detail?.escrow_tx_hash||"").trim();
  const taskStatus=String(detail?.status||"").toLowerCase();
  const phase=String(detail?.phase||"").toLowerCase();
  const requester=String(detail?.requester||"").toLowerCase();
  const expectedRaw=String(detail?.reward??"");
  const expiryRaw=detail?.expiryTime??detail?.deadline??null;
  let expiryMs=NaN;
  if(typeof expiryRaw==="number"||/^\\d+(?:\\.\\d+)?$/.test(String(expiryRaw||""))){
    const n=Number(expiryRaw);
    expiryMs=n>1e12?n:(n>1e9?n*1000:NaN);
  }else if(expiryRaw)expiryMs=Date.parse(String(expiryRaw));
  if(!/^0x[a-f0-9]{64}$/i.test(txHash))return {ok:false,reason:"OFFICIAL_ESCROW_TX_HASH_MISSING",tx_hash:txHash||null};
  if(taskStatus!=="open"||phase!=="active")return {ok:false,reason:"TASK_NOT_OPEN_ACTIVE",tx_hash:txHash};
  if(!Number.isFinite(expiryMs)||expiryMs<=Date.now())return {ok:false,reason:"TASK_DEADLINE_EXPIRED_OR_UNVERIFIED",tx_hash:txHash,expiry_at:Number.isFinite(expiryMs)?new Date(expiryMs).toISOString():null};
  if(!/^0x[a-f0-9]{40}$/i.test(requester)||!/^\d+$/.test(expectedRaw))return {ok:false,reason:"TASK_PAYOUT_FIELDS_INVALID",tx_hash:txHash};
  let expected:bigint;
  try{expected=BigInt(expectedRaw)}catch{return {ok:false,reason:"TASK_REWARD_INVALID",tx_hash:txHash}}
  if(expected<=0n)return {ok:false,reason:"TASK_REWARD_NONPOSITIVE",tx_hash:txHash};
  const [receiptResponse,headResponse]=await Promise.all([
    baseRpc("eth_getTransactionReceipt",[txHash]),
    baseRpc("eth_blockNumber",[])
  ]);
  const receipt=receiptResponse.result;
  if(!receiptResponse.ok||!receipt)return {ok:false,reason:"BASE_RECEIPT_UNAVAILABLE",tx_hash:txHash};
  if(String(receipt.status||"").toLowerCase()!=="0x1")return {ok:false,reason:"BASE_ESCROW_TX_FAILED",tx_hash:txHash};
  if(!headResponse.ok||!headResponse.result||!receipt.blockNumber)return {ok:false,reason:"BASE_CONFIRMATIONS_UNAVAILABLE",tx_hash:txHash};
  let confirmations=0;
  try{confirmations=Number(BigInt(headResponse.result)-BigInt(receipt.blockNumber)+1n)}catch{return {ok:false,reason:"BASE_BLOCK_HEIGHT_INVALID",tx_hash:txHash}}
  if(confirmations<2)return {ok:false,reason:"BASE_CONFIRMATIONS_INSUFFICIENT",tx_hash:txHash,confirmations};
  const usdc="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const transferTopic="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const taskCreatedTopic="0xe0dc4072f8420c56e984e9c6eec7bad2e5616825f0d1ca581bd96ff3e8eec948";
  const rewardConfiguredTopic="0x9573067352184cdb0845d8f374abc3145d43ee03be86df46bc054dd12a48ac6d";
  const hookRegisteredTopic="0x7eb92142451e76f67308910694127e44cec10a3af5efca21cc89d2128f56ee29";
  const taskId=String(detail.id||"").toLowerCase().replace(/^0x/,"");
  const taskIdTopic="0x"+taskId.padStart(64,"0");
  const requesterTopic="0x"+requester.slice(2).padStart(64,"0");
  const hookAddress=String(detail.hookContract||"").toLowerCase();
  const logs=Array.isArray(receipt.logs)?receipt.logs:[];
  const taskCreatedLog=logs.find((log:any)=>{
    const topics=Array.isArray(log.topics)?log.topics:[];
    if(String(topics[0]||"").toLowerCase()!==taskCreatedTopic||String(topics[1]||"").toLowerCase()!==taskIdTopic||String(topics[2]||"").toLowerCase()!==requesterTopic)return false;
    try{return BigInt("0x"+String(log.data||"0x").slice(2,66))===expected}catch{return false}
  });
  const rewardConfiguredLog=logs.find((log:any)=>{
    const topics=Array.isArray(log.topics)?log.topics:[];
    if(String(topics[0]||"").toLowerCase()!==rewardConfiguredTopic||String(topics[1]||"").toLowerCase()!==taskIdTopic)return false;
    try{return BigInt(log.data||"0x0")===expected}catch{return false}
  });
  const hookRegisteredLog=logs.find((log:any)=>{
    const topics=Array.isArray(log.topics)?log.topics:[];
    if(String(topics[0]||"").toLowerCase()!==hookRegisteredTopic||String(topics[1]||"").toLowerCase()!==taskIdTopic)return false;
    const returnedHook="0x"+String(log.data||"").slice(-40).toLowerCase();
    return Boolean(hookAddress)&&returnedHook===hookAddress;
  });
  if(!taskCreatedLog||!rewardConfiguredLog||!hookRegisteredLog)return {ok:false,reason:"TASK_ESCROW_EVENTS_NOT_MATCHED_TO_LISTING",tx_hash:txHash,confirmations};
  let transferAmount=0n,transferFrom:string|null=null,transferTo:string|null=null;
  for(const log of logs){
    if(String(log.address||"").toLowerCase()!==usdc)continue;
    const topics=Array.isArray(log.topics)?log.topics:[];
    if(String(topics[0]||"").toLowerCase()!==transferTopic)continue;
    if(!topics[1]||!topics[2]||!/^0x[0-9a-f]{64}$/i.test(String(topics[1]))||!/^0x[0-9a-f]{64}$/i.test(String(topics[2])))continue;
    const recipient="0x"+String(topics[2]).slice(-40).toLowerCase();
    if(recipient!==String(taskCreatedLog.address||"").toLowerCase())continue;
    let amount=0n;try{amount=BigInt(log.data||"0x0")}catch{continue}
    if(amount>=expected){transferAmount=amount;transferFrom="0x"+String(topics[1]).slice(-40).toLowerCase();transferTo=recipient;break}
  }
  if(transferAmount<expected)return {ok:false,reason:"BASE_USDC_ESCROW_TRANSFER_NOT_MATCHED",tx_hash:txHash,confirmations};
  return {ok:true,reason:null,tx_hash:txHash,confirmations,asset:"USDC",network:"Base",requester,escrow_sender:transferFrom,escrow_recipient:transferTo,escrow_amount_base_units:transferAmount.toString(),expected_reward_base_units:expected.toString(),verified_at:new Date().toISOString(),source:"taskmarket_official_detail_plus_base_usdc_and_task_events"};
}

function score(reward:number, applicants:number, freshnessHours:number, crypto:boolean){
  let s=55 + Math.min(28, Math.max(0,reward)*2.2);
  s -= Math.min(18, Math.max(0,applicants)*0.35);
  s += Math.max(0,6-Math.max(0,freshnessHours)/24);
  if(crypto) s+=5;
  return Math.max(50,Math.min(99,Math.round(s*100)/100));
}

function hoursSince(iso:any){
  const t=Date.parse(String(iso||"")); if(!Number.isFinite(t)) return 72;
  return Math.max(0,(Date.now()-t)/3600000);
}

function normalizedCoin(x:any){ return String(x||"").toLowerCase().replace("-","_"); }
function cryptoPayoutGate(c:any, registry:any){
  const source=String(c?.source||"");
  const policy=registry?.payout_policy||{};
  const mode=String(policy.mode||"").toLowerCase();
  const state=String(policy.status||"").toLowerCase();
  const checked=Date.parse(String(registry?.policy_checked_at||""));
  const fresh=Number.isFinite(checked)&&Date.now()-checked<=30*86400000&&checked<=Date.now()+300000;
  const docs=Array.isArray(registry?.payout_policy_evidence)?registry.payout_policy_evidence:[];
  const official=docs.some((e:any)=>e?.official===true&&/^https:\/\//i.test(String(e?.url||"")));
  const asset=String(c?.evidence?.payment_asset||c?.evidence?.token||c?.evidence?.reward_token||c?.evidence?.payment||((source==="taskmarket"&&Number(c?.evidence?.reward_usdc)>0)?"USDC":"")).toUpperCase();
  const cleanAsset=asset==="USDC"||asset==="USDT"||asset==="OUSD"||asset==="BTC"||asset==="ETH"||asset==="SOL";
  const networkRaw=String(c?.evidence?.network||c?.evidence?.payout_network||c?.evidence?.chain||c?.chain||"").toLowerCase();
  const network=networkRaw.replace(/^usdc\//,"").replace(/^usdt\//,"").replace("eip155:8453","base");
  const policyAssets=(Array.isArray(policy.assets)?policy.assets:[]).map((x:any)=>String(x).toUpperCase());
  const policyNetworks=(Array.isArray(policy.networks)?policy.networks:[]).map((x:any)=>String(x).toLowerCase());
  const networkMatches=policyNetworks.includes(network)||policyNetworks.some((n:string)=>n===networkRaw);
  const assetMatches=policyAssets.includes(asset)||(source==="taskmarket"&&Number(c?.evidence?.reward_usdc)>0&&policyAssets.includes("USDC"))||(source==="agent_souk"&&Number(c?.evidence?.reward_usdc)>0&&String(c?.evidence?.payment||"").toUpperCase()==="USDC"&&policyAssets.includes("USDC"));
  const usable=Boolean(registry&&["crypto_only","crypto_available"].includes(mode)&&state==="verified"&&fresh&&official&&assetMatches&&networkMatches&&cleanAsset&&Number(c?.reward)>0);
  const reasons:string[]=[];
  if(!registry)reasons.push("PLATFORM_NOT_IN_VERIFIED_CRYPTO_REGISTRY");
  if(!["crypto_only","crypto_available"].includes(mode)||state!=="verified")reasons.push("PLATFORM_CRYPTO_PAYOUT_NOT_VERIFIED");
  if(!fresh)reasons.push("PAYOUT_EVIDENCE_STALE_OR_MISSING");
  if(!official)reasons.push("OFFICIAL_PAYOUT_EVIDENCE_MISSING");
  if(!assetMatches||!cleanAsset)reasons.push("LISTING_CRYPTO_ASSET_UNPROVEN");
  if(!networkMatches)reasons.push("SUPPORTED_CRYPTO_NETWORK_UNPROVEN");
  if(!(Number(c?.reward)>0))reasons.push("POSITIVE_REWARD_MISSING");
  const fundingVerified=c?.evidence?.funding_verified===true;
  const payoutMechanismVerified=source==="agent_souk" && c?.evidence?.payout_mechanism_verified===true && asset==="USDC" && network==="base";
  const fundingOrMechanism=fundingVerified||payoutMechanismVerified;
  if(!fundingOrMechanism)reasons.push("TASK_FUNDING_OR_CRYPTO_PAYOUT_MECHANISM_UNVERIFIED");
  const finalUsable=usable&&fundingOrMechanism;
  const fee=Number(policy.action_fee_usdc||policy.claim_fee_usdc||policy.entry_fee_usdc||0);
  return {allowed:finalUsable,reason:reasons[0]||null,asset,network,fee,funding_verified:fundingVerified,payout_mechanism_verified:payoutMechanismVerified,auto_spend_allowed:fee<=0,policy_checked_at:registry?.policy_checked_at||null};
}

function viableCoin(x:any){
  const c=normalizedCoin(x);
  return ["usdc","usdt","usdc_sol","usdc_eth","usdc_pol","usdc_base","eth","sol","btc","base","tempo","ousd_tempo"].includes(c);
}

function assessRisk(c:any){
  const text=(String(c.title||"")+" "+String(c.description||"")+" "+JSON.stringify(c.evidence||{})).toLowerCase();
  const flags:string[]=[];
  const add=(name:string,re:RegExp)=>{if(re.test(text)) flags.push(name);};
  add("anti_bot_bypass",/anti[- ]?bot\s*(bypass|evasion)|cloudflare[^\n]{0,80}bypass|datadome[^\n]{0,80}bypass/);
  add("captcha_or_human_verification",/captcha|recaptcha|turnstile|anti[- ]?sybil|proof of humanity|human verification/);
  add("credential_or_secret_access",/password|private key|seed phrase|secret key|api key.*provide|credential/);
  add("identity_or_residency_constraint",/u\.s\. resident|us resident|citizen only|residency required|identity verification|kyc/);
  add("account_provisioning",/provide .*platform account|provide .*ai platform accounts|rent .*account|account creation for someone/);
  add("impersonation_or_fraud",/impersonat|fake identity|fraud|stolen|counterfeit|scam/);
  add("unauthorized_access",/bypass .*access|unauthorized access|drainer|wallet connect.*unknown/);
  add("malware_or_exploit_execution",/malware|credential stealer|ransomware/);

  const hardBlock=flags.some(x=>[
    "anti_bot_bypass","credential_or_secret_access","impersonation_or_fraud",
    "unauthorized_access","malware_or_exploit_execution","account_provisioning"
  ].includes(x));
  const riskClass=hardBlock?"RED":flags.length?"AMBER":"GREEN";
  return {
    risk_class:riskClass,
    flags:[...new Set(flags)],
    requires_human_review:riskClass!=="GREEN",
    automation_allowed:riskClass==="GREEN",
    reason:riskClass==="RED"?"Potentially unsafe, unauthorized, or policy-sensitive activity detected":
      riskClass==="AMBER"?"Eligibility, identity, or human-verification conditions require review":
      "No blocked pattern detected"
  };
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:H});
  if(req.method!=="POST") return json({error:"POST required"},405);

  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const expected=Deno.env.get("MIDAD_INGEST_KEY")||"";
  const auth=req.headers.get("authorization")||"";
  const supplied=req.headers.get("x-midad-ingest-key")||"";
  const autonomy=req.headers.get("x-midad-autonomy-key")||"";
  const autonomyKey=Deno.env.get("MIDAD_AUTONOMY_KEY")||"";
  const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
  // Internal cron callers use the DB-held key; compare it server-side if the edge secret alias is missing/stale.
  let dbAutonomyAuthorized=false;
  if(serviceKey && supabaseUrl && autonomy){
    try{
      const authDb=createClient(supabaseUrl,serviceKey);
      const {data:storedKey,error:keyError}=await authDb.rpc("midad_get_autonomy_key");
      dbAutonomyAuthorized=!keyError&&Boolean(storedKey)&&autonomy===String(storedKey);
    }catch(_){dbAutonomyAuthorized=false;}
  }
  const authorized=Boolean(serviceKey)&&(
    auth==="Bearer "+serviceKey ||
    (Boolean(expected)&&supplied===expected) ||
    (Boolean(autonomyKey)&&autonomy===autonomyKey) ||
    dbAutonomyAuthorized
  );
  if(!authorized) return json({error:"unauthorized"},401);
  const actionBody=await req.clone().json().catch(()=>({}));
  const requestedAction=String(actionBody?.action||"").toLowerCase();
  if(requestedAction==="self_test")return json({service:"midad_money_hunter",version:17,...taskmarketTempoSelfTest()});
  if(requestedAction==="health")return json({ok:true,service:"midad_money_hunter",version:17,taskmarket_rails:["USDC/Base chainId 8453","OUSD/Tempo chainId 4217"],no_spend:true,external_actions_allowed:false});

  const sb=createClient(supabaseUrl,serviceKey);
  const {data:profile}=await sb.from("profiles").select("id").limit(1).maybeSingle();
  if(!profile?.id) return json({error:"no_system_profile"},503);

  // Fail closed for uGig application readiness whenever its live profile is flagged or the account health record is blocked.
  const {data:revenuePolicy}=await sb.from("midad_revenue_policy")
    .select("allow_auto_submission,allow_auto_ugig")
    .eq("owner_scope","midad").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  const {data:ugigHealth,error:ugigHealthError}=await sb.from("midad_platform_accounts")
    .select("account_status,metadata,verification_snapshot")
    .eq("platform_key","ugig").eq("owner_scope","midad").eq("brand_key","midad_ai").maybeSingle();
  const ugigMeta=ugigHealth?.metadata||{};
  const ugigVerification=ugigHealth?.verification_snapshot||{};
  const ugigExternalFlag=ugigMeta.external_profile_is_spam===true ||
    String(ugigMeta.external_profile_status||"").toUpperCase()==="SPAM_REVIEW" ||
    String(ugigVerification.external_profile_is_spam||"").toLowerCase()==="true";
  const ugigHealthBlocked=Boolean(ugigHealthError || !ugigHealth || ugigExternalFlag ||
    ["BLOCKED","SUSPENDED","REJECTED"].includes(String(ugigHealth?.account_status||"").toUpperCase()) ||
    String(ugigMeta.submission_gate||"").toUpperCase()==="BLOCKED");
  const ugigApplicationLaneAllowed=!ugigHealthBlocked &&
    revenuePolicy?.allow_auto_submission===true && revenuePolicy?.allow_auto_ugig===true;

  const started=Date.now();
  const {data:cryptoPlatformPolicies,error:cryptoPolicyReadError}=await sb.from("midad_platform_registry")
    .select("platform_key,payout_policy,payout_policy_evidence,policy_checked_at,allowed_automation,forbidden_automation,identity_policy")
    .in("platform_key",["taskmarket","agent_souk","bountybook","laborx"]);
  if(cryptoPolicyReadError) return json({ok:false,error:"CRYPTO_PAYOUT_REGISTRY_UNAVAILABLE_FAIL_CLOSED"},503);
  const cryptoPolicyByPlatform=new Map((cryptoPlatformPolicies||[]).map((p:any)=>[p.platform_key,p]));

  // Quarantine old active listings that predate the strict crypto gate. Keep only rows revalidated against
  // current official crypto policy and a listing-level funded receipt or explicit native crypto-pay route.
  const quarantineNow=new Date().toISOString();
  const {data:activePayoutRows,error:activePayoutRowsError}=await sb.from("opportunities")
    .select("id,user_id,source,title,score,status,evidence,offer,created_at,updated_at,metadata")
    .in("status",["money_candidate","human_review"])
    .order("updated_at",{ascending:false}).limit(2000);
  if(activePayoutRowsError)return json({ok:false,error:"ACTIVE_OPPORTUNITY_PAYOUT_AUDIT_FAILED_CLOSED"},503);
  const policyUsableFor=(source:string,asset:string,network:string)=>{
    const row=cryptoPolicyByPlatform.get(source);
    const policy=row?.payout_policy||{};
    const checked=Date.parse(String(row?.policy_checked_at||""));
    const fresh=Number.isFinite(checked)&&Date.now()-checked<=30*86400000&&checked<=Date.now()+300000;
    const official=(Array.isArray(row?.payout_policy_evidence)?row.payout_policy_evidence:[])
      .some((e:any)=>e?.official===true&&/^https:\/\//i.test(String(e?.url||"")));
    const assets=(Array.isArray(policy.assets)?policy.assets:[]).map((x:any)=>String(x).toUpperCase());
    const networks=(Array.isArray(policy.networks)?policy.networks:[]).map((x:any)=>String(x).toLowerCase().replace("eip155:8453","base"));
    return Boolean(row&&["crypto_only","crypto_available"].includes(String(policy.mode||"").toLowerCase())&&
      String(policy.status||"").toLowerCase()==="verified"&&fresh&&official&&assets.includes(asset)&&networks.includes(network));
  };
  const quarantined: any[]=[];
  const preservedCount={taskmarket:0,agent_souk:0,bountybook:0,laborx:0};
  for(const row of (activePayoutRows||[])){
    const source=String(row.source||"");
    const meta=row.metadata||{}, ev=row.evidence||{}, offer=row.offer||{};
    const asset=String(ev.payment_asset||ev.payment_coin||ev.payment||meta.payment_asset||meta.payment_coin||meta.crypto_asset||"").toUpperCase();
    const network=String(ev.network||ev.payout_network||meta.crypto_network||meta.network||offer.chain||"").toLowerCase().replace("eip155:8453","base");
    const gate=String(meta.payout_gate_status||"").toUpperCase()==="VERIFIED_CRYPTO";
    const funding=ev.funding_verified===true||meta.funding_verified===true||ev.escrow_funded===true||meta.escrow_funded===true;
    const nativePay=source==="agent_souk"&&ev.payout_mechanism_verified===true&&asset==="USDC"&&network==="base";
    const policyOK=policyUsableFor(source,asset,network);
    const keep=gate&&policyOK&&(funding||nativePay)&&
      ["taskmarket","agent_souk","bountybook","laborx"].includes(source);
    if(keep){(preservedCount as any)[source]++;continue;}
    quarantined.push({
      id:row.id,
      user_id:row.user_id,
      source:row.source,
      title:row.title,
      score:row.score,
      status:"blocked",
      evidence:row.evidence||{},
      offer:row.offer||{},
      created_at:row.created_at,
      updated_at:quarantineNow,
      metadata:{
        ...meta,
        payout_gate_status:"BLOCKED",
        payout_gate_reason:!["taskmarket","agent_souk","bountybook","laborx"].includes(source)
          ?"PLATFORM_NOT_IN_CRYPTO_ONLY_REVENUE_ALLOWLIST"
          :!gate?"LEGACY_ROW_NOT_REVERIFIED_UNDER_CRYPTO_ONLY_POLICY"
          :!policyOK?"OFFICIAL_CRYPTO_PAYOUT_POLICY_STALE_OR_MISMATCHED"
          :"LISTING_FUNDING_OR_NATIVE_CRYPTO_PAYOUT_NOT_PROVEN",
        crypto_only_gate:"STRICT_FAIL_CLOSED",
        automation_allowed:false,
        execution_decision:"BLOCKED",
        blocked_at:quarantineNow,
        blocked_by:"midad_money_hunter_crypto_only_policy"
      }
    });
  }
  let quarantinedCount=0;
  for(let i=0;i<quarantined.length;i+=100){
    const batch=quarantined.slice(i,i+100);
    const {error}=await sb.from("opportunities").upsert(batch,{onConflict:"id",defaultToNull:false});
    if(error)return json({ok:false,error:"CRYPTO_POLICY_QUARANTINE_WRITE_FAILED",detail:clip(error.message,300)},503);
    quarantinedCount+=batch.length;
  }
  const optionalRevenueSourcesEnabled=false;
  const result:any={source:"midad_money_hunter",version:17,sources:{},created:0,updated:0,skipped:0,reconciled:0,discovered:0,optional_revenue_sources_enabled:false,
    crypto_only_gate:"STRICT_FAIL_CLOSED",
    legacy_quarantine:{blocked:quarantinedCount,preserved_current_crypto_rows:preservedCount,rows_checked:(activePayoutRows||[]).length},
    ugig_submission_gate:{allowed:false,account_status:ugigHealth?.account_status||null,blocked:true,reason:"owner_directive_crypto_only_and_ugig_account_blocked"}};
  let engineRunId:string|null=null;
  try{
    const {data:run}=await sb.from("engine_runs").insert({
      user_id:profile.id,
      job_type:"money_hunter",
      status:"running",
      requested_tools:["taskmarket","deskcrew","ugig","moltjobs","basedagents","taskbounty","monetizeyouragent","withagi_signal","agent_souk","opportunities"],
      result:{trigger:"direct_money_hunter"}
    }).select("id").single();
    engineRunId=run?.id||null;
  }catch(_){/* telemetry must never block revenue discovery */}


  try{
    // P0 crypto-only discovery: query only the platforms with current official crypto payout policies.
    // Unregistered/unverified platforms are not scraped into active opportunities.
    const [tm,dc,ug1,ug2,ug3,ug4,molt,ba,tb,mya,withagi,agentSouk]=await Promise.all([
      getJson("https://api.taskmarket.dev/api/tasks?status=open&sort=reward_desc&limit=50"),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"CRYPTO_PAYOUT_POLICY_NOT_VERIFIED"}),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"UGIG_ACCOUNT_BLOCKED_AND_POLICY_PAUSED"}),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"UGIG_ACCOUNT_BLOCKED_AND_POLICY_PAUSED"}),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"UGIG_ACCOUNT_BLOCKED_AND_POLICY_PAUSED"}),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"UGIG_ACCOUNT_BLOCKED_AND_POLICY_PAUSED"}),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"CRYPTO_PAYOUT_POLICY_NOT_VERIFIED"}),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"PLATFORM_CRYPTO_PAYOUT_POLICY_NOT_REGISTERED"}),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"CRYPTO_PAYOUT_POLICY_NOT_VERIFIED"}),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"CRYPTO_PAYOUT_POLICY_NOT_VERIFIED"}),
      Promise.resolve({ok:false,status:0,data:null,skipped:true,reason:"CRYPTO_PAYOUT_POLICY_NOT_VERIFIED"}),
      getJson("https://api.agentsouk.dev/v1/demand")
    ]);

    result.sources={
      taskmarket:{ok:tm.ok,status:tm.status},
      deskcrew:{ok:dc.ok,status:dc.status},
      ugig:{page1:{ok:ug1.ok,status:ug1.status},page2:{ok:ug2.ok,status:ug2.status},page3:{ok:ug3.ok,status:ug3.status},page4:{ok:ug4.ok,status:ug4.status}},
      moltjobs:{ok:molt.ok,status:molt.status},
      basedagents:{ok:ba.ok,status:ba.status},
      taskbounty:{ok:tb.ok,status:tb.status},
      mya:{ok:mya.ok,status:mya.status,skipped:Boolean(mya.skipped)},
      withagi_signal:{ok:withagi.ok,status:withagi.status,skipped:Boolean(withagi.skipped)},
      agent_souk:{ok:agentSouk.ok,status:agentSouk.status}
    };

    const candidates:any[]=[];

    const tasks=Array.isArray(tm.data?.tasks)?tm.data.tasks:[];
    for(const t of tasks){
      const id=String(t.id||"");
      const chainId=Number(t.chainId??t.chain_id);
      const asset=chainId===4217?"OUSD":chainId===8453?"USDC":null;
      const network=chainId===4217?"Tempo":chainId===8453?"Base":"unknown";
      const rewardRaw=Number(t.reward??t.rewardUsdc??0);
      const reward=Number.isFinite(rewardRaw)&&rewardRaw>0?(t.reward!==undefined?rewardRaw/1000000:Number(t.rewardUsdc||0)):0;
      const netRaw=Number(t.netReward??t.net_reward??t.reward??0);
      const netReward=Number.isFinite(netRaw)&&netRaw>0?netRaw/1000000:reward;
      if(!id||!Number.isFinite(reward)||reward<1) continue;
      const status=String(t.status||"open").toLowerCase();
      if(status!=="open") continue;
      const deadline=t.expiryTime||t.deadline||null;
      const tags=Array.isArray(t.tags)?t.tags:[];
      candidates.push({
        fp:"taskmarket:"+id,source:"taskmarket",
        title:String(t.title||t.description||"Taskmarket bounty").slice(0,180),
        description:clip(t.description,2200),reward,netReward,
        asset,chain:network,externalId:id,deadline,tags,applicants:Number(t.submissionCount||t.submissions||t.awardCount||0),
        liveStatus:"open",actionUrl:"https://taskmarket.dev/tasks/"+id,
        evidence:{platform:"Taskmarket",task_id:id,status:t.status,mode:t.mode,tags,requester:t.requester||null,payment_asset:asset||"UNKNOWN",network,reward_amount:reward,reward_asset:asset||"UNKNOWN",...(asset==="USDC"?{reward_usdc:reward}:asset==="OUSD"?{reward_ousd:reward}:{}),source_url:"https://api.taskmarket.dev/api/tasks/"+id}
      });
    }

    const bounties=Array.isArray(dc.data?.bounties)?dc.data.bounties:(Array.isArray(dc.data)?dc.data:[]);
    for(const b of bounties){
      const reward=Number(b.bountyUsd||b.rewardUsd||b.reward||0);
      const id=String(b.ticketId||b.id||"");
      if(!id||!Number.isFinite(reward)||reward<1) continue;
      const entrants=Number(b.entrants||0);
      const fee=Number(b.toolPriceUsd||.06);
      candidates.push({
        fp:"deskcrew:"+id,source:"deskcrew",
        title:String(b.subject||b.title||"DeskCrew bounty").slice(0,180),
        description:clip(b.description||b.body||b.subject,2200),
        reward,netReward:Math.max(0,reward*.85-fee),
        chain:String(b.payoutNetwork||"unknown"),externalId:id,
        deadline:b.closingTime||b.decidesAt||null,tags:Array.isArray(b.tags)?b.tags:[],
        applicants:entrants,liveStatus:"open",actionUrl:"https://deskcrew.io/arena",
        evidence:{platform:"DeskCrew",ticket_id:id,bounty_usd:reward,payout_network:b.payoutNetwork||null,entrants,entry_fee_usd:fee,source_url:"https://deskcrew.io/arena"}
      });
    }

    const ugigs=[
      ...(Array.isArray(ug1.data?.gigs)?ug1.data.gigs:[]),
      ...(Array.isArray(ug2.data?.gigs)?ug2.data.gigs:[]),
      ...(Array.isArray(ug3.data?.gigs)?ug3.data.gigs:[]),
      ...(Array.isArray(ug4.data?.gigs)?ug4.data.gigs:[])
    ];
    const seenUg=new Set<string>();
    for(const g of ugigs){
      const id=String(g.id||""); if(!id||seenUg.has(id)) continue; seenUg.add(id);
      if(String(g.status||"").toLowerCase()!=="active") continue;
      if(g.listing_type && String(g.listing_type).toLowerCase()!=="hiring") continue;
      const min=Number(g.budget_min||0), max=Number(g.budget_max||0), reward=max||min;
      const coin=normalizedCoin(g.payment_coin||"");
      if(!(reward>=3)||!viableCoin(coin)) continue;
      const applicants=Number(g.applications_count||0);
      const updated=g.updated_at||g.created_at||null;
      const hours=hoursSince(updated);
      const crypto=coin.startsWith("usdc")||coin==="usdt";
      candidates.push({
        fp:"ugig:"+id,source:"ugig",
        title:String(g.title||"uGig paid work").slice(0,180),
        description:clip(g.description,2400),
        reward,netReward:reward,chain:coin,
        externalId:id,deadline:g.duration||null,
        tags:Array.isArray(g.skills_required)?g.skills_required:[],
        applicants,liveStatus:"open",actionUrl:"https://ugig.net/gigs/"+id,
        score:score(reward,applicants,hours,crypto),
        evidence:{
          platform:"ugig.net",gig_id:id,status:g.status,listing_type:g.listing_type||"hiring",category:g.category||null,
          budget_min:min,budget_max:max,payment_coin:g.payment_coin||null,
          duration:g.duration||null,applications_count:applicants,
          source_url:"https://ugig.net/gigs/"+id
        }
      });
    }

    const moltRows=Array.isArray(molt.data?.data)?molt.data.data:[];
    for(const j of moltRows){
      const reward=Number(j.budgetUsdc||0);
      if(String(j.status||"").toUpperCase()!=="OPEN"||!j.funded||reward<1) continue;
      const id=String(j.id||""); if(!id) continue;
      candidates.push({
        fp:"moltjobs:"+id,source:"moltjobs",
        title:String(j.title||"MoltJobs task").slice(0,180),
        description:clip(j.inputData?.generalDescription||j.title,2200),
        reward,netReward:reward*.95,chain:"USDC/Base",externalId:id,
        deadline:j.deadlineAt||null,tags:Array.isArray(j.requiredSkills)?j.requiredSkills:[],
        applicants:0,liveStatus:"open",actionUrl:"https://moltjobs.io/",
        score:score(reward,0,hoursSince(j.updatedAt||j.createdAt),true),
        evidence:{
          platform:"MoltJobs",job_id:id,status:j.status,funded:true,budget_usdc:reward,
          purpose:j.purpose||null,escrow_tx_hash:j.escrowTxHash||null,
          chain_id:j.chainId||null,token_symbol:j.tokenSymbol||null,
          source_url:"https://api.moltjobs.io/v1/jobs/"+id
        }
      });
    }


    const baRows=Array.isArray(ba.data?.tasks)?ba.data.tasks:(Array.isArray(ba.data)?ba.data:[]);
    for(const t of baRows){
      const id=String(t.id||t.task_id||""); const status=String(t.status||"open").toLowerCase();
      const b=t.bounty||t.reward||{};
      const amountDisplay=Number(b.amount_display??t.amount_display??0)||0;
      const amountAtomic=Number(b.amount_atomic??t.amount_atomic??0)/1000000;
      const reward=amountDisplay||amountAtomic;
      const token=String(b.token||t.token||"USDC").toUpperCase();
      if(!id||status!=="open"||!Number.isFinite(reward)||reward<1) continue;
      const applicants=Number(t.claims_count||t.submissions_count||t.submissions||0)||0;
      const category=String(t.category||t.capability||"agent_task");
      candidates.push({
        fp:"basedagents:"+id,source:"basedagents",title:String(t.title||"BasedAgents task").slice(0,180),
        description:clip(t.description||t.spec||t.instructions,2400),reward,netReward:reward*.98,
        chain:String(b.network||t.network||"eip155:8453"),externalId:id,
        deadline:t.deadline||t.expires_at||null,tags:Array.isArray(t.capabilities)?t.capabilities:[category],
        applicants,liveStatus:"open",actionUrl:"https://basedagents.ai/tasks/"+id,
        score:score(reward,applicants,hoursSince(t.updated_at||t.created_at),true),
        evidence:{
          platform:"BasedAgents",task_id:id,status:t.status,title:t.title||null,
          bounty:{amount_display:amountDisplay||null,amount_atomic:String(b.amount_atomic||t.amount_atomic||""),token,network:b.network||t.network||"eip155:8453"},
          category,capabilities:t.capabilities||[],source_url:"https://api.basedagents.ai/v1/tasks/"+id
        }
      });
    }

    const tbRows=Array.isArray(tb.data?.tasks)?tb.data.tasks:(Array.isArray(tb.data)?tb.data:[]);
    for(const t of tbRows){
      const id=String(t.id||t.task_id||"");
      const status=String(t.status||t.state||"open").toLowerCase();
      const cents=Number(t.bounty_cents??t.reward_cents??0);
      const direct=Number(t.bounty_usd??t.reward_usd??t.reward??t.amount_usd??0);
      const reward=direct || (Number.isFinite(cents)&&cents>0?cents/100:0);
      if(!id||status!=="open"||!Number.isFinite(reward)||reward<1) continue;
      const applicants=Number(t.submissions_count||t.submission_count||t.submissions||0)||0;
      const rails=Array.isArray(t.payout_methods)?t.payout_methods:(Array.isArray(t.payment_methods)?t.payment_methods:[]);
      const crypto=rails.length===0 || rails.some((x:any)=>/usdc|usdt|eth|btc|crypto/i.test(JSON.stringify(x)));
      const language=String(t.language||t.primary_language||"");
      candidates.push({
        fp:"taskbounty:"+id,source:"taskbounty",title:String(t.title||t.name||"TaskBounty bounty").slice(0,180),
        description:clip(t.description||t.summary||t.issue_body,2400),
        reward,netReward:reward*.80,chain:crypto?"USDC/crypto":"USD",externalId:id,
        deadline:t.deadline||t.expires_at||null,tags:Array.isArray(t.tags)?t.tags:(language?[language]:[]),
        applicants,liveStatus:"open",actionUrl:"https://www.task-bounty.com/task/"+id,
        score:score(reward,applicants,hoursSince(t.updated_at||t.created_at),crypto),
        evidence:{
          platform:"TaskBounty",task_id:id,status:t.status||t.state,title:t.title||null,
          bounty_usd:reward,payout_methods:rails,language,github_repo_url:t.github_repo_url||null,
          github_issue_url:t.github_issue_url||null,source_url:"https://www.task-bounty.com/task/"+id
        }
      });
    }

    const withagiRows=Array.isArray(withagi.data?.bounties)?withagi.data.bounties:(Array.isArray(withagi.data)?withagi.data:[]);
    for(const b of withagiRows){
      const id=String(b.id||b.bounty_id||b.task_id||"");
      const status=String(b.status||b.state||"open").toLowerCase();
      const rewardUsd=Number(b.reward_usd??b.bounty_usd??b.usd_value??b.value_usd??0)||0;
      if(!id||!["open","available","unclaimed","active"].includes(status)||rewardUsd<1) continue;
      const applicants=Number(b.claims_count||b.applicants||b.submissions_count||0)||0;
      candidates.push({
        fp:"withagi:"+id,source:"withagi_signal",
        title:String(b.title||b.task_title||"WithAGI bounty").slice(0,180),
        description:clip(b.description||b.detail||b.acceptance_criteria,2400),
        reward:rewardUsd,netReward:rewardUsd*.96,
        chain:String(b.payment_network||b.network||"ETH"),externalId:id,
        deadline:b.deadline||b.expires_at||null,
        tags:Array.isArray(b.tags)?b.tags:(Array.isArray(b.capabilities)?b.capabilities:[]),
        applicants,liveStatus:"open",actionUrl:"https://signal.withagi.space/bounties/"+id,
        score:score(rewardUsd,applicants,hoursSince(b.updated_at||b.created_at),true),
        evidence:{
          platform:"WithAGI The Signal",bounty_id:id,status:b.status||b.state,title:b.title||b.task_title||null,
          reward_usd:rewardUsd,network:b.payment_network||b.network||"ETH",
          source_url:"https://api-signal.withagi.space/api/v1/bounties"
        }
      });
    }

    const demand=agentSouk.data||{};
    const soukRows=Array.isArray(demand.bounties)?demand.bounties:
      Array.isArray(demand.open_bounties)?demand.open_bounties:
      Array.isArray(demand.jobs)?demand.jobs:
      Array.isArray(demand.items)?demand.items:
      [];
    for(const j of soukRows){
      const id=String(j.id||j.job_id||j.bounty_id||"");
      const status=String(j.status||j.state||"open").toLowerCase();
      const rawAmount=j.reward_usdc??j.bounty_usdc??j.price_usdc??j.amount_usdc??j.reward??j.price??0;
      let reward=Number(rawAmount)||0;
      if(reward>10000 && reward%1===0) reward=reward/1000000;
      if(!id||!["open","available","unclaimed","active","posted"].includes(status)||reward<1) continue;
      const applicants=Number(j.applicants||j.claims_count||j.submissions_count||0)||0;
      candidates.push({
        fp:"agentsouk:"+id,source:"agent_souk",
        title:String(j.title||j.name||j.description||"Agent Souk demand").slice(0,180),
        description:clip(j.description||j.prompt||j.requirements||j.input_schema,2400),
        reward,netReward:reward*.97,chain:"USDC/Base",externalId:id,
        deadline:j.deadline||j.expires_at||null,
        tags:Array.isArray(j.tags)?j.tags:(Array.isArray(j.capabilities)?j.capabilities:[]),
        applicants,liveStatus:"open",actionUrl:"https://api.agentsouk.dev/v1/jobs/"+id,
        score:score(reward,applicants,hoursSince(j.updated_at||j.created_at),true),
        evidence:{
          platform:"Agent Souk",job_id:id,status:j.status||j.state,title:j.title||j.name||null,
          reward_usdc:reward,network:"Base",payment:"USDC",payout_mechanism_verified:true,
          payment_evidence_source:"official Agent Souk documented wallet-to-wallet USDC/Base payment flow",
          source_url:"https://api.agentsouk.dev/v1/demand"
        }
      });
    }

    const myaRows=Array.isArray(mya.data?.jobs)?mya.data.jobs:(Array.isArray(mya.data)?mya.data:[]);
    for(const j of myaRows){
      const id=String(j.id||j.job_id||"");
      const status=String(j.status||"open").toLowerCase();
      const rawReward=j.reward??j.reward_usdc??j.bounty??j.payment??"";
      const rewardMatch=String(rawReward).match(/([0-9]+(?:\\.[0-9]+)?)/);
      const reward=Number.isFinite(Number(rawReward))?Number(rawReward):(rewardMatch?Number(rewardMatch[1]):0);
      if(!id||status!=="open"||!Number.isFinite(reward)||reward<1) continue;
      const applicants=Number(j.applications_count||j.applicants||j.claims_count||0)||0;
      candidates.push({
        fp:"mya:"+id,source:"monetizeyouragent",title:String(j.title||j.name||"Monetize Your Agent job").slice(0,180),
        description:clip(j.description||j.summary||j.details,2400),
        reward,netReward:reward*.96,chain:"USDC/Base",externalId:id,
        deadline:j.deadline||j.expires_at||null,tags:Array.isArray(j.skills)?j.skills:(Array.isArray(j.capabilities)?j.capabilities:[]),
        applicants,liveStatus:"open",actionUrl:"https://monetizeyouragent.fun/api/v1/jobs/"+id,
        score:score(reward,applicants,hoursSince(j.updated_at||j.created_at),true),
        evidence:{
          platform:"Monetize Your Agent",job_id:id,status:j.status,title:j.title||j.name||null,
          raw_reward:String(rawReward),network:"Base",payment:"USDC",
          source_url:"https://monetizeyouragent.fun/api/v1/jobs/"+id
        }
      });
    }

    // Re-verify each shortlisted Taskmarket listing against its official detail endpoint and Base mainnet receipt.
    // A platform-level USDC policy alone never marks a task funded.
    const taskmarketShortlist=candidates.filter((c:any)=>c.source==="taskmarket").sort((a:any,b:any)=>Number(b.reward||0)-Number(a.reward||0)).slice(0,25);
    await Promise.all(taskmarketShortlist.map(async(c:any)=>{
      const detailResponse=await getJson("https://api.taskmarket.dev/api/tasks/"+encodeURIComponent(String(c.externalId)),5000);
      const detail=detailResponse?.data?.task||detailResponse?.data;
      if(!detailResponse.ok||String(detail?.id||"")!==String(c.externalId)){
        c.evidence={...(c.evidence||{}),payment_asset:"UNKNOWN",network:"unknown",funding_verified:false,funding_check_reason:"OFFICIAL_TASK_DETAIL_UNAVAILABLE",funding_checked_at:new Date().toISOString()};
        return;
      }
      const funding=await verifyTaskmarketEscrow(detail);
      const rawReward=Number(detail.reward);
      const rawNet=Number(detail.netReward);
      if(Number.isFinite(rawReward)&&rawReward>0)c.reward=rawReward/1000000;
      if(Number.isFinite(rawNet)&&rawNet>=0)c.netReward=rawNet/1000000;
      c.deadline=detail.expiryTime||detail.deadline||c.deadline||null;
      c.liveStatus=String(detail.status||"").toLowerCase();
      c.evidence={
        ...(c.evidence||{}),
        platform:"Taskmarket",task_id:String(detail.id),status:detail.status,phase:detail.phase,mode:detail.mode,
        payment_asset:String(funding.asset|| (Number(detail.chainId??detail.chain_id)===4217?"OUSD":Number(detail.chainId??detail.chain_id)===8453?"USDC":"UNKNOWN")),
        network:String(funding.network|| (Number(detail.chainId??detail.chain_id)===4217?"Tempo":Number(detail.chainId??detail.chain_id)===8453?"Base":"unknown")),
        reward_amount:c.reward,
        reward_asset:String(funding.asset|| (Number(detail.chainId??detail.chain_id)===4217?"OUSD":Number(detail.chainId??detail.chain_id)===8453?"USDC":"UNKNOWN")),
        ...(String(funding.asset||"")==="USDC"?{reward_usdc:c.reward,net_reward_usdc:c.netReward}:{}),
        ...(String(funding.asset||"")==="OUSD"?{reward_ousd:c.reward,net_reward_ousd:c.netReward}:{}),
        escrow_tx_hash:funding.tx_hash||null,
        escrow_recipient:funding.escrow_recipient||null,
        escrow_sender:funding.escrow_sender||null,
        escrow_amount_atomic:funding.escrow_amount_atomic||funding.escrow_amount_base_units||null,
        expected_reward_atomic:funding.expected_reward_atomic||funding.expected_reward_base_units||String(detail.reward||""),
        funding_verified:funding.ok===true,
        funding_check_reason:funding.reason||null,
        funding_confirmations:funding.confirmations||0,
        funding_verified_at:funding.ok?funding.verified_at:null,
        submission_fee_verified:funding.submission_fee_verified??null,
        submission_fee_usd:funding.submission_fee_usd??null,
        source_url:"https://api.taskmarket.dev/api/tasks/"+String(detail.id)
      };
    }));
    result.taskmarket_funding_check={
      checked:taskmarketShortlist.length,
      verified:taskmarketShortlist.filter((c:any)=>c.evidence?.funding_verified===true).length,
      failed:taskmarketShortlist.filter((c:any)=>c.evidence?.funding_verified!==true).length,
      outcomes:taskmarketShortlist.map((c:any)=>({
        task_id:String(c.externalId||""),
        funding_verified:c.evidence?.funding_verified===true,
        reason:String(c.evidence?.funding_check_reason||(c.evidence?.funding_verified===true?"VERIFIED_TASK_ESCROW":"UNKNOWN")),
        task_status:String(c.evidence?.status||""),
        phase:String(c.evidence?.phase||""),
        tx_hash_present:Boolean(c.evidence?.escrow_tx_hash),
        confirmations:Number(c.evidence?.funding_confirmations||0)
      }))
    };
    candidates.sort((a,b)=>(Number(b.score||score(b.reward,b.applicants,0,viableCoin(b.chain)))-Number(a.score||0)) || (b.netReward-a.netReward));
    result.discovered=candidates.length;

    // Reconcile stale Taskmarket candidates only against a successful, complete official open-task feed.
    // Partial pages, changed response schemas, HTTP failures, and timeouts never mass-block opportunities.
    let staleTaskmarketReconciliation:any={enabled:false,reason:"OPEN_FEED_NOT_COMPLETE"};
    if(tm.ok && Array.isArray(tm.data?.tasks) && tm.data?.hasMore===false){
      const reconciliationAt=new Date().toISOString();
      const currentTaskmarketIds=new Set<string>();
      for(const task of tm.data.tasks){
        const id=String(task?.id||"").trim().toLowerCase();
        if(!/^0x[a-f0-9]{64}$/.test(id))continue;
        const status=String(task?.status||"").toLowerCase();
        const phase=String(task?.phase||"active").toLowerCase();
        const deadlineRaw=task?.expiryTime||task?.deadline||null;
        const deadlineMs=deadlineRaw?Date.parse(String(deadlineRaw)):NaN;
        const rewardBase=Number(task?.reward??0);
        const rewardUsdc=Number.isFinite(rewardBase)&&rewardBase>0?rewardBase/1000000:Number(task?.rewardUsdc??0);
        const live=status==="open"&&(phase==="active"||!phase)&&task?.submissionWindowOpen!==false&&
          (!Number.isFinite(deadlineMs)||deadlineMs>Date.now())&&Number.isFinite(rewardUsdc)&&rewardUsdc>=1;
        if(live)currentTaskmarketIds.add(id);
      }
      const {data:activeTaskmarketRows,error:activeTaskmarketError}=await sb.from("opportunities")
        .select("id,status,title,offer,evidence,metadata,fingerprint,updated_at")
        .eq("source","taskmarket")
        .in("status",["money_candidate","human_review"])
        .order("updated_at",{ascending:false})
        .limit(2000);
      let staleBlocked=0;
      let staleWriteErrors=0;
      if(!activeTaskmarketError){
        for(const row of (activeTaskmarketRows||[])){
          const offer=row.offer||{}, evidence=row.evidence||{}, metadata=row.metadata||{};
          const fallback=String(row.fingerprint||"").replace(/^taskmarket:/i,"");
          const taskId=String(offer.external_id||evidence.task_id||metadata.external_id||fallback).trim().toLowerCase();
          if(!/^0x[a-f0-9]{64}$/.test(taskId))continue;
          const deadlineRaw=offer.deadline||evidence.deadline||metadata.deadline||null;
          const deadlineMs=deadlineRaw?Date.parse(String(deadlineRaw)):NaN;
          const expired=Number.isFinite(deadlineMs)&&deadlineMs<=Date.now();
          const missingFromCompleteFeed=!currentTaskmarketIds.has(taskId);
          if(!expired&&!missingFromCompleteFeed)continue;
          const reason=expired?"TASK_DEADLINE_EXPIRED":"TASK_NOT_IN_COMPLETE_OPEN_FEED";
          const nextMetadata={
            ...metadata,
            payout_gate_status:expired?"STALE_EXPIRED":"STALE_MISSING",
            payout_gate_reason:reason,
            automation_allowed:false,
            execution_decision:"BLOCKED",
            blocked_at:reconciliationAt,
            blocked_by:"midad_money_hunter_live_feed_reconciliation",
            stale_taskmarket_reconciliation:{
              source:"https://api.taskmarket.dev/api/tasks?status=open&sort=reward_desc&limit=50",
              feed_complete:true,
              current_open_reward_task_count:currentTaskmarketIds.size,
              checked_at:reconciliationAt,
              previous_deadline:deadlineRaw||null
            }
          };
          const {data:changed,error:changeError}=await sb.from("opportunities")
            .update({status:"blocked",metadata:nextMetadata,updated_at:reconciliationAt})
            .eq("id",row.id)
            .eq("status",row.status)
            .select("id")
            .maybeSingle();
          if(changeError)staleWriteErrors++;
          else if(changed)staleBlocked++;
        }
        staleTaskmarketReconciliation={
          enabled:true,feed_complete:true,checked:(activeTaskmarketRows||[]).length,
          current_open_reward_task_count:currentTaskmarketIds.size,
          blocked:staleBlocked,write_errors:staleWriteErrors,checked_at:reconciliationAt
        };
      }else{
        staleTaskmarketReconciliation={enabled:false,reason:"ACTIVE_TASKMARKET_OPPORTUNITY_QUERY_FAILED",error:clip(activeTaskmarketError.message,200),checked_at:reconciliationAt};
      }
    }
    result.stale_taskmarket_reconciliation=staleTaskmarketReconciliation;

    let cryptoRejected=0;
    for(const c of candidates.slice(0,200)){
      const verifiedAt=new Date().toISOString();
      const registry=cryptoPolicyByPlatform.get(String(c.source||""));
      const payoutGate=cryptoPayoutGate(c,registry);
      const risk=assessRisk(c);
      const safeStatus=risk.risk_class==="GREEN"?"money_candidate":"human_review";
      const {data:exists}=await sb.from("opportunities").select("id,status,metadata").eq("fingerprint",c.fp).maybeSingle();

      if(!payoutGate.allowed){
        cryptoRejected++;
        if(exists && !["submitted_waiting","technical_blocked","settled","paid","accepted_waiting_delivery","delivered"].includes(String(exists.status||""))){
          await sb.from("opportunities").update({status:"blocked",updated_at:verifiedAt,metadata:{...(exists.metadata||{}),payout_gate_status:"BLOCKED",payout_gate_reason:payoutGate.reason||"CRYPTO_PAYOUT_UNVERIFIED",crypto_only_gate:"STRICT_FAIL_CLOSED",automation_allowed:false,execution_decision:"BLOCKED"}}).eq("id",exists.id);
        }
        result.skipped++;
        continue;
      }
      // No zero-budget operation may pay an action/claim fee. Candidate can be observed but is not executable.
      if(!payoutGate.auto_spend_allowed)c.execution_spend_blocked=true;

      if(exists){
        const preserved=exists.status==="submitted_waiting"||exists.status==="technical_blocked"||exists.status==="settled";
        const status=preserved?exists.status:safeStatus;
        const metadata={
          ...(exists.metadata||{}),
          origin:"midad_money_hunter_v11",
          funded_signal:true,
          requires_human_gate:true,
          execution_write:false,
          application_ready:c.source==="ugig" && risk.risk_class==="GREEN" && ugigApplicationLaneAllowed,
          risk_class:risk.risk_class,
          risk_flags:risk.flags,
          requires_human_review:risk.requires_human_review,
          automation_allowed:risk.automation_allowed,
          payment_coin:payoutGate.asset,
          payout_gate_status:"VERIFIED_CRYPTO",
          payout_gate_reason:null,
          payout_policy_checked_at:payoutGate.policy_checked_at,
          crypto_network:payoutGate.network,
          external_action_fee_usdc:payoutGate.fee,
          execution_spend_blocked:Boolean(c.execution_spend_blocked),
          automation_allowed:!c.execution_spend_blocked&&risk.risk_class==="GREEN",
          applicants:c.applicants||0,
          last_verified_at:verifiedAt
        };
        const {error}=await sb.from("opportunities").update({
          status,title:c.title,description:c.description,evidence:c.evidence,
          offer:{reward_usd:c.reward,net_reward_usd:c.netReward,chain:c.chain,external_id:c.externalId,deadline:c.deadline,applicants:c.applicants||0,action_url:c.actionUrl},
          opportunity_type:"paid_work",confidence:.9,expected_value:Math.max(0,c.netReward),
          metadata,score:Number(c.score||score(c.reward,c.applicants,hoursSince(c.evidence?.updated_at),viableCoin(c.chain)))
        }).eq("id",exists.id);
        if(error) result.skipped++; else {result.updated++;if(exists.status!==status)result.reconciled++;}
        continue;
      }

      const s=Number(c.score||score(c.reward,c.applicants,0,viableCoin(c.chain)));
      const {error}=await sb.from("opportunities").insert({
        user_id:profile.id,source:c.source,title:c.title,score:s,status:safeStatus,
        evidence:c.evidence,offer:{reward_usd:c.reward,net_reward_usd:c.netReward,chain:c.chain,external_id:c.externalId,deadline:c.deadline,applicants:c.applicants||0,action_url:c.actionUrl},
        opportunity_type:"paid_work",description:c.description,confidence:.9,expected_value:Math.max(0,c.netReward),
        fingerprint:c.fp,
        metadata:{
          origin:"midad_money_hunter_v11",funded_signal:true,requires_human_gate:true,
          execution_write:false,application_ready:c.source==="ugig" && risk.risk_class==="GREEN" && ugigApplicationLaneAllowed,
          risk_class:risk.risk_class,risk_flags:risk.flags,
          requires_human_review:risk.requires_human_review,automation_allowed:risk.automation_allowed,
          payment_coin:payoutGate.asset,
          payout_gate_status:"VERIFIED_CRYPTO",
          payout_gate_reason:null,
          payout_policy_checked_at:payoutGate.policy_checked_at,
          crypto_network:payoutGate.network,
          external_action_fee_usdc:payoutGate.fee,
          execution_spend_blocked:Boolean(c.execution_spend_blocked),
          automation_allowed:!c.execution_spend_blocked&&risk.risk_class==="GREEN",
          applicants:c.applicants||0,last_verified_at:verifiedAt
        }
      });
      if(error) result.skipped++; else result.created++;
    }

    result.crypto_gate={mode:"STRICT_FAIL_CLOSED",checked_candidates:candidates.length,rejected:cryptoRejected,verified_platforms:[...cryptoPolicyByPlatform.keys()]};
    result.duration_ms=Date.now()-started;
    if(engineRunId){
      await sb.from("engine_runs").update({
        status:"completed",
        result,
        completed_at:new Date().toISOString(),
        attempt_count:1,
        latency_ms:result.duration_ms,
        providers_used:Object.keys(result.sources||{})
      }).eq("id",engineRunId);
    }
    return json({ok:true,result});
  }catch(e){
    result.error=clip(e);
    result.duration_ms=Date.now()-started;
    if(engineRunId){
      await sb.from("engine_runs").update({
        status:"failed",
        result,
        error:clip(e),
        completed_at:new Date().toISOString(),
        attempt_count:1,
        latency_ms:result.duration_ms,
        providers_used:Object.keys(result.sources||{})
      }).eq("id",engineRunId);
    }
    return json({ok:false,error:clip(e),result},500);
  }
});