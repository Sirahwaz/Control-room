import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DATABASE_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const INGEST_KEY = Deno.env.get("MIDAD_INGEST_KEY") || "";
const SOLANA_RPC = Deno.env.get("MIDAD_SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com";
const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const db = DATABASE_URL ? postgres(DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10, ssl: "require", prepare: false }) : null;
const H = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-autonomy-key,x-midad-ingest-key"};
const json = (v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clip = (v:unknown,n=500)=>String(v??"").slice(0,n);
function needDb(){if(!db)throw new Error("supabase_db_url_missing");return db;}

async function secret(name:string){
 const d=needDb();
 const rows=await d.unsafe("select decrypted_secret from vault.decrypted_secrets where name=$1 order by updated_at desc limit 1",[name]);
 return typeof rows[0]?.decrypted_secret==="string"?rows[0].decrypted_secret:"";
}
async function authorized(req:Request){
 const got=req.headers.get("x-midad-autonomy-key")||"";
 const ingestGot=req.headers.get("x-midad-ingest-key")||"";
 if(!got&&!ingestGot)return false;
 const [autonomy,ingest]=await Promise.all([secret("midad_autonomy_key"),secret("MIDAD_INGEST_KEY")]);
 const equal=async(a:string,b:string)=>{
   if(!a||!b)return false;
   const digest=async(x:string)=>{const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(x));return Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,"0")).join("");};
   return (await digest(a))===(await digest(b));
 };
 return (await equal(got,autonomy))||(await equal(ingestGot,ingest));
}
async function solana(method:string,params:unknown[]){
 const res=await fetch(SOLANA_RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:Date.now(),method,params}),signal:AbortSignal.timeout(20000)});
 const body=await res.json().catch(()=>null);
 if(!res.ok)throw new Error("solana_rpc_http_"+res.status);
 if(body?.error)throw new Error("solana_rpc_"+clip(body.error.message,180));
 return body?.result;
}
function tokenDeltas(tx:any){
 const pre=tx?.meta?.preTokenBalances||[],post=tx?.meta?.postTokenBalances||[],map=new Map<string,any>();
 for(const x of [...pre,...post]){
   const key=String(x.accountIndex)+"|"+String(x.mint)+"|"+String(x.owner||"");
   let row=map.get(key);
   if(!row){row={accountIndex:Number(x.accountIndex),mint:String(x.mint),owner:String(x.owner||""),pre:0,post:0,decimals:Number(x.uiTokenAmount?.decimals||0)};map.set(key,row);}
   row.decimals=Number(x.uiTokenAmount?.decimals??row.decimals);
   if(pre.includes(x))row.pre=Number(x.uiTokenAmount?.amount||0);
   if(post.includes(x))row.post=Number(x.uiTokenAmount?.amount||0);
 }
 return [...map.values()].map(x=>({...x,deltaRaw:x.post-x.pre}));
}
async function persistMatchEvidence(receiptId:string, patch:any){
 const d=needDb();
 const rows=await d.unsafe("update public.midad_wallet_receipts set evidence=coalesce(evidence,'{}'::jsonb)||$2::jsonb where id=$1 returning id",[receiptId,JSON.stringify(patch)]);
 if(!rows.length)throw new Error("receipt_match_evidence_persist_failed");
}

