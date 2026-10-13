import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")||"";
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(URL,KEY);
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,x-midad-autonomy-key,authorization"};
const json=(v:any,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clip=(v:any,n=3000)=>String(v??"").slice(0,n);
const num=(v:any)=>{const x=Number(v);return Number.isFinite(x)?x:0};
const now=()=>Date.now();
async function ak(){const {data,error}=await db.rpc("midad_get_autonomy_key");if(error||!data) throw new Error("autonomy_key_unavailable");return String(data)}
async function auth(req:Request){const a=req.headers.get("authorization")||"";if(KEY&&a==="Bearer "+KEY)return true;const k=req.headers.get("x-midad-autonomy-key")||"";if(!k)return false;return k===await ak()}
async function getJson(url:string,timeout=7000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"MIDAD-FastCash-Radar/1.0"},signal:c.signal});const raw=await r.text();let data:any;try{data=JSON.parse(raw)}catch{data={raw}}return {ok:r.ok,status:r.status,data}}
  catch(e){return {ok:false,status:0,data:{error:String((e as any)?.name||e||"fetch_failed")}}} finally{clearTimeout(t)}
}
async function getText(url:string,timeout=7000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{headers:{"accept":"text/html,text/plain","user-agent":"MIDAD-FastCash-Radar/1.0"},signal:c.signal});return {ok:r.ok,status:r.status,text:await r.text()}}
  catch(e){return {ok:false,status:0,text:String((e as any)?.name||e||"fetch_failed")}} finally{clearTimeout(t)}
}
function risk(s:string){
  const x=s.toLowerCase();const flags:string[]=[];
  const pats:[string,RegExp][]=[
    ["credential_secret_access",/private key|seed phrase|password|secret key|api key.*provide|credentials/],
    ["anti_bot_bypass",/captcha bypass|anti[- ]bot bypass|cloudflare bypass|datadome bypass/],
    ["identity_kyc",/kyc|identity verification|resident only|citizen only|residency required/],
    ["impersonation_fraud",/impersonat|fake identity|fraud|scam|stolen|counterfeit/],
    ["unauthorized_access",/unauthorized access|drainer|wallet drain|bypass access/],
    ["malware",/malware|ransomware|credential stealer/]
  ];
  for(const [n,re] of pats)if(re.test(x))flags.push(n);
  const red=flags.some(f=>["credential_secret_access","anti_bot_bypass","impersonation_fraud","unauthorized_access","malware"].includes(f));
  return {risk_class:red?"RED":flags.length?"AMBER":"GREEN",risk_flags:flags};
}
function freshness(iso:any){const t=Date.parse(String(iso||""));return Number.isFinite(t)?Math.max(0,(now()-t)/60000):99999}
function velocity(reward:number,mins:number){return mins>0?Number((reward/mins).toFixed(4)):0}
function candidate(base:any){
  const r=risk((base.title+" "+base.description));const mins=Math.max(1,Math.round(num(base.estimated_minutes)||30));
  const net=Math.max(0,num(base.reward)*(1-Math.max(0,Math.min(.2,num(base.fee_pct)||0))));
  return {...base,net_reward_usd:Number(net.toFixed(4)),cash_velocity_usd_per_min:velocity(net,mins),estimated_minutes:mins,...r};
}
async function main(req:Request){
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  if(!(await auth(req)))return json({ok:false,error:"unauthorized"},401);
  const body=await req.json().catch(()=>({}));
  const requestedProvider=String(body.provider||body.source||"");
  const sourceOnly=["bountybook","deskcrew","agentxchange","moltask","basedagents","superteam_agents","agentsbay","basebounty","superteam","laborx","airdropalert"].includes(requestedProvider)?requestedProvider:"";
  const started=now();
  const {data:profile}=await db.from("profiles").select("id").limit(1).maybeSingle();
  if(!profile?.id)return json({ok:false,error:"no_system_profile"},503);
  const result:any={service:"midad_fast_cash_radar",version:9,observed_at:new Date().toISOString(),sources:{},discovered:0,created:0,updated:0,skipped:0,top:[]};
  try{
    const [bb,dc,ax,mt,ba,sup,ab,baseBounty,superteam,laborx,airdropalert]:any[]=await Promise.all([
       (!sourceOnly||sourceOnly==="bountybook")?getJson("https://api.bountybook.ai/jobs?status=open&limit=100"):{ok:false,status:0,data:null,skipped:true},
       (!sourceOnly||sourceOnly==="deskcrew")?getJson("https://deskcrew.io/api/arena/contests"):{ok:false,status:0,data:null,skipped:true},
       (!sourceOnly||sourceOnly==="agentxchange")?getJson("https://agentxchange.io/api/v1/tasks/available"):{ok:false,status:0,data:null,skipped:true},
       (!sourceOnly||sourceOnly==="moltask")?getJson("https://www.moltask.com/api/tasks?status=open"):{ok:false,status:0,data:null,skipped:true},
       (!sourceOnly||sourceOnly==="basedagents")?getJson("https://api.basedagents.ai/v1/tasks?status=open&limit=100"):{ok:false,status:0,data:null,skipped:true},
       (!sourceOnly||sourceOnly==="superteam_agents")?getText("https://superteam.fun/earn/agents/listings"):{ok:false,status:0,text:"",skipped:true},
       (!sourceOnly||sourceOnly==="agentsbay")?getText("https://agentsbay.ai/jobs"):{ok:false,status:0,text:"",skipped:true},
       (!sourceOnly||sourceOnly==="basebounty")?getJson("https://www.basebounty.app/api/v1/bounties?status=open"):{ok:false,status:0,data:null,skipped:true},
       (!sourceOnly||sourceOnly==="superteam")?getJson("https://superteam.fun/api/listings?take=100"):{ok:false,status:0,data:null,skipped:true},
       (!sourceOnly||sourceOnly==="laborx")?getText("https://laborx.com/gigs"):{ok:false,status:0,text:"",skipped:true},
       (!sourceOnly||sourceOnly==="airdropalert")?getText("https://airdropalert.com/browse-airdrops/"):{ok:false,status:0,text:"",skipped:true}
     ]);
    result.sources={bountybook:{ok:bb.ok,status:bb.status,skipped:Boolean(bb.skipped),error:bb.skipped||bb.ok?null:clip(bb.data?.error||"fetch_failed",180)},deskcrew:{ok:dc.ok,status:dc.status,skipped:Boolean(dc.skipped),error:dc.skipped||dc.ok?null:clip(dc.data?.error||"fetch_failed",180)},agentxchange:{ok:ax.ok,status:ax.status,skipped:Boolean(ax.skipped),error:ax.skipped||ax.ok?null:clip(ax.data?.error||"fetch_failed",180)},moltask:{ok:mt.ok,status:mt.status,skipped:Boolean(mt.skipped),error:mt.skipped||mt.ok?null:clip(mt.data?.error||"fetch_failed",180)},basedagents:{ok:ba.ok,status:ba.status,skipped:Boolean(ba.skipped),error:ba.skipped||ba.ok?null:clip(ba.data?.error||"fetch_failed",180)},superteam_agents:{ok:sup.ok,status:sup.status,skipped:Boolean(sup.skipped),error:sup.skipped||sup.ok?null:clip(sup.text||"fetch_failed",180)},agentsbay:{ok:ab.ok,status:ab.status,skipped:Boolean(ab.skipped),error:ab.skipped||ab.ok?null:clip(ab.text||"fetch_failed",180)}};
    Object.assign(result.sources,{
      basebounty:{ok:baseBounty.ok,status:baseBounty.status,skipped:Boolean(baseBounty.skipped),error:baseBounty.skipped||baseBounty.ok?null:clip(baseBounty.data?.error||"fetch_failed",180)},
      superteam:{ok:superteam.ok,status:superteam.status,skipped:Boolean(superteam.skipped),error:superteam.skipped||superteam.ok?null:clip(superteam.data?.error||"fetch_failed",180)},
      laborx:{ok:laborx.ok,status:laborx.status,skipped:Boolean(laborx.skipped),error:laborx.skipped||laborx.ok?null:clip(laborx.text||"fetch_failed",180)},
      airdropalert:{ok:airdropalert.ok,status:airdropalert.status,skipped:Boolean(airdropalert.skipped),error:airdropalert.skipped||airdropalert.ok?null:clip(airdropalert.text||"fetch_failed",180)}
    });
    const cs:any[]=[];

    const bbRows=Array.isArray(bb.data?.jobs)?bb.data.jobs:Array.isArray(bb.data)?bb.data:[];
    for(const j of bbRows){const status=String(j.status||"open").toLowerCase();const id=String(j.id||j.job_id||"");const reward=num(j.budget_usdc??j.reward_usdc??j.reward??j.bounty);if(!id||status!=="open"||reward<=0)continue;
      const mins=num(j.estimated_minutes??j.estimatedMinutes??j.estimated_time_minutes)||30;
      cs.push(candidate({fp:"bountybook:"+id,source:"bountybook",title:clip(j.title||"BountyBook bounty",220),description:clip(j.description||j.instructions||j.success_condition,2600),reward,fee_pct:.04,estimated_minutes:mins,applicants:num(j.claims??j.submissions??j.submission_count),deadline:j.deadline??j.expires_at??null,action_url:"https://www.bountybook.ai/job/"+id,claim_mode:"wallet_signature",payout_mode:"escrow_oracle",payment_asset:"USDC",network:"Base",automation_candidate:true,external_id:id,evidence:{platform:"BountyBook",job_id:id,status:j.status,budget_usdc:reward,escrow:true,oracle_verification:true,source_url:"https://api.bountybook.ai/jobs/"+id}}));
    }

    const dcRows=Array.isArray(dc.data?.bounties)?dc.data.bounties:Array.isArray(dc.data)?dc.data:[];
    for(const j of dcRows){const id=String(j.ticketId||j.id||"");const reward=num(j.bountyUsd??j.rewardUsd??j.reward);if(!id||reward<=0)continue;
      const title=clip(j.subject||j.title||"DeskCrew bounty",220);const desc=clip(j.description||j.body||title,2200);const mins=Number(j.estimatedMinutes||15);
      cs.push(candidate({fp:"deskcrew:"+id,source:"deskcrew",title,description:desc,reward,fee_pct:.15,estimated_minutes:mins,applicants:num(j.entrants||j.submissions),deadline:j.decidesAt||j.closingTime||null,action_url:"https://deskcrew.io/arena",claim_mode:"no_account",payout_mode:"human_approval",payment_asset:"USDC",network:String(j.payoutNetwork||"unknown"),automation_candidate:true,external_id:id,evidence:{platform:"DeskCrew",ticket_id:id,bounty_usd:reward,entry_fee_usd:num(j.toolPriceUsd||.06),payout_network:j.payoutNetwork||null,source_url:"https://deskcrew.io/api/arena/contests"},spend_required:true}));
    }

    const axRows=Array.isArray(ax.data?.tasks)?ax.data.tasks:Array.isArray(ax.data)?ax.data:[];
    for(const j of axRows){const id=String(j.id||j.task_id||"");const reward=num(j.budget_usdc??j.reward_usdc??j.reward);if(!id||reward<=0)continue;cs.push(candidate({fp:"agentxchange:"+id,source:"agentxchange",title:clip(j.title||"AgentXChange task",220),description:clip(j.description||j.context,2200),reward,estimated_minutes:num(j.estimated_minutes)||30,applicants:num(j.submissions),deadline:j.deadline||j.expires_at,action_url:"https://agentxchange.io/",claim_mode:"wallet_signature",payout_mode:"escrow",payment_asset:"USDC",network:"Polygon",automation_candidate:true,external_id:id,evidence:{platform:"AgentXChange",task_id:id,status:j.status,source_url:"https://agentxchange.io/api/v1/tasks/available"}}));}

    const baRows=Array.isArray(ba.data?.tasks)?ba.data.tasks:Array.isArray(ba.data)?ba.data:[];
    for(const j of baRows){const id=String(j.id||j.task_id||"");const b=j.bounty||j.reward||{};const reward=num(b.amount_display??j.amount_display) || num(b.amount_atomic)/1000000;if(!id||reward<=0)continue;cs.push(candidate({fp:"basedagents:"+id,source:"basedagents",title:clip(j.title||"BasedAgents task",220),description:clip(j.description||j.instructions||j.spec,2200),reward,estimated_minutes:num(j.estimated_minutes)||60,applicants:num(j.submissions_count||j.claims_count),deadline:j.deadline||j.expires_at,action_url:"https://basedagents.ai/tasks/"+id,claim_mode:"agent_identity",payout_mode:"escrow",payment_asset:String(b.token||j.token||"USDC"),network:String(b.network||j.network||"Base"),automation_candidate:true,external_id:id,evidence:{platform:"BasedAgents",task_id:id,status:j.status,bounty: b||null,source_url:"https://api.basedagents.ai/v1/tasks/"+id}}));}

    const mtRows=Array.isArray(mt.data?.tasks)?mt.data.tasks:Array.isArray(mt.data)?mt.data:[];
    for(const j of mtRows){const id=String(j.id||j.task_id||"");const reward=num(j.reward??j.bounty??j.amount);if(!id||reward<=0)continue;cs.push(candidate({fp:"moltask:"+id,source:"moltask",title:clip(j.title||j.name||"Moltask ask",220),description:clip(j.description||j.instructions,2200),reward,estimated_minutes:num(j.estimated_minutes)||30,applicants:num(j.submissions_count),deadline:j.deadline||j.expires_at,action_url:"https://moltask.com/tasks/"+id,claim_mode:"wallet_address",payout_mode:"poster_approval",payment_asset:"MOLT",network:"Base",automation_candidate:true,external_id:id,evidence:{platform:"Moltask",task_id:id,status:j.status,reward:reward,token:"MOLT",source_url:"https://www.moltask.com/api/tasks/"+id}}));}


    // BaseBounty reads contract-backed USDC/Base tasks. Listings are research-only here: taking/submitting requires wallet signing.
    const baseRows=Array.isArray(baseBounty.data?.bounties)?baseBounty.data.bounties:[];
    const boardReadAt=Date.parse(String(baseBounty.data?.readAt||""));
    const boardFresh=Number.isFinite(boardReadAt)&&now()-boardReadAt<=5*60_000;
    for(const j of baseRows){
      const id=String(j.id||j.jobId||j.bountyId||"");
      const status=String(j.status||"").toLowerCase();
      const reward=num(j.workerPayoutUsdc);
      const deadline=j.deadline||j.expiresAt||j.expiry||null;
      if(!id||status!=="open"||reward<=0||!boardFresh||(deadline&&Date.parse(String(deadline))<=now()))continue;
      cs.push(candidate({fp:"basebounty:"+id,source:"basebounty",title:clip(j.title||j.description||"BaseBounty USDC task",220),description:clip(j.description||j.title||"Contract-backed USDC bounty on Base.",2500),reward,fee_pct:0,estimated_minutes:num(j.estimatedMinutes)||60,applicants:num(j.submissions||j.workerCount),deadline,action_url:"https://www.basebounty.app/",claim_mode:"wallet_signature",payout_mode:"contract_escrow",payment_asset:"USDC",network:"Base",automation_candidate:false,payout_evidence_verified:true,crypto_payout_verified:true,requires_human_signature:true,research_only:true,external_id:id,evidence:{platform:"BaseBounty",job_id:id,status,worker_payout_usdc:reward,chain_id:baseBounty.data?.chainId||8453,network:baseBounty.data?.network||"Base",read_at:baseBounty.data?.readAt,source_url:"https://www.basebounty.app/api/v1/bounties?status=open",contract_state_read:true,submission_requires_wallet_signature:true}}));
    }

    // Superteam's public feed reports token symbols, but raw reward units/network and the payout claimant must be verified before execution.
    const stRows=Array.isArray(superteam.data)?superteam.data:Array.isArray(superteam.data?.listings)?superteam.data.listings:Array.isArray(superteam.data?.data)?superteam.data.data:[];
    const nonFiatSymbols=["USD","EUR","GBP","FIAT","CASH","PAYPAL"];
    for(const j of stRows){
      const id=String(j.id||j.listingId||"");
      const status=String(j.status||"").toUpperCase();
      const deadline=j.deadline||null;
      const token=String(j.token||j.currency||"").trim().toUpperCase();
      if(!id||status!=="OPEN"||!token||nonFiatSymbols.includes(token)||(deadline&&!Number.isFinite(Date.parse(String(deadline))))||(deadline&&Date.parse(String(deadline))<=now()))continue;
      const title=clip(j.title||"Superteam Earn listing",220);
      const slug=String(j.slug||id);
      cs.push(candidate({fp:"superteam:"+id,source:"superteam",title,description:clip([j.description,j.summary].filter(Boolean).join(" ")||"Public Superteam listing. Eligibility, amount scale, payout network and claimant requirements require verification.",2400),reward:0,fee_pct:0,estimated_minutes:60,applicants:num(j._count?.Submission),deadline,action_url:"https://superteam.fun/earn/listing/"+encodeURIComponent(slug),claim_mode:"human_claim_required",payout_mode:"listing_reward_unverified",payment_asset:token,network:"unverified",automation_candidate:false,payout_evidence_verified:false,crypto_payout_verified:true,requires_human_claim:true,research_only:true,external_id:id,evidence:{platform:"Superteam Earn",listing_id:id,slug,status,token,reward_amount_raw:j.rewardAmount??null,reward_units_verified:false,payout_network_verified:false,agent_access:j.agentAccess||"unknown",deadline,source_url:"https://superteam.fun/api/listings?take=100",human_claim_required_for_payout:true}}));
    }

    const htmlText=(s:string)=>String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&nbsp;/g," ").replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();
    // LaborX supports crypto contracts platform-wide, but each gig's asset/network must be checked in its specific contract terms.
    const laborLinks=new Map<string,{url:string,title:string}>();
    if(laborx.ok&&laborx.text){
      for(const m of laborx.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
        try{
          const u=new globalThis.URL(String(m[1]),"https://laborx.com/");
          if(u.hostname!=="laborx.com"||!/^\/gigs\/[^/?#]+/.test(u.pathname))continue;
          const title=htmlText(m[2]).slice(0,220);
          if(title.length<8||/^(browse gigs|show all gigs|more info)$/i.test(title))continue;
          if(!laborLinks.has(u.pathname))laborLinks.set(u.pathname,{url:u.href,title});
        }catch{}
        if(laborLinks.size>=25)break;
      }
    }
    for(const [path,j] of laborLinks){
      const slug=path.split("/").filter(Boolean).pop()||path;
      cs.push(candidate({fp:"laborx:"+slug,source:"laborx",title:j.title,description:"LaborX public gig listing. The platform supports crypto payments, but this individual gig's contract asset, network and escrow must be checked before work begins.",reward:0,fee_pct:0,estimated_minutes:60,applicants:0,deadline:null,action_url:j.url,claim_mode:"contract_terms_check",payout_mode:"gig_terms_unverified",payment_asset:"unverified",network:"unverified",automation_candidate:false,payout_evidence_verified:false,crypto_payout_verified:false,requires_human_claim:true,research_only:true,external_id:slug,evidence:{platform:"LaborX",listing_url:j.url,source_url:"https://laborx.com/gigs",platform_crypto_payments_supported:true,individual_gig_crypto_terms_verified:false}}));
    }

    // Airdrops stay research-only until eligibility, reward token, network and costs are verified at the official project.
    const airdropTitles=new Map<string,string>();
    if(airdropalert.ok&&airdropalert.text){
      const h4s=[...airdropalert.text.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi)];
      for(let i=0;i<h4s.length&&airdropTitles.size<25;i++){
        const title=htmlText(h4s[i][1]);
        const nextStart=(h4s[i].index||0)+h4s[i][0].length;
        const nextEnd=i+1<h4s.length?(h4s[i+1].index||airdropalert.text.length):Math.min(airdropalert.text.length,nextStart+1600);
        const context=airdropalert.text.slice(nextStart,nextEnd);
        if(title.length<3||/^(find an airdrop|categories|trading|trade your crypto|latest news|download the airdropalert app)$/i.test(title))continue;
        if(!/added\s+(?:oct|nov|dec|jan|feb|mar|apr|may|jun|jul|aug|sep)|airdrop|testnet|points|reward/i.test(context))continue;
        const key=title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,90);
        if(key&&!airdropTitles.has(key))airdropTitles.set(key,title);
      }
    }
    for(const [slug,title] of airdropTitles){
      cs.push(candidate({fp:"airdropalert:"+slug,source:"airdropalert",title:"Airdrop research: "+title,description:"Research-only campaign signal from AirdropAlert. Eligibility, reward token, payout chain, fees, KYC and official project URL are unverified. No wallet connection, message signing, transaction or claim is performed.",reward:0,fee_pct:0,estimated_minutes:1,applicants:0,deadline:null,action_url:"https://airdropalert.com/browse-airdrops/",claim_mode:"research_only",payout_mode:"unverified_airdrop",payment_asset:"unverified",network:"unverified",automation_candidate:false,payout_evidence_verified:false,crypto_payout_verified:false,requires_human_claim:true,research_only:true,external_id:slug,evidence:{platform:"AirdropAlert",displayed_project_title:title,source_url:"https://airdropalert.com/browse-airdrops/",listing_state:"revalidate_at_source",no_wallet_interaction:true,no_claim_performed:true}}));
    }

    // Only use internal cache when every structured task API is unreachable. A reachable API returning no open tasks is not a reason to recycle old listings.
    const structuredSourceCount = [bb,dc,ax,mt,ba,baseBounty,superteam].filter((source:any)=>source.ok).length;
    const cacheFallback = cs.length===0 && structuredSourceCount===0;
    if(cacheFallback){
      const {data:cached}=await db.from("opportunities")
        .select("id,source,title,description,score,expected_value,offer,evidence,metadata,updated_at")
        .in("status",["money_candidate","submitted_waiting"])
        .gte("updated_at",new Date(Date.now()-2*3600000).toISOString())
        .eq("metadata->>fast_cash_lane","true")
        .order("score",{ascending:false}).limit(100);
      for(const o of cached||[]){
        const m=o.metadata||{}, off=o.offer||{}, ev=o.evidence||{};
        const reward=num(off.net_reward_usd||off.reward_usd||o.expected_value);
        const mins=Math.max(1,num(m.estimated_minutes)||30);
        cs.push(candidate({
          fp:"cache:"+o.id,source:o.source,title:clip(o.title,220),description:clip(o.description,2200),
          reward,fee_pct:0,estimated_minutes:mins,applicants:num(m.applicants||off.applicants),
          deadline:off.deadline||null,action_url:off.action_url||null,
          claim_mode:String(m.claim_mode||"review"),payout_mode:String(m.payout_mode||"unknown"),
          payment_asset:String(m.payment_asset||off.chain||""),network:String(m.network||off.chain||""),
          automation_candidate:Boolean(m.automation_allowed),external_id:off.external_id||null,
          evidence:{...(ev||{}),internal_cache:true,source_opportunity_id:o.id}
        }));
      }
      result.fallback="internal_opportunity_cache";
      result.fallback_count=cs.length;
      result.read_only_fallback=true;
      result.fallback_reason="all_structured_sources_unreachable";
    }

    // Public HTML sources are tracked as health signals; we do not fabricate task rows from partial text.
    result.public_signals={
       superteam_agents:{agent_program_visible:Boolean(sup.text&&/agent-eligible|Agent-eligible/i.test(sup.text)),no_eligible_visible:Boolean(sup.text&&/no agent-eligible listings|no agent eligible listings/i.test(sup.text))},
       agentsbay:{job_pages_visible:Boolean(ab.text&&/Open jobs|escrow-backed/i.test(ab.text)),spam_markers:Number((ab.text.match(/lamborghini|rolls-royce|pharm|promo code/gi)||[]).length)},
       basebounty:{read_at:baseBounty.data?.readAt||null,chain_id:baseBounty.data?.chainId||null,open_count:baseRows.length,source_contract_state:Boolean(baseBounty.ok&&baseBounty.data?.testnet===false),claim_requires_signature:true},
       superteam:{open_listings:stRows.filter((j:any)=>String(j.status||"").toUpperCase()==="OPEN").length,agent_eligible:stRows.filter((j:any)=>["AGENT_ALLOWED","AGENT_ONLY"].includes(String(j.agentAccess||""))&&String(j.status||"").toUpperCase()==="OPEN").length,payout_network_verified:false,human_claim_required_for_payout:true},
       laborx:{listing_links_found:laborLinks.size,platform_crypto_payments_supported:Boolean(laborx.ok&&/supports a range of popular tokens/i.test(laborx.text)),individual_contract_terms_verified:false},
       airdropalert:{campaign_signals_found:airdropTitles.size,sample_titles:[...airdropTitles.values()].slice(0,8),research_only:true,reward_values_inferred:false,wallets_connected:false,claims_performed:false}
     };
    const beforeDedupe=cs.length;
    const deduped=new Map<string,any>();
    for(const c of cs){
      const source=String(c.source||"unknown").toLowerCase();
      const external=String(c.external_id||"").trim().toLowerCase();
      const url=String(c.action_url||"").split("?")[0].trim().toLowerCase();
      const title=String(c.title||"").trim().toLowerCase();
      const key=source+"|"+(external?"id:"+external:(url?"url:"+url:"title:"+title));
      const prior=deduped.get(key);
      if(!prior || Number(c.net_reward_usd||0)>Number(prior.net_reward_usd||0))deduped.set(key,c);
    }
    cs.splice(0,cs.length,...deduped.values());
    result.duplicates_collapsed=Math.max(0,beforeDedupe-cs.length);
    result.discovery_mode=cacheFallback?"cache_fallback_read_only":"live_sources";
    result.live_structured_source_count=structuredSourceCount;
    const ranked=cs.sort((a,b)=>b.cash_velocity_usd_per_min-a.cash_velocity_usd_per_min || b.net_reward_usd-a.net_reward_usd);
    result.discovered=ranked.length;result.top=ranked.slice(0,25).map(x=>({source:x.source,id:x.external_id,title:x.title,reward:x.reward,net:x.net_reward_usd,mins:x.estimated_minutes,velocity:x.cash_velocity_usd_per_min,risk:x.risk_class,claim:x.claim_mode,payout:x.payout_mode,spend_required:Boolean(x.spend_required),research_only:Boolean(x.research_only),crypto_payout_verified:Boolean(x.crypto_payout_verified),payout_evidence_verified:Boolean(x.payout_evidence_verified)}));
    if(cacheFallback) result.not_persisted_due_to_fallback=ranked.length;
    for(const c of ranked.slice(0,200)){
      if(cacheFallback) continue;
      const asset=String(c.payment_asset||"").trim().toUpperCase();const net=String(c.network||"").trim().toLowerCase();const stableCrypto=["USDC","USDT","DAI","USDP","USDG","FDUSD","USDE","USDS"].includes(asset);const verifiedCrypto=stableCrypto&&Boolean(c.crypto_payout_verified)&&Boolean(c.payout_evidence_verified)&&Boolean(net)&&!["unknown","unverified","n/a"].includes(net);const automationAllowed=c.risk_class==="GREEN"&&c.automation_candidate===true&&!c.spend_required&&!c.research_only&&verifiedCrypto&&c.claim_mode!=="wallet_signature"&&!c.requires_human_claim;const status=automationAllowed?"money_candidate":"human_review";
      let exists:any=null;
      // Prefer an opportunity already linked to a revenue job; this prevents live refreshes from creating or reviving parallel copies.
      if(c.external_id){
        const {data:jobLink}=await db.from("midad_revenue_jobs").select("opportunity_id").eq("platform",c.source).eq("external_ref",String(c.external_id)).not("opportunity_id","is",null).limit(1).maybeSingle();
        if(jobLink?.opportunity_id){
          const {data:linkedOpportunity}=await db.from("opportunities").select("id,status,metadata").eq("id",jobLink.opportunity_id).maybeSingle();
          if(linkedOpportunity)exists=linkedOpportunity;
        }
      }
      if(!exists){
        const {data:byFingerprint}=await db.from("opportunities").select("id,status,metadata").eq("fingerprint",c.fp).maybeSingle();
        if(byFingerprint)exists=byFingerprint;
      }
      if(!exists&&c.external_id){
        const {data:byExternal}=await db.from("opportunities").select("id,status,metadata").eq("source",c.source).eq("offer->>external_id",String(c.external_id)).order("updated_at",{ascending:false}).limit(1).maybeSingle();
        if(byExternal)exists=byExternal;
      }
      const metadata={origin:"midad_fast_cash_radar_v1",fast_cash_lane:true,last_verified_at:new Date().toISOString(),risk_class:c.risk_class,risk_flags:c.risk_flags,automation_candidate:c.automation_candidate,automation_allowed:automationAllowed,payout_evidence_verified:Boolean(c.payout_evidence_verified),crypto_payout_verified:Boolean(c.crypto_payout_verified),research_only:Boolean(c.research_only),requires_human_claim:Boolean(c.requires_human_claim),claim_mode:c.claim_mode,payout_mode:c.payout_mode,payment_asset:c.payment_asset,network:c.network,estimated_minutes:c.estimated_minutes,net_reward_usd:c.net_reward_usd,cash_velocity_usd_per_min:c.cash_velocity_usd_per_min,spend_required:Boolean(c.spend_required),requires_human_signature:c.claim_mode==="wallet_signature",freshness_minutes:freshness(c.created_at||c.updated_at),evidence_version:2};
      const payload={source:c.source,title:c.title,score:Number(Math.min(99,Math.max(50,60+c.cash_velocity_usd_per_min*8+(c.reward>=5?8:0)) ).toFixed(2)),status,description:c.description,evidence:c.evidence,offer:{reward_usd:c.reward,net_reward_usd:c.net_reward_usd,chain:c.network,external_id:c.external_id,deadline:c.deadline,applicants:c.applicants||0,action_url:c.action_url},opportunity_type:c.research_only?(c.source==="airdropalert"?"airdrop_research":"crypto_payout_research"):"fast_cash_agent_bounty",confidence:c.research_only?.45:c.risk_class==="GREEN"?.88:.72,expected_value:c.net_reward_usd,metadata};
      if(exists){const lock=Boolean(exists.metadata?.duplicate_suppression?.execution_locked||exists.metadata?.midad_quarantine?.execution_locked);const preserved=["submitted_waiting","technical_blocked","settled","paid","accepted_waiting_delivery","rejected","blocked"].includes(exists.status)||lock;const s=preserved?exists.status:status;const mergedMetadata=lock?{...metadata,...(exists.metadata||{}),automation_allowed:false,requires_human_review:true,execution_decision:"BLOCKED"}:{...(exists.metadata||{}),...metadata};const {error}=await db.from("opportunities").update({...payload,status:s,updated_at:new Date().toISOString(),metadata:mergedMetadata}).eq("id",exists.id);if(error)result.skipped++;else result.updated++;}
      else{const {error}=await db.from("opportunities").insert({user_id:profile.id,fingerprint:c.fp,...payload});if(error)result.skipped++;else result.created++;}
    }
    await db.from("engine_runs").insert({user_id:profile.id,job_type:"fast_cash_radar",status:"completed",requested_tools:["bountybook","deskcrew_fast","agentxchange","moltask","basedagents","superteam_agents","agentsbay","basebounty","superteam","laborx","airdropalert"],result,completed_at:new Date().toISOString(),attempt_count:1,latency_ms:now()-started,providers_used:Object.keys(result.sources)});
    return json({ok:true,result});
  }catch(e){result.error=clip(e);await db.from("engine_runs").insert({user_id:profile.id,job_type:"fast_cash_radar",status:"failed",requested_tools:["bountybook","deskcrew_fast","agentxchange","moltask","basedagents","superteam_agents","agentsbay","basebounty","superteam","laborx","airdropalert"],result,error:clip(e),completed_at:new Date().toISOString(),attempt_count:1,latency_ms:now()-started,providers_used:Object.keys(result.sources||{})});return json({ok:false,result},500)}
}
Deno.serve(main);