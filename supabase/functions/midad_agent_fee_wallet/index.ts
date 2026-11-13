import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Wallet, JsonRpcProvider, Interface, formatUnits, formatEther, parseUnits, getAddress, keccak256 } from "npm:ethers@6.15.0";
import { initialFeeWalletSafetyMetadata } from "./fee-wallet-policy.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BASE_RPC = Deno.env.get("MIDAD_BASE_RPC_URL") || "https://mainnet.base.org";
const BASE_CHAIN_ID = 8453;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const erc20 = new Interface(["function balanceOf(address) view returns (uint256)"]);
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const H = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-midad-client,x-midad-request-id"
};
const json = (x: unknown, s=200) => new Response(JSON.stringify(x), { status:s, headers:H });
const clip = (v: unknown, n=500) => String(v ?? "").trim().slice(0,n);
const sha256 = async (s:string) => {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(v => v.toString(16).padStart(2,"0")).join("");
};

async function getAuthorizedSession(token:string) {
  if (!token || token.length < 24 || token.length > 200) return null;
  const { data, error } = await db.from("control_room_sessions")
    .select("id,active,created_at")
    .eq("token_hash", await sha256(token))
    .eq("active", true)
    .maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - new Date(data.created_at).getTime();
  if (!Number.isFinite(age) || age < 0 || age > 30*24*60*60*1000) return null;
  return data;
}

function publicWallet(w:any) {
  if (!w) return null;
  return {
    id: w.id,
    owner_scope: w.owner_scope,
    network: w.network,
    chain_id: BASE_CHAIN_ID,
    address: w.address,
    status: w.status,
    purpose: w.purpose,
    created_at: w.created_at,
    updated_at: w.updated_at,
    last_balance: w.last_balance,
    last_balance_asset: w.last_balance_asset,
    last_balance_updated_at: w.last_balance_updated_at,
    spending_enabled: false,
    metadata: {
      lifecycle: w.metadata?.lifecycle || "PENDING_VERIFICATION",
      custody: "Supabase Vault",
      network: "Base",
      max_per_transaction_usd: 5,
      max_daily_total_usd: 5,
      auto_execution: "DISABLED_UNTIL_FUNDING_AND_TESTS",
      private_key_exposed: false
    }
  };
}

async function readBalance(address:string) {
  const provider = new JsonRpcProvider(BASE_RPC, BASE_CHAIN_ID);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== BASE_CHAIN_ID) throw new Error("wrong_base_chain_id");
  const [eth, usdcRaw] = await Promise.all([
    provider.getBalance(address),
    provider.call({ to: USDC, data: erc20.encodeFunctionData("balanceOf", [address]) })
  ]);
  const usdc = erc20.decodeFunctionResult("balanceOf", usdcRaw)[0];
  return { eth: formatEther(eth), usdc: formatUnits(usdc, 6), chain_id: BASE_CHAIN_ID, verified: true };
}

async function getExistingWallet() {
  const { data, error } = await db.from("midad_agent_fee_wallets")
    .select("id,owner_scope,network,address,status,purpose,last_balance,last_balance_asset,last_balance_updated_at,metadata,created_at,updated_at")
    .eq("owner_scope","midad").eq("network","base").neq("status","RETIRED")
    .limit(1).maybeSingle();
  if (error) throw new Error("FEE_WALLET_LOOKUP_FAILED");
  return data;
}

async function status() {
  await reconcileFeeReceipts();
  const wallet=await getExistingWallet();
  const policy=await feePolicy();
  const [requests,ledger]=await Promise.all([
    db.from("midad_agent_fee_requests").select("id,job_ref,provider,fee_kind,network,asset,amount,amount_usd,recipient,quote_url,quote_domain,expected_return_usd,status,approval_id,tx_hash,error_code,result,created_at,updated_at,executed_at").order("created_at",{ascending:false}).limit(20),
    db.from("midad_agent_fee_ledger").select("id,request_id,network,asset,amount,amount_usd,recipient,tx_hash,network_fee_asset,network_fee_amount,status,evidence,created_at,updated_at").order("created_at",{ascending:false}).limit(12)
  ]);
  if(requests.error||ledger.error)throw new Error("FEE_HISTORY_LOOKUP_FAILED");
  if(!wallet)return {ok:true,status:"NOT_PROVISIONED",wallet:null,balance:null,readiness:null,requests:requests.data||[],ledger:ledger.data||[],policy:feePolicyView(policy)};
  let balance:any=null,readiness:any=null,balanceError:string|null=null;
  try{balance=await readBalance(wallet.address);readiness=await feeReadiness(wallet,balance,policy)}catch(e){balanceError=clip(e instanceof Error?e.message:e,240)}
  return {ok:true,status:wallet.status,wallet:publicWallet(wallet),balance,balance_error:balanceError,readiness,requests:requests.data||[],ledger:ledger.data||[],policy:feePolicyView(policy),next_step:wallet.status==="PAUSED"?"Verify Base USDC, Base ETH gas and Vault signer before explicit enablement.":"Armed for one-time fee payments only; automatic spending remains disabled."};
}