async function reconcileExactSolanaReceipt(input:{receiptId:string;walletAddress:string;txHash:string;amount:number;evidence:any;}){
 const d=needDb(),evidence=input.evidence||{};
 const blockTime=Number(evidence.block_time||0);
 if(!Number.isFinite(blockTime)||blockTime<=0){
   const patch={payment_intent_matched:false,payment_intent_match_status:"manual_review_chain_time_missing",payment_intent_match_checked_at:new Date().toISOString()};
   await persistMatchEvidence(input.receiptId,patch);
   return {...patch,payment_verifier_calls:0};
 }
 const amountMicros=Math.round(input.amount*1_000_000);
 const candidates=await d.unsafe(`
   select id,quoted_crypto_amount,created_at,expires_at,status
   from public.midad_payment_intents
   where lower(coalesce(network,''))='solana'
     and upper(coalesce(settlement_asset,''))='USDC'
     and wallet_address=$1
     and status in ('created','quoted','detected','verified')
     and expires_at is not null
     and created_at<=to_timestamp($3)
     and expires_at>to_timestamp($3)
     and round(quoted_crypto_amount*1000000)::bigint=$2::bigint
   order by created_at asc
   limit 3
 `,[input.walletAddress,amountMicros,blockTime]);
 if(candidates.length!==1){
   const patch={payment_intent_matched:false,payment_intent_match_status:candidates.length===0?"unmatched_no_exact_active_intent":"manual_review_multiple_exact_intents",payment_intent_candidate_count:candidates.length,payment_intent_match_checked_at:new Date().toISOString()};
   await persistMatchEvidence(input.receiptId,patch);
   return {...patch,payment_verifier_calls:0};
 }
 if(!SUPABASE_URL||!SERVICE_ROLE_KEY){
   const patch={payment_intent_matched:false,payment_intent_match_status:"blocked_verifier_credentials_unavailable",payment_intent_match_checked_at:new Date().toISOString()};
   await persistMatchEvidence(input.receiptId,patch);
   return {...patch,payment_verifier_calls:0};
 }
 let ingestKey=INGEST_KEY;
 if(!ingestKey){try{ingestKey=await secret("MIDAD_INGEST_KEY")}catch{}}
 if(!ingestKey){
   const patch={payment_intent_matched:false,payment_intent_match_status:"blocked_ingest_key_unavailable",payment_intent_match_checked_at:new Date().toISOString()};
   await persistMatchEvidence(input.receiptId,patch);
   return {...patch,payment_verifier_calls:0};
 }
 const intentId=String(candidates[0].id);
 const callVerifier=async(action:string,extra:any={})=>{
   const response=await fetch(SUPABASE_URL+"/functions/v1/midad_payment_verifier",{
     method:"POST",
     headers:{"content-type":"application/json","authorization":"Bearer "+SERVICE_ROLE_KEY,"x-midad-ingest-key":ingestKey},
     body:JSON.stringify({action,payment_intent_id:intentId,...extra}),
     signal:AbortSignal.timeout(15000)
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok||data?.ok===false||data?.error)throw new Error("payment_verifier_"+action+":"+(data?.error||response.status));
   return data;
 };
 let calls=0;
 try{
   const existing=await d.unsafe("select id from public.midad_payment_events where payment_intent_id=$1 and tx_hash=$2 order by occurred_at desc limit 1",[intentId,input.txHash]);
   if(!existing.length){
     await callVerifier("record_event",{
       event_type:"onchain_receipt_observed",provider:"solana_rpc",tx_hash:input.txHash,
       asset:"USDC",network:"solana",observed_amount:input.amount,confirmations:0,
       evidence,occurred_at:new Date(blockTime*1000).toISOString()
     });
     calls++;
   }
   const verified=await callVerifier("reconcile");
   calls++;
   const refreshed=await d.unsafe("select status,reconciliation_status,received_tx_hash,paid_at from public.midad_payment_intents where id=$1 limit 1",[intentId]);
   const confirmed=refreshed[0]||{};
   const matched=verified?.status==="reconciled"
     &&verified?.reconciliation?.assetOk===true
     &&verified?.reconciliation?.networkOk===true
     &&verified?.reconciliation?.amountOk===true
     &&verified?.reconciliation?.txOk===true
     &&verified?.reconciliation?.independentEvidence===true
     &&String(confirmed.status||"")==="paid"
     &&String(confirmed.reconciliation_status||"")==="matched"
     &&String(confirmed.received_tx_hash||"")===input.txHash
     &&Boolean(confirmed.paid_at);
   const patch={payment_intent_matched:matched,payment_intent_id:intentId,payment_intent_match_status:matched?"reconciled":String(verified?.status||"manual_review"),payment_verifier_result:verified?.reconciliation||null,payment_intent_match_checked_at:new Date().toISOString()};
   await persistMatchEvidence(input.receiptId,patch);
   return {...patch,payment_verifier_calls:calls};
 }catch(error){
   const patch={payment_intent_matched:false,payment_intent_id:intentId,payment_intent_match_status:"verifier_call_failed",payment_intent_match_error:clip(error instanceof Error?error.message:error,300),payment_intent_match_checked_at:new Date().toISOString()};
   await persistMatchEvidence(input.receiptId,patch);
   return {...patch,payment_verifier_calls:calls};
 }
}

async function scanRoute(route:any){
 const d=needDb(),wallet=route.wallet;
 if(!wallet?.address){
   await d.unsafe("insert into public.midad_wallet_monitor_state(route_id,status,last_error,updated_at) values($1,'BLOCKED','RECEIVING_WALLET_UNAVAILABLE',now()) on conflict(route_id) do update set status='BLOCKED',last_error='RECEIVING_WALLET_UNAVAILABLE',updated_at=now()",[route.id]);
   return {route_id:route.id,status:"BLOCKED",reason:"RECEIVING_WALLET_UNAVAILABLE"};
 }
 const mint=clip(route.metadata?.verification?.token_mint||DEFAULT_USDC_MINT,100);
 if(mint!==DEFAULT_USDC_MINT)throw new Error("solana_usdc_mint_not_canonical");
 const accountResult=await solana("getTokenAccountsByOwner",[wallet.address,{mint},{commitment:"finalized",encoding:"jsonParsed"}]);
 const accounts=accountResult?.value||[];
 let balanceRaw=0;
 for(const a of accounts)balanceRaw+=Number(a?.account?.data?.parsed?.info?.tokenAmount?.amount||0);
 const signatures=new Map<string,any>();
 for(const a of accounts){
   const list=await solana("getSignaturesForAddress",[a.pubkey,{commitment:"finalized",limit:25}]);
   for(const x of list||[])if(!x.err&&x.signature)signatures.set(x.signature,x);
 }
 const receipts:any[]=[];
 let paymentVerifierCalls=0;
 for(const [signature,sigInfo] of signatures){
   const tx=await solana("getTransaction",[signature,{commitment:"finalized",maxSupportedTransactionVersion:0,encoding:"jsonParsed"}]);
   if(!tx?.meta||tx.meta.err)continue;
   const keys=tx?.transaction?.message?.accountKeys||[];
   const incoming=tokenDeltas(tx).filter((delta:any)=>delta.mint===mint&&delta.owner===wallet.address&&delta.deltaRaw>0);
   if(!incoming.length)continue;
   const decimals=Number(incoming[0]?.decimals??6);
   if(incoming.some((delta:any)=>Number(delta.decimals??6)!==decimals))continue;
   const totalRaw=incoming.reduce((sum:number,delta:any)=>sum+Number(delta.deltaRaw||0),0);
   const amount=totalRaw/Math.pow(10,decimals);
   if(!(amount>0)||!Number.isFinite(amount))continue;
   const tokenAccounts=incoming.map((delta:any)=>{const key=keys[delta.accountIndex];return typeof key==="string"?key:(key?.pubkey||null);}).filter(Boolean);
   const evidence={independently_verified:true,verifier:"solana_rpc",verifier_ref:signature,source:"midad_wallet_receipt_monitor_v4",commitment:"finalized",mint_verified:true,expected_mint:mint,observed_mint:mint,wallet_address:wallet.address,token_account:tokenAccounts.length===1?tokenAccounts[0]:null,token_accounts:tokenAccounts,delta_raw:totalRaw,decimals,slot:tx.slot||sigInfo.slot||null,block_time:tx.blockTime||sigInfo.blockTime||null,transaction_error:null,settlement_performed:false};
   const inserted=await d.unsafe("insert into public.midad_wallet_receipts as current_receipt(wallet_id,tx_hash,asset,mint,network,amount,direction,slot,commitment,evidence) values($1,$2,'USDC',$3,'solana',$4,'inbound',$5,'finalized',$6::jsonb) on conflict(wallet_id,tx_hash,asset,mint,direction) do update set amount=excluded.amount,slot=excluded.slot,commitment=excluded.commitment,evidence=coalesce(current_receipt.evidence,'{}'::jsonb)||excluded.evidence returning id,evidence",[wallet.id,signature,mint,amount,Number(tx.slot||sigInfo.slot||0)||null,JSON.stringify(evidence)]);
   const receiptId=String(inserted[0]?.id||"");
   let reconciliation:any={payment_intent_matched:false,payment_intent_match_status:"receipt_id_unavailable",payment_verifier_calls:0};
   if(receiptId&&inserted[0]?.evidence?.payment_intent_matched!==true){
     reconciliation=await reconcileExactSolanaReceipt({receiptId,walletAddress:wallet.address,txHash:signature,amount,evidence});
   }else if(inserted[0]?.evidence?.payment_intent_matched===true){
     reconciliation={payment_intent_matched:true,payment_intent_id:inserted[0]?.evidence?.payment_intent_id||null,payment_intent_match_status:"reconciled_previously",payment_verifier_calls:0};
   }
   paymentVerifierCalls+=Number(reconciliation.payment_verifier_calls||0);
   receipts.push({receipt_id:receiptId||null,tx_hash:signature,amount,evidence_status:reconciliation.payment_intent_matched?"ONCHAIN_FINALIZED_MATCHED":"ONCHAIN_FINALIZED_UNMATCHED",...reconciliation});
 }
 const stateStatus=accounts.length?"VERIFIED":"NO_TOKEN_ACCOUNT";
 const metadata={provider:"solana_rpc",mint,token_decimals:6,token_accounts:accounts.length,scanned_signatures:signatures.size,receipt_count:receipts.length,payment_verifier_calls:paymentVerifierCalls,settlement_performed:false};
 const lastSlot=[...signatures.values()].reduce((m:number,x:any)=>Math.max(m,Number(x.slot||0)),0)||null;
 await d.unsafe("insert into public.midad_wallet_monitor_state(route_id,last_scan_at,last_signature,last_slot,latest_balance,latest_balance_updated_at,status,error_count,last_error,metadata,updated_at) values($1,now(),$2,$3,$4,now(),$5,0,null,$6::jsonb,now()) on conflict(route_id) do update set last_scan_at=excluded.last_scan_at,last_signature=excluded.last_signature,last_slot=excluded.last_slot,latest_balance=excluded.latest_balance,latest_balance_updated_at=excluded.latest_balance_updated_at,status=excluded.status,error_count=0,last_error=null,metadata=excluded.metadata,updated_at=now()",[route.id,[...signatures.keys()][0]||null,lastSlot,balanceRaw/1_000_000,stateStatus,JSON.stringify(metadata)]);
 return {route_id:route.id,wallet_id:wallet.id,network:"solana",asset:"USDC",token_accounts:accounts.length,balance:balanceRaw/1_000_000,scanned_signatures:signatures.size,payment_verifier_calls:paymentVerifierCalls,receipts};
}
async function run(){
 const d=needDb();
 const routes=await d.unsafe("select r.id,r.label,r.asset,r.network,r.metadata,r.wallet_id,jsonb_build_object('id',w.id,'address',w.address,'chain',w.chain,'watch_only',w.watch_only) as wallet from public.midad_revenue_routes r left join public.midad_wallets w on w.id=r.wallet_id where r.active=true and r.auto_route=true and r.route_kind='receive' and upper(r.asset)='USDC' and lower(r.network)='solana' and w.active=true order by r.created_at asc");
 const results:any[]=[];
 for(const route of routes){
   try{results.push(await scanRoute(route));}
   catch(error){
     const message=clip(error instanceof Error?error.message:error,400);
     await d.unsafe("insert into public.midad_wallet_monitor_state(route_id,last_scan_at,status,error_count,last_error,metadata,updated_at) values($1,now(),'DEGRADED',1,$2,$3::jsonb,now()) on conflict(route_id) do update set last_scan_at=now(),status='DEGRADED',error_count=public.midad_wallet_monitor_state.error_count+1,last_error=excluded.last_error,metadata=excluded.metadata,updated_at=now()",[route.id,message,JSON.stringify({provider:"solana_rpc",settlement_performed:false})]);
     results.push({route_id:route.id,status:"DEGRADED",error:message});
   }
 }
 return {ok:true,service:"midad_wallet_receipt_monitor",version:4,mode:"read_chain_record_and_strictly_reconcile_exact_receipts",routes:results,financial_actions:{transfers:0,payment_verifier_calls:results.reduce((sum:any,r:any)=>sum+Number(r.payment_verifier_calls||0),0),direct_payment_intent_writes:0,settlement_router_calls:0}};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
 if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
 try{if(!(await authorized(req)))return json({ok:false,error:"unauthorized"},401);}catch{return json({ok:false,error:"auth_check_failed"},500);}
 let body:any={};try{body=await req.json();}catch{}
 try{
   const d=needDb(),action=String(body?.action||"scan").toLowerCase();
   if(action==="status"){
     const states=await d.unsafe("select route_id,last_scan_at,last_signature,last_slot,latest_balance,status,error_count,last_error,metadata,updated_at from public.midad_wallet_monitor_state order by updated_at desc");
     return json({ok:true,service:"midad_wallet_receipt_monitor",version:4,states});
   }
   if(action==="diagnose"){
     const r=await d.unsafe("select current_database() as database_name,(select count(*)::int from public.midad_wallet_receipts) as receipts,(select count(*)::int from public.midad_payment_events) as payment_events,(select count(*)::int from public.midad_payment_intents) as payment_intents");
     return json({ok:true,service:"midad_wallet_receipt_monitor",version:4,database_connected:true,counts:r[0],settlement_enabled:false});
   }
   return json(await run());
 }catch(error){return json({ok:false,service:"midad_wallet_receipt_monitor",version:4,error:clip(error instanceof Error?error.message:error,700)},500);}
});