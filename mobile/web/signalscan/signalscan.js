const $=id=>document.getElementById(id);
const state={lang:"ar",busy:false,last:null};
const providers=[
 {id:"binance",name:"Binance",url:s=>`https://api.binance.com/api/v3/ticker/24hr?symbol=${s}`,parse:j=>({price:+j.lastPrice,change:+j.priceChangePercent,volume:+j.quoteVolume})},
 {id:"bybit",name:"Bybit",url:s=>`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${s}`,parse:j=>{const x=j?.result?.list?.[0];return x?{price:+x.lastPrice,change:+x.price24hPcnt*100,volume:+x.turnover24h}:null}},
 {id:"kucoin",name:"KuCoin",url:s=>`https://api.kucoin.com/api/v1/market/stats?symbol=${s.replace("USDT","-USDT")}`,parse:j=>{const x=j?.data;return x?{price:+x.last,change:+x.changeRate*100,volume:+x.volValue}:null}},
 {id:"coinbase",name:"Coinbase",url:s=>`https://api.exchange.coinbase.com/products/${s.replace("USDT","-USD")}/ticker`,parse:j=>j?.price?{price:+j.price,change:null,volume:+j.volume}:null}
];
const labels={
 ar:{subtitle:"فحص السوق بالأدلة — بدون بيانات وهمية.",asset:"الأصل",scan:"فحص الآن",retry:"إعادة المحاولة",ready:"جاهز للفحص",busy:"جاري فحص المصادر…",failed:"تعذر إثبات بيانات السوق",price:"السعر الموثق",notYet:"لم يتم الفحص بعد",quorum:"Provider quorum",spread:"Cross-source spread",evidence:"Evidence",providers:"مصادر البيانات",why:"لماذا هذه الإشارة؟",start:"ابدأ الفحص للحصول على FACT → INFERENCE → ACTION.",router:"ROUTER READY",updated:"آخر تحقق",noData:"لا توجد بيانات موثوقة",buy:"BUY BIAS",sell:"SELL BIAS",neutral:"NEUTRAL",fact:"FACT",inference:"INFERENCE",action:"ACTION"},
 en:{subtitle:"Evidence-based market scanning — no fake data.",asset:"Asset",scan:"Scan now",retry:"Retry",ready:"Ready",busy:"Scanning providers…",failed:"Market data could not be verified",price:"Verified price",notYet:"Not scanned yet",quorum:"Provider quorum",spread:"Cross-source spread",evidence:"Evidence",providers:"Data sources",why:"Why this signal?",start:"Run a scan for FACT → INFERENCE → ACTION.",router:"ROUTER READY",updated:"Last verified",noData:"No trusted data",stale:"Last verified data (stale)",buy:"BUY BIAS",sell:"SELL BIAS",neutral:"NEUTRAL"},
 fa:{subtitle:"اسکن بازار بر اساس شواهد — بدون داده ساختگی.",asset:"دارایی",scan:"اسکن",retry:"تلاش دوباره",ready:"آماده اسکن",busy:"در حال بررسی منابع…",failed:"داده بازار قابل تأیید نیست",price:"قیمت تأییدشده",notYet:"هنوز اسکن نشده",quorum:"تعداد منابع",spread:"اختلاف منابع",evidence:"شواهد",providers:"منابع داده",why:"چرا این سیگنال؟",start:"برای FACT → INFERENCE → ACTION اسکن کنید.",router:"ROUTER READY",updated:"آخرین تأیید",noData:"داده معتبر وجود ندارد",stale:"آخرین داده معتبر (قدیمی)",buy:"تمایل خرید",sell:"تمایل فروش",neutral:"خنثی"}
};
function t(k){return labels[state.lang][k]||labels.ar[k]||k}
function setStatus(kind,text){$("state").className="status "+kind;$("stateText").textContent=text}
async function fetchProvider(p,symbol){
 const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),6500);
 try{const res=await fetch(p.url(symbol),{signal:ctl.signal,cache:"no-store",headers:{accept:"application/json"}});if(!res.ok)throw new Error("HTTP "+res.status);const json=await res.json();const data=p.parse(json);if(!data||!Number.isFinite(data.price)||data.price<=0)throw new Error("invalid payload");return {...data,ok:true}}
 finally{clearTimeout(timer)}
}
function fmt(n){if(!Number.isFinite(n))return "—";return n>=1000?n.toLocaleString(undefined,{maximumFractionDigits:2}):n.toLocaleString(undefined,{maximumFractionDigits:6})}
function pct(n){return Number.isFinite(n)?(n>=0?"+":"")+n.toFixed(2)+"%":"—"}
function renderProviders(rows){$("providers").innerHTML=rows.map(r=>`<div class="provider"><div><strong>${r.name}</strong><small>${r.ok?"Verified response":"Unavailable / rejected"}</small></div><span class="badge ${r.ok?"ok":"fail"}>${r.ok?"OK":"FAIL"}</span></div>`).join("")}
function analyze(rows){
 const good=rows.filter(x=>x.ok);const prices=good.map(x=>x.price);const avg=prices.reduce((a,b)=>a+b,0)/prices.length;
 const spread=((Math.max(...prices)-Math.min(...prices))/avg)*100;
 const changes=good.map(x=>x.change).filter(Number.isFinite);const change=changes.length?changes.reduce((a,b)=>a+b,0)/changes.length:null;
 let signal="neutral";if(change!==null){if(change>=1)signal="buy";else if(change<=-1)signal="sell"}
 let confidence=Math.min(0.99,0.45+good.length*.12+Math.max(0,0.2-spread)/0.2*.2);
 if(good.length<2)confidence=Math.min(confidence,.55);
 return {good,avg,spread,change,signal,confidence}
}
async function scan(){
 if(state.busy)return;state.busy=true;$("scanBtn").disabled=true;$("retryBtn").classList.add("hidden");setStatus("busy",t("busy"));$("routerState").textContent="ROUTER SCANNING";
 const symbol=$("asset").value;const rows=[];
 for(const p of providers){try{const data=await fetchProvider(p,symbol);rows.push({name:p.name,...data})}catch(e){rows.push({name:p.name,ok:false,error:e.message})}}
 renderProviders(rows);const a=analyze(rows);$("evidence").textContent=a.good.length;
 if(!a.good.length){setStatus("error",t("failed"));$("price").textContent="—";$("freshness").textContent=t("noData");$("signal").textContent="BLOCKED";$("signal").className="signal sell";$("confidence").textContent="Confidence 0%";$("quorum").textContent="0/4";$("spread").textContent="—";$("change").textContent="—";$("explanationText").innerHTML="<b>FACT:</b> لم ينجح أي provider في تقديم بيانات قابلة للتحقق.<br><b>INFERENCE:</b> لا يجوز توليد إشارة.<br><b>ACTION:</b> تحقق من الاتصال أو أعد المحاولة.";state.last=null;$("retryBtn").classList.remove("hidden")}
 else{
  $("price").textContent=fmt(a.avg);$("freshness").textContent=new Date().toLocaleTimeString();$("signal").textContent=t(a.signal);$("signal").className="signal "+a.signal;$("confidence").textContent="Confidence "+Math.round(a.confidence*100)+"%";$("quorum").textContent=a.good.length+"/4";$("spread").textContent=a.spread.toFixed(3)+"%";$("change").textContent=pct(a.change);setStatus("ok",`${a.good.length}/4 providers verified`);$("routerState").textContent="ROUTER VERIFIED";
  const inference=a.signal==="buy"?"زخم إيجابي قصير الأجل":a.signal==="sell"?"زخم سلبي قصير الأجل":"لا توجد أفضلية اتجاهية قوية";
  $("explanationText").innerHTML=`<b>${t("fact")}:</b> ${a.good.length} مصادر أعادت سعرًا صالحًا، متوسط السعر ${fmt(a.avg)}، والتشتت ${a.spread.toFixed(3)}%.<br><b>${t("inference")}:</b> ${inference}.<br><b>${t("action")}:</b> تحليل فقط؛ لا يوجد تنفيذ مالي مباشر.`;state.last={symbol,...a}
 }
 state.busy=false;$("scanBtn").disabled=false;$("updated").textContent=t("updated")+" "+new Date().toLocaleTimeString()
}
function applyLang(){const l=labels[state.lang];document.documentElement.lang=state.lang;document.documentElement.dir=state.lang==="en"?"ltr":"rtl";$("subtitle").textContent=l.subtitle;$("assetLabel").textContent=l.asset;$("scanBtn").textContent=l.scan;$("retryBtn").textContent=l.retry;$("priceLabel").textContent=l.price;$("quorumLabel").textContent=l.quorum;$("spreadLabel").textContent=l.spread;$("evidenceLabel").textContent=l.evidence;$("providersTitle").textContent=l.providers;$("whyTitle").textContent=l.why;if(!state.last)$("explanationText").textContent=l.start;$("langBtn").textContent=state.lang.toUpperCase()}
$("scanBtn").addEventListener("click",scan);$("retryBtn").addEventListener("click",scan);$("asset").addEventListener("change",()=>{state.last=null;setStatus("pending",t("ready"));$("explanationText").textContent=t("start")});$("langBtn").addEventListener("click",()=>{state.lang=state.lang==="ar"?"en":state.lang==="en"?"fa":"ar";applyLang()});applyLang();setStatus("pending",t("ready"));renderProviders(providers.map(p=>({name:p.name,ok:false})));
