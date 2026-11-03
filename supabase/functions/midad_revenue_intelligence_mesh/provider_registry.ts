/**
 * Data-driven public JSON provider adapter.
 * This module normalizes discovery evidence only; provider claims never become
 * independent payout, escrow, identity, region, or KYC proof.
 */
export type RevenueParserKey = "taskmarket" | "basedagents" | "bountybook" | "chain_bounties" | "immunefi_public_json" | "official_airdrop_json" | "superteam" | "mapped_json" | "jobbi_json_feed";

const REGISTERED = new Set<RevenueParserKey>(["taskmarket","basedagents","bountybook","chain_bounties","immunefi_public_json","official_airdrop_json","superteam","mapped_json","jobbi_json_feed"]);
const ALIASES: Record<string,string[]> = {
  items:["items"], id:["id","external_id"], title:["title"], description:["description"],
  url:["url","listing_url"], status:["status"], amount:["amount","reward_amount","individual_reward_amount"],
  asset:["asset","payout_asset","reward_asset"], network:["network","payout_network","reward_network"],
  deadline:["deadline","expires_at"], upfront_cost_usd:["upfront_cost_usd","upfront_cost"],
  claim_bond_usd:["claim_bond_usd","claim_bond"], fee_usd:["fee_usd","estimated_fee_usd"],
  effort_hours:["effort_hours","estimated_effort_hours"], tags:["tags","skills","capabilities"],
};
const ASSETS = new Set(["BTC","USDC","USDT","ETH","SOL","DAI","EURC","LTC","XLM","XRP","AVAX","POL","POLYX","XMR"]);
const TERMINAL = new Set(["closed","expired","cancelled","canceled","completed","paid","disabled","archived","removed","rejected","withdrawn"]);
type RecordValue = Record<string,unknown>;
const record = (v:unknown):RecordValue|null => v!==null && typeof v==="object" && !Array.isArray(v) ? v as RecordValue : null;
function safePath(v:unknown):string|null {
  if(typeof v!=="string" || !v || v.length>180) return null;
  const parts=v.split(".");
  return parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p) && !["__proto__","prototype","constructor"].includes(p.toLowerCase())) ? v : null;
}
function safeHost(host:string):boolean {
  const h=host.toLowerCase().replace(/\.$/,"");
  return !!h && h.includes(".") && !h.includes("..") && !h.startsWith("[") && !h.includes(":") &&
    !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(h) &&
    !["localhost"].some(x=>h===x || h.endsWith("."+x)) &&
    ![".local",".internal",".test",".invalid",".example"].some(x=>h.endsWith(x)) &&
    /^[a-z0-9.-]+$/.test(h) &&
    h.split(".").every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function httpsUrl(v:unknown):URL|null {
  try { const u=new URL(String(v??"")); return u.protocol==="https:" && !u.username && !u.password && safeHost(u.hostname) ? u : null; }
  catch { return null; }
}
export function resolveRevenueParser(v:unknown):RevenueParserKey|null {
  const key=String(v??"").trim().toLowerCase() as RevenueParserKey;
  return REGISTERED.has(key)?key:null;
}
export function isSafeMappedJsonSource(v:unknown):boolean {
  const s=record(v); if(!s || resolveRevenueParser(s.parser_key)!=="mapped_json") return false;
  const feed=httpsUrl(s.api_url??s.url), domain=String(s.official_domain??"").trim().toLowerCase().replace(/\.$/,"");
  if(!feed || !safeHost(domain) || (feed.hostname.toLowerCase()!==domain && !feed.hostname.toLowerCase().endsWith("."+domain))) return false;
  const map=record(s.field_map); if(!map) return false;
  for(const [key,path] of Object.entries(map)) if(ALIASES[key] && safePath(path)===null) return false;
  return ["items","id","title"].every(k=>safePath(map[k])!==null);
}
function pathValue(root:unknown,path:unknown):unknown {
  const p=safePath(path); if(!p) return undefined;
  let current:unknown=root;
  for(const part of p.split(".")){const r=record(current);if(!r || !Object.prototype.hasOwnProperty.call(r,part))return undefined;current=r[part];}
  return current;
}
function mapped(item:unknown,map:RecordValue,key:string):unknown {
  for(const alias of ALIASES[key]||[key]) if(map[alias]!==undefined) return pathValue(item,map[alias]);
  return undefined;
}
function str(v:unknown,max:number):string { return typeof v==="string" || typeof v==="number" ? String(v).trim().slice(0,max) : ""; }
function num(v:unknown):number|null { if(typeof v!=="number" && typeof v!=="string")return null; const n=Number(String(v).replace(/[,$\s]/g,""));return Number.isFinite(n)&&n>=0?n:null; }
function candidateUrl(v:unknown,domain:string):string|null { const u=httpsUrl(v); if(!u)return null;const h=u.hostname.toLowerCase();return h===domain || h.endsWith("."+domain) ? u.toString() : null; }

export function normalizeMappedJsonFeed(body:unknown,sourceValue:unknown,now:Date|number=new Date()):any[] {
  const source=record(sourceValue); if(!source || !isSafeMappedJsonSource(source))return [];
  const map=record(source.field_map); if(!map)return [];
  const items=pathValue(body,map.items); if(!Array.isArray(items))return [];
  const capRaw=Number(source.max_items??50),cap=Number.isFinite(capRaw)?Math.max(1,Math.min(50,Math.trunc(capRaw))):50;
  const domain=String(source.official_domain).trim().toLowerCase().replace(/\.$/,"");
  const observed=now instanceof Date?now.toISOString():new Date(now).toISOString();
  const output:any[]=[];
  for(const item of items.slice(0,cap)){
    const id=str(mapped(item,map,"id"),256),title=str(mapped(item,map,"title"),500);
    if(!id || !title)continue;
    const url=candidateUrl(mapped(item,map,"url"),domain); if(!url)continue;
    const status=str(mapped(item,map,"status"),100)||"unknown";if(TERMINAL.has(status.toLowerCase()))continue;
    const rawAsset=str(mapped(item,map,"asset"),24).toUpperCase(),asset=ASSETS.has(rawAsset)?rawAsset:null;
    const amount=num(mapped(item,map,"amount")),cost=num(mapped(item,map,"upfront_cost_usd")),bond=num(mapped(item,map,"claim_bond_usd")),fee=num(mapped(item,map,"fee_usd"));
    const deadlineValue=mapped(item,map,"deadline"),deadlineDate=deadlineValue?new Date(deadlineValue as string|number):null;
    const deadline=deadlineDate && Number.isFinite(deadlineDate.getTime())?deadlineDate:null;
    const rawTags=mapped(item,map,"tags"),tags=Array.isArray(rawTags)?rawTags.map(x=>str(x,100)).filter(Boolean).slice(0,40):typeof rawTags==="string"?rawTags.split(/[,;|]/).map(x=>x.trim().slice(0,100)).filter(Boolean).slice(0,40):[];
    output.push({
      sourceSlug:str(source.slug,100),sourceUrl:httpsUrl(source.api_url??source.url)?.toString()||"",
      externalId:id,title,description:str(mapped(item,map,"description"),6000),url,externalStatus:status,
      amount:amount!==null&&amount>0?amount:null,asset,network:str(mapped(item,map,"network"),48)||"unknown",
      payoutClass:"C2_PROGRAM_CONDITIONAL_CRYPTO",payoutProofStatus:"unverified",payoutConfidence:0,
      paymentProof:false,escrowFunded:null,tx:null,payoutProofUrl:null,cost:cost??0,bond:bond??0,fee:fee??0,
      effortHours:num(mapped(item,map,"effort_hours")),deadline,region:"unknown",regionEligible:null,kyc:"unknown",
      identity:"unknown",identityEligible:null,caps:tags,tags,competition:0,
      test:/\b(?:do not claim|selfaudit|compatibility probe|test task|synthetic test)\b/i.test(title+" "+str(mapped(item,map,"description"),6000)),
      notes:["Mapped public JSON is discovery evidence only; payout and eligibility are not independently verified.","Provider self-asserted payment or payout fields are never promoted to verified escrow or payment.","Upfront cost, claim bond, KYC and region requirements require independent verification."],
      revenueLane:"crypto_task",evidenceMeta:{revenue_lane:"crypto_task",official_domain:domain,observed_at:observed,cost_evidence_present:cost!==null,claim_bond_evidence_present:bond!==null},
      raw:item,httpStatus:200,contentHash:null,
    });
  }
  return output;
}


/**
 * Jobbi is a discovery index, not a payer or escrow verifier.
 * Keep original board URLs as untrusted HTTPS references and preserve the
 * index's payout metadata as evidence only. Never promote its payout grade or
 * payment_state into task-level funding proof.
 */
export function isSafeJobbiJsonSource(v:unknown):boolean {
  const source=record(v);
  if(!source || resolveRevenueParser(source.parser_key)!=="jobbi_json_feed") return false;
  const url=httpsUrl(source.api_url??source.url);
  if(!url || url.hostname.toLowerCase()!=="jobbi.org" || url.pathname!=="/gigs.json") return false;
  const limit=Number(url.searchParams.get("limit"));
  return url.searchParams.get("lane")==="agent" && ["USDC","BTC"].includes(String(url.searchParams.get("currency")||"").toUpperCase()) && Number.isInteger(limit) && limit>=1 && limit<=50;
}

export function normalizeJobbiJsonFeed(body:unknown,sourceValue:unknown,now:Date|number=new Date()):any[] {
  const source=record(sourceValue);
  if(!source) return [];
  const feed=record(body);
  const items=Array.isArray(feed?.items)?feed.items:[];
  const capRaw=Number(source.max_items??50),cap=Number.isFinite(capRaw)?Math.max(1,Math.min(50,Math.trunc(capRaw))):50;
  const observed=now instanceof Date?now.toISOString():new Date(now).toISOString();
  const nowDate=now instanceof Date?now:new Date(now);
  const sourceUrl=httpsUrl(source.url??source.api_url)?.toString()||"https://jobbi.org/gigs.json";
  const output:any[]=[];
  for(const itemValue of items.slice(0,cap)){
    const item=record(itemValue); if(!item)continue;
    const meta=record(item._jobbi)||{};
    const reward=record(meta.reward)||{};
    const id=str(item.id,256),title=str(item.title,500);
    const link=httpsUrl(item.url);
    if(!id||!title||!link)continue;
    if(meta.claims_open===false)continue;
    const rawAsset=str(reward.currency,24).toUpperCase();
    const asset=ASSETS.has(rawAsset)?rawAsset:null;
    const rawRail=str(reward.rail,80);
    const rail=rawRail.toLowerCase();
    const network=rail.includes("base")?"Base":rail.includes("bitcoin")||rail==="btc"?"Bitcoin":rail.includes("solana")?"Solana":rail.includes("ethereum")||rail.includes("erc-20")?"Ethereum":rail.includes("arbitrum")?"Arbitrum":rail.includes("optimism")?"Optimism":rail.includes("polygon")?"Polygon":rawRail||"unknown";
    const rawAmount=num(reward.amount);
    const amount=asset==="USDC"||asset==="USDT"?rawAmount:null;
    const expiry=meta.expires??item.expires??null;
    const expiryNum=typeof expiry==="number"||(typeof expiry==="string"&&/^\d+$/.test(expiry))?Number(expiry):NaN;
    const expiryDate=expiry===null?null:(Number.isFinite(expiryNum)?new Date(expiryNum>1e12?expiryNum:expiryNum*1000):new Date(String(expiry)));
    const deadline=expiryDate&&Number.isFinite(expiryDate.getTime())?expiryDate:null;
    if(deadline&&deadline.getTime()<=nowDate.getTime())continue;
    const tags=Array.isArray(item.tags)?item.tags.map(x=>str(x,100)).filter(Boolean).slice(0,40):[];
    const board=str(meta.source,100)||"unknown_board";
    const description=str(item.content_text,6000);
    const claims=meta.claims_open===true;
    const payoutGrade=str(meta.payout_grade,8)||"unknown";
    const paymentState=str(meta.payment_state,80)||"unknown";
    output.push({
      sourceSlug:str(source.slug,100),sourceUrl,externalId:id,title,description,url:link.toString(),
      externalStatus:claims?"open":"open_index_feed",
      amount:amount!==null&&amount>0?amount:null,asset,network,
      payoutClass:"C2_PROGRAM_CONDITIONAL_CRYPTO",payoutProofStatus:"unverified",
      payoutConfidence:0,paymentProof:false,escrowFunded:null,tx:null,payoutProofUrl:null,
      cost:null,bond:null,fee:null,effortHours:null,deadline,region:"unknown",regionEligible:null,
      kyc:"unknown",identity:"unknown",identityEligible:null,caps:tags,tags,competition:0,
      test:/\b(?:do not claim|selfaudit|compatibility probe|test task|synthetic test)\b/i.test(title+" "+description),
      notes:[
        "Jobbi is a third-party discovery index; the original board is the authority for listing status and payment.",
        "Jobbi payout_grade/payment_state are index metadata only and do not prove this task's funded escrow or settlement.",
        "Original listing URL is an untrusted external HTTPS reference; verify its official host, eligibility, fees and payout terms before any work."
      ],
      revenueLane:"agent_work_index",
      evidenceMeta:{revenue_lane:"agent_work_index",index:"jobbi.org",board,observed_at:observed,index_payout_grade:payoutGrade,index_payment_state:paymentState,claims_open:meta.claims_open??null,reward:{amount:rawAmount,currency:rawAsset||null,rail:rawRail||null},index_expiry:expiry??null,independent_payment_proof:false},
      raw:item,httpStatus:200,contentHash:null
    });
  }
  return output;
}
