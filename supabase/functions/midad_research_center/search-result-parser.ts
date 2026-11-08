/**
 * Pure HTML search-result parsing for the no-cost public research center.
 * Relevance here only determines whether a public page is worth reading.
 * It is not payout, escrow, identity, region or KYC evidence.
 */
function decodeEntities(value:string):string {
  return value
    .replace(/&amp;/g,"&")
    .replace(/&lt;/g,"<")
    .replace(/&gt;/g,">")
    .replace(/&#39;/g,"'")
    .replace(/&quot;/g,'"')
    .replace(/&#x([0-9a-f]+);/gi,(_m,hex)=>String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#(\d+);/g,(_m,num)=>String.fromCodePoint(Number(num)));
}

function cleanTitle(value:string,max=220):string {
  return decodeEntities(value.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()).slice(0,max);
}

function safeHttpUrl(value:string):string|null {
  try {
    const url=new URL(decodeEntities(value));
    if((url.protocol!=="https:"&&url.protocol!=="http:")||url.username||url.password)return null;
    return url.toString();
  } catch {
    return null;
  }
}

function unwrapBingDestination(value:string):string|null {
  const tracking=safeHttpUrl(value);
  if(!tracking)return null;
  try {
    const url=new URL(tracking);
    const encoded=url.searchParams.get("u")||"";
    if(!encoded.startsWith("a1"))return tracking;
    const b64=encoded.slice(2).replace(/-/g,"+").replace(/_/g,"/");
    const padded=b64+"=".repeat((4-(b64.length%4))%4);
    const binary=atob(padded);
    const bytes=Uint8Array.from(binary,(ch)=>ch.charCodeAt(0));
    const destination=new TextDecoder().decode(bytes);
    return safeHttpUrl(destination)||tracking;
  } catch {
    return tracking;
  }
}

export function isRelevantSearchResult(item:unknown, query:string):boolean {
  const value=(item&&typeof item==="object"?item:{}) as Record<string,unknown>;
  const text=(String(value.title||"")+" "+String(value.url||"")).toLowerCase();
  const stop=new Set([
    "the","and","for","with","from","that","this","into","beyond","current","find","search",
    "prioritize","include","verify","official","new","live","task","tasks","platform","platforms",
    "source","sources","public","data","work","jobs","job","listings","criteria","must","have",
    "only","need","when","where","which","what","how","your","their","ours","than","each",
    "other","funded","across","where","actual"
  ]);
  const tokens=(query.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g)||[]).filter((word)=>!stop.has(word));
  const matches=tokens.filter((word)=>text.includes(word));
  const topic=/(crypto|usdc|usdt|\bbtc\b|bitcoin|bounty|bounties|freelanc|escrow|web3|blockchain|x402|payout|payrelayer|cryptotask|taskmarket|basedagents|bountybook|nadbounty|basebounty|arcbounty|gig|earn|reward|grant|airdrop|workusdc|mining|miner|hashrate|dogecoin|cloud|miningpool|cloudminecrypto|withdrawal|withdrawals|proof-of-work|faucet|referral|ai[\s-]?training|training|rlhf|annotation|model evaluation|red[\s-]?team|security qa|automation|api|integration|python|typescript|sql|developer|direct client|contract)/i.test(text);
  return matches.length>=1&&topic;
}

export function parseSearch(html:string):Array<{title:string;url:string}> {
  const out:Array<{title:string;url:string}>=[];
  const re=/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match:RegExpExecArray|null;
  while((match=re.exec(html))&&out.length<16){
    const attrs=String(match[1]+" "+match[3]);
    if(!/(?:result__a|result-link)/i.test(attrs))continue;
    let href=String(match[2]).replace(/&amp;/g,"&");
    try {
      if(href.startsWith("//"))href="https:"+href;
      const url=new URL(href);
      const redirected=url.searchParams.get("uddg");
      const destination=safeHttpUrl(redirected||href);
      const title=cleanTitle(String(match[4]));
      if(destination&&title&&!out.some(item=>item.url===destination))out.push({title,url:destination});
    } catch {}
  }
  return out;
}

export function parseBing(html:string):Array<{title:string;url:string}> {
  const out:Array<{title:string;url:string}>=[];
  const blocks=/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let block:RegExpExecArray|null;
  while((block=blocks.exec(html))&&out.length<16){
    const heading=/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(block[1]);
    if(!heading)continue;
    const anchor=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(heading[1]);
    if(!anchor)continue;
    const destination=unwrapBingDestination(String(anchor[1]).replace(/&amp;/g,"&"));
    const title=cleanTitle(String(anchor[2]));
    if(destination&&title&&!out.some(item=>item.url===destination))out.push({title,url:destination});
  }
  return out;
}