async function provision() {
  const current = await getExistingWallet();
  if (current) {
    const s = await status();
    return { ...s, created:false, note:"An existing fee wallet was preserved; no new key was generated." };
  }
  const wallet = Wallet.createRandom();
  const secretName = "midad_agent_fee_base_evm_key_" + crypto.randomUUID().replace(/-/g,"").slice(0,20);
  const initialMetadata = {
    lifecycle:"SECRET_PENDING",
    provider:"midad_agent_fee_wallet",
    role:"isolated_fee_only",
    custody:"supabase_vault",
    chain_id:BASE_CHAIN_ID,
    network:"base",
    asset_payments:["USDC"],
    max_per_transaction_usd:5,
    max_daily_total_usd:5,
    all_in_budget_includes_network_gas:true,
    ...initialFeeWalletSafetyMetadata(),
    owner_approval_per_operation:true,
    transaction_signing_enabled:false,
    allowlisted_destinations_required:true,
    verified_roi_evidence_required:true,
    owner_approval_for_unknown_destination:true,
    private_key_in_chat:false,
    source:"midad_fee_wallet_provisioner_v1"
  };
  const { data: row, error: insertError } = await db.from("midad_agent_fee_wallets").insert({
    owner_scope:"midad",
    network:"base",
    address:wallet.address,
    secret_name:secretName,
    status:"PAUSED",
    purpose:"isolated_agent_fee_wallet",
    metadata:initialMetadata
  }).select("id,owner_scope,network,address,status,purpose,last_balance,last_balance_asset,last_balance_updated_at,metadata,created_at,updated_at").single();

  if (insertError) {
    if (insertError.code === "23505") {
      const existing = await getExistingWallet();
      if (existing) return { ...(await status()), created:false, note:"A concurrent request already provisioned the fee wallet; the existing wallet was preserved." };
    }
    throw new Error("FEE_WALLET_RECORD_CREATE_FAILED");
  }

  const { error: vaultError } = await db.rpc("midad_vault_store_secret", {
    p_secret:wallet.privateKey,
    p_name:secretName,
    p_description:"MIDAD isolated Base agent fee wallet signing key. Fee-only use; do not disclose."
  });
  if (vaultError) {
    await db.from("midad_agent_fee_wallets").delete().eq("id",row.id).eq("status","PAUSED");
    throw new Error("FEE_WALLET_VAULT_STORE_FAILED");
  }

  const finalMetadata = {
    ...initialMetadata,
    lifecycle:"PENDING_FUNDING_AND_SECURITY_TEST",
    secret_stored_in_vault:true,
    secret_value_returned:false,
    provisioned_at:new Date().toISOString(),
    spending_enabled:false,
    transaction_signing_enabled:false
  };
  const { data: updated, error: updateError } = await db.from("midad_agent_fee_wallets")
    .update({ metadata:finalMetadata, updated_at:new Date().toISOString() })
    .eq("id",row.id).select("id,owner_scope,network,address,status,purpose,last_balance,last_balance_asset,last_balance_updated_at,metadata,created_at,updated_at").single();
  if (updateError) throw new Error("FEE_WALLET_RECORD_FINALIZE_FAILED");

  let balance:any = null, balanceError:string|null = null;
  try { balance = await readBalance(updated.address); }
  catch (e) { balanceError = clip(e instanceof Error ? e.message : e, 300); }
  return {
    ok:true, created:true, status:"PAUSED", wallet:publicWallet(updated), balance, balance_error:balanceError,
    policy:{network:"base",max_per_transaction_usd:5,max_daily_total_usd:5,auto_execute_allowlisted:false,global_external_spend_usd:0},
    authority:{read_balance:true,receive:true,spend:false,transaction_signing:false,withdrawals:false},
    note:"Separate fee wallet created and its key stored in Supabase Vault. It remains paused; no funds moved and no transaction was signed."
  };
}



