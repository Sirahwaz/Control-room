(()=>{"use strict";
const API="https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_iaitrader_station";
const VERSION="20261004";
const TG=()=>window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;
const S={view:"command",initData:"",data:null,result:null,busy:false,error:"",edge:"CHECKING",edgeMs:null,transport:"IDLE",lastAction:"",prepared:null};
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=v=>String(v??"").replace(/[&<>"]/g,m=>m==="&"?"&amp;":m==="<"?"&lt;":m===">"?"&gt;":"&quot;");
const num=(v,d=2)=>v==null||v===""||!Number.isFinite(Number(v))?"—":Number(v).toLocaleString("en-US",{maximumFractionDigits:d});
const pct=v=>v==null||!Number.isFinite(Number(v))?"—":(Number(v)*100).toFixed(1)+"%";
const money=v=>v==null||!Number.isFinite(Number(v))?"—":"$"+Number(v).toFixed(2);
const st=v=>{const s=String(v||"PENDING").toUpperCase(),c=["VERIFIED","ACTIVE","READY","CONNECTED","PAPER","OBSERVE"].includes(s)?"ok":["FAILED","BLOCKED","LOCKED","ERROR"].includes(s)?"bad":"warn";return '<span class="iat-badge '+c+'">'+esc(s)+"</span>"};
const ft=v=>{if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString("ar-EG",{hour12:false,day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})};
function haptic(x="light"){try{TG()?.HapticFeedback?.impactOccurred(x)}catch{}}
function toast(m,c="info"){const d=document.createElement("div");d.className="iat-toast "+c;d.innerHTML=m;document.body.appendChild(d);setTimeout(()=>d.remove(),3200)}
function timer(ms){const c=new AbortController(),t=setTimeout(()=>c.abort(new DOMException("timeout","TimeoutError")),ms);return{signal:c.signal,clear:()=>clearTimeout(t)}}
async function parse(r){const t=await r.text();let j={};try{j=t?JSON.parse(t):{}}catch{j={raw:t}}return{r,j}}
async function postForm(body){const p=new URLSearchParams();Object.entries(body).forEach(([k,v])=>p.set(k,typeof v==="string"?v:JSON.stringify(v)));const z=timer(30000);try{return await fetch(API,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","accept":"application/json"},body:p.toString(),cache:"no-store",mode:"cors",signal:z.signal})}finally{z.clear()}}
async function postText(body){const z=timer(30000);try{return await fetch(API,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8","accept":"application/json"},body:JSON.stringify(body),cache:"no-store",mode:"cors",signal:z.signal})}finally{z.clear()}}
async function call(action,extra={}){
 if(!S.initData)throw new Error("TELEGRAM_SESSION_MISSING");
 const body={telegram_init_data:S.initData,action,...extra},started=performance.now();S.transport="POST / FORM";
 let r;
 try{try{r=await postForm(body)}catch(e){if(!/fetch|network|Failed/i.test(String(e?.message||e))&&e?.name!=="TypeError")throw e;S.transport="POST / TEXT";r=await postText(body)}
  const q=await parse(r);S.edgeMs=Math.round(performance.now()-started);
  if(!r.ok||q.j?.ok===false)throw new Error(String(q.j?.error||q.j?.reason||"HTTP_"+r.status));
  S.error="";return q.j;
 }catch(e){if(e?.name==="AbortError"||e?.name==="TimeoutError")throw new Error("STATION_TIMEOUT");throw e}
}
async function probe(){
 const z=timer(12000),started=performance.now();
 try{const r=await fetch(API,{method:"GET",headers:{accept:"application/json"},mode:"cors",cache:"no-store",signal:z.signal});const j=await r.json().catch(()=>({}));S.edgeMs=Math.round(performance.now()-started);S.edge=r.ok&&j?.ok?"VERIFIED":"FAILED";return j}catch{S.edge="BLOCKED";return null}finally{z.clear()}
}
async function refresh(){
 if(S.busy)return;S.busy=true;S.lastAction="overview";render();
 try{S.data=await call("overview");S.error=""}catch(e){S.error=String(e.message||e);toast("تعذر الاتصال بالمحطة: "+esc(S.error),"bad")}finally{S.busy=false;render()}
}
async function analyze(mode="analyze"){
 if(S.busy)return;S.busy=true;S.lastAction=mode;render();
 try{S.result=await call(mode);S.data=await call("overview");S.error="";haptic("medium");toast(mode==="paper"?"تم تحديث Paper Lab":"تم تشغيل Intelligence Cycle","ok")}catch(e){S.error=String(e.message||e);toast("فشل التحليل: "+esc(S.error),"bad")}finally{S.busy=false;render()}
}
async function lockGovernor(){
 if(S.busy)return;S.busy=true;render();
 try{const j=await call("lock");S.data=await call("overview");toast(j?.ok?"🔒 Kill Switch مفعل — Paper Mode":"تعذر القفل",j?.ok?"ok":"bad");haptic("medium")}catch(e){toast("تعذر القفل: "+esc(e.message),"bad")}finally{S.busy=false;render()}
}
async function prepare(){
 const market=($("#iat-pm")?.value||"BTCUSDT").trim().toUpperCase(),provider=($("#iat-pp")?.value||"coinex").trim().toLowerCase(),side=($("#iat-ps")?.value||"watch").trim().toLowerCase(),amount=Number($("#iat-pa")?.value||1);
 if(!Number.isFinite(amount)||amount<=0)return;
 try{const j=await call("prepare",{market,provider,side,amount});S.prepared=j;$("#iat-forge-out").innerHTML='<div class="iat-result ok"><b>INTENT READY</b><p>تم إنشاء مرشح تحضيري فقط.</p><pre>'+esc(JSON.stringify(j.result||j,null,2))+'</pre><small>لا live order. يتطلب Policy + Human Approval + Provider Verification.</small></div>';haptic("light")}
 catch(e){$("#iat-forge-out").innerHTML='<div class="iat-result bad"><b>BLOCKED</b><p>'+esc(e.message||e)+'</p></div>'}
}
function openForge(){
 document.querySelector("#iat-forge")?.remove();
 document.body.insertAdjacentHTML("beforeend",'<div id="iat-forge" class="iat-modal"><section class="iat-forge-panel"><div class="iat-modal-head"><div><span class="iat-eyebrow">PAPER INTENT FORGE / NO LIVE ORDER</span><h2>صياغة مرشح تداول</h2></div><button class="iat-icon" data-cmd="close">×</button></div><div class="iat-form-grid"><label>السوق<input id="iat-pm" value="BTCUSDT"></label><label>المزوّد<select id="iat-pp"><option value="coinex">CoinEx</option><option value="weex">WEEX</option><option value="ourbit">Ourbit</option></select></label><label>الاتجاه<select id="iat-ps"><option value="watch">مراقبة</option><option value="buy">شراء</option><option value="sell">بيع</option></select></label><label>القيمة USD<input id="iat-pa" type="number" value="1" min="0.01" step="0.01"></label></div><div class="iat-gates"><span>paper-only</span><span>fee-check</span><span>min-order-check</span><span>human-approval</span></div><button class="iat-btn primary wide" data-cmd="prepare">🧠 ولّد intent آمن</button><div id="iat-forge-out"><div class="iat-result"><b>READY</b><p>لن يتم إرسال أمر حي.</p></div></div></section></div>');
 $("#iat-forge").addEventListener("click",e=>{if(e.target.id==="iat-forge")e.currentTarget.remove()})
}
function latest(){const sig=S.result?.signal||S.data?.signals?.[0]?.payload||{},features=S.result?.features||sig,ev=S.result?.evidence||{};return{sig,features,ev}}
function shell(){
 const html=[];
 html.push('<div id="iat3"><header class="iat-top"><div class="iat-brand"><div class="iat-orb"><b>₿</b><i></i></div><div><strong>iAiTrader</strong><small>MIDAD / FINANCIAL INTELLIGENCE</small></div></div><div class="iat-top-right">');
 html.push('<span class="iat-chip"><i class="'+(S.initData?"good":"warn")+'"></i>'+(S.initData?"TELEGRAM":"NO SESSION")+'</span>');
 html.push('<span class="iat-chip">'+st(S.edge)+'</span>');
 html.push('<span class="iat-chip">'+st(S.data?.governor?.kill_switch?"LOCKED":"CHECKING")+'</span>');
 html.push('<button class="iat-icon" data-cmd="refresh">↻</button></div></header><main id="iat-main"></main>');
 html.push('<nav class="iat-nav"><button data-view="command">◉<small>المقود</small></button><button data-view="evidence">⌁<small>الأدلة</small></button>');
 html.push('<button data-view="lattice">◇<small>الشبكة</small></button><button data-view="risk">⛨<small>المخاطر</small></button><button data-view="lab">▦<small>Lab</small></button></nav></div>');
 $("#app").innerHTML=html.join("");
}
function command(){
 const g=S.data?.governor||{},p=S.data?.paper_trades||{},led=S.data?.decision_ledger||[],x=latest(),s=x.sig,f=x.features,open=(S.data?.paper_trades||[]).filter(a=>["open","review"].includes(String(a.status))).length,lanes=f.strategy_lanes||[];
 return '<div class="iat-page"><section class="iat-hero"><div class="iat-scan"></div><div><span class="iat-eyebrow">MYSUN / LOOP + TRADE · COMMAND SURFACE</span><h1>MARKET<br><em>INTELLIGENCE</em></h1><p class="iat-lead">Evidence → Signal → Risk Gate → Paper Learning. iAiTrader لا ينسخ السوق؛ بل يبني قراءة مستقلة من مصادر متعددة ويترك التنفيذ المالي خلف Human Gate.</p><div class="iat-mission"><span>INTELLIGENCE</span><b>→</b><span>OPPORTUNITY</span><b>→</b><span>ACTION</span><b>→</b><span>DELIVERY</span><b>→</b><span>PAYMENT</span><b>→</b><span>LEARNING</span></div><div class="iat-actions"><button class="iat-btn primary" data-cmd="analyze">'+(S.busy?"⟳ جارٍ التحليل":"🧠 حلّل الآن")+'</button><button class="iat-btn ghost" data-cmd="paper">▣ Paper Cycle</button><button class="iat-btn danger" data-cmd="lock">🔒 Lock</button></div></div><div class="iat-core"><i class="c1"></i><i class="c2"></i><i class="c3"></i><div class="cc"><b>AI</b><small>'+esc(g.mode||"PAPER")+'</small></div><span class="p1">MKT</span><span class="p2">RISK</span><span class="p3">OSINT</span><span class="p4">LAB</span></div></section><section class="iat-kpis"><article><span>SIGNAL</span><b>'+esc(s.direction||"NEUTRAL")+'</b><small>'+pct(s.confidence)+'</small></article><article><span>VENUES</span><b>'+n(f.usable_sources,0)+'</b><small>usable sources</small></article><article><span>PAPER OPEN</span><b>'+open+'</b><small>review queue</small></article><article><span>MIN EDGE</span><b>'+(g.min_expected_net_edge_pct==null?"—":n(g.min_expected_net_edge_pct)+"%")+'</b><small>governor</small></article><article><span>ORDER CAP</span><b>'+money(g.max_order_usd)+'</b><small>spot-only</small></article><article><span>LIVE</span><b class="accent">'+(g.kill_switch?"LOCKED":"GATED")+'</b><small>human approval</small></article></section><section class="iat-cols"><div class="iat-panel"><div class="iat-head"><div><span class="iat-eyebrow">EVIDENCE → SIGNAL</span><h2>حالة السوق</h2></div>'+st(s.direction)+'</div><div class="iat-price"><b>'+esc(s.price??"—")+'</b><span>BTCUSDT</span></div><div class="iat-facts"><div><span>REGIME</span><b>'+esc(f.regime||"—")+'</b></div><div><span>AGREEMENT</span><b>'+esc(f.agreement??"—")+'</b></div><div><span>AVG 24H</span><b>'+ (f.avg_change_24h_pct==null?"—":n(f.avg_change_24h_pct)+"%")+'</b></div><div><span>SPREAD</span><b>'+ (f.max_spread_pct==null?"—":n(f.max_spread_pct,4)+"%")+'</b></div></div><div class="iat-state-row"><span>'+st("VERIFIED")+' market evidence</span><span>'+st(f.mining_state||"PENDING")+' mining modifier</span></div></div><div class="iat-panel"><div class="iat-head"><div><span class="iat-eyebrow">RISK GOVERNOR</span><h2>قلعة رأس المال</h2></div>'+st(g.kill_switch?"LOCKED":"READY")+'</div><div class="iat-facts"><div><span>DAILY LOSS</span><b>'+money(g.max_daily_loss_usd)+'</b></div><div><span>DAILY TRADES</span><b>'+n(g.max_daily_trades,0)+'</b></div><div><span>CONFIDENCE FLOOR</span><b>'+pct(g.min_signal_confidence)+'</b></div><div><span>PRINCIPAL FLOOR</span><b>'+money(g.principal_floor_usd)+'</b></div></div><p class="iat-note">القفل الحالي حماية مالية مقصودة، وليس عطلًا. الانتقال الحي لا يظهر كزر عادي؛ يحتاج Policy + Human Approval + Provider Verification.</p><button class="iat-btn outline wide" data-cmd="lock">فرض القفل والتحقق</button></div></section><section class="iat-panel"><div class="iat-head"><div><span class="iat-eyebrow">MIDAD NEURAL MESH</span><h2>الأنظمة المرتبطة</h2></div><span class="iat-badge cyan">CONNECTED FABRIC</span></div><div class="iat-modules"><article><b>◈</b><strong>Non-Copy Engine</strong><small>'+st("ACTIVE")+' multi-venue reasoning</small></article><article><b>◈</b><strong>Paper Evaluator</strong><small>'+st("ACTIVE")+' outcome measurement</small></article><article><b>◈</b><strong>Model Gateway</strong><small>'+st("ACTIVE")+' provider abstraction</small></article><article><b>◈</b><strong>OSINT Router</strong><small>'+st("ACTIVE")+' evidence expansion</small></article><article><b>◈</b><strong>Learning Engine</strong><small>'+st("ACTIVE")+' feedback loop</small></article><article><b>⛨</b><strong>Defensive Security</strong><small>'+st("PENDING")+' IOC / IOA / anti-phishing plane</small></article></div></section><section class="iat-panel"><div class="iat-head"><div><span class="iat-eyebrow">STRATEGY LATTICE</span><h2>شبكة المسارات</h2></div><button class="iat-btn mini" data-view="lattice">استكشف →</button></div><div class="iat-lanes">'+((lanes.length?lanes:[{id:"momentum_consensus",state:"PENDING",direction:"NEUTRAL",score:0,reason:"شغّل دورة التحليل"}]).slice(0,6).map((a,i)=>'<button class="iat-lane" data-view="lattice"><span class="no">0'+(i+1)+'</span><span><b>'+esc(String(a.id).replace(/_/g," "))+'</b><small>'+esc(a.reason||"independent lane")+'</small></span><strong>'+n(a.score,3)+'</strong>'+st(a.state)+'</button>').join(""))+'</div></section><section class="iat-security"><div><span class="iat-eyebrow">DEFENSIVE SECURITY PLANE</span><h2>الأمن كطبقة إدراك</h2><p>نضم مراقبة attack-surface، anti-phishing، IOC/IOA، anomaly detection، connector integrity وOSINT إلى المحطة. الاستخدام المقصود هنا دفاعي ومصرّح به.</p></div><div class="iat-sec-tags"><span>ANTI-PHISHING</span><span>IOC / IOA</span><span>ANOMALY</span><span>INTEGRITY</span><span>OSINT</span></div></section><section class="iat-cols"><div class="iat-panel"><div class="iat-head"><div><span class="iat-eyebrow">DECISION LEDGER</span><h2>آخر القرارات</h2></div></div><div class="iat-ledger">'+led.slice(0,5).map(a=>'<article>'+st(a.outcome_status||"pending")+'<b>'+esc(a.subject_key||"BTCUSDT")+'</b><strong>'+esc(a.decision||"—")+'</strong><small>'+esc(a.reason_code||"—")+' · '+ft(a.created_at)+'</small></article>').join("")+'</div></div><div class="iat-panel forge"><span class="iat-eyebrow">PAPER INTENT FORGE</span><h2>حوّل الفكرة إلى تجربة</h2><p>أنشئ intent صغيرًا، افحص الرسوم والحدود، واترك التنفيذ المالي خلف البوابات المقصودة.</p><button class="iat-btn primary wide" data-cmd="forge">فتح Forge</button></div></section></div>'
}
function evidence(){
 const x=latest(),f=x.features,s=x.sig,e=x.ev,src=e.market_sources||[],c=S.data?.connectors||[];
 return '<div class="iat-page"><section class="iat-title"><span class="iat-eyebrow">EVIDENCE ROOM</span><h1>غرفة الأدلة</h1><p>FACT → INFERRED → PENDING → BLOCKED. كل حالة لها حدود واضحة.</p></section><section class="iat-egrid"><article class="fact"><span>FACT</span><b>'+esc(f.usable_sources??"—")+'</b><small>مصادر سوق قابلة للاستخدام</small></article><article class="infer"><span>INFERRED</span><b>'+esc(s.direction||"NEUTRAL")+'</b><small>منطق non-copy consensus</small></article><article class="pending"><span>PENDING</span><b>'+esc(f.mining_state||"PENDING")+'</b><small>ViaBTC modifier</small></article><article class="blocked"><span>BLOCKED</span><b>LIVE</b><small>financial execution</small></article></section><section class="iat-cols"><div class="iat-panel"><div class="iat-head"><div><span class="iat-eyebrow">MARKET SOURCES</span><h2>المصادر المستقلة</h2></div></div><div class="iat-source-list">'+(src.length?src.map(a=>'<article><b>'+esc(a.source||"source")+'</b><span>'+esc(a.symbol||"BTCUSDT")+'</span><strong>'+esc(a.price??"—")+'</strong><small>'+ (a.change_24h_pct==null?"—":n(a.change_24h_pct,3)+"%")+'</small></article>').join(""):'<div class="iat-empty">بعد دورة تحليل جديدة ستظهر snapshots هنا.</div>')+'</div></div><div class="iat-panel"><div class="iat-head"><div><span class="iat-eyebrow">CONNECTOR FABRIC</span><h2>موصلات الأموال</h2></div></div><div class="iat-source-list">'+c.slice(0,8).map(a=>'<article><b>'+esc(a.label||a.provider||"connector")+'</b><span>'+esc(a.mode||"—")+'</span>'+st(a.status||"planned")+'<small>'+esc(a.provider||"—")+'</small></article>').join("")+'</div></div></section><section class="iat-panel"><b>قاعدة MIDAD:</b> الإشارة بدون evidence ليست intelligence مكتملة.</section></div>'
}
function lattice(){
 const f=latest().features,lanes=f.strategy_lanes||[{id:"momentum_consensus",direction:"NEUTRAL",score:0,state:"PENDING",reason:"شغّل التحليل"},{id:"cross_venue_dislocation",direction:"NEUTRAL",score:0,state:"PENDING",reason:"شغّل التحليل"},{id:"mining_stress_modifier",direction:"NEUTRAL",score:0,state:"PENDING",reason:"ViaBTC context"},{id:"regime_filter",direction:"NEUTRAL",score:0,state:"PENDING",reason:"Regime classifier"}];
 return '<div class="iat-page"><section class="iat-title"><span class="iat-eyebrow">STRATEGY LATTICE</span><h1>شبكة الاستراتيجيات</h1><p>مسارات مستقلة تتنافس على تفسير السوق؛ القرار النهائي لا يخرج من lane واحدة.</p></section><section class="iat-lattice">'+lanes.map((a,i)=>'<article><div class="top"><span>LANE 0'+(i+1)+'</span>'+st(a.state)+'</div><h2>'+esc(String(a.id).replace(/_/g," "))+'</h2><p>'+esc(a.reason||"independent lane")+'</p><div class="read"><b>'+esc(a.direction||"NEUTRAL")+'</b><strong>'+n(a.score,4)+'</strong></div><div class="meter"><i style="width:'+Math.max(3,Math.min(100,Number(a.score||0)*100))+'%"></i></div></article>').join("")+'</section><section class="iat-panel"><div class="iat-contract"><div><b>Independent</b><span>لا copy-trading.</span></div><div><b>Multi-source</b><span>لا مصدر واحد للقرار.</span></div><div><b>Counterfactual</b><span>كل قرار يقاس لاحقًا.</span></div><div><b>Learning</b><span>النتيجة تعود للمحرك.</span></div></div></section></div>'
}
function risk(){
 const g=S.data?.governor||{};
 return '<div class="iat-page"><section class="iat-title"><span class="iat-eyebrow">RISK GOVERNOR</span><h1>قلعة المخاطر</h1><p>حدود واضحة، kill switch، spot-only، ولا leverage.</p></section><section class="iat-riskhero"><div><span class="iat-eyebrow">CURRENT MODE</span><h2>'+esc(g.kill_switch?"LOCKED / PAPER":"GATED / REVIEW")+'</h2><p>Live execution remains outside the normal UI path.</p></div><div class="seal">⛨</div></section><section class="iat-kpis"><article><span>MAX ORDER</span><b>'+money(g.max_order_usd)+'</b><small>hard cap</small></article><article><span>MAX POSITION</span><b>'+money(g.max_position_usd)+'</b><small>spot-only</small></article><article><span>DAILY LOSS</span><b>'+money(g.max_daily_loss_usd)+'</b><small>loss budget</small></article><article><span>DAILY TRADES</span><b>'+n(g.max_daily_trades,0)+'</b><small>frequency cap</small></article><article><span>CONFIDENCE</span><b>'+pct(g.min_signal_confidence)+'</b><small>signal floor</small></article><article><span>NET EDGE</span><b>'+(g.min_expected_net_edge_pct==null?"—":n(g.min_expected_net_edge_pct)+"%")+'</b><small>after cost</small></article></section><section class="iat-panel"><div class="iat-policy">'+(g.require_multi_source_confirmation?"✓":"—")+'<b>Multi-source</b>'+(g.require_fee_check?"✓":"—")+'<b>Fee check</b>'+(g.require_min_order_check?"✓":"—")+'<b>Min-order check</b>'+(g.spot_only?"ON":"OFF")+'<b>Spot only</b>'+(g.leverage_allowed?"ON":"OFF")+'<b>Leverage</b></div></section><section class="iat-security"><div><span class="iat-eyebrow">KILL SWITCH</span><h2>مخرج الطوارئ</h2><p>القفل يثبت Governor على disabled + kill_switch + paper. لا يوجد هنا زر لفتح Live.</p></div><button class="iat-btn danger" data-cmd="lock">🔒 فرض القفل</button></section></div>'
}
function lab(){
 const p=S.data?.paper_trades||[];
 return '<div class="iat-page"><section class="iat-title"><span class="iat-eyebrow">PAPER LAB / LEARNING</span><h1>مختبر التجارب</h1><p>نسمح للذكاء أن يخطئ بأمان، ثم نقيس ونعلّم.</p></section><section class="iat-labbar"><div><b>'+p.length+'</b><span>candidates</span></div><div><b>'+p.filter(a=>a.status==="review").length+'</b><span>review queue</span></div><button class="iat-btn primary" data-cmd="forge">＋ intent جديد</button></section><section class="iat-paper-grid">'+(p.slice(0,12).map(a=>'<article><div class="top"><span>'+esc(a.asset_symbol||"BTC")+'</span>'+st(a.status)+'</div><h2>'+esc(a.direction||"NEUTRAL")+'</h2><div class="levels"><div><span>ENTRY</span><b>'+esc(a.entry_price??"—")+'</b></div><div><span>STOP</span><b>'+esc(a.stop_price??"—")+'</b></div><div><span>TP</span><b>'+esc(a.take_profit_price??"—")+'</b></div></div><p>'+pct(a.confidence)+' · '+esc(a.strategy||"independent_non_copy")+'</p><small>'+esc(a.gate_decision||"—")+' · '+(a.outcome_return_pct==null?"pending":n(a.outcome_return_pct,2)+"%")+'</small></article>').join("")||'<div class="iat-panel iat-empty">لا توجد Paper Trades حاليًا.</div>')+'</section></div>'
}
function sessionGate(){
 return '<section class="iat-blocked"><div class="biglock">🔐</div><span class="iat-eyebrow">SECURE TELEGRAM SESSION</span><h1>افتح iAiTrader من Telegram</h1><p>المحطة لا تقبل Access Keys أو Secrets من الواجهة. الهوية تأتي من Telegram WebApp initData وتتحقق على الخادم.</p><a class="iat-btn primary" href="https://t.me/iAiTrader_bot" target="_blank" rel="noopener">فتح @iAiTrader_bot</a><div class="iat-diag"><span>'+st(S.edge)+' Edge probe</span><span>'+st(S.transport)+' transport</span></div></section>'
}
function blockedGate(){
 return '<section class="iat-blocked"><div class="biglock">!</div><span class="iat-eyebrow">TRANSPORT DIAGNOSTIC</span><h1>Edge موجود لكن POST لم يصل</h1><p><b>'+esc(S.error)+'</b></p><div class="iat-diag-grid"><div>EDGE<strong>'+esc(S.edge)+'</strong></div><div>TRANSPORT<strong>'+esc(S.transport)+'</strong></div><div>NETWORK<strong>'+(navigator.onLine?"ONLINE":"OFFLINE")+'</strong></div><div>LATENCY<strong>'+esc(S.edgeMs??"—")+' ms</strong></div></div><div class="iat-actions"><button class="iat-btn primary" data-cmd="refresh">إعادة المحاولة</button><a class="iat-btn ghost" href="https://sirahwaz.github.io/Control-room/iaitrader.html?v='+VERSION+'" target="_blank" rel="noopener">نسخة مباشرة</a></div></section>'
}
function render(){
 shell();
 const m=$("#iat-main");
 if(!S.initData){m.innerHTML=sessionGate();return}
 if(!S.data&&S.error){m.innerHTML=blockedGate();return}
 m.innerHTML=S.view==="evidence"?evidence():S.view==="lattice"?lattice():S.view==="risk"?risk():S.view==="lab"?lab():command();
 $$(" [data-view]",document).forEach(()=>{});
 $$(".iat-nav [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===S.view));
 bind();
}
function bind(){
 $$("[data-view]").forEach(b=>b.onclick=()=>{S.view=b.dataset.view;haptic("light");render()});
 $$("[data-cmd]").forEach(b=>b.onclick=()=>{const c=b.dataset.cmd;if(c==="refresh")refresh();else if(c==="analyze")analyze("analyze");else if(c==="paper")analyze("paper");else if(c==="lock")lockGovernor();else if(c==="forge")openForge();else if(c==="close")document.querySelector("#iat-forge")?.remove();else if(c==="prepare")prepare()});
}
async function boot(){
 try{TG()?.ready();TG()?.expand();TG()?.BackButton?.hide()}catch{}
 S.initData=TG()?.initData||"";
 render();
 await probe();
 render();
 if(S.initData)await refresh();
}
boot();
})();