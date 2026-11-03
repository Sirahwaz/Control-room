import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const H = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-midad-ingest-key"
};
const json = (x:any, status=200) => new Response(JSON.stringify(x), {status, headers:H});
const clip = (v:any, n=6500) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0,n);
const esc = (v:string) => v.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#39;/g,"'").replace(/&quot;/g,'"');

function textFromHtml(html:string){
  return clip(
    html
      .replace(/<script[\s\S]*?<\/script>/gi," ")
      .replace(/<style[\s\S]*?<\/style>/gi," ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi," ")
      .replace(/<[^>]+>/g," ")
      .replace(/\s+/g," "),
    6500
  );
}

async function searchDuckDuckGo(query:string){
  try{
    const r=await fetch("https://html.duckduckgo.com/html/?q="+encodeURIComponent(query),{
      headers:{"user-agent":"Mozilla/5.0 (compatible; MIDAD-Research-Center/2.0)","accept":"text/html,application/xhtml+xml","accept-language":"en-US,en;q=0.9"},
      signal:AbortSignal.timeout(10000)
    });
    return {ok:r.ok,status:r.status,html:await r.text()};
  }catch(e){return {ok:false,status:0,html:"",error:clip(e,250)};}
}
async function searchBing(query:string){
  try{
    const r=await fetch("https://www.bing.com/search?q="+encodeURIComponent(query),{
      headers:{"user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36","accept":"text/html,application/xhtml+xml","accept-language":"en-US,en;q=0.9"},
      signal:AbortSignal.timeout(10000)
    });
    return {ok:r.ok,status:r.status,html:await r.text()};
  }catch(e){return {ok:false,status:0,html:"",error:clip(e,250)};}
}
function isRelevantSearchResult(item:any, query:string){
  const text=(String(item?.title||"")+" "+String(item?.url||"")).toLowerCase();
  const stop=new Set(["the","and","for","with","from","that","this","into","beyond","current","find","search","prioritize","include","verify","official","new","live","task","tasks","platform","platforms","source","sources","public","data","work","jobs","job","listings","criteria","must","have","only","need","when","where","which","what","how","your","their","ours","than","each","other","funded"]);
  const tokens=(query.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g)||[]).filter((w:string)=>!stop.has(w));
  const matches=tokens.filter((w:string)=>text.includes(w));
  const core=/(crypto|usdc|usdt|bounty|bounties|freelanc|escrow|web3|blockchain|x402|payout|payrelayer|cryptotask|taskmarket|basedagents|bountybook|nadbounty|basebounty|arcbounty|gig|earn|reward|grant|airdrop|workusdc|mining|miner|hashrate|bitcoin|dogecoin|cloud|miningpool|cloudminecrypto|withdrawal|withdrawals|proof-of-work|faucet|referral)/i.test(text);
  return matches.length>=1&&core;
}
function parseSearch(html:string){
  const out:any[]=[];
  const re=/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m:any;
  while((m=re.exec(html))&&out.length<16){
    const attrs=String(m[1]+" "+m[3]);
    if(!/(?:result__a|result-link)/i.test(attrs))continue;
    let href=String(m[2]).replace(/&amp;/g,"&");
    try{
      if(href.startsWith("//"))href="https:"+href;
      const u=new URL(href);
      const redirected=u.searchParams.get("uddg");
      const url=redirected||href;
      if(!/^https?:$/i.test(new URL(url).protocol))continue;
      const title=clip(esc(String(m[4])).replace(/<[^>]+>/g," "),220);
      if(title&&!out.some(x=>x.url===url))out.push({title,url});
    }catch(_){}
  }
  return out;
}
function parseBing(html:string){
  const out:any[]=[];
  const blocks=/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let b:any;
  while((b=blocks.exec(html))&&out.length<16){
    const a=/<h2[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(b[1]);
    if(!a)continue;
    const href=String(a[1]).replace(/&amp;/g,"&");
    try{
      const u=new URL(href);
      if(!/^https?:$/i.test(u.protocol))continue;
      const title=clip(esc(String(a[2])).replace(/<[^>]+>/g," "),220);
      if(title&&!out.some(x=>x.url===href))out.push({title,url:href});
    }catch(_){}
  }
  return out;
}
async function discoverSearchResults(query:string){
  const ddg=await searchDuckDuckGo(query);
  const first=ddg.ok?parseSearch(ddg.html).filter((x:any)=>isRelevantSearchResult(x,query)):[];
  if(first.length)return {candidates:first.slice(0,8),engine:"duckduckgo",ddg_status:ddg.status,bing_status:null};
  const bing=await searchBing(query);
  const second=bing.ok?parseBing(bing.html).filter((x:any)=>isRelevantSearchResult(x,query)):[];
  return {candidates:second.slice(0,8),engine:second.length?"bing":"none",ddg_status:ddg.status,bing_status:bing.status};
}
function isProbablyPublicUrl(raw:string){
  try{
    const u = new URL(raw);
    if(!/^https?:$/i.test(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    if(h==="localhost" || h==="127.0.0.1" || h==="0.0.0.0" || h.endsWith(".local")) return false;
    if(h.startsWith("10.") || h.startsWith("192.168.") || h.startsWith("169.254.")) return false;
    return true;
  }catch(_){ return false; }
}

async function fetchSource(s:any){
  const started = Date.now();
  try{
    if(!isProbablyPublicUrl(s.url)) return {...s,fetched_ok:false,error:"blocked_url"};
    const r = await fetch(s.url, {
      redirect:"follow",
      signal:AbortSignal.timeout(10000),
      headers: {"user-agent":"MIDAD-Research-Center/1.0","accept":"text/html,application/xhtml+xml,application/json,text/plain"}
    });
    const ct = r.headers.get("content-type") || "";
    if(/application\/pdf/i.test(ct)) return {...s,fetched_ok:false,status_code:r.status,content_type:ct,error:"pdf_requires_document_parser"};
    const raw = await r.text();
    return {...s,fetched_ok:r.ok,status_code:r.status,content_type:ct,content:textFromHtml(raw),fetch_ms:Date.now()-started};
  }catch(e){
    return {...s,fetched_ok:false,error:clip(e,300),fetch_ms:Date.now()-started};
  }
}

async function groundedSynthesis(admin:any, query:string, sources:any[], language:string){
  const url = Deno.env.get("SUPABASE_URL") || "";
  const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ik = Deno.env.get("MIDAD_INGEST_KEY") || "";
  if(!url || !sk || !ik) return {ok:false,error:"ai_router_not_configured",answer:""};
  const sourcePacket = sources.filter(s=>s.fetched_ok && s.content).map((s:any,i:number)=>
    "[S"+(i+1)+"] "+s.title+"\nURL: "+s.url+"\nCONTENT: "+clip(s.content,5200)
  ).join("\n\n");
  const prompt =
    "أنت MIDAD Research Center، طبقة بحث موثقة وليست دردشة عامة. " +
    "أجب باللغة "+(language==="ar"?"العربية":"English")+". " +
    "اعتمد فقط على المواد المصدرية التالية، ولا تختلق حقائق أو أرقامًا. " +
    "لكل ادعاء مهم ضع مرجعًا بصيغة [S1] أو [S2]. " +
    "فرّق بوضوح بين ما هو موثق وما هو استنتاج. في النهاية أضف قسمًا بعنوان 'المصادر' مع الروابط.\n\n" +
    "سؤال البحث: "+query+"\n\n"+sourcePacket;
  const r = await fetch(url+"/functions/v1/midad_control_room", {
    method:"POST",
    headers:{
      "content-type":"application/json",
      "authorization":"Bearer "+sk,
      "x-midad-ingest-key":ik
    },
    body:JSON.stringify({action:"ai_assist",prompt,ai_mode:"research_center"})
  });
  const t = await r.text();
  let j:any={};
  try{ j=JSON.parse(t) }catch{ j={raw:t} }
  if(!r.ok || j?.ok===false) return {ok:false,error:j?.error||j?.message||("AI HTTP "+r.status),answer:""};
  return {ok:true,answer:j?.answer||j?.final||j?.message||""};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:H});
  if(req.method!=="POST") return json({ok:true,service:"midad_research_center",version:32});
  try{
    const supplied=req.headers.get("x-midad-ingest-key")||"";
    const suppliedAutonomy=req.headers.get("x-midad-autonomy-key")||"";
    const configured=Deno.env.get("MIDAD_INGEST_KEY")||"";
    const autonomy=Deno.env.get("MIDAD_AUTONOMY_KEY")||"";
    const auth=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");
    const sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    let vaultAutonomy="";
    try{const v=await createClient(Deno.env.get("SUPABASE_URL")!,sk).rpc("midad_get_autonomy_key");vaultAutonomy=typeof v?.data==="string"?v.data:"";}catch(_){}
    const keyOk=(configured&&supplied===configured)||(autonomy&&suppliedAutonomy===autonomy)||(vaultAutonomy&&suppliedAutonomy===vaultAutonomy)||(auth===sk);
    if(!keyOk) return json({ok:false,error:"forbidden"},403);

    const body=await req.json().catch(()=>({}));
    const query=clip(body?.query,500);
    const language=String(body?.language||"ar").toLowerCase().startsWith("en")?"en":"ar";
    if(!query) return json({ok:false,error:"query_required"},400);

    const admin=createClient(Deno.env.get("SUPABASE_URL")!,sk);
    const {data:run,error:runError}=await admin.from("midad_research_runs")
      .insert({query,language,status:"running",started_at:new Date().toISOString()})
      .select("id").single();
    if(runError) return json({ok:false,error:runError.message},500);

    const directUrls=Array.isArray(body?.urls)?body.urls.filter((u:any)=>typeof u==="string").slice(0,8):[];
    let searchDiagnostics:any=null;
    let candidates=directUrls.map((url:string,i:number)=>({rank:i+1,title:"Direct source",url}));
    if(!candidates.length){
      const searched=await discoverSearchResults(query);
      searchDiagnostics={engine:searched.engine,duckduckgo_http_status:searched.ddg_status,bing_http_status:searched.bing_status};
      candidates=searched.candidates.map((x:any,i:number)=>({...x,rank:i+1}));
      if(!candidates.length){
        await admin.from("midad_research_runs").update({
          status:"failed",source_count:0,finding_count:0,answer:null,
          methodology:"Search discovery failed closed: no parseable public results from primary or fallback search engines.",
          metadata:{usable_sources:0,query_mode:"web_search",search:searchDiagnostics},
          error:"search_no_parseable_results",completed_at:new Date().toISOString(),updated_at:new Date().toISOString()
        }).eq("id",run.id);
        return json({ok:false,run_id:run.id,error:"search_no_parseable_results",search:searchDiagnostics},502);
      }
    }

    const fetched:any[]=[];
    for(const c of candidates.slice(0,4)){
      const item=await fetchSource(c);
      fetched.push(item);
      await admin.from("midad_research_sources").insert({
        run_id:run.id,rank:c.rank||0,title:item.title,url:item.url,
        domain:(()=>{try{return new URL(item.url).hostname}catch(_){return null}})(),
        snippet:item.snippet||null,content:item.content||null,
        content_type:item.content_type||null,fetched_ok:!!item.fetched_ok,
        fetched_at:new Date().toISOString(),status_code:item.status_code||null,
        error:item.error||null,metadata:{fetch_ms:item.fetch_ms||null}
      });
    }

    const usable=fetched.filter(x=>x.fetched_ok && x.content);
    const synthesize=body?.synthesize!==false;
    const ai=synthesize?await groundedSynthesis(admin,query,usable,language):{ok:true,answer:"Synthesis skipped by zero-cost research policy; public source evidence captured.",error:null};
    const citations=fetched.map((s:any,i:number)=>({key:"S"+(i+1),title:s.title||"",url:s.url,domain:s.domain||null,fetched_ok:!!s.fetched_ok,status_code:s.status_code||null}));
    const answer=ai.answer || (
      "تعذر توليد الخلاصة الآلية، لكن تم جمع المصادر. راجع الروابط الموثقة أدناه."
    );
    await admin.from("midad_research_findings").insert(
      usable.slice(0,8).map((s:any,i:number)=>({
        run_id:run.id,
        claim:"مصدر بحث تم جلبه وتحليله ضمن الحزمة البحثية.",
        support:clip(s.content,1000),
        confidence:s.fetched_ok?0.75:0.2,
        citation_key:"S"+(i+1)
      }))
    );
    await admin.from("midad_research_runs").update({
      status:ai.ok?"completed":"failed",
      source_count:fetched.length,
      finding_count:usable.length,
      answer,
      methodology:synthesize?"Search discovery + source retrieval + grounded synthesis. Sources are preserved with URLs and fetch status.":"Search discovery + source retrieval only; model synthesis intentionally skipped to preserve zero-cost operation.",
      citations,
      metadata:{usable_sources:usable.length,query_mode:directUrls.length?"direct_urls":"web_search",search:searchDiagnostics,synthesis_enabled:synthesize,synthesis_skipped:!synthesize},
      error:ai.ok?null:ai.error,
      completed_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",run.id);

    return json({
      ok:true,run_id:run.id,query,language,search:searchDiagnostics,synthesis:{enabled:synthesize,skipped:!synthesize},
      sources:citations,
      answer:clip(answer,12000),
      stats:{discovered:fetched.length,usable:usable.length}
    });
  }catch(e){
    return json({ok:false,error:clip(e,500)},500);
  }
});