async function feePolicy(){
  const {data,error}=await db.from("midad_agent_fee_policies").select("*").eq("policy_key","default").maybeSingle();
  if(error||!data)throw new Error("FEE_POLICY_UNAVAILABLE");
  if(!data.enabled)throw new Error("FEE_POLICY_DISABLED");
  if(data.auto_execute_allowlisted===true)throw new Error("AUTO_EXECUTION_MUST_REMAIN_DISABLED");
  return data;
}
function feePolicyView(p:any){return {enabled:p.enabled,auto_execute_allowlisted:false,max_per_payment_usd:Math.min(5,Number(p.max_per_payment_usd||5)),max_per_job_usd:Math.min(5,Number(p.max_per_job_usd||5)),max_daily_usd:Math.min(5,Number(p.max_daily_usd||5)),max_weekly_usd:Math.min(15,Number(p.max_weekly_usd||15)),min_expected_return_ratio:Number(p.min_expected_return_ratio||3),max_gas_fee_eth:Number(p.max_gas_fee_eth||0.00025),allowed_fee_kinds:p.allowed_fee_kinds,allowed_networks:["base"],allowed_assets:["USDC"],owner_approval_required_each_time:true};}
function evidenceUrl(raw:string){try{const u=new globalThis.URL(raw),h=u.hostname.toLowerCase();if(u.protocol!=="https:"||u.username||u.password||!h||h==="localhost"||h.endsWith(".local")||h==="127.0.0.1"||h==="0.0.0.0"||h==="::1"||/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h))return null;return {url:u.toString(),domain:h};}catch{return null;}}
async function readFeeKey(name:string){if(!name)throw new Error("FEE_WALLET_SECRET_NAME_MISSING");const {data,error}=await db.rpc("midad_vault_read_secret",{p_name:name});if(error||typeof data!=="string"||!data.trim())throw new Error("FEE_WALLET_VAULT_KEY_UNAVAILABLE");const k=data.trim();if(!/^0x[0-9a-fA-F]{64}$/.test(k))throw new Error("FEE_WALLET_KEY_FORMAT_INVALID");return k;}
async function feeSignerMatches(w:any){try{const a=new Wallet(await readFeeKey(w.secret_name)).address;return {ok:a.toLowerCase()===String(w.address).toLowerCase(),address:a};}catch{return {ok:false,address:null};}}
async function feeReadiness(w:any,b:any,p:any){const signer=await feeSignerMatches(w),eth=Number(b?.eth||0),usdc=Number(b?.usdc||0),minEth=Number(p.max_gas_fee_eth||0.00025);return {signer_matches:signer.ok,balance_verified:Boolean(b?.verified),usdc_funded:Number.isFinite(usdc)&&usdc>0,base_eth_for_gas:Number.isFinite(eth)&&eth>=minEth,minimum_recommended_base_eth:minEth,ready_to_enable:Boolean(signer.ok&&b?.verified&&usdc>0&&eth>=minEth),note:"Readiness check only; no transaction was signed or sent."};}
async function feeAudit(userId:string,action:string,subjectId:string,statusValue:string,summary:string,details:any={}){await db.from("midad_audit_log").insert({user_id:userId,event_type:"fee_wallet_operation",actor_type:"human",action,subject_type:"fee_payment_request",subject_id:subjectId,status:statusValue,risk_class:"high",summary,details});}
async function reconcileFeeReceipts(){
  const p=new JsonRpcProvider(BASE_RPC,BASE_CHAIN_ID);
  const {data}=await db.from("midad_agent_fee_ledger").select("id,request_id,tx_hash,status,evidence").in("status",["PENDING","SUBMITTED"]).order("created_at",{ascending:false}).limit(20);
  for(const l of data||[]){if(!l.tx_hash)continue;try{const r=await p.getTransactionReceipt(l.tx_hash);if(!r)continue;const used=BigInt(r.gasUsed.toString()),gp=BigInt((r.gasPrice??r.effectiveGasPrice??0n).toString()),gasEth=formatEther(used*gp);
    if(Number(r.status)===1){await db.from("midad_agent_fee_ledger").update({status:"CONFIRMED",network_fee_amount:gasEth,evidence:{...(l.evidence||{}),receipt_status:"success",block_number:r.blockNumber,actual_gas_eth:gasEth,actual_gas_used:used.toString(),confirmed_at:new Date().toISOString()}}).eq("id",l.id).in("status",["PENDING","SUBMITTED"]);await db.from("midad_agent_fee_requests").update({status:"PAID",tx_hash:l.tx_hash,executed_at:new Date().toISOString(),updated_at:new Date().toISOString(),error_code:null,result:{tx_hash:l.tx_hash,receipt_status:"success",block_number:r.blockNumber,actual_gas_eth:gasEth}}).eq("id",l.request_id).eq("status","EXECUTING");}
    else {const tx=await p.getTransaction(l.tx_hash);const ethUsd=Number(l.evidence?.eth_usd||0);const gasUsd=tx&&ethUsd>0?Number((Number(gasEth)*ethUsd).toFixed(6)):0;await db.from("midad_agent_fee_ledger").update({status:"FAILED",amount_usd:gasUsd,evidence:{...(l.evidence||{}),receipt_status:"reverted",block_number:r.blockNumber,actual_gas_eth:gasEth,actual_gas_usd:gasUsd}}).eq("id",l.id).in("status",["PENDING","SUBMITTED"]);await db.from("midad_agent_fee_requests").update({status:"FAILED",tx_hash:l.tx_hash,error_code:"ONCHAIN_TRANSACTION_REVERTED",updated_at:new Date().toISOString(),result:{tx_hash:l.tx_hash,receipt_status:"reverted",block_number:r.blockNumber,actual_gas_eth:gasEth}}).eq("id",l.request_id).eq("status","EXECUTING");}
  }catch{/* Read-only reconciliation never resends a transaction. */}}
}
async function verifyFunding(){
  const w=await getExistingWallet();if(!w)return {ok:false,error:"fee_wallet_not_provisioned"};
  const p=await feePolicy(),[balance]=await Promise.all([readBalance(w.address)]),ready=await feeReadiness(w,balance,p);
  const metadata={...(w.metadata||{}),lifecycle:ready.ready_to_enable?"FUNDING_AND_SIGNER_VERIFIED_WAITING_FOR_OWNER_ARM":"FUNDING_OR_SIGNER_CHECK_INCOMPLETE",last_readiness_check_at:new Date().toISOString(),last_readiness:ready,spending_enabled:w.status==="ACTIVE"&&w.metadata?.spending_enabled===true,transaction_signing_enabled:w.status==="ACTIVE"&&w.metadata?.transaction_signing_enabled===true};
  const up=await db.from("midad_agent_fee_wallets").update({last_balance:balance.usdc,last_balance_asset:"USDC",last_balance_updated_at:new Date().toISOString(),metadata,updated_at:new Date().toISOString()}).eq("id",w.id);if(up.error)throw new Error("FEE_READINESS_SAVE_FAILED");
  return {ok:true,status:w.status,wallet:publicWallet({...w,metadata}),balance,readiness:ready,policy:feePolicyView(p),note:"Funding and Vault signer verification only. Nothing was sent."};
}
async function enableSpending(b:any){
  if(clip(b.confirm_text,80)!=="ENABLE LIMITED FEE PAYMENTS")return {ok:false,error:"explicit_enable_confirmation_required"};
  const w=await getExistingWallet();if(!w)return {ok:false,error:"fee_wallet_not_provisioned"};
  const p=await feePolicy(),balance=await readBalance(w.address),ready=await feeReadiness(w,balance,p);
  if(!ready.ready_to_enable)return {ok:false,error:"funding_or_signer_verification_failed",readiness:ready};
  if(Number(balance.usdc)<0.01)return {ok:false,error:"base_usdc_balance_too_low"};
  if(w.status==="ACTIVE"&&w.metadata?.spending_enabled===true)return {...await status(),already_enabled:true};
  const metadata={...(w.metadata||{}),lifecycle:"ARMED_OWNER_APPROVAL_ONLY",spending_enabled:true,transaction_signing_enabled:true,auto_execute_allowlisted:false,owner_approval_per_operation:true,owner_approval_required_each_time:true,max_per_transaction_usd:5,max_daily_total_usd:5,all_in_budget_includes_network_gas:true,enabled_at:new Date().toISOString(),enabled_by:"control_room_owner",withdrawals_enabled:false,arbitrary_contract_calls:false,fee_payment_adapter:"USDC transfer on Base only"};
  const up=await db.from("midad_agent_fee_wallets").update({status:"ACTIVE",metadata,updated_at:new Date().toISOString()}).eq("id",w.id).eq("status","PAUSED");if(up.error)throw new Error("FEE_WALLET_ARM_FAILED");
  return {...await status(),enabled_now:true,note:"Armed for fresh owner approval for each exact USDC/Base payment; automatic spending remains disabled."};
}
async function pauseSpending(){
  const w=await getExistingWallet();if(!w)return {ok:false,error:"fee_wallet_not_provisioned"};
  const metadata={...(w.metadata||{}),lifecycle:"MANUAL_PAUSE",spending_enabled:false,transaction_signing_enabled:false,paused_at:new Date().toISOString(),paused_by:"control_room_owner",auto_execute_allowlisted:false};
  const up=await db.from("midad_agent_fee_wallets").update({status:"PAUSED",metadata,updated_at:new Date().toISOString()}).eq("id",w.id);if(up.error)throw new Error("FEE_WALLET_PAUSE_FAILED");
  return {...await status(),paused_now:true};
}
async function createFeeRequest(b:any){
  const w=await getExistingWallet();if(!w)return {ok:false,error:"fee_wallet_not_provisioned"};const p=await feePolicy();
  const providerName=clip(b.provider,100),job=clip(b.job_ref,180),kind=clip(b.fee_kind,40).toLowerCase(),quote=evidenceUrl(clip(b.quote_url,1000)),returnUrl=evidenceUrl(clip(b.expected_return_evidence_url||b.quote_url,1000)),summary=clip(b.expected_return_summary,1600),instruction=clip(b.official_fee_instructions_summary,1600);
  if(!providerName||!job)return {ok:false,error:"provider_and_job_ref_required"};if(!quote||!returnUrl)return {ok:false,error:"https_evidence_urls_required"};if(b.official_fee_instructions_verified!==true||instruction.length<10)return {ok:false,error:"owner_must_verify_official_platform_fee_instructions"};
  if(!Array.isArray(p.allowed_fee_kinds)||!p.allowed_fee_kinds.includes(kind))return {ok:false,error:"unsupported_fee_kind"};
  let recipient:string;try{recipient=getAddress(clip(b.recipient,200))}catch{return {ok:false,error:"valid_evm_recipient_required"}}
  let units:bigint;try{units=parseUnits(String(b.amount??"").trim(),6)}catch{return {ok:false,error:"amount_must_have_max_6_decimals"}}if(units<=0n)return {ok:false,error:"invalid_fee_amount"};
  const amount=Number(formatUnits(units,6)),expected=Number(b.expected_return_usd);
  if(!Number.isFinite(amount)||amount>Math.min(5,Number(p.max_per_payment_usd||5))||amount>Math.min(5,Number(p.max_per_job_usd||5)))return {ok:false,error:"fee_amount_exceeds_policy_limit"};
  if(!Number.isFinite(expected)||expected<amount*Number(p.min_expected_return_ratio||3)||summary.length<10)return {ok:false,error:"expected_return_evidence_failed",min_expected_return_usd:amount*Number(p.min_expected_return_ratio||3)};
  const feeEvidence={official_fee_instructions_verified:true,official_fee_instructions_summary:instruction,user_checked_at:new Date().toISOString(),payment_method:"direct USDC transfer on Base only",owner_confirmed_asset_network_recipient:true};
  const returnEvidence={summary,evidence_url:returnUrl.url,provider_domain:quote.domain,expected_return_usd:expected,ratio:expected/amount};
  const {data:request,error}=await db.from("midad_agent_fee_requests").insert({idempotency_key:crypto.randomUUID(),requested_by_agent:clip(b.requested_by_agent||"MIDAD Control Room",100),job_ref:job,provider:providerName,fee_kind:kind,network:"base",asset:"USDC",amount,amount_usd:amount,recipient,quote_url:quote.url,quote_domain:quote.domain,expected_return_usd:expected,expected_return_evidence:returnEvidence,fee_evidence:feeEvidence,status:"OWNER_APPROVAL_REQUIRED",policy_decision:{decision:"requires_explicit_owner_approval",network:"base",asset:"USDC",auto_execute:false}}).select("id,job_ref,provider,fee_kind,network,asset,amount,amount_usd,recipient,quote_url,quote_domain,expected_return_usd,status,created_at").single();
  if(error)throw new Error("FEE_REQUEST_CREATE_FAILED");
  const {data:profile}=await db.from("profiles").select("id").order("created_at",{ascending:true}).limit(1).maybeSingle();if(!profile?.id){await db.from("midad_agent_fee_requests").update({status:"CANCELLED",error_code:"PROFILE_MISSING"}).eq("id",request.id);throw new Error("OWNER_PROFILE_UNAVAILABLE")}
  const expiry=new Date(Date.now()+30*60*1000).toISOString();
  const {data:approval,error:ae}=await db.from("midad_approvals").insert({user_id:profile.id,subject_type:"fee_payment_request",subject_id:request.id,action:"pay_platform_fee",risk_class:"high",reason:"One-time Base USDC platform fee: "+providerName+" / "+job+" / "+amount+" USDC. Owner approval required.",evidence:{request_id:request.id,provider:providerName,job_ref:job,fee_kind:kind,network:"base",asset:"USDC",amount,recipient,quote_url:quote.url,expected_return_usd:expected,auto_execute:false},status:"pending",expires_at:expiry}).select("id,status,expires_at").single();
  if(ae||!approval){await db.from("midad_agent_fee_requests").update({status:"CANCELLED",error_code:"APPROVAL_CREATE_FAILED"}).eq("id",request.id);throw new Error("OWNER_APPROVAL_RECORD_CREATE_FAILED")}
  const link=await db.from("midad_agent_fee_requests").update({approval_id:approval.id,updated_at:new Date().toISOString()}).eq("id",request.id);if(link.error)throw new Error("FEE_APPROVAL_LINK_FAILED");
  await db.from("midad_audit_log").insert({user_id:profile.id,event_type:"fee_request_created",actor_type:"human",action:"create_fee_request",subject_type:"fee_payment_request",subject_id:request.id,status:"OWNER_APPROVAL_REQUIRED",risk_class:"high",summary:"Fee request created. No payment authorized or sent.",details:{request_id:request.id,approval_id:approval.id,provider:providerName,domain:quote.domain,network:"base",asset:"USDC",amount,recipient,expected_return_usd:expected}});
  return {ok:true,created:true,request:{...request,approval_id:approval.id,approval_expires_at:approval.expires_at},wallet_status:w.status,note:"Request awaits one-time approval; nothing has been sent."};
}
async function rejectFeeRequest(b:any){
  const id=clip(b.request_id,80);if(!id)return {ok:false,error:"request_id_required"};const {data:r}=await db.from("midad_agent_fee_requests").select("id,status,approval_id,provider,job_ref,amount,recipient").eq("id",id).maybeSingle();if(!r)return {ok:false,error:"fee_request_not_found"};if(r.status!=="OWNER_APPROVAL_REQUIRED")return {ok:false,error:"fee_request_not_pending",status:r.status};
  const up=await db.from("midad_agent_fee_requests").update({status:"CANCELLED",error_code:"OWNER_REJECTED",updated_at:new Date().toISOString()}).eq("id",r.id).eq("status","OWNER_APPROVAL_REQUIRED");if(up.error)throw new Error("FEE_REQUEST_CANCEL_FAILED");if(r.approval_id)await db.from("midad_approvals").update({status:"rejected",decided_by:"control_room_owner",decision_note:"Owner rejected fee request in Control Room.",decided_at:new Date().toISOString()}).eq("id",r.approval_id).eq("status","pending");
  const {data:profile}=await db.from("profiles").select("id").order("created_at",{ascending:true}).limit(1).maybeSingle();if(profile?.id)await feeAudit(profile.id,"reject_fee_request",r.id,"CANCELLED","Owner rejected platform fee request.",{provider:r.provider,job_ref:r.job_ref,amount:r.amount,recipient:r.recipient});return {ok:true,rejected:true,request_id:r.id};
}
async function ethUsdSpot(){const r=await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot",{headers:{accept:"application/json"},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error("ETH_USD_PRICE_UNAVAILABLE");const j:any=await r.json().catch(()=>({})),price=Number(j?.data?.amount);if(!Number.isFinite(price)||price<100||price>100000)throw new Error("ETH_USD_PRICE_INVALID");return price;}

async function previewFeePayment(body:any){
  const id=clip(body.request_id,80);if(!id)return {ok:false,error:"request_id_required"};
  const {data:r,error}=await db.from("midad_agent_fee_requests").select("*").eq("id",id).maybeSingle();
  if(error||!r)return {ok:false,error:"fee_request_not_found"};
  if(r.status!=="OWNER_APPROVAL_REQUIRED"||!r.approval_id)return {ok:false,error:"fee_request_not_pending",status:r.status};
  if(r.network!=="base"||String(r.asset).toUpperCase()!=="USDC")return {ok:false,error:"only_usdc_on_base_is_supported"};
  const quote=evidenceUrl(String(r.quote_url||""));
  if(!quote||quote.domain!==String(r.quote_domain||"").toLowerCase())return {ok:false,error:"fee_quote_domain_mismatch"};
  if(r.fee_evidence?.official_fee_instructions_verified!==true||Number(r.expected_return_usd)<Number(r.amount_usd)*3||!r.expected_return_evidence?.evidence_url)return {ok:false,error:"fee_evidence_not_valid"};
  const w=await getExistingWallet();if(!w||w.status!=="ACTIVE"||w.metadata?.spending_enabled!==true||w.metadata?.transaction_signing_enabled!==true)return {ok:false,error:"fee_wallet_not_armed_owner_approval_only"};
  const pcy=await feePolicy();let to:string;try{to=getAddress(String(r.recipient))}catch{return {ok:false,error:"recipient_address_invalid"}}
  const {data:ap}=await db.from("midad_approvals").select("id,status,expires_at").eq("id",r.approval_id).maybeSingle();
  if(!ap||ap.status!=="pending"||!ap.expires_at||new Date(ap.expires_at).getTime()<=Date.now())return {ok:false,error:"owner_approval_expired_or_not_pending"};
  const amountUnits=parseUnits(String(r.amount),6),b=await readBalance(w.address);
  if(Number(b.usdc)<Number(r.amount))return {ok:false,error:"insufficient_fee_wallet_usdc",balance_usdc:b.usdc,required_usdc:r.amount};
  const signer=await feeSignerMatches(w);if(!signer.ok)return {ok:false,error:"fee_wallet_signer_address_mismatch"};
  const p=new JsonRpcProvider(BASE_RPC,BASE_CHAIN_ID),network=await p.getNetwork();if(Number(network.chainId)!==BASE_CHAIN_ID)return {ok:false,error:"wrong_base_chain_id"};
  const priceResp=await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot",{headers:{accept:"application/json"},signal:AbortSignal.timeout(8000)});
  if(!priceResp.ok)throw new Error("ETH_USD_PRICE_UNAVAILABLE");
  const priceJson:any=await priceResp.json().catch(()=>({})),ethPrice=Number(priceJson?.data?.amount);
  if(!Number.isFinite(ethPrice)||ethPrice<100||ethPrice>100000)throw new Error("ETH_USD_PRICE_INVALID");
  const fees=await p.getFeeData(),maxFeeRaw=fees.maxFeePerGas??fees.gasPrice;
  if(!maxFeeRaw)return {ok:false,error:"base_gas_price_unavailable"};
  const data=erc20.encodeFunctionData("transfer",[to,amountUnits]),estimate=await p.estimateGas({from:w.address,to:USDC,data,value:0n}),gasLimit=estimate*120n/100n,maxFee=BigInt(maxFeeRaw.toString()),reserveWei=gasLimit*maxFee;
  const gasEth=Number(formatEther(reserveWei)),gasUsd=gasEth*ethPrice,allIn=Number(r.amount_usd)+gasUsd;
  if(!Number.isFinite(gasUsd)||gasEth>Number(pcy.max_gas_fee_eth||0.00025))return {ok:false,error:"estimated_gas_exceeds_policy",gas_eth:gasEth,gas_usd:gasUsd,max_gas_fee_eth:pcy.max_gas_fee_eth};
  if(Number(b.eth)<gasEth)return {ok:false,error:"insufficient_base_eth_for_gas",balance_eth:b.eth,required_eth:gasEth};
  if(allIn>Math.min(5,Number(pcy.max_per_payment_usd||5)))return {ok:false,error:"all_in_transaction_limit_exceeded",amount_usd:Number(r.amount_usd),estimated_gas_usd:gasUsd,all_in_usd:allIn,limit_usd:5};
  const {data:led}=await db.from("midad_agent_fee_ledger").select("amount_usd,status,created_at").in("status",["PENDING","SUBMITTED","CONFIRMED"]).limit(500);
  const today=(new Date()).toISOString().slice(0,10),usedToday=(led||[]).filter((x:any)=>String(x.created_at||"").slice(0,10)===today).reduce((s:number,x:any)=>s+Number(x.amount_usd||0),0);
  if(usedToday+allIn>Math.min(5,Number(pcy.max_daily_usd||5)))return {ok:false,error:"daily_fee_budget_exceeded",reserved_or_spent_usd:usedToday,all_in_usd:allIn,daily_limit_usd:5};
  const created=new Date().toISOString(),expires=new Date(Date.now()+120000).toISOString();
  const stored={created_at:created,expires_at:expires,network:"base",chain_id:BASE_CHAIN_ID,asset:"USDC",amount:Number(r.amount),recipient:to,quote_domain:quote.domain,gas_eth:gasEth,gas_usd:Number(gasUsd.toFixed(6)),eth_usd:ethPrice,all_in_usd:Number(allIn.toFixed(6)),balance_usdc:b.usdc,balance_base_eth:b.eth,gas_limit:gasLimit.toString(),max_fee_per_gas_wei:maxFee.toString(),policy_max_gas_eth:Number(pcy.max_gas_fee_eth||0.00025),auto_execute:false};
  const {error:saveError}=await db.from("midad_agent_fee_requests").update({policy_decision:{...(r.policy_decision||{}),decision:"preview_ready_owner_must_confirm",latest_preview:stored},updated_at:created}).eq("id",r.id).eq("status","OWNER_APPROVAL_REQUIRED");
  if(saveError)throw new Error("FEE_PREVIEW_SAVE_FAILED");
  return {ok:true,status:"PREVIEW_READY",request_id:r.id,provider:r.provider,job_ref:r.job_ref,fee_kind:r.fee_kind,network:"base",asset:"USDC",amount:Number(r.amount),recipient:to,quote_url:r.quote_url,quote_domain:quote.domain,expected_return_usd:Number(r.expected_return_usd),expected_return_summary:r.expected_return_evidence?.summary||"",preview:stored,policy:feePolicyView(pcy),note:"Preview only. No approval was consumed and no transaction was signed or sent."};
}
async function approveAndPay(b:any){
  let request:any=null,reservation:any=null,txHash="",feeWallet:any=null,p:any=null;
  try {
    const id=clip(b.request_id,80);if(!id)return {ok:false,error:"request_id_required"};if(clip(b.confirmation,240)!=="PAY "+id)return {ok:false,error:"exact_one_time_payment_confirmation_required"};
    const qr=await db.from("midad_agent_fee_requests").select("*").eq("id",id).maybeSingle();request=qr.data;if(qr.error||!request)return {ok:false,error:"fee_request_not_found"};if(request.status!=="OWNER_APPROVAL_REQUIRED"||!request.approval_id)return {ok:false,error:"fee_request_not_pending_or_approval_missing",status:request.status};
    const preview=request.policy_decision?.latest_preview;
    if(!preview||!preview.created_at||!preview.expires_at||Date.now()>new Date(preview.expires_at).getTime()||Date.now()-new Date(preview.created_at).getTime()>120000||
       String(preview.network)!=="base"||String(preview.asset)!=="USDC"||
       String(preview.recipient||"").toLowerCase()!==String(request.recipient||"").toLowerCase()||
       String(preview.quote_domain||"").toLowerCase()!==String(request.quote_domain||"").toLowerCase()||
       Math.abs(Number(preview.amount)-Number(request.amount))>0.000001)
      return {ok:false,error:"fee_preview_required_or_expired",next:"preview_fee_payment"};

    if(request.network!=="base"||String(request.asset).toUpperCase()!=="USDC")return {ok:false,error:"only_usdc_on_base_is_supported"};
    const quote=evidenceUrl(String(request.quote_url||""));if(!quote||quote.domain!==String(request.quote_domain||"").toLowerCase())return {ok:false,error:"fee_quote_domain_mismatch"};
    if(request.fee_evidence?.official_fee_instructions_verified!==true||!request.expected_return_evidence||Number(request.expected_return_usd)<Number(request.amount_usd)*3||!evidenceUrl(String(request.expected_return_evidence?.evidence_url||"")))return {ok:false,error:"fee_or_return_evidence_failed"};
    feeWallet=await getExistingWallet();if(!feeWallet||feeWallet.status!=="ACTIVE"||feeWallet.metadata?.spending_enabled!==true||feeWallet.metadata?.transaction_signing_enabled!==true)return {ok:false,error:"fee_wallet_not_armed_owner_approval_only"};
    const policy=await feePolicy();let recipient:string;try{recipient=getAddress(String(request.recipient))}catch{return {ok:false,error:"recipient_address_invalid"}}
    const amountUnits=parseUnits(String(request.amount),6),balances=await readBalance(feeWallet.address);if(Number(balances.usdc)<Number(request.amount))return {ok:false,error:"insufficient_fee_wallet_usdc",balance_usdc:balances.usdc,required_usdc:request.amount};
    const signer=new Wallet(await readFeeKey(feeWallet.secret_name));if(signer.address.toLowerCase()!==String(feeWallet.address).toLowerCase())return {ok:false,error:"fee_wallet_signer_address_mismatch"};
    p=new JsonRpcProvider(BASE_RPC,BASE_CHAIN_ID);const net=await p.getNetwork();if(Number(net.chainId)!==BASE_CHAIN_ID)return {ok:false,error:"wrong_base_chain_id"};
    const ethPrice=await ethUsdSpot(),feeData=await p.getFeeData(),maxFeeRaw=feeData.maxFeePerGas??feeData.gasPrice,priorityRaw=feeData.maxPriorityFeePerGas??feeData.gasPrice??maxFeeRaw;if(!maxFeeRaw||!priorityRaw)return {ok:false,error:"base_gas_price_unavailable"};
    const txData=erc20.encodeFunctionData("transfer",[recipient,amountUnits]),estimate=await p.estimateGas({from:signer.address,to:USDC,data:txData,value:0n}),gasLimit=estimate*120n/100n,maxFee=BigInt(maxFeeRaw.toString()),gasReserveWei=gasLimit*maxFee,gasEth=Number(formatEther(gasReserveWei)),gasUsd=gasEth*ethPrice;
    if(!Number.isFinite(gasUsd)||gasEth>Number(policy.max_gas_fee_eth||0.00025))return {ok:false,error:"estimated_gas_exceeds_policy",gas_reserve_eth:gasEth,gas_reserve_usd:gasUsd,max_gas_fee_eth:Number(policy.max_gas_fee_eth||0.00025)};
    if(gasUsd>Number(preview.gas_usd||0)+0.01||gasEth>Number(preview.gas_eth||0)+0.0000005)
      return {ok:false,error:"fee_preview_changed_refresh_required",preview_gas_usd:preview.gas_usd,current_gas_usd:Number(gasUsd.toFixed(6)),next:"preview_fee_payment"};

    if(Number(balances.eth)<gasEth)return {ok:false,error:"insufficient_base_eth_for_gas",balance_eth:balances.eth,required_eth:gasEth};
    const {data:profile}=await db.from("profiles").select("id").order("created_at",{ascending:true}).limit(1).maybeSingle();if(!profile?.id)return {ok:false,error:"owner_profile_unavailable"};
    const claim=await db.rpc("midad_claim_agent_fee_payment",{p_request_id:request.id,p_approval_id:request.approval_id,p_fee_wallet_id:feeWallet.id,p_estimated_gas_usd:Number(gasUsd.toFixed(6)),p_network_fee_amount:gasEth,p_eth_usd:ethPrice});if(claim.error)throw new Error("FEE_BUDGET_RESERVATION_FAILED");reservation=claim.data;if(!reservation?.ok)return {ok:false,error:reservation?.error||"fee_budget_reservation_rejected",details:reservation};
    const nonce=await p.getTransactionCount(signer.address,"pending"),priorityBig=BigInt(priorityRaw.toString()),priority=priorityBig>maxFee?maxFee:priorityBig;
    const raw=await signer.signTransaction({type:2,chainId:BASE_CHAIN_ID,nonce,to:USDC,value:0n,data:txData,gasLimit,maxFeePerGas:maxFee,maxPriorityFeePerGas:priority});
    txHash=keccak256(raw);
    const saved=await db.from("midad_agent_fee_ledger").update({tx_hash:txHash,evidence:{reservation_id:reservation.ledger_id,estimated_gas_eth:gasEth,estimated_gas_usd:gasUsd,eth_usd:ethPrice,quote_domain:quote.domain,network_chain_id:BASE_CHAIN_ID,owner_approved_request_id:request.id,auto_execute:false,broadcast_status:"about_to_broadcast"}}).eq("id",reservation.ledger_id).eq("status","PENDING");if(saved.error)throw new Error("TRANSACTION_HASH_PERSIST_FAILED");
    const broadcast=await p.broadcastTransaction(raw);if(broadcast.hash.toLowerCase()!==txHash.toLowerCase())throw new Error("BROADCAST_HASH_MISMATCH");
    const submitted=await db.from("midad_agent_fee_ledger").update({status:"SUBMITTED",evidence:{reservation_id:reservation.ledger_id,estimated_gas_eth:gasEth,estimated_gas_usd:gasUsd,eth_usd:ethPrice,quote_domain:quote.domain,network_chain_id:BASE_CHAIN_ID,owner_approved_request_id:request.id,auto_execute:false,broadcast_status:"submitted"}}).eq("id",reservation.ledger_id).eq("status","PENDING");if(submitted.error)throw new Error("SUBMITTED_LEDGER_UPDATE_FAILED");
    await db.from("midad_agent_fee_requests").update({tx_hash:txHash,updated_at:new Date().toISOString(),result:{tx_hash:txHash,gas_estimate_eth:gasEth,gas_estimate_usd:gasUsd,eth_usd:ethPrice,network:"base",asset:"USDC",amount:request.amount,recipient}}).eq("id",request.id).eq("status","EXECUTING");
    let receipt:any=null;try{receipt=await p.waitForTransaction(txHash,1,15000)}catch{}
    if(receipt&&Number(receipt.status)===1){const used=BigInt(receipt.gasUsed.toString()),gp=BigInt((receipt.gasPrice??receipt.effectiveGasPrice??maxFee).toString()),actualEth=formatEther(used*gp);await db.from("midad_agent_fee_ledger").update({status:"CONFIRMED",network_fee_amount:actualEth,evidence:{reservation_id:reservation.ledger_id,estimated_gas_eth:gasEth,estimated_gas_usd:gasUsd,actual_gas_eth:actualEth,actual_gas_used:used.toString(),actual_gas_price_wei:gp.toString(),eth_usd:ethPrice,receipt_status:"success",block_number:receipt.blockNumber,quote_domain:quote.domain,owner_approved_request_id:request.id}}).eq("id",reservation.ledger_id).eq("status","SUBMITTED");await db.from("midad_agent_fee_requests").update({status:"PAID",tx_hash:txHash,executed_at:new Date().toISOString(),updated_at:new Date().toISOString(),error_code:null,result:{tx_hash:txHash,receipt_status:"success",block_number:receipt.blockNumber,actual_gas_eth:actualEth,actual_gas_usd:Number((Number(actualEth)*ethPrice).toFixed(6)),network:"base",asset:"USDC",amount:request.amount,recipient}}).eq("id",request.id).eq("status","EXECUTING");const b2=await readBalance(feeWallet.address);await db.from("midad_agent_fee_wallets").update({last_balance:b2.usdc,last_balance_asset:"USDC",last_balance_updated_at:new Date().toISOString(),updated_at:new Date().toISOString(),metadata:{...(feeWallet.metadata||{}),last_payment_at:new Date().toISOString(),last_payment_tx:txHash}}).eq("id",feeWallet.id);await feeAudit(profile.id,"approve_and_pay_platform_fee",request.id,"PAID","One-time Base USDC platform fee transfer confirmed on-chain.",{tx_hash:txHash,amount:request.amount,recipient,provider:request.provider,quote_domain:quote.domain,actual_gas_eth:actualEth});return {ok:true,status:"PAID",request_id:request.id,tx_hash:txHash,network:"base",asset:"USDC",amount:request.amount,recipient,actual_gas_eth:actualEth,actual_gas_usd:Number((Number(actualEth)*ethPrice).toFixed(6)),block_number:receipt.blockNumber};}
    if(receipt){const used=BigInt(receipt.gasUsed.toString()),gp=BigInt((receipt.gasPrice??receipt.effectiveGasPrice??maxFee).toString()),actualEth=formatEther(used*gp),actualUsd=Number((Number(actualEth)*ethPrice).toFixed(6));await db.from("midad_agent_fee_ledger").update({status:"FAILED",amount_usd:actualUsd,network_fee_amount:actualEth,evidence:{reservation_id:reservation.ledger_id,tx_hash:txHash,receipt_status:"reverted",block_number:receipt.blockNumber,actual_gas_eth:actualEth,actual_gas_usd:actualUsd}}).eq("id",reservation.ledger_id).in("status",["PENDING","SUBMITTED"]);await db.from("midad_agent_fee_requests").update({status:"FAILED",error_code:"ONCHAIN_TRANSACTION_REVERTED",tx_hash:txHash,updated_at:new Date().toISOString(),result:{tx_hash:txHash,receipt_status:"reverted",block_number:receipt.blockNumber,actual_gas_eth:actualEth}}).eq("id",request.id).eq("status","EXECUTING");return {ok:false,status:"FAILED",request_id:request.id,tx_hash:txHash,error:"onchain_transaction_reverted"};}
    return {ok:true,status:"SUBMITTED",request_id:request.id,tx_hash:txHash,network:"base",asset:"USDC",amount:request.amount,recipient,estimated_gas_eth:gasEth,estimated_gas_usd:Number(gasUsd.toFixed(6)),note:"Broadcast confirmed by RPC; payment becomes PAID only after a verified receipt."};
  }catch(e){const msg=clip(e instanceof Error?e.message:e,300);if(txHash&&reservation&&p){const tx=await p.getTransaction(txHash).catch(()=>null),rec=await p.getTransactionReceipt(txHash).catch(()=>null);if(tx||rec){await db.from("midad_agent_fee_ledger").update({status:rec?(Number(rec.status)===1?"CONFIRMED":"FAILED"):"SUBMITTED",tx_hash:txHash,evidence:{tx_hash:txHash,broadcast_status:"reconciled_after_error",error:msg}}).eq("id",reservation.ledger_id).in("status",["PENDING","SUBMITTED"]);if(rec&&Number(rec.status)===1)await db.from("midad_agent_fee_requests").update({status:"PAID",tx_hash:txHash,executed_at:new Date().toISOString(),updated_at:new Date().toISOString(),result:{tx_hash:txHash,receipt_status:"success",reconciled_after_error:true}}).eq("id",request.id).eq("status","EXECUTING");else await db.from("midad_agent_fee_requests").update({tx_hash:txHash,error_code:rec?"ONCHAIN_TRANSACTION_REVERTED":"BROADCAST_RECONCILIATION_PENDING",updated_at:new Date().toISOString(),result:{tx_hash:txHash,transport_error:msg,manual_reconciliation_required:!rec}}).eq("id",request.id).eq("status","EXECUTING");return {ok:Boolean(rec&&Number(rec.status)===1),status:rec?(Number(rec.status)===1?"PAID":"FAILED"):"SUBMITTED",request_id:request.id,tx_hash:txHash,note:"No retry was made; reconcile this exact hash."};}await db.from("midad_agent_fee_ledger").update({evidence:{tx_hash:txHash,broadcast_status:"unknown",error:msg}}).eq("id",reservation.ledger_id).eq("status","PENDING");await db.from("midad_agent_fee_requests").update({tx_hash:txHash,error_code:"BROADCAST_OUTCOME_UNKNOWN",updated_at:new Date().toISOString(),result:{tx_hash:txHash,transport_error:msg,manual_reconciliation_required:true}}).eq("id",request.id).eq("status","EXECUTING");return {ok:false,status:"EXECUTING",request_id:request.id,tx_hash:txHash,error:"broadcast_outcome_unknown",note:"No retry was made."};}if(reservation?.ledger_id){await db.from("midad_agent_fee_ledger").update({status:"FAILED",evidence:{reservation_id:reservation.ledger_id,error:msg}}).eq("id",reservation.ledger_id).eq("status","PENDING");await db.from("midad_agent_fee_requests").update({status:"FAILED",error_code:"PRE_BROADCAST_FAILED",updated_at:new Date().toISOString(),result:{error:msg}}).eq("id",request?.id).eq("status","EXECUTING");}return {ok:false,status:"FAILED",error:"fee_transaction_failed",detail:msg};}
}

Deno.serve(async (req:Request) => {
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  if(!SUPABASE_URL||!SERVICE_KEY)return json({ok:false,error:"server_configuration_missing"},500);
  const body=await req.json().catch(()=>({})),action=clip(body?.action,50).toLowerCase(),session=await getAuthorizedSession(clip(body?.token,200));
  if(!session)return json({ok:false,error:"control_room_session_invalid"},401);
  try {
    let out:any;
    if(action==="status")out=await status();
    else if(action==="provision")out=await provision();
    else if(action==="verify_funding")out=await verifyFunding();
    else if(action==="enable_spending")out=await enableSpending(body);
    else if(action==="pause_spending")out=await pauseSpending();
    else if(action==="create_fee_request")out=await createFeeRequest(body);
    else if(action==="reject_fee_request")out=await rejectFeeRequest(body);
    else if(action==="preview_fee_payment")out=await previewFeePayment(body);
    else if(action==="approve_and_pay")out=await approveAndPay(body);
    else return json({ok:false,error:"unsupported_action"},400);
    return json(out,out?.ok===false?400:200);
  }catch(e){return json({ok:false,error:clip(e instanceof Error?e.message:e,500)},500);}
});
