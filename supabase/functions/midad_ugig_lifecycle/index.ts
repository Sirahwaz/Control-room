import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")||"", KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(URL,KEY);
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-autonomy-key"};
const json=(v:any,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clip=(v:any,n=1200)=>String(v??"").slice(0,n);
const num=(v:any)=>{const x=Number(v);return Number.isFinite(x)?x:0};
async function ak(){const {data,error}=await db.rpc("midad_get_autonomy_key");if(error||!data)throw new Error("autonomy_key_unavailable");return String(data)}
async function auth(req:Request){const a=req.headers.get("authorization")||"";if(KEY&&a==="Bearer "+KEY)return true;const k=req.headers.get("x-midad-autonomy-key")||"";return !!k&&k===await ak()}
async function call(slug:string,body:any){
  const r=await fetch(URL+"/functions/v1/"+slug,{method:"POST",headers:{"content-type":"application/json","x-midad-autonomy-key":await ak()},body:JSON.stringify(body)});
  const t=await r.text();let data:any;try{data=JSON.parse(t)}catch{data={raw:t}}return {ok:r.ok,status:r.status,data}
}
async function main(req:Request){
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  if(!(await auth(req)))return json({ok:false,error:"unauthorized"},401);
  try{
    const apps=await call("midad_ugig_gateway",{action:"applications"});
    if(!apps.ok||!apps.data?.ok) return json({ok:false,error:"applications_fetch_failed",detail:apps.data?.error||apps.status},apps.status||502);
    const rows=Array.isArray(apps.data.applications)?apps.data.applications:[];
    const {data:jobs}=await db.from("midad_revenue_jobs").select("id,opportunity_id,external_ref,state,payout,metadata,deadline_at,created_at,blocker_code,next_action").eq("platform","ugig").in("state",["IN_PROGRESS","PENDING_PAYOUT","DELIVERED"]);
    const summary:any={service:"midad_ugig_lifecycle",version:7,checked:0,changed:0,invoices_created:0,paid:0,rejected:0,blocked:0,waiting:0,crypto_payout_blocked:0,errors:[]};
    for(const j of jobs||[]){
      const app=rows.find((a:any)=>String(a.gig_id)===String(j.external_ref) || String(a.id)===String(j.metadata?.submission?.data?.application?.id));
      if(!app){
        const stale = Boolean(j.created_at) && (Date.now()-new Date(j.created_at).getTime()) > 48*60*60*1000;
        if(stale){
          await db.from("midad_revenue_jobs").update({
            state:"BLOCKED",
            blocker_code:"MISSING_EXTERNAL_APPLICATION",
            blocker_detail:"No matching uGig application was found during repeated lifecycle reconciliation; moved out of active queue after 48h.",
            next_action:"verify_application_reference",
            updated_at:new Date().toISOString()
          }).eq("id",j.id);
          summary.changed++;
        }else{
          summary.waiting++;
        }
        continue;
      }
      summary.checked++;
      const st=String(app.status||"").toLowerCase();
      const meta={...(j.metadata||{}),latest_application:{id:app.id,gig_id:app.gig_id,status:st,updated_at:app.updated_at}};
      const terminalNegative = ["rejected","withdrawn","archived","expired","cancelled","canceled","declined"].includes(st);
      if(terminalNegative){
        const requireRevalidation = ["archived","expired","cancelled","canceled"].includes(st);
        const nextState = requireRevalidation ? "BLOCKED" : "REJECTED";
        const blocker = "APPLICATION_" + st.toUpperCase();
        const detail = requireRevalidation
          ? "uGig application is archived, expired, or cancelled. Invoice creation and delivery are paused until the live buyer task and application are revalidated."
          : "uGig application was rejected or withdrawn; do not invoice or deliver.";
        await db.from("midad_revenue_jobs").update({
          state:nextState,blocker_code:blocker,blocker_detail:detail,
          next_action:requireRevalidation?"manual_revalidation":"refresh_opportunity",
          metadata:{...meta,midad_lifecycle_guard:{status:st,guarded_at:new Date().toISOString(),reason:"terminal_application_status"}},
          updated_at:new Date().toISOString()
        }).eq("id",j.id);
        await db.from("opportunities").update({
          status:requireRevalidation?"human_review":"rejected",
          updated_at:new Date().toISOString()
        }).eq("id",j.opportunity_id);
        if(requireRevalidation) summary.blocked++; else summary.rejected++;
        summary.changed++;continue;
      }
      if(st!=="accepted"){
        await db.from("midad_revenue_jobs").update({state:"IN_PROGRESS",next_action:"poll_application_and_invoice",metadata:meta,updated_at:new Date().toISOString()}).eq("id",j.id);
        continue;
      }
            // uGig currently issues USD/CoinPay invoices. This lifecycle must not treat that as crypto-only income.
      const {data:payoutPolicy}=await db.from("midad_revenue_policy").select("allow_auto_ugig,allow_auto_receive,allow_auto_submission").eq("owner_scope","midad").order("updated_at",{ascending:false}).limit(1).maybeSingle();
      const payoutMeta=(j.metadata&&typeof j.metadata==="object")?j.metadata:{};
      const payoutAsset=String(payoutMeta.payment_asset||payoutMeta.payout_asset||j.payout?.payment_asset||"").trim().toUpperCase();
      const payoutNetwork=String(payoutMeta.network||payoutMeta.payout_network||j.payout?.network||"").trim().toLowerCase();
      const cryptoAssets=["USDC","USDT","DAI","USDP","USDG","FDUSD","USDE","USDS","BTC","ETH","SOL","BNB","MATIC","POL","AVAX","SUI","APT","ARB","OP","TIA"];
      const cryptoPayoutReady=payoutMeta.crypto_payout_verified===true&&payoutMeta.payout_evidence_verified===true&&cryptoAssets.includes(payoutAsset)&&Boolean(payoutNetwork)&&!["unknown","unverified","n/a"].includes(payoutNetwork);
      const cryptoOnlyReceiveBridgeAvailable=false; // This lifecycle still hardcodes USD/CoinPay invoice_create and has no matched on-chain receipt path.
      if(!cryptoOnlyReceiveBridgeAvailable||payoutPolicy?.allow_auto_ugig!==true||payoutPolicy?.allow_auto_receive!==true||!cryptoPayoutReady){
        const gateReason=!cryptoOnlyReceiveBridgeAvailable?"crypto_only_onchain_invoice_bridge_not_implemented":payoutPolicy?.allow_auto_ugig!==true?"ugig_channel_paused_by_policy":!cryptoPayoutReady?"crypto_payout_not_independently_verified":"auto_receive_policy_disabled";
        const gateMeta={...meta,crypto_payout_gate:{allowed:false,reason:gateReason,asset:payoutAsset||null,network:payoutNetwork||null,checked_at:new Date().toISOString(),invoice_creation_blocked:true}};
        const alreadyGated=j.blocker_code==="CRYPTO_PAYOUT_NOT_VERIFIED"&&j.next_action==="verify_crypto_payout_and_wallet_receipt";
        if(!alreadyGated){
          await db.from("midad_revenue_jobs").update({state:j.state,blocker_code:"CRYPTO_PAYOUT_NOT_VERIFIED",blocker_detail:"uGig lifecycle is paused until the exact cryptocurrency asset, receiving network, and independent payout evidence are verified. USD/CoinPay invoice status is not accepted as on-chain income.",next_action:"verify_crypto_payout_and_wallet_receipt",metadata:gateMeta,updated_at:new Date().toISOString()}).eq("id",j.id);
          await db.from("opportunities").update({status:"human_review",updated_at:new Date().toISOString()}).eq("id",j.opportunity_id);
          summary.changed++;
        }
        summary.blocked++;summary.crypto_payout_blocked++;
        continue;
      }
const inv=await call("midad_ugig_gateway",{action:"gig_invoice",gig_id:j.external_ref});
      if(!inv.ok||!inv.data?.ok){summary.errors.push({job_id:j.id,step:"gig_invoice",detail:inv.data?.error||inv.status});continue}
      const invoices=Array.isArray(inv.data?.data?.data)?inv.data.data.data:(Array.isArray(inv.data?.data?.invoices)?inv.data.data.invoices:[]);
      const ours=invoices.find((x:any)=>String(x.application_id)===String(app.id))||invoices[0];
      if(!ours){
        const amount=num(j.payout?.expected_usd||j.payout?.reward_usd);
        if(amount<=0){summary.errors.push({job_id:j.id,step:"invoice_create",detail:"amount_missing"});continue}
        const due=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
        const created=await call("midad_ugig_gateway",{action:"invoice_create",gig_id:j.external_ref,application_id:app.id,amount,currency:"USD",notes:"MIDAD completed-scope invoice — payment requested via CoinPay; work delivery is released after payment/funding confirmation.",due_date:due});
        if(created.ok&&created.data?.ok){
          await db.from("midad_revenue_jobs").update({state:"PENDING_PAYOUT",next_action:"poll_invoice_payment",metadata:{...meta,invoice:created.data.data||created.data},updated_at:new Date().toISOString()}).eq("id",j.id);
          await db.from("opportunities").update({status:"submitted_waiting",updated_at:new Date().toISOString()}).eq("id",j.opportunity_id);
          summary.invoices_created++;summary.changed++;
        }else summary.errors.push({job_id:j.id,step:"invoice_create",detail:created.data?.error||created.status,data:created.data});
        continue;
      }
      const ist=String(ours.status||"").toLowerCase();
      const invMeta={...meta,invoice:ours};
      if(ist==="paid"){
        await db.from("midad_revenue_jobs").update({state:"PAID",paid_at:ours.paid_at||new Date().toISOString(),next_action:"verify_wallet_receipt",metadata:invMeta,updated_at:new Date().toISOString()}).eq("id",j.id);
        await db.from("opportunities").update({status:"settled",updated_at:new Date().toISOString()}).eq("id",j.opportunity_id);
        await db.from("midad_revenue_runs").insert({revenue_job_id:j.id,opportunity_id:j.opportunity_id,action:"ugig_invoice_paid",actor:"midad_ugig_lifecycle",ok:true,external_status:200,request_ref:ours.id||ours.coinpay_invoice_id||null,result:{invoice:ours},error:null});
        summary.paid++;summary.changed++;
      }else{
        await db.from("midad_revenue_jobs").update({state:"PENDING_PAYOUT",next_action:"poll_invoice_payment",metadata:invMeta,updated_at:new Date().toISOString()}).eq("id",j.id);
        summary.waiting++;
      }
    }
    return json({ok:true,...summary,observed_at:new Date().toISOString()});
  }catch(e){return json({ok:false,error:"ugig_lifecycle_error",detail:clip(e)},500)}
}
Deno.serve(main);