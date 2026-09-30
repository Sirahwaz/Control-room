(()=>{
"use strict";
window.MIDAD_COCKPIT_BOOTING=true;
const CFG={url:"https://froegigfmpmvtecztfbf.supabase.co",fn:"/functions/v1/midad_control_room",build:"cockpit-2026-09-30-emergencypp"};
const TG=()=>window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;
const S={view:"cockpit",token:"",connected:false,user:null,data:null,telegram:null,miningAccounts:[],busy:false,aiBusy:false,aiMessages:[],error:"",ugigProfile:null,ugigApps:[],ugigBusy:false,botContext:null,botStatus:null,tradeData:null,tradeBusy:false};
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=v=>String(v??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const n=v=>v==null?"—":Number(v).toLocaleString("en-US",{maximumFractionDigits:2});
const usd=v=>v==null?"—":"$"+Number(v||0).toLocaleString("en-US",{maximumFractionDigits:2});
function toast(m,type="ok"){const b=$("#crToast");if(!b)return;const d=document.createElement("div");d.className="toast "+type;d.textContent=m;b.appendChild(d);setTimeout(()=>d.remove(),4200)}
function savedKey(){try{return sessionStorage.getItem("midad_cockpit_key")||""}catch{return""}}
function saveKey(v){try{sessionStorage.setItem("midad_cockpit_key",v)}catch{}}
async function post(body,timeout=20000){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
 try{const r=await fetch(CFG.url+CFG.fn,{method:"POST",headers:{"content-type":"application/json","x-midad-client":"midad-cockpit","x-midad-request-id":"cr-"+Date.now().toString(36)},body:JSON.stringify(body),signal:c.signal});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||j.error||j.ok===false)throw new Error(j.error||j.message||("HTTP "+r.status));
 return j;
 }finally{clearTimeout(t)}
}
async function authenticate(){
 if(S.token)return S.token;
 const t=TG(),init=t&&t.initData||"",key=savedKey();
 if(!init&&!key)throw new Error("telegram_context_required");
 const j=init?await post({telegram_init_data:init,client:"midad-cockpit",client_version:CFG.build}):await post({access_key:key,client:"midad-cockpit",client_version:CFG.build});
 if(!j.token)throw new Error("session_token_missing");
 S.token=j.token;S.connected=true;S.user={telegram_user_id:j.telegram_user_id||null};return j.token;
}
async function api(action,extra={},retry=true,timeout=30000){
 try{await authenticate();return await post({action,operation:action,token:S.token,client:"midad-cockpit",client_version:CFG.build,...extra},timeout)}
 catch(e){if(retry&&/session_expired|missing_session/.test(String(e.message))){S.token="";return api(action,extra,false,timeout)}throw e}
}
async function refresh(silent=false){
 try{const j=await api("dashboard",{},true,45000);S.data=j;try{S.botStatus=await api("bot_fabric_status",{},true,20000)}catch{S.botStatus=null}S.connected=true;S.error="";render();if(!silent)toast("تم تحديث النواة.","ok");return j}
 catch(e){S.connected=false;S.error=String(e.message||e);render();if(!silent)toast("فشل الاتصال: "+S.error,"bad")}
}
function H(){return S.data?.health||{}}
function tasks(){return (S.data?.human_tasks||[]).filter(x=>["OPEN","ACKNOWLEDGED"].includes(String(x.status||"").toUpperCase()))}
function apps(){return S.data?.approvals||[]}
function opps(){return (S.data?.opportunities||[]).slice().sort((a,b)=>Number(b.score||0)-Number(a.score||0))}
function moneyOpps(){return (S.data?.money_opportunities||[]).slice().sort((a,b)=>Number(b.score||0)-Number(a.score||0))}
function blueprints(){return (S.data?.income_blueprints||[]).slice().sort((a,b)=>Number(b.estimated_net_usd||0)-Number(a.estimated_net_usd||0))}
function sigs(){return S.data?.signals||[]}
function pipeline(){const v=H().money_expected_value;return v==null?moneyOpps().reduce((s,o)=>s+Number(o.expected_value||0),0):Number(v)}
function nav(id,icon,label){return '<button data-view="'+id+'"><b>'+icon+'</b><span>'+label+'</span></button>'}
function getBotContext(){try{return new URL(location.href).searchParams.get("bot")||null}catch{return null}}
function setBotContext(bot,view){try{const u=new URL(location.href);if(bot)u.searchParams.set("bot",bot);else u.searchParams.delete("bot");u.searchParams.set("view",view||"cockpit");u.searchParams.set("v","20260930emergencypp2");history.replaceState({}, "", u.toString())}catch{}S.botContext=bot;S.view=view||"cockpit";S.tradeData=null;render()}
function tradeLaneRows(lanes){
 return (lanes||[]).map((x,i)=>{
   const id=esc(String(x.id||("lane_"+i)));
   const state=String(x.state||"PENDING");
   const cls=state==="VERIFIED"?"green":state==="BLOCKED"||state==="FAILED"?"red":"amber";
   return '<button class="trade-lane" data-trade-lane="'+id+'"><div><b>'+esc(String(x.id||"lane").replace(/_/g," ").toUpperCase())+'</b><small>'+esc(x.reason||"لا يوجد تفسير محفوظ.")+'</small></div><span class="badge '+cls+'">'+esc(state)+'</span><strong>'+esc(x.direction||"NEUTRAL")+'</strong><em>'+Math.round(Number(x.score||0)*100)+'%</em><span class="trade-lane-more">↗</span></button>';
 }).join("")||'<div class="empty">لم تصل بيانات المسارات بعد.</div>';
}
function showTradeLane(id){
 const lanes=S.tradeData?.features?.strategy_lanes||S.tradeData?.evidence?.strategy_lanes||[];
 const x=lanes.find(v=>String(v.id)===String(id));
 if(!x)return;
 const old=$("#tradeLaneModal");if(old)old.remove();
 const ev=x.evidence||x.sources||x.market_evidence||{};
 const blockers=x.blockers||x.blocks||[];
 const evidenceText=typeof ev==="string"?ev:JSON.stringify(ev,null,2);
 const blockerHtml=Array.isArray(blockers)?(blockers.map(v=>'<span class="badge amber">'+esc(typeof v==="string"?v:JSON.stringify(v))+'</span>').join("")||'<span class="badge green">لا عوائق معلنة</span>'):'<span class="badge amber">'+esc(String(blockers))+'</span>';
 const html='<div id="tradeLaneModal" class="context-modal"><div class="panel context-modal-panel"><div class="panel-head"><div><div class="eyebrow">TRADE MATRIX / LANE DETAIL</div><h3>'+esc(String(x.id||"LANE").replace(/_/g," ").toUpperCase())+'</h3><small>هذه نافذة تفسير للمسار فقط؛ لا تنفذ أي أمر حي.</small></div><button class="btn" data-cmd="closeTradeLane">إغلاق</button></div><div class="kpis"><div class="kpi"><span>STATE</span><b style="font-size:18px">'+esc(x.state||"PENDING")+'</b></div><div class="kpi"><span>DIRECTION</span><b style="font-size:18px">'+esc(x.direction||"NEUTRAL")+'</b></div><div class="kpi"><span>SCORE</span><b>'+Math.round(Number(x.score||0)*100)+'%</b></div><div class="kpi"><span>METHOD</span><b style="font-size:14px">'+esc(x.method||x.strategy||"independent")+'</b></div></div><section class="panel section-gap"><div class="eyebrow">WHY</div><p class="lane-detail-text">'+esc(x.reason||"لا يوجد تفسير محفوظ.")+'</p></section><section class="panel section-gap"><div class="panel-head"><div><div class="eyebrow">EVIDENCE</div><h3>ما الذي بُني عليه المسار؟</h3></div></div><pre class="lane-evidence">'+esc(evidenceText||"{}")+'</pre></section><section class="panel section-gap"><div class="panel-head"><div><div class="eyebrow">BLOCKERS</div><h3>ما الذي يمنعه؟</h3></div></div><div class="trade-blocks">'+blockerHtml+'</div></section></div></div>';
 document.body.insertAdjacentHTML("beforeend",html);
 const m=$("#tradeLaneModal");const b=m.querySelector('[data-cmd="closeTradeLane"]');if(b)b.onclick=()=>m.remove();
}
async function runTradingLab(){
 if(S.tradeBusy)return;
 S.tradeBusy=true;render();
 try{
   const j=await api("noncopy_trade",{mode:"run"},true,60000);
   S.tradeData=j;
   if(!j?.ok)throw new Error(j?.error||"trade_engine_failed");
   toast("تم تحديث Trading Lab بالأدلة الحالية.","ok");
 }catch(e){
   S.tradeData={ok:false,error:String(e?.message||e)};
   toast("Trading Lab: "+(e?.message||e),"bad");
 }finally{S.tradeBusy=false;render()}
}
function tradingView(){
 const j=S.tradeData||{},s=j.signal||{},r=j.risk||{},e=j.evidence||{},lanes=j.features?.strategy_lanes||e.strategy_lanes||[],sources=e.market_sources||[],blocks=e.source_errors||j.source_errors||[],m=j.mining||{};
 const fused=(j.features?.fusion||j.fusion||j.aggregator||{});
 const active=lanes.filter(x=>["VERIFIED","ACTIVE"].includes(String(x.state||"").toUpperCase())).length;
 const last=j.completed_at||j.created_at||j.generated_at||"لم تُشغّل هذه الجلسة بعد";
 return '<div class="cr-page trading-page"><section class="trade-hero"><div class="trade-hero-copy"><div class="eyebrow">MIDAD / VIA₿TC · NON-COPY INTELLIGENCE</div><h1>Trading <span>Lab</span></h1><p>محرك مستقل متعدد المسارات: كل lane يعمل كمرشح منفصل ثم يظهر <b>الدليل → الإشارة → Gate المخاطر → Paper Trade → النتيجة</b>. لا copy-trading ولا أمر حي.</p><div class="hero-actions"><button class="btn primary" data-cmd="tradeRun" '+(S.tradeBusy?"disabled":"")+'>'+(S.tradeBusy?"جارٍ التحليل…":"شغّل التحليل")+'</button><button class="btn" data-view="mining">Mining Edge</button><button class="btn" data-view="ai">تفسير AI</button></div><div class="trade-runline"><span>LAST RUN</span><b>'+esc(last)+'</b><span>ACTIVE LANES</span><b>'+active+'/'+lanes.length+'</b></div></div><div class="trade-orbit"><i></i><i></i><i></i><div class="trade-orbit-core"><b>BTC</b><small>'+esc(s.direction||"WAIT")+'</small></div></div></section><section class="trade-segments"><article><span class="seg-no">01</span><div class="eyebrow">EVIDENCE</div><h3>مصادر السوق</h3><strong>'+sources.length+'</strong><p>مصادر قابلة للقراءة الآن</p><div class="trade-source-row">'+sources.map(x=>'<span>'+esc(x.source||x.name||"source")+'</span>').join("")+'</div></article><article><span class="seg-no">02</span><div class="eyebrow">SIGNAL</div><h3>'+esc(s.direction||"NEUTRAL")+'</h3><strong>'+Math.round(Number(s.confidence||0)*100)+'%</strong><p>Confidence · '+esc(j.features?.regime||"—")+'</p></article><article><span class="seg-no">03</span><div class="eyebrow">RISK GATE</div><h3>'+esc(r.class||"—")+'</h3><strong>'+esc(r.gate_decision||"—")+'</strong><p>Human approval required</p></article><article><span class="seg-no">04</span><div class="eyebrow">PAPER TRADE</div><h3>'+esc(j.paper_trade?.status||"NOT_CREATED")+'</h3><strong>'+esc(s.entry??"—")+'</strong><p>Entry · Stop '+esc(s.stop??"—")+' · TP '+esc(s.take_profit??"—")+'</p></article></section><section class="trade-matrix-grid section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">TRADE MATRIX</div><h3>المسارات المتوازية</h3><small>اضغط أي مسار لرؤية أدلته وسبب حالته.</small></div><span class="badge cyan">'+lanes.length+' LANES</span></div><div class="trade-lanes">'+tradeLaneRows(lanes)+'</div></div><aside class="panel trade-fusion"><div class="panel-head"><div><div class="eyebrow">FUSION / GATE</div><h3>القرار الموحّد</h3></div><span class="badge '+(String(s.direction||"NEUTRAL")==="NEUTRAL"?"amber":"cyan")+'">'+esc(s.direction||"NEUTRAL")+'</span></div><div class="fusion-stack"><div><span>CONFIDENCE</span><b>'+Math.round(Number(s.confidence||0)*100)+'%</b></div><div><span>REGIME</span><b>'+esc(j.features?.regime||"—")+'</b></div><div><span>FUSION SCORE</span><b>'+esc(fused.score==null?"—":Math.round(Number(fused.score)*100)+"%")+'</b></div><div><span>GATE</span><b>'+esc(r.gate_decision||"—")+'</b></div></div><div class="note">الـFusion لا يحوّل نفسه إلى تنفيذ حي. Paper-only ما لم يوجد مسار موافقة مستقل.</div></aside></section><section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">MYSUN / EVIDENCE</div><h3>Fact → Inference → Action</h3></div><span class="badge amber">NO LIVE ORDER</span></div><div class="mysun-ladder"><div><b>FACT</b><span>'+esc(sources.length+" market sources; mining state "+(m.state||"—"))+'</span></div><div><b>INFERENCE</b><span>'+esc((s.direction||"NEUTRAL")+" · confidence "+Math.round(Number(s.confidence||0)*100)+"% · regime "+(j.features?.regime||"—"))+'</span></div><div><b>ACTION</b><span>Paper-only review. لا تنفيذ حي ولا copy-trading.</span></div></div></div><div class="panel"><div class="panel-head"><div><div class="eyebrow">PAPER OUTCOME</div><h3>من الإشارة إلى التعلّم</h3></div><span class="badge '+(j.paper_outcome?"green":"amber")+'">'+(j.paper_outcome?"RECEIVED":"PENDING")+'</span></div><div class="outcome-grid"><div><span>STATUS</span><b>'+esc(j.paper_outcome?.status||"لا نتيجة بعد")+'</b></div><div><span>RETURN</span><b>'+esc(j.paper_outcome?.return_pct==null?"—":Number(j.paper_outcome.return_pct).toFixed(2)+"%")+'</b></div><div><span>LABEL</span><b>'+esc(j.paper_outcome?.label||"—")+'</b></div><div><span>LEARNING</span><b>'+esc(j.paper_outcome?.learning_state||"بانتظار القياس")+'</b></div></div></div></section><section class="panel section-gap"><div class="panel-head"><div><div class="eyebrow">TRANSPORT / BLOCKS</div><h3>لماذا لا نرى كل الأسواق؟</h3></div><span class="badge '+(blocks.length?"amber":"green")+'">'+(blocks.length?"PARTIAL":"CLEAR")+'</span></div><div class="trade-blocks">'+(blocks.map(x=>'<span>'+esc(typeof x==="string"?x:(x.message||x.code||JSON.stringify(x)))+'</span>').join("")||'<span>لا توجد أخطاء نقل مسجلة في آخر دورة.</span>')+'</div></section></div>';
}
function shell(){
 $("#app").innerHTML='<div id="cr"><aside class="cr-rail"><div class="cr-mark '+(S.connected?"live":"")+'">M</div><div class="cr-nav">'+nav("cockpit","⌂","المقود")+nav("ai","✦","AI")+nav("money","◆","المال")+nav("intel","⌬","الرصد")+nav("tasks","✓","المهام")+nav("ugig","◎","uGig")+nav("mining","₿","التعدين")+nav("bots","⬡","البوتات")+nav("trading","◈","Trading")+'</div><div class="cr-rail-spacer"></div><button class="cr-more" data-view="more"><span>☷</span><span>المزيد</span></button></aside><main class="cr-main"><header class="cr-top"><div class="cr-titlebar"><b>MIDAD</b><small>NEURAL CONTROL DECK</small><span class="badge green">'+esc(S.botContext==="viabtc"?"VIABTC MONITOR · NON-COPY":S.botContext==="ahwaz"?"AHWAZAI · OPS":S.botContext==="aimidad"?"AIMIDAD · NEURAL++":"NEW$WAY · CASH FIRST")+'</span></div><div class="cr-command"><input id="quick" placeholder="اكتب أمرًا: AI / فرص / OSINT / مهام / تعدين / دورة"><button class="btn primary" data-cmd="quick">نفّذ</button></div><div class="cr-actions"><div class="cr-status"><i class="dot '+(S.connected?"live":"")+'"></i><span>'+(S.connected?"VERIFIED":"LOCKED")+'</span></div><button class="iconbtn" data-cmd="refresh">↻</button></div></header><div id="views"></div></main></div><div class="toastbox" id="crToast"></div>';
 $$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===S.view));
}
function rowTask(x){return '<div class="row click" data-task="'+esc(x.id)+'"><div class="row-main"><b>'+esc(x.title||"Human task")+'</b><small>أولوية '+n(x.priority)+' · '+esc(x.risk_class||"—")+' · '+esc(x.instruction||x.reason||"")+'</small></div><span class="badge '+(x.blocking?"red":"amber")+'">'+esc(x.status||"OPEN")+'</span></div>'}
function rowOpp(x){return '<div class="row click" data-opp="'+esc(x.id)+'"><div class="row-main"><b>'+esc(x.title||"Opportunity")+'</b><small>'+esc(x.source||"")+" · score "+n(x.score)+" · "+(x.confidence==null?"—":Math.round(Number(x.confidence)*100)+"%")+'</small></div><span class="badge cyan">'+usd(x.expected_value)+'</span></div>'}
function neuralState(){
 const h=H(), r=S.data?.runtime?.money_hunter||null, cg=S.data?.capability_gate||{};
 const blockers=[];
 if(!S.connected) blockers.push({state:"BLOCKED",label:"الجلسة",detail:"غرفة التحكم غير موثقة"});
 if(Number(h.pending_human_tasks||0)>0) blockers.push({state:"PENDING",label:"مهام بشرية",detail:n(h.pending_human_tasks)+" تحتاج تدخلك"});
 if(Number(h.pending_approvals||0)>0) blockers.push({state:"PENDING",label:"موافقات",detail:n(h.pending_approvals)+" بانتظار القرار"});
 if(r?.status==="failed") blockers.push({state:"FAILED",label:"Money Hunter",detail:r.error||"آخر تشغيل فشل"});
 if(Number(h.money_opportunities||0)>0) blockers.push({state:"VERIFIED",label:"مسار المال",detail:n(h.money_opportunities)+" فرصة paid_work"});
 if(Number(cg.avg_delivery_confidence||0)>0) blockers.push({state:"VERIFIED",label:"جاهزية التسليم",detail:Math.round(Number(cg.avg_delivery_confidence)*100)+"%"});
 if(!blockers.length) blockers.push({state:"VERIFIED",label:"النواة",detail:"لا توجد عوائق مسجلة الآن"});
 return blockers.slice(0,4);
}
function stateBadge(x){
 const cls={VERIFIED:"green",INFERRED:"cyan",PENDING:"amber",FAILED:"red",BLOCKED:"red"}[x]||"cyan";
 return '<span class="state-chip '+cls+'"><i></i>'+esc(x)+'</span>';
}
function cockpitView(){
 const h=H(),ts=tasks(),mo=moneyOpps(),ss=sigs(),ready=Math.round(Number(S.data?.capability_gate?.avg_delivery_confidence||0)*100);
 const ns=neuralState();
 const topTask=ts[0]||null, topOpp=mo[0]||null;
 const next=topTask
   ? {k:"NOW",title:topTask.title||"مهمة بشرية",detail:topTask.instruction||topTask.reason||"راجع المهمة",state:"PENDING",action:"tasks"}
   : topOpp
     ? {k:"NEXT",title:topOpp.title||"فرصة دخل",detail:"تحقق من الجاهزية والعوائق قبل التقديم.",state:"VERIFIED",action:"money"}
     : {k:"NEXT",title:"لا توجد خطوة حرجة",detail:"شغّل مسح المال أو اطلب من MIDAD AI قراءة الحالة.",state:"VERIFIED",action:"ai"};
 return '<div class="cr-page">'+
 '<section class="neural-stage">'+
   '<div class="stage-copy">'+
     '<div class="eyebrow">MIDAD / NEURAL COMMAND CENTER</div>'+
     '<div class="stage-title">المقود بيدك.<br><span>والنواة تشرح لك لماذا.</span></div>'+
     '<p>ليست لوحة أرقام: هذه طبقة قرار حيّة تربط <b>الحالة → الدليل → الخطوة التالية → العائق</b> مع إبقاء الأفعال الحساسة خلف موافقة بشرية.</p>'+
     '<div class="hero-actions"><button class="btn primary" data-view="ai">✦ اسأل النواة</button><button class="btn green" data-run="run_money_scan">💰 اصطد فرصة دخل</button><button class="btn" data-run="run_osint_scan">⌬ حدّث الرادار</button><button class="btn warn" data-run="run_autonomy_now">⚡ شغّل الدورة</button></div>'+
   '</div>'+
   '<div class="neural-core" aria-label="MIDAD Neural Core">'+
     '<div class="core-orbit orbit-a"></div><div class="core-orbit orbit-b"></div><div class="core-orbit orbit-c"></div>'+
     '<div class="core-pulse"><span></span><b>MIDAD</b><small>'+esc(S.connected?"LIVE CORE":"LOCKED")+'</small></div>'+
     '<div class="core-readout"><span>STATE</span><strong>'+esc(S.error?"FAILED":S.connected?"VERIFIED":"BLOCKED")+'</strong></div>'+
   '</div>'+
 '</section>'+
 '<section class="state-strip">'+
   '<div class="state-main"><div class="eyebrow">NEURAL STATE / NOW</div><div class="state-chips">'+ns.map(x=>stateBadge(x.state)+'<span class="state-detail"><b>'+esc(x.label)+'</b> '+esc(x.detail)+'</span>' ).join("")+'</div></div>'+
   '<div class="state-next"><div class="eyebrow">'+next.k+'</div><b>'+esc(next.title)+'</b><span>'+esc(next.detail)+'</span><button class="btn" data-view="'+next.action+'">افتح المسار →</button></div>'+
 '</section>'+
 '<div class="kpis"><div class="kpi"><span>MONEY OPPS</span><b>'+n(h.money_opportunities??mo.length)+'</b><div class="sub">فرص paid_work في المسار</div></div><div class="kpi"><span>SIGNALS</span><b>'+n(h.signals)+'</b><div class="sub">إشارات الرادار</div></div><div class="kpi"><span>HUMAN TASKS</span><b>'+n(h.pending_human_tasks)+'</b><div class="sub">تحتاج يدك</div></div><div class="kpi"><span>CASH PIPELINE</span><b>'+usd(pipeline())+'</b><div class="sub">قيمة متوقعة</div></div><div class="kpi"><span>READINESS</span><b>'+ready+'%</b><div class="sub">قابلية تسليم</div></div></div>'+
 '<section class="decision-grid section-gap">'+
   '<div class="panel decision-panel"><div class="panel-head"><div><div class="eyebrow">DECISION STREAM</div><h3>ما الذي يحدث الآن؟</h3></div><span class="badge cyan">LIVE</span></div>'+
     '<div class="decision-flow"><div class="flow-node active"><i>01</i><b>DETECT</b><small>'+n(h.signals)+' إشارات</small></div><div class="flow-line"></div><div class="flow-node"><i>02</i><b>QUALIFY</b><small>'+n(h.money_opportunities)+' فرص</small></div><div class="flow-line"></div><div class="flow-node"><i>03</i><b>ACT</b><small>'+n(h.pending_human_tasks)+' مهام</small></div><div class="flow-line"></div><div class="flow-node"><i>04</i><b>DELIVER</b><small>'+ready+'% جاهزية</small></div></div>'+
     '<div class="decision-footer"><span>'+stateBadge(topTask?"PENDING":topOpp?"VERIFIED":"VERIFIED")+'</span><b>'+esc(topTask?("تدخلك مطلوب: "+(topTask.title||"مهمة")):topOpp?("أقرب مسار مالي: "+(topOpp.title||"فرصة")):"النظام لا يطلب تدخلاً عاجلاً.")+'</b></div>'+
   '</div>'+
   '<div class="panel action-panel"><div class="panel-head"><div><div class="eyebrow">ACTION MATRIX</div><h3>من الفكرة إلى النتيجة</h3></div><button class="btn" data-view="ai">AI →</button></div>'+
     '<div class="action-matrix"><button data-view="money"><span>◆</span><b>INCOME</b><small>'+n(h.money_actionable||0)+' قابلة للمراجعة</small></button><button data-view="tasks"><span>✓</span><b>HUMAN</b><small>'+n(h.pending_human_tasks||0)+' تنتظر</small></button><button data-view="intel"><span>⌬</span><b>RADAR</b><small>'+n(h.osint_events||0)+' أحداث</small></button><button data-view="more"><span>⛏</span><b>MINING</b><small>ViaBTC monitor</small></button></div>'+
   '</div>'+
 '</section>'+
 '<section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">NOW</div><h3>ماذا يحتاجني الآن؟</h3></div><button class="btn" data-view="tasks">كل المهام</button></div><div class="list">'+(ts.slice(0,5).map(rowTask).join("")||'<div class="empty">لا توجد مهمة بشرية مفتوحة.</div>')+'</div></div>'+
 '<div class="panel"><div class="panel-head"><div><div class="eyebrow">MONEY LANE</div><h3>الفرص التي يمكن تحويلها إلى عمل</h3></div><button class="btn" data-view="money">فتح المال</button></div><div class="list">'+(mo.slice(0,5).map(rowOpp).join("")||'<div class="empty">لا توجد حاليًا فرصة paid_work في مسار المال.</div>')+'</div></div></section>'+
 '<section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">RADAR</div><h3>الرصد الحي</h3></div><button class="btn" data-view="intel">فتح الرصد</button></div><div class="stream">'+(ss.slice(0,8).map(x=>'<div class="item"><b>'+esc(x.type_label||x.signal_type||"Signal")+'</b> · '+esc(x.entity||"—")+' <span class="badge cyan">'+n(x.score)+'</span><p>'+esc(x.source||"source")+" · confidence "+(x.confidence==null?"—":Math.round(Number(x.confidence)*100)+"%")+"</p></div>").join("")||'<div class="empty">لا توجد إشارات.</div>')+'</div></div>'+
 '<div class="panel"><div class="panel-head"><div><div class="eyebrow">SYSTEM</div><h3>صحة التشغيل</h3></div><button class="btn" data-view="more">التفاصيل</button></div><div class="list"><div class="row"><div class="row-main"><b>Supabase Core</b><small>جلسة التحكم</small></div><span class="badge '+(S.connected?"green":"red")+'">'+(S.connected?"LIVE":"LOCKED")+'</span></div><div class="row"><div class="row-main"><b>Telegram</b><small>Web App identity</small></div><span class="badge '+(TG()?.initData?"green":"amber")+'">'+(TG()?.initData?"CONNECTED":"CONTEXT")+'</span></div><div class="row"><div class="row-main"><b>Opportunity Engine</b><small>'+esc(h.pipeline_note||"")+'</small></div><span class="badge '+(h.pipeline_ok?"green":"amber")+'">'+(h.pipeline_ok?"FLOW":"CHECK")+'</span></div></div></div></section>'+
 '</div>';
}
function formatAI(v){
 let s=esc(v??"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
 s=s.replace(/^###?\s+(.+)$/gm,'<div class="md-h">$1</div>');
 s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
 s=s.replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
 s=s.replace(/`([^\`]+)`/g,'<code>$1</code>');
 s=s.replace(/^\s*[-•]\s+(.+)$/gm,'<div class="md-li">• $1</div>');
 const lines=s.split("\n");
 let out=[],table=[];
 const flush=()=>{if(!table.length)return;out.push('<div class="md-table">'+table.map((row,i)=>{const cells=row.split("|").map(x=>x.trim()).filter(Boolean);if(cells.length<2)return "";if(cells.every(x=>/^[-: ]+$/.test(x)))return "";return '<div class="md-tr">'+cells.map(x=>'<span>'+x+'</span>').join("")+'</div>';}).join("")+'</div>');table=[];};
 for(const line of lines){
   if(line.includes("|")&&line.split("|").filter(Boolean).length>=2){table.push(line);continue;}
   flush();out.push(line);
 }
 flush();
 return out.join("\n").replace(/\n{2,}/g,"<br><br>").replace(/\n/g,"<br>");
}
function aiContextLabel(v){
 const map={now:"NOW / ما يحتاجك الآن",money:"MONEY / مسار الدخل",opportunity:"OPPORTUNITY / فرصة محددة",blueprint:"BLUEPRINT / جاهزية التنفيذ",tasks:"TASKS / تدخل بشري",osint:"OSINT / الرصد",system:"SYSTEM / صحة النواة"};
 return map[String(v||"").toLowerCase()]||"NEURAL CONTEXT";
}
function aiStateSnapshot(){
 const h=H(),cg=S.data?.capability_gate||{},ts=tasks(),mo=moneyOpps();
 return {
   state:S.error?"FAILED":S.connected?"VERIFIED":"BLOCKED",
   money:moneyOpps().length,
   tasks:ts.length,
   approvals:apps().length,
   readiness:Math.round(Number(cg.avg_delivery_confidence||0)*100),
   pipeline:usd(pipeline())
 };
}
function decisionAction(e){
 const o=e?.selected_opportunity||null,b=e?.selected_blueprint||null,entity=o||b;
 if(!entity)return "";
 const state=String(entity.status||entity.state||"").toLowerCase();
 const blocked=/blocked|failed|technical_blocked|cancel|closed/.test(state);
 const actionable=/accepted|delivery|in_progress|ready|approved/.test(state);
 const label=b?"فتح حزمة التنفيذ":"فتح الفرصة";
 if(blocked)return '<div class="decision-action locked"><span>⛔ BLOCKED</span><b>لا يوجد تنفيذ تلقائي</b><small>العائق يجب معالجته أولًا.</small></div>';
 if(actionable)return '<div class="decision-action ready"><span>● READY</span><b>'+label+'</b><small>متاح كمسار متابعة؛ التنفيذ الحساس يحتاج موافقة الإنسان.</small></div>';
 return '<div class="decision-action review"><span>◌ REVIEW</span><b>مراجعة بشرية مطلوبة</b><small>الحالة الحالية لا تثبت صلاحية التنفيذ المباشر.</small></div>';
}
function aiEvidenceCard(e){
 const h=e?.health||{},cg=e?.capability_gate||{},o=e?.selected_opportunity||null,b=e?.selected_blueprint||null;
 const items=[
   ["STATE",S.error?"FAILED":S.connected?"VERIFIED":"BLOCKED"],
   ["MONEY",n(h.money_opportunities??0)],
   ["TASKS",n(h.pending_human_tasks??(e?.human_tasks||[]).length)],
   ["APPROVALS",n(h.pending_approvals??(e?.approvals||[]).length)],
   ["READINESS",Math.round(Number(cg.avg_delivery_confidence||0)*100)+"%"]
 ];
 const subject=o?esc(o.title||o.id):b?esc(b.title||b.id):"الحالة التشغيلية";
 return '<div class="ai-evidence"><div class="ai-evidence-head"><span>LIVE EVIDENCE</span><b>'+subject+'</b><small>'+esc(e.generated_at||"")+'</small></div><div class="ai-evidence-grid">'+items.map(x=>'<span><i>'+x[0]+'</i><b>'+x[1]+'</b></span>').join("")+'</div><div class="decision-action-wrap">'+decisionAction(e)+'</div><div class="ai-evidence-foot"><span>المصدر: Supabase operational state</span><span>الدليل لا يعني تفويضًا بالتنفيذ</span></div></div>';
}
function aiView(){
 const snap=aiStateSnapshot();
 const msgs=S.aiMessages.length?S.aiMessages.map(m=>'<div class="bubble '+m.role+'"><span class="meta">'+(m.role==="ai"?"MIDAD AI":"أنت")+(m.mode?' · <span class="ai-mode-tag">'+esc(aiContextLabel(m.mode))+'</span>':"")+'</span><div class="bubble-body">'+(m.role==="ai"?formatAI(m.text):esc(m.text).replace(/\\n/g,"<br>"))+'</div>'+(m.evidence?aiEvidenceCard(m.evidence):"")+'</div>').join(""):'<div class="empty">النواة جاهزة. اسألها عن <b>NOW / MONEY / OPPORTUNITY / BLUEPRINT / SYSTEM</b> وستعرض الحالة، الدليل، العائق والخطوة التالية.</div>';
 return '<div class="cr-page ai-command-page">'+
 '<section class="ai-neural-header">'+
   '<div><div class="eyebrow">MIDAD AI / NEURAL++ REASONING</div><h1>العقل التشغيلي.</h1><p>من <b>الحالة</b> إلى <b>الدليل</b> ثم <b>القرار</b> والخطوة التالية — بدون خلط بين الرصد والتنفيذ.</p></div>'+
   '<div class="ai-live-orbit"><i></i><b>AI CORE</b><small>'+esc(snap.state)+'</small></div>'+
   '<div class="ai-state-mini"><span>STATE <b>'+esc(snap.state)+'</b></span><span>MONEY <b>'+n(snap.money)+'</b></span><span>TASKS <b>'+n(snap.tasks)+'</b></span><span>APPROVALS <b>'+n(snap.approvals)+'</b></span><span>READINESS <b>'+snap.readiness+'%</b></span><span>PIPELINE <b>'+snap.pipeline+'</b></span></div>'+
 '</section>'+
 '<div class="ai-shell">'+
   '<section class="panel ai-chat"><div class="panel-head"><div><div class="eyebrow">DECISION CONSOLE</div><h3>اسأل النواة — وسترى لماذا</h3><small>AI يقرأ الحالة التشغيلية المباشرة ويُبقي الأفعال الحساسة خلف بوابة الإنسان.</small></div><button class="btn" data-cmd="aiClear">مسح</button></div><div class="ai-scroll" id="aiScroll">'+msgs+'</div><div class="ai-compose"><textarea id="aiInput" placeholder="مثال: ما الذي يحتاجني الآن؟ أو حلّل أعلى فرصة دخل وما يمنع التقديم."></textarea><button class="btn primary" data-cmd="aiSend">إرسال</button></div></section>'+
   '<aside class="ai-command-side">'+
     '<section class="panel"><div class="eyebrow">NEURAL MODES</div><h3>اسأل حسب المسار</h3><div class="prompt-grid">'+
       '<button data-prompt="ما أهم شيء يحتاج تدخلي الآن؟">◉ NOW — ماذا أفعل الآن؟</button>'+
       '<button data-prompt="أين أقرب فرصة دخل قابلة للتنفيذ وما عائقها؟">◆ MONEY — أين أقرب دخل؟</button>'+
       '<button data-prompt="حلّل أعلى فرصة مالية الآن: الجاهزية، الدليل، العائق، والخطوة التالية.">◇ OPPORTUNITY — حلّل فرصة</button>'+
       '<button data-prompt="راجع أعلى Blueprint جاهز: هل هو قابل للتنفيذ الآن؟ اذكر المتطلبات والعوائق والخطوة التالية.">▣ BLUEPRINT — جاهزية التنفيذ</button>'+
       '<button data-prompt="حلّل أعلى مهمة بشرية وقل لي ماذا أفعل خطوة بخطوة.">✓ TASKS — تدخلي</button>'+
       '<button data-prompt="افحص صحة النظام وما الذي يحتاج إصلاحًا؟">⌘ SYSTEM — صحة النواة</button>'+
     '</div></section>'+
     '<section class="panel ai-contract"><div class="eyebrow">NEURAL CONTRACT</div><div class="contract-row"><span>FACT</span><b>بيانات مثبتة</b></div><div class="contract-row"><span>INFERENCE</span><b>استنتاج معلّم</b></div><div class="contract-row"><span>BLOCKER</span><b>ما يمنع الخطوة</b></div><div class="contract-row"><span>NEXT</span><b>خطوة عملية</b></div><div class="contract-row"><span>APPROVAL</span><b>قرار بشري عند الحاجة</b></div></section>'+
   '</aside>'+
 '</div></div>';
}
function moneyView(){
 const h=H(),oo=moneyOpps(),bp=blueprints();
 return '<div class="cr-page"><section class="hero-panel"><div class="eyebrow">CASH COMMAND</div><h1 style="font-size:48px">من الإشارة إلى دولار.</h1><p>المال هنا يعني فرص عمل قابلة للفحص، قيمة متوقعة، حالة التنفيذ، وما يمنع التحويل إلى نتيجة.</p><div class="hero-actions"><button class="btn green" data-run="run_opportunity_scan">↻ أعد البحث</button><button class="btn primary" data-view="ai" data-prefill="حلّل أعلى فرصة مالية الآن وما الذي يمنع تحويلها إلى دخل.">✦ حلّل بالـAI</button></div></section><div class="kpis"><div class="kpi"><span>MONEY OPPS</span><b>'+n(h.money_opportunities??oo.length)+'</b></div><div class="kpi"><span>CASH PIPELINE</span><b>'+usd(pipeline())+'</b></div><div class="kpi"><span>OPEN TASKS</span><b>'+n(h.pending_human_tasks)+'</b></div><div class="kpi"><span>PAYMENTS</span><b>'+n(h.payment_intents)+'</b></div><div class="kpi"><span>BLUEPRINTS</span><b>'+n(h.income_blueprints??bp.length)+'</b><div class="sub">'+usd(h.blueprint_expected_value||0)+' تقديرًا</div></div></div><section class="panel section-gap"><div class="panel-head"><div><div class="eyebrow">READY BLUEPRINTS</div><h3>حزم جاهزة للتحويل إلى تنفيذ</h3><small>كل بطاقة مرتبطة بفرصة فعلية ولها deliverables وQA وعوائق وخطوة تحصيل.</small></div><span class="badge green">'+n(bp.length)+'</span></div><div class="opps">'+(bp.slice(0,8).map(x=>'<article class="opp blueprint-card" data-blueprint="'+esc(x.id)+'"><div class="opp-top"><h4>'+esc(x.title||"Blueprint")+'</h4><span class="badge green">'+usd(x.estimated_net_usd)+'</span></div><p>'+esc(x.money_thesis||"حزمة تنفيذ مرتبطة بفرصة دخل.")+'</p><div class="meta"><span class="badge">'+esc(x.buyer_or_market||"market")+'</span><span class="badge">'+n((x.blockers||[]).length)+' عوائق محتملة</span><span class="badge cyan">AI →</span></div></article>').join("")||'<div class="empty">لا توجد Blueprints جاهزة بعد.</div>')+'</div></section><section class="panel section-gap"><div class="panel-head"><div><div class="eyebrow">TOP OPPORTUNITIES</div><h3>المادة الخام للمال</h3></div></div><div class="opps">'+(oo.map(x=>'<article class="opp" data-opp="'+esc(x.id)+'"><div class="opp-top"><h4>'+esc(x.title||"Opportunity")+'</h4><span class="badge cyan">'+n(x.score)+'</span></div><p>'+esc(x.description||"تحتاج تحققًا قبل القبول.")+'</p><div class="meta"><span class="badge">'+esc(x.status||"candidate")+'</span><span class="badge">'+(x.confidence==null?"—":Math.round(Number(x.confidence)*100)+"% confidence")+'</span><span class="badge green">'+usd(x.expected_value)+'</span></div></article>').join("")||'<div class="empty">لا توجد فرص حالية.</div>')+'</div></section></div>'
}
function intelView(){
 const h=H(),ss=sigs(),ev=S.data?.osint?.events||[];
 return '<div class="cr-page"><section class="hero-panel"><div class="eyebrow">OSINT / SIGNAL INTELLIGENCE</div><h1 style="font-size:48px">الرادار، لا العقل.</h1><p>هذه الشاشة تعرض الأدلة والإشارات ومصادر الرصد فقط. AI ليس جزءًا من هذه الصفحة.</p><div class="hero-actions"><button class="btn primary" data-run="run_osint_scan">⌁ تشغيل OSINT</button><button class="btn" data-view="ai">✦ انتقل إلى AI</button></div></section><div class="kpis"><div class="kpi"><span>SIGNALS</span><b>'+n(h.signals)+'</b></div><div class="kpi"><span>OSINT SOURCES</span><b>'+n(h.osint_sources)+'</b></div><div class="kpi"><span>OSINT EVENTS</span><b>'+n(h.osint_events)+'</b></div><div class="kpi"><span>ENTITIES</span><b>'+n(h.entities)+'</b></div><div class="kpi"><span>ALERTS</span><b>'+n(h.sentinel_alerts)+'</b></div></div><section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">SIGNAL STREAM</div><h3>آخر الإشارات</h3></div></div><div class="stream">'+(ss.map(x=>'<div class="item"><b>'+esc(x.type_label||x.signal_type)+'</b> · '+esc(x.entity||"—")+' <span class="badge cyan">'+n(x.score)+'</span><p>'+esc(x.source||"")+" · "+esc(x.occurred_at||"")+'</p></div>').join("")||'<div class="empty">لا توجد إشارات.</div>')+'</div></div><div class="panel"><div class="panel-head"><div><div class="eyebrow">OSINT EVENTS</div><h3>أحداث الرصد</h3></div></div><div class="stream">'+(ev.map(x=>'<div class="item"><b>'+esc(x.event_type||"event")+'</b> · '+esc(x.subject_key||"—")+' <span class="badge '+(String(x.severity||"").toLowerCase().includes("high")?"red":"amber")+'">'+esc(x.severity||"watch")+'</span><p>confidence '+(x.confidence==null?"—":Math.round(Number(x.confidence)*100)+"%")+'</p></div>').join("")||'<div class="empty">لا توجد أحداث OSINT.</div>')+'</div></div></section></div>'
}
function tasksView(){
 const ts=tasks(),aa=apps();
 return '<div class="cr-page"><section class="hero-panel"><div class="eyebrow">HUMAN CONTROL</div><h1 style="font-size:48px">المهام التي تحتاج يدك.</h1><p>هنا فقط القرارات التي تنتظر تدخلك. لا نخلطها مع الإشارات أو الذكاء.</p></section><section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">TASK QUEUE</div><h3>المهام</h3></div><span class="badge amber">'+n(ts.length)+' مفتوحة</span></div><div class="list">'+(ts.map(rowTask).join("")||'<div class="empty">لا توجد مهام.</div>')+'</div></div><div class="panel"><div class="panel-head"><div><div class="eyebrow">APPROVAL GATE</div><h3>الموافقات</h3></div><span class="badge red">'+n(aa.length)+' بانتظارك</span></div><div class="list">'+(aa.map(x=>'<div class="row"><div class="row-main"><b>'+esc(x.reason||x.action||"Approval")+'</b><small>Risk: '+esc(x.risk_class||"—")+' · '+esc(x.subject_type||"—")+'</small><div class="hero-actions"><button class="btn green" data-approval="'+esc(x.id)+'" data-decision="approved">موافقة</button><button class="btn danger" data-approval="'+esc(x.id)+'" data-decision="rejected">رفض</button></div></div></div>').join("")||'<div class="empty">لا توجد موافقات.</div>')+'</div></div></section></div>'
}
function ugigView(){
 const p=S.ugigProfile||{}, a=S.ugigApps||[];
 const skills=Array.isArray(p.skills)?p.skills.join(", "):(p.skills||"");
 const tools=Array.isArray(p.ai_tools)?p.ai_tools.join(", "):(p.ai_tools||"");
 return '<div class="cr-page"><section class="hero-panel"><div class="eyebrow">uGIG / DIRECT CONTROL</div><h1 style="font-size:48px">uGig داخل غرفة التحكم.</h1><p>الملف الشخصي والطلبات تُقرأ وتُحدّث عبر MIDAD Core مباشرة. لا نعتمد على واجهة الموقع لتشغيل المسار.</p><div class="hero-actions"><button class="btn primary" data-cmd="ugigLoad">↻ مزامنة Profile + Applications</button><button class="btn" data-cmd="ugigBest">⌬ أفضل فرصة</button></div></section><section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">PROFILE</div><h3>الملف المهني</h3><small>التحديث يذهب مباشرة إلى UGIG API عبر gateway.</small></div><span class="badge '+(S.ugigProfile?"green":"amber")+'">'+(S.ugigProfile?"SYNCED":"NOT LOADED")+'</span></div><div class="form-grid"><label>Username<input id="ugUsername" value="'+esc(p.username||"")+'"></label><label>Full name<input id="ugFullName" value="'+esc(p.full_name||"")+'"></label><label>Hourly rate<input id="ugRate" type="number" min="0" step="1" value="'+esc(p.hourly_rate??"")+'"></label><label>Timezone<input id="ugTimezone" value="'+esc(p.timezone||"")+'"></label><label style="grid-column:1/-1">Bio<textarea id="ugBio" rows="5">'+esc(p.bio||"")+'</textarea></label><label style="grid-column:1/-1">Skills<input id="ugSkills" value="'+esc(skills)+'"></label><label style="grid-column:1/-1">AI Tools<input id="ugTools" value="'+esc(tools)+'"></label><label>Available<select id="ugAvailable"><option value="true" '+(p.is_available===false?"":"selected")+'>نعم</option><option value="false" '+(p.is_available===false?"selected":"")+'>لا</option></select></label></div><div class="hero-actions"><button class="btn green" data-cmd="ugigSave">حفظ Profile</button></div></div><div class="panel"><div class="panel-head"><div><div class="eyebrow">APPLICATIONS</div><h3>تقديماتي</h3><small>الحالة تُقرأ مباشرة من UGIG.</small></div><span class="badge cyan">'+n(a.length)+'</span></div><div class="list">'+(a.map(x=>'<div class="row"><div class="row-main"><b>'+esc(x.gig?.title||x.gig_title||x.title||x.gig_id||"Application")+'</b><small>'+esc(x.status||"—")+' · '+esc(x.proposed_rate!=null?("$"+x.proposed_rate):"rate —")+' · '+esc(x.proposed_timeline||"")+'</small></div><span class="badge '+(String(x.status).toLowerCase()==="accepted"?"green":"amber")+'">'+esc(x.status||"—")+'</span></div>').join("")||'<div class="empty">اضغط مزامنة Profile + Applications لجلب التقديمات.</div>')+'</div><div class="note">التقديمات الجديدة تبقى خلف بوابة الموافقة البشرية؛ هذه الصفحة لا ترسل طلبًا مدفوعًا أو نهائيًا تلقائيًا.</div></div></section></div>'
}
function moreView(){
 const h=H(),t=S.telegram?.result||S.telegram||{},r=S.data?.runtime?.money_hunter||null;
 const moneyState=r?.status?("الحالة: "+r.status+" · آخر تشغيل "+(r.completed_at||r.created_at||"—")):"لم يُسجّل تشغيل بعد";
 return '<div class="cr-page"><section class="hero-panel"><div class="eyebrow">MORE / TOOLS</div><h1 style="font-size:48px">الأدوات، لا الصفحات.</h1><p>أبقيت الأدوات ذات الغرض الواضح، وأخرجت الفوضى من المسار الرئيسي.</p></section><section class="more-grid section-gap"><div class="toolcard"><b>💰 NEW$WAY / المال أولاً</b><p>'+esc(moneyState)+' · فرصة → تحقق → عرض → موافقة → تقديم → تسليم → تحصيل. المسار الحرج مستقل عن n8n.</p><button class="btn green" data-run="run_money_scan">تشغيل بحث المال</button></div><div class="toolcard"><b>⛏ ViaBTC / MYSUN</b><p>لوحة التعدين: fleet + telemetry + profit + payments.</p><button class="btn primary" data-view="mining">فتح اللوحة</button></div><div class="toolcard"><b>⚡ الاستقلالية</b><p>تشغيل دورة MIDAD مع بقاء بوابات الأمان.</p><button class="btn warn" data-run="run_autonomy_now">تشغيل الدورة</button></div><div class="toolcard"><b>📡 Telegram</b><p>'+esc(t.url||"لم يُفحص بعد")+'</p><button class="btn" data-cmd="telegram">فحص Telegram</button></div><div class="toolcard"><b>✺ النظام</b><p>'+esc(S.connected?"جلسة موثقة":"الجلسة مقفلة")+'</p><button class="btn" data-cmd="system">فحص الصحة</button></div><div class="toolcard"><b>◎ المحافظ</b><p>'+n((S.data?.wallets||[]).length)+' محافظ مسجلة في النواة.</p><button class="btn" data-cmd="wallets">عرض الحالة</button></div><div class="toolcard"><b>⬡ Bot Fabric</b><p>شبكة البوتات والواجهات والـgates في مسار واحد.</p><button class="btn primary" data-view="bots">فتح الشبكة</button></div><div class="toolcard"><b>⌘ أمر سريع</b><p>نفّذ أمرًا نصيًا من الشريط العلوي.</p><button class="btn" data-cmd="focusCommand">اكتب أمرًا</button></div></section></div>'
}
function lockView(){return '<div class="lock"><div class="box"><div class="eyebrow">MIDAD / SECURE CONTROL</div><h2>الغرفة مقفلة حتى نعرف من أنت.</h2><p>داخل Telegram يتم أخذ هوية Web App تلقائيًا. من المتصفح العادي يمكنك استخدام مفتاح الوصول المحلي إن كان لديك.</p><div class="key-row"><input id="keyInput" type="password" placeholder="Access key"><button class="btn primary" data-cmd="keyConnect">دخول</button></div><div style="margin-top:12px;color:#69788b;font-size:10px">لا تدخل seed phrase أو private key.</div></div></div>'}
let renderGuard=false;
function botSurfacePrompt(prompt,view="ai"){
 S.view=view;render();
 if(view==="ai")setTimeout(()=>{const i=$("#aiInput");if(i){i.value=prompt;i.focus();sendAI()}},60);
}
function showKeysStatus(j){
 const rows=["الهويات: "+(j.identities||[]).length,"الـAgents: "+(j.agents||[]).length,"الطلبات النشطة: "+(j.requests||[]).length];
 const old=$("#keysStatusModal");if(old)old.remove();
 const details=(j.identities||[]).slice(0,8).map(x=>'<div class="row"><div class="row-main"><b>'+esc(x.account_label||x.provider||"Identity")+'</b><small>'+esc(x.identity_type||"—")+' · '+esc(x.status||"—")+'</small></div><span class="badge cyan">'+esc(x.provider||"—")+'</span></div>').join("");
 const html='<div id="keysStatusModal" style="position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:96;padding:7vh 7vw;overflow:auto"><div class="panel" style="max-width:920px;margin:auto"><div class="panel-head"><div><div class="eyebrow">MIDADKEYS / GATEWAY STATUS</div><h3>حالة الهوية والقدرات</h3><small>'+rows.join(" · ")+'</small></div><button class="btn" data-cmd="closeKeysStatus">إغلاق</button></div><div class="list">'+(details||'<div class="empty">لا توجد هويات محفوظة.</div>')+'</div><div class="sub" style="margin-top:12px">حالة Bot Token منفصلة عن Gateway: التوكن غير متاح حاليًا، ولا يتم عرض أي سر هنا.</div></div></div>';
 document.body.insertAdjacentHTML("beforeend",html);
 const m=$("#keysStatusModal");const b=m.querySelector('[data-cmd="closeKeysStatus"]');if(b)b.onclick=()=>m.remove();
}
function botAction(id){
 const map={
  neural:()=>botSurfacePrompt("افحص Neural Core: ما أهم حالة معرفية تحتاج اهتمامًا الآن؟ اذكر الدليل والعائق والخطوة التالية.","ai"),
  research:()=>botSurfacePrompt("جهّز لي إطار بحث قرارّي لمهمة مدفوعة: ما البيانات المطلوبة، مصادرها، ومخرجات التسليم؟","ai"),
  money:()=>{S.view="money";render()},
  income:()=>botSurfacePrompt("راجع أفضل مسار دخل مؤهل حاليًا: هل توجد حزمة تنفيذ جاهزة؟ وما المطلوب مني قبل البدء؟","ai"),
  keys:async()=>{try{const j=await api("keys_status",{},true,30000);showKeysStatus(j)}catch(e){toast("MIDADKeys: "+e.message,"bad")}},
  telegram:()=>command("telegram"),
  ugig:()=>{S.view="ugig";render()},
  mining:()=>{S.view="mining";render();loadMiningStatus()},
  recovery:()=>botSurfacePrompt("راجع حالات Revenue Recovery الحالية: ما الذي يمكن استعادته، وما الدليل والعائق والخطوة التالية؟","ai"),
  osint:()=>runAction("run_osint_scan"),
  autonomy:()=>runAction("run_autonomy_now"),
  tasks:()=>{S.view="tasks";render()},
  learning:()=>botSurfacePrompt("راجع آخر تعلّم في MIDAD: ما الذي تغيّر وما الدليل والخطوة التالية؟","ai"),
  payments:()=>botSurfacePrompt("افحص مسار التحقق من الدفع والتسوية: ما الحالة المثبتة والعائق والخطوة التالية؟","ai"),
  chain:()=>botSurfacePrompt("افحص Chain Intelligence: ما البيانات المثبتة وما قيمتها التشغيلية الآن؟","ai")
 };
 return map[id]?map[id]():toast("واجهة البوت غير معرفة بعد.","bad");
}
async function loadMiningStatus(){
 try{const j=await api("mining_status",{},true,30000);S.miningAccounts=j.accounts||j.mining_accounts||[];render();toast("تم تحديث حالة ViaBTC.","ok")}
 catch(e){toast("ViaBTC: "+e.message,"bad")}
}
function miningView(){
 const a=(S.miningAccounts||[])[0]||null,meta=a?.metadata||{},fleet=Array.isArray(meta.fleet_declared)?meta.fleet_declared:[];
 const live=a?.last_hashrate_ths!=null,transport=meta.transport||"—",state=a?.status||"PLANNED";
 const profit=meta.profit_summary||null,payments=meta.payment_history_30d||{};
 return '<div class="cr-page"><section class="hero-panel"><div class="eyebrow">MIDAD / VIA⛓BTC · /MYSUN</div><h1>Mining Intelligence Deck</h1><p>ViaBTC في طبقة مستقلة: fleet المعلن، القياس الحي، الربح، الدفعات، ومسار النقل. المعلن ≠ المقاس.</p><div class="hero-actions"><button class="btn primary" data-run="run_mining_monitor">تشغيل telemetry</button><button class="btn" data-cmd="miningStatus">تحديث الحالة</button></div></section>'+
 '<section class="kpis section-gap"><div class="kpi"><span>LIVE HASHRATE</span><b>'+esc(live?Number(a.last_hashrate_ths).toFixed(2):"—")+'</b><small>TH/s</small></div><div class="kpi"><span>DECLARED FLEET</span><b>'+esc(String(meta.fleet_hashrate_ths_declared||"—"))+'</b><small>TH/s · user declared</small></div><div class="kpi"><span>WORKERS</span><b>'+esc(a?.last_worker_count!=null?String(a.last_worker_count):"—")+'</b><small>ViaBTC</small></div><div class="kpi"><span>TRANSPORT</span><b style="font-size:18px">'+esc(transport)+'</b><small>telemetry path</small></div></section>'+
 '<section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">FLEET</div><h3>الأجهزة المعلنة</h3></div><span class="badge cyan">140 TH/s</span></div><div class="list">'+(fleet.map(x=>'<div class="row"><div class="row-main"><b>'+esc(x.model||"Miner")+'</b><small>'+esc(String(x.count||0))+' × '+esc(String(x.hashrate_ths_declared||"—"))+' TH/s</small></div><span class="badge cyan">DECLARED</span></div>').join("")||'<div class="empty">لا توجد fleet metadata.</div>')+'</div></div>'+
 '<div class="panel"><div class="panel-head"><div><div class="eyebrow">STATE</div><h3>ViaBTC Monitor</h3></div><span class="badge '+(state==="connected"&&live?"green":"amber")+'">'+esc(state.toUpperCase())+'</span></div><div class="list"><div class="row"><div class="row-main"><b>Read-only</b><small>لا أوامر سحب/تعديل من هذا السطح.</small></div><span class="badge green">'+(a?.read_only?"ON":"CHECK")+'</span></div><div class="row"><div class="row-main"><b>Snapshot</b><small>'+esc(a?.last_snapshot_at||"لم تصل telemetry بعد")+'</small></div><span class="badge '+(live?"green":"amber")+'">'+(live?"LIVE":"PENDING")+'</span></div><div class="row"><div class="row-main"><b>Transport</b><small>'+esc(meta.state||"مسار النقل غير مثبت")+'</small></div><span class="badge cyan">'+esc(transport)+'</span></div></div></div></section>'+
 '<section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">PROFIT</div><h3>Profit Summary</h3></div><span class="badge cyan">BTC</span></div><div class="list">'+(profit?Object.entries(profit).slice(0,8).map(([k,v])=>'<div class="row"><div class="row-main"><b>'+esc(k)+'</b></div><span class="badge cyan">'+esc(String(v??"—"))+'</span></div>').join(""):'<div class="empty">لا توجد بيانات ربح مؤكدة بعد.</div>')+'</div></div>'+
 '<div class="panel"><div class="panel-head"><div><div class="eyebrow">PAYMENTS</div><h3>آخر الدفعات</h3></div><span class="badge cyan">'+esc(String(payments.count??"—"))+'</span></div><div class="list">'+(payments.latest?Object.entries(payments.latest).slice(0,8).map(([k,v])=>'<div class="row"><div class="row-main"><b>'+esc(k)+'</b></div><span class="badge cyan">'+esc(String(v??"—"))+'</span></div>').join(""):'<div class="empty">لا توجد دفعات مؤكدة.</div>')+'</div></div></section>'+
 '<section class="panel section-gap"><div class="panel-head"><div><div class="eyebrow">MYSUN / EVIDENCE</div><h3>فصل الحقيقة عن الافتراض</h3></div><span class="badge amber">VERIFIED GATE</span></div><div class="decision-grid"><div><b>FACT</b><p>Fleet معلن: '+esc(String(meta.fleet_hashrate_ths_declared||"—"))+' TH/s.</p></div><div><b>MEASURED</b><p>'+esc(live?String(a.last_hashrate_ths)+" TH/s":"لا يوجد قياس حي")+'.</p></div><div><b>BLOCKER</b><p>'+esc(live?"لا يوجد حجب telemetry حاليًا.":(meta.reason||"بانتظار API/egress صالح."))+'</p></div><div><b>NEXT</b><p>تثبيت telemetry الحي ثم مقارنة measured / declared قبل أي قرار تشغيلي أو مالي.</p></div></div></section></div>';
}
function botsView(){
 const h=H(),cg=S.data?.capability_gate||{},recovery=(S.data?.recovery_cases||[]).length;
 const cards=[
  {id:"neural",icon:"✦",name:"MIDAD Neural Core",type:"REASONING",state:"VERIFIED",detail:"دمج البحث، الفرضيات، الروابط والتعلّم.",action:"تحليل النواة"},
  {id:"research",icon:"⌬",name:"Research Center",type:"RESEARCH",state:"READY",detail:"بحث موثق بالمصادر وحزمة قابلة للتسليم.",action:"فتح البحث"},
  {id:"money",icon:"◆",name:"Money Hunter",type:"INCOME",state:Number(h.money_opportunities||0)>0?"VERIFIED":"PENDING",detail:n(h.money_opportunities||0)+" فرصة مالية في الحالة الحالية.",action:"مسار المال"},
  {id:"income",icon:"↗",name:"Income Factory",type:"DELIVERY",state:cg.eligible>0?"VERIFIED":"REVIEW",detail:"تحويل الفرصة المؤهلة إلى Blueprint وخطة تسليم.",action:"جاهزية التنفيذ"},
  {id:"keys",icon:"🛡",name:"MIDADKeys",type:"IDENTITY",state:"READY",detail:"Gateway الهوية متاح للفحص؛ لا تُعرض الأسرار داخل Control Room.",action:"تشخيص الهوية"},
  {id:"telegram",icon:"✈",name:"Telegram Fabric",type:"ROUTING",state:"ACTIVE",detail:"Owner Bot + Router + Pollers.",action:"فحص Telegram"},
  {id:"ugig",icon:"◎",name:"uGig Worker",type:"DELIVERY",state:"READY",detail:"Profile، التطبيقات، المحافظ، والفواتير عبر Gateway.",action:"فتح uGig"},
  {id:"mining",icon:"₿",name:"ViaBTC Monitor",type:"TELEMETRY",state:(h.live_mining||0)>0?"VERIFIED":"REVIEW",detail:(h.live_mining||0)+" حساب تعدين حي.",action:"فحص التعدين"},
  {id:"recovery",icon:"♻",name:"Revenue Recovery",type:"RECOVERY",state:recovery?"PENDING":"READY",detail:recovery+" حالات استرداد غير مغلقة.",action:"فحص الاسترداد"},
  {id:"osint",icon:"📡",name:"OSINT Router",type:"RADAR",state:"READY",detail:"تحويل الرصد إلى بيانات قابلة للتحقق.",action:"تشغيل الرصد"},
  {id:"autonomy",icon:"⚡",name:"Autonomy Loop",type:"AUTONOMY",state:"GATED",detail:"دورة تشغيل محكومة بالـpolicy والـgates.",action:"تشغيل الدورة"},
  {id:"tasks",icon:"✓",name:"Human Task Router",type:"HUMAN",state:(h.pending_human_tasks||0)>0?"PENDING":"READY",detail:(h.pending_human_tasks||0)+" مهام بشرية مفتوحة.",action:"تدخلي"},
  {id:"payments",icon:"₿",name:"Payment / Settlement",type:"MONEY",state:"GATED",detail:"تحقق وتسوية دون ادعاء تحصيل.",action:"فحص الدفع"},
  {id:"learning",icon:"♻",name:"Learning Engine",type:"LEARNING",state:"ACTIVE",detail:"تعلم من النتائج والعمليات.",action:"آخر تعلّم"},
  {id:"chain",icon:"⛓",name:"Chain Intelligence",type:"CHAIN",state:"READY",detail:"تحليل بيانات السلسلة وربطها بالقرار.",action:"فحص السلسلة"}
 ];
 const bs=S.botStatus||{};const bot=(key)=>((bs.bots||[]).find(x=>x.key===key)||{});
 const ah=bot("ahwazai_bot"),mi=bot("aimidad_bot"),vb=bot("viabtc_monitor");
 const ctxDeck='<section class="bot-context-grid"><article class="bot-context-card trade"><div class="eyebrow">TRADING COMMAND ROOM</div><h2>@viabtc_monitor</h2><p>Mining telemetry + Independent Trade Intelligence + MYSUN evidence.</p><div class="bot-context-meta"><span class="badge '+(vb.ok?"green":"amber")+'">'+(vb.configured?(vb.ok?"ONLINE":"CHECK"):"TOKEN PENDING")+'</span><span>Paper-only</span><span>No copy-trading</span></div><button class="btn primary" data-bot-context="viabtc" data-bot-view="trading">فتح Trading Lab ↗</button></article><article class="bot-context-card ops"><div class="eyebrow">OPERATIONS ROOM</div><h2>@ahwazai_bot</h2><p>إدارة المهام والرصد والتشغيل والـAI من سياق واحد.</p><div class="bot-context-meta"><span class="badge '+(ah.ok?"green":"amber")+'">'+(ah.configured?(ah.ok?"ONLINE":"CHECK"):"NOT CONFIGURED")+'</span><span>OWNER GATED</span></div><button class="btn" data-bot-context="ahwaz" data-bot-view="cockpit">فتح غرفة الإدارة ↗</button></article><article class="bot-context-card ai"><div class="eyebrow">INTELLIGENCE ROOM</div><h2>@aimidad_bot</h2><p>Neural++ · Research · Money · Opportunities · Orchestration.</p><div class="bot-context-meta"><span class="badge '+(mi.ok?"green":"amber")+'">'+(mi.configured?(mi.ok?"ONLINE":"CHECK"):"NOT CONFIGURED")+'</span><span>NEURAL++</span></div><button class="btn" data-bot-context="aimidad" data-bot-view="ai">فتح AI Room ↗</button></article></section><section class="bots-hero"><div><div class="eyebrow">MIDAD / BOT FABRIC</div><h1>شبكة البوتات.</h1><p>كل وظيفة لها واجهة واضحة ومصدر وGate مستقل.</p></div><div class="bots-pulse"><i></i><b>FABRIC ONLINE</b><small>'+n(cards.length)+' SURFACES / '+(S.connected?"SESSION VERIFIED":"LOCKED")+'</small></div></section><section class="bot-grid">'+cards.map(x=>'<article class="bot-card"><div class="bot-card-head"><span class="bot-icon">'+x.icon+'</span><div><div class="eyebrow">'+esc(x.type)+'</div><h3>'+esc(x.name)+'</h3></div><span class="badge '+(x.state==="VERIFIED"||x.state==="READY"||x.state==="ACTIVE"?"green":x.state==="PENDING"||x.state==="REVIEW"||x.state==="GATED"?"amber":"red")+'">'+esc(x.state)+'</span></div><p>'+esc(x.detail)+'</p><div class="bot-meta"><span>CONTROL</span><span>OBSERVABLE</span><span>GATED</span></div><button class="btn primary" data-bot-action="'+esc(x.id)+'">'+esc(x.action)+' ↗</button></article>').join("")+'</section><section class="panel bot-principles"><div class="eyebrow">FABRIC RULES</div><div class="bot-principle-grid"><div><b>1</b><span>Evidence-first</span><small>لا ادعاء بلا سجل أو حالة مثبتة.</small></div><div><b>2</b><span>Lifecycle-aware</span><small>لا يبدأ التنفيذ قبل قبول المهمة.</small></div><div><b>3</b><span>Human-gated</span><small>المعاملات الحساسة خلف موافقة.</small></div><div><b>4</b><span>Portable</span><small>Telegram قناة وليست نقطة فشل للنواة.</small></div></div></section></div>';
}
function botContextState(botKey){
 const bs=S.botStatus||{};
 return (bs.bots||[]).find(x=>x.key===botKey)||{};
}
function contextPreface(){
 const h=H(),tasksOpen=tasks().length,oppsOpen=moneyOpps().length,appsOpen=apps().length;
 const vb=botContextState("viabtc_monitor"),ah=botContextState("ahwazai_bot"),mi=botContextState("aimidad_bot");
 if(S.botContext==="viabtc" && ["trading","mining","ai"].includes(S.view)){
   const live=Boolean((S.miningAccounts||[])[0]?.last_hashrate_ths!=null);
   return '<section class="context-command-shell context-viabtc"><div class="context-command-orb"><span>₿</span></div><div><div class="eyebrow">VIABTC MONITOR / TRADE COMMAND ROOM</div><h2>غرفة التداول المجزّأ.</h2><p>Telemetry → Lanes → Fusion → Risk Gate → Paper Outcome. الحالة الحية للتعدين لا تُفترض؛ تظهر فقط عندما تصل قياسًا فعليًا.</p><div class="context-rail"><span class="badge '+(vb.ok?"green":"amber")+'">'+(vb.configured?(vb.ok?"BOT ONLINE":"BOT CHECK"):"TOKEN PENDING")+'</span><span class="badge '+(live?"green":"amber")+'">'+(live?"TELEMETRY LIVE":"TELEMETRY PENDING")+'</span><span class="badge cyan">PAPER ONLY</span><span class="badge amber">HUMAN GATE</span></div></div><div class="context-command-actions"><button class="btn primary" data-cmd="tradeRun">تشغيل Matrix</button><button class="btn" data-view="mining">Telemetry</button><button class="btn" data-view="ai">AI تفسير</button></div></section>';
 }
 if(S.botContext==="ahwaz" && ["cockpit","tasks","intel","ai"].includes(S.view)){
   return '<section class="context-command-shell context-ahwaz"><div class="context-command-orb"><span>⌁</span></div><div><div class="eyebrow">@AHWAZAI_BOT / OPERATIONS COMMAND ROOM</div><h2>غرفة إدارة التشغيل.</h2><p>هذه الغرفة ليست نسخة من MIDAD: تركيزها على <b>Mission → Task Control → Radar → AI Ops → Bot Health</b>.</p><div class="context-rail"><span class="badge '+(ah.ok?"green":"amber")+'">'+(ah.configured?(ah.ok?"BOT ONLINE":"BOT CHECK"):"NOT CONFIGURED")+'</span><span class="badge amber">'+tasksOpen+' TASKS</span><span class="badge cyan">'+n(h.signals||0)+' SIGNALS</span><span class="badge '+(appsOpen?"red":"green")+'">'+appsOpen+' APPROVALS</span></div></div><div class="context-command-actions"><button class="btn primary" data-view="tasks">Task Control</button><button class="btn" data-view="intel">Radar</button><button class="btn" data-view="ai">AI Ops</button><button class="btn warn" data-run="run_autonomy_now">دورة التشغيل</button></div></section>';
 }
 if(S.botContext==="aimidad" && ["cockpit","ai","money","tasks","intel"].includes(S.view)){
   const ready=Math.round(Number(S.data?.capability_gate?.avg_delivery_confidence||0)*100);
   return '<section class="context-command-shell context-aimidad"><div class="context-command-orb"><span>✦</span></div><div><div class="eyebrow">@AIMIDAD_BOT / NEURAL++ COMMAND ROOM</div><h2>النواة تفكر — والـRoom يثبت لماذا.</h2><p>المسار هنا: <b>Observe → Understand → Discover → Decide → Route → Execute → Verify → Learn</b>، مع فصل واضح بين FACT وINFERENCE وAPPROVAL.</p><div class="context-rail"><span class="badge '+(mi.ok?"green":"amber")+'">'+(mi.configured?(mi.ok?"BOT ONLINE":"BOT CHECK"):"NOT CONFIGURED")+'</span><span class="badge cyan">'+oppsOpen+' OPPORTUNITIES</span><span class="badge '+(ready>=70?"green":"amber")+'">DELIVERY '+ready+'%</span><span class="badge '+(appsOpen?"red":"green")+'">'+appsOpen+' APPROVALS</span></div></div><div class="context-command-actions"><button class="btn primary" data-prompt="ما أهم قرار تشغيلي الآن؟ اذكر FACT وEVIDENCE وCAPABILITY وBLOCKER وNEXT ACTION وAPPROVAL وEXPECTED RESULT.">اسأل النواة</button><button class="btn" data-view="money">Opportunity Engine</button><button class="btn" data-view="tasks">Human Gate</button></div></section>';
 }
 return "";
}
function render(){
 if(renderGuard)return;
 renderGuard=true;
 try{
  shell();
  const v=$("#views");
  if(!S.connected&&!S.token)v.innerHTML=lockView();
  else if(S.view==="ai")v.innerHTML=contextPreface()+aiView();
  else if(S.view==="money")v.innerHTML=moneyView();
  else if(S.view==="intel")v.innerHTML=intelView();
  else if(S.view==="tasks")v.innerHTML=tasksView();
  else if(S.view==="ugig")v.innerHTML=ugigView();
  else if(S.view==="mining")v.innerHTML=miningView();
  else if(S.view==="trading")v.innerHTML=contextPreface()+tradingView();
  else if(S.view==="bots")v.innerHTML=botsView();
  else if(S.view==="more")v.innerHTML=moreView();
  else v.innerHTML=contextPreface()+cockpitView();
  bind();
 }catch(e){
  console.error("[MIDAD cockpit render]",e);
  const app=$("#app");
  if(app)app.innerHTML="<div class=\"lock\"><div class=\"box\"><div class=\"eyebrow\">MIDAD / UI RECOVERY</div><h2>الواجهة دخلت وضع الاسترداد</h2><p>حدث خطأ داخل الواجهة، لكن النواة لم تُمسح. أعد التحميل بعد حفظ الحالة الحالية.</p><pre style=\"white-space:pre-wrap;color:#ff9cab;font:11px var(--mono)\">"+esc(e?.message||e)+"</pre><button class=\"btn primary\" onclick=\"location.reload()\">إعادة تحميل</button></div></div>";
 }finally{
  renderGuard=false;
 }
}
function bind(){
 $$("[data-view]").forEach(b=>b.onclick=()=>{S.view=b.dataset.view;render()});
 $$("[data-run]").forEach(b=>b.onclick=()=>runAction(b.dataset.run));
 $$("[data-bot-action]").forEach(b=>b.onclick=()=>botAction(b.dataset.botAction));
 $$("[data-bot-context]").forEach(b=>b.onclick=()=>setBotContext(b.dataset.botContext,b.dataset.botView||"cockpit"));
 const tr=$("[data-cmd=\"tradeRun\"]");if(tr)tr.onclick=runTradingLab;
 $$("[data-approval]").forEach(b=>b.onclick=()=>decide(b.dataset.approval,b.dataset.decision));
 $$("[data-task]").forEach(b=>b.onclick=()=>openTask(b.dataset.task));
 $$("[data-opp]").forEach(b=>b.onclick=()=>openOpp(b.dataset.opp));
 $$("[data-blueprint]").forEach(b=>b.onclick=()=>openBlueprint(b.dataset.blueprint));
 $$("[data-trade-lane]").forEach(b=>b.onclick=()=>showTradeLane(b.dataset.tradeLane));
 $$("[data-prompt]").forEach(b=>b.onclick=()=>{const i=$("#aiInput");if(i){i.value=b.dataset.prompt;i.focus();sendAI()}});
 $$("[data-cmd]").forEach(b=>b.onclick=()=>command(b.dataset.cmd));
 const q=$("#quick");if(q)q.onkeydown=e=>{if(e.key==="Enter")command("quick")};
 const ai=$("#aiSend");if(ai)ai.onclick=sendAI;
 const ac=$("#aiClear");if(ac)ac.onclick=()=>{S.aiMessages=[];render()};
 const ul=$('[data-cmd="ugigLoad"]');if(ul)ul.onclick=loadUgig;
 const ub=$('[data-cmd="ugigBest"]');if(ub)ub.onclick=ugigBest;
 const us=$('[data-cmd="ugigSave"]');if(us)us.onclick=saveUgigProfile;
 const p=$("[data-prefill]");if(p&&S.view==="ai"){const i=$("#aiInput");if(i)i.value=p.dataset.prefill}
}
function openTask(id){
 const t=(S.data?.human_tasks||[]).find(x=>String(x.id)===String(id));if(!t)return;
 const existing=$("#taskModal");if(existing)existing.remove();
 const html='<div id="taskModal" style="position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:90;padding:8vh 8vw;overflow:auto"><div class="panel"><div class="panel-head"><div><div class="eyebrow">TASK</div><h3>'+esc(t.title||"Task")+'</h3><small>'+esc(t.instruction||t.reason||"")+'</small></div><button class="btn" data-cmd="closeTask">إغلاق</button></div><div class="row-main"><b>Priority '+n(t.priority)+'</b><small>Risk '+esc(t.risk_class||"—")+' · '+esc(t.status||"OPEN")+'</small><pre style="white-space:pre-wrap;color:#8290a4;font:11px var(--mono);margin-top:14px">'+esc(JSON.stringify(t.evidence||{},null,2))+'</pre><div class="hero-actions"><button class="btn" data-task-update="'+esc(t.id)+'" data-status="ACKNOWLEDGED">استلام</button><button class="btn primary" data-task-update="'+esc(t.id)+'" data-status="COMPLETED">إكمال</button><button class="btn danger" data-task-update="'+esc(t.id)+'" data-status="CANCELLED">إلغاء</button></div></div></div></div>';
 document.body.insertAdjacentHTML("beforeend",html);
 const m=$("#taskModal");m.querySelectorAll('[data-cmd="closeTask"]').forEach(b=>b.onclick=()=>m.remove());m.querySelectorAll("[data-task-update]").forEach(b=>b.onclick=async()=>{await taskUpdate(b.dataset.taskUpdate,b.dataset.status);m.remove()});
}
function openBlueprint(id){
 const b=(S.data?.income_blueprints||[]).find(x=>String(x.id)===String(id));if(!b)return;
 S.view="ai";render();
 setTimeout(()=>{const i=$("#aiInput");if(i){i.value="راجع هذا الـBlueprint: "+(b.title||"")+"؛ هل هو جاهز للتنفيذ الآن؟ اذكر المتطلبات والعوائق والخطوة التالية والتحصيل المتوقع.";sendAI()}},50);
}
function openOpp(id){
 const o=[...(S.data?.money_opportunities||[]),...(S.data?.opportunities||[])].find(x=>String(x.id)===String(id));
 if(!o)return;
 const old=$("#oppModal");if(old)old.remove();
 const url=o.action_url||o.offer?.action_url||o.offer?.url||o.evidence?.action_url||o.evidence?.url||"";
 const expected=o.expected_value==null?"—":usd(o.expected_value);
 const risk=o.risk_class||o.metadata?.risk_class||"—";
 const readiness=o.readiness||o.status||"—";
 const html='<div id="oppModal" style="position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:95;padding:6vh 6vw;overflow:auto"><div class="panel" style="max-width:980px;margin:auto"><div class="panel-head"><div><div class="eyebrow">OPPORTUNITY / CASH PATH</div><h3>'+esc(o.title||"Opportunity")+'</h3><small>'+esc(o.source||"")+" · score "+n(o.score)+" · confidence "+(o.confidence==null?"—":Math.round(Number(o.confidence)*100)+"%")+'</small></div><button class="btn" data-cmd="closeOpp">إغلاق</button></div><div class="kpis"><div class="kpi"><span>EXPECTED</span><b>'+expected+'</b></div><div class="kpi"><span>STATUS</span><b style="font-size:18px">'+esc(readiness)+'</b></div><div class="kpi"><span>RISK</span><b style="font-size:18px">'+esc(risk)+'</b></div><div class="kpi"><span>HOURS</span><b>'+esc(o.estimated_hours==null?"—":o.estimated_hours)+'</b></div><div class="kpi"><span>DELIVERY CONF.</span><b>'+esc(o.delivery_confidence==null?"—":Math.round(Number(o.delivery_confidence)*100)+"%")+'</b></div></div><section class="panel section-gap"><div class="eyebrow">DESCRIPTION</div><p style="color:#c1cad7;line-height:1.8">'+esc(o.description||"لا يوجد وصف محفوظ.")+'</p><div class="hero-actions"><button class="btn green" data-opp-blueprint="'+esc(o.id)+'">⚙ أنشئ حزمة تنفيذ</button><button class="btn primary" data-opp-ai="'+esc(o.id)+'">✦ حلّل بالـAI</button>'+(url?'<a class="btn" href="'+esc(url)+'" target="_blank" rel="noopener">↗ افتح الفرصة</a>':"")+'</div><div id="oppResult" class="sub" style="margin-top:14px">الحزمة لا تبدأ تنفيذًا خارجيًا؛ تنشئ فقط Blueprint داخليًا قابلًا للمراجعة.</div></section></div></div>';
 document.body.insertAdjacentHTML("beforeend",html);
 const m=$("#oppModal");
 const close=m.querySelector('[data-cmd="closeOpp"]');if(close)close.onclick=()=>m.remove();
 const bp=m.querySelector("[data-opp-blueprint]");
 if(bp)bp.onclick=async()=>{
   bp.disabled=true;const out=$("#oppResult");if(out)out.textContent="جارٍ بناء حزمة التنفيذ…";
   try{const j=await api("prepare_income_blueprint",{opportunity_id:o.id},true,45000);if(out)out.textContent=j.ok?"تم إنشاء Blueprint ويمكن مراجعته من صفحة المال.":"تعذر إنشاء Blueprint: "+(j.error||"غير مؤهل");await refresh(true)}catch(e){if(out)out.textContent="تعذر إنشاء Blueprint: "+String(e.message||e)}finally{bp.disabled=false}
 };
 const ai=m.querySelector("[data-opp-ai]");
 if(ai)ai.onclick=()=>{m.remove();S.view="ai";render();setTimeout(()=>{const input=$("#aiInput");if(input){input.value="حلّل هذه الفرصة: "+(o.title||"")+"؛ قيّم قابلية التنفيذ، العوائق، وما يجب فعله قبل التقديم.";sendAI()}},50)};
}
async function loadUgig(){
 if(S.ugigBusy)return; S.ugigBusy=true; render();
 try{
   const [p,a]=await Promise.all([
     api("ugig",{ugig_action:"profile"},true,30000),
     api("ugig",{ugig_action:"applications"},true,30000)
   ]);
   S.ugigProfile=p; S.ugigApps=Array.isArray(a?.applications)?a.applications:(Array.isArray(a?.data)?a.data:(a?.items||[]));
   toast("تمت مزامنة uGig.","ok");
 }catch(e){toast("uGig: "+e.message,"bad")}
 finally{S.ugigBusy=false;render()}
}
async function ugigBest(){
 try{
   const p=S.ugigProfile||{};
   const wanted=Array.isArray(p.skills)?p.skills:[];
   const j=await api("ugig",{ugig_action:"best_opportunity",wanted_skills:wanted,limit:50},true,45000);
   const top=(j.ranked||[])[0];
   if(!top)return toast("لم تُرجع UGIG فرصة من نتيجة البحث الحالية.","bad");
   toast("أفضل نتيجة حالية: "+(top.title||top.id||"Opportunity")+" · score "+(top.midad_score?.score??"—"),"ok");
   console.log("[MIDAD UGIG best]",top);
 }catch(e){toast("تعذر فحص uGig: "+e.message,"bad")}
}
async function saveUgigProfile(){
 const split=v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean);
 const profile={
   username:$("#ugUsername")?.value?.trim()||"",
   full_name:$("#ugFullName")?.value?.trim()||"",
   hourly_rate:Number($("#ugRate")?.value||0),
   timezone:$("#ugTimezone")?.value?.trim()||"",
   bio:$("#ugBio")?.value||"",
   skills:split($("#ugSkills")?.value),
   ai_tools:split($("#ugTools")?.value),
   is_available:$("#ugAvailable")?.value!=="false"
 };
 try{
   const j=await api("ugig",{ugig_action:"profile_update",profile},true,45000);
   S.ugigProfile=j.verified_profile||j.result||S.ugigProfile;
   toast(j.verification_ok===false?"تم الحفظ لكن تعذر التحقق بعده.":"تم تحديث Profile والتحقق منه.","ok");
   render();
 }catch(e){toast("فشل تحديث Profile: "+e.message,"bad")}
}
async function runAction(a){
 if(S.busy)return;
 S.busy=true;$$("[data-run]").forEach(b=>b.disabled=true);
 const limits={run_opportunity_scan:90000,run_money_scan:90000,run_osint_scan:75000,run_autonomy_now:90000,run_mining_monitor:60000};
 try{
   await api(a,{},true,limits[a]||45000);
   await api("dashboard",{},true,45000);
   await refresh(true);
   toast(({run_opportunity_scan:"مسح الفرص",run_money_scan:"مسح مالي مباشر",run_osint_scan:"مسح OSINT",run_autonomy_now:"دورة التشغيل",run_mining_monitor:"فحص التعدين"})[a]||a+" تم.","ok")
 }catch(e){toast("فشل "+a+": "+e.message,"bad")}
 finally{S.busy=false;$$("[data-run]").forEach(b=>b.disabled=false)}
}
async function decide(id,decision){try{await api("approval_decide",{approval_id:id,decision,note:"Decision from MIDAD Cockpit"});await refresh(true);toast("تم تحديث الموافقة.","ok")}catch(e){toast("تعذر تحديث الموافقة: "+e.message,"bad")}}
async function taskUpdate(id,status){try{await api("human_task_update",{task_id:id,status,response_data:{source:"midad-cockpit"}});await refresh(true);toast("تم تحديث المهمة.","ok")}catch(e){toast("تعذر تحديث المهمة: "+e.message,"bad")}}
function showWallets(){
 const ws=S.data?.wallets||[];
 const old=$("#walletModal");if(old)old.remove();
 const mask=a=>{const s=String(a||"");return s.length>14?s.slice(0,7)+"…"+s.slice(-6):s};
 const html='<div id="walletModal" style="position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:95;padding:7vh 7vw;overflow:auto"><div class="panel"><div class="panel-head"><div><div class="eyebrow">WALLET TREASURY</div><h3>المحافظ تحت المراقبة</h3><small>عناوين عامة فقط؛ لا تُدخل private key أو seed phrase.</small></div><button class="btn" data-cmd="closeWallets">إغلاق</button></div><div class="list">'+(ws.map(x=>'<div class="row"><div class="row-main"><b>'+esc(x.label||"Wallet")+'</b><small>'+esc(x.chain||"—")+' · '+esc(mask(x.address))+'</small></div><span class="badge '+(x.watch_only?"green":"amber")+'">'+(x.watch_only?"WATCH":"MANAGED")+'</span></div>').join("")||'<div class="empty">لا توجد محافظ مسجلة.</div>')+'</div></div></div>';
 document.body.insertAdjacentHTML("beforeend",html);
 const m=$("#walletModal");m.querySelectorAll('[data-cmd="closeWallets"]').forEach(b=>b.onclick=()=>m.remove());
}
function command(cmd){
 if(cmd==="tradeRun")return runTradingLab();
 if(cmd==="aiSend")return sendAI();
 if(cmd==="quick"){const s=String($("#quick")?.value||"").trim().toLowerCase();if(!s)return;if(/ai|ذكاء|مساعد/.test(s)){S.view="ai";render();return}if(/فرص|مال|دخل/.test(s)){S.view="money";render();return}if(/osint|رصد|إشارات/.test(s)){S.view="intel";render();return}if(/مهم|task|approval|مواف/.test(s)){S.view="tasks";render();return}if(/new\$way|new way|cash first|دخل أولاً|طريق جديد/.test(s)){S.view="money";render();toast("NEW$WAY فعال: الأولوية للدخل المقبوض.","ok");return}if(/ugig|uGig|يوجيج|بروفايل/.test(s)){S.view="ugig";render();return}if(/تعدين|viabtc|mining/.test(s)){S.view="mining";render();loadMiningStatus();return}if(/دورة|autonomy/.test(s)){runAction("run_autonomy_now");return}if(/مسح/.test(s)){runAction("run_osint_scan");return}return toast("الأمر غير واضح. جرّب AI، مال، رصد، مهام، تعدين، دورة.","bad")}
 if(cmd==="ugigLoad")return loadUgig(); if(cmd==="ugigBest")return ugigBest(); if(cmd==="ugigSave")return saveUgigProfile(); if(cmd==="refresh")refresh();else if(cmd==="aiClear"){S.aiMessages=[];render()}else if(cmd==="keyConnect"){const k=$("#keyInput")?.value?.trim();if(!k)return toast("أدخل مفتاح الوصول.","bad");saveKey(k);refresh()}else if(cmd==="closeTask")$("#taskModal")?.remove();else if(cmd==="wallets")showWallets();else if(cmd==="closeWallets")$("#walletModal")?.remove();else if(cmd==="miningStatus")return loadMiningStatus();else if(cmd==="telegram"){api("telegram_webhook_info").then(j=>{S.telegram=j;render();toast("تم فحص Telegram.","ok")}).catch(e=>toast("Telegram: "+e.message,"bad"))}else if(cmd==="system"){api("dashboard").then(()=>toast("النواة تعمل.","ok")).catch(e=>toast("النواة: "+e.message,"bad"))}else if(cmd==="focusCommand"){const v=window.prompt("أدخل أمر MIDAD");if(v){const q=$("#quick");if(q)q.value=v;command("quick")}}}
async function sendAI(){
 const i=$("#aiInput");if(!i||S.aiBusy)return;const prompt=i.value.trim();if(!prompt)return;
 const mode=/ما\s*(?:أهم|اهم)\s*شي.*(?:تدخل|يحتاجني).*الآن|شنو.*يحتاجني|what\s+needs\s+me|my\s+intervention/i.test(prompt)?"now":/blueprint|بلوپرنت|مخطط تنفيذ|جاهز للتنفيذ|راجع.*حزمة/i.test(prompt)?"blueprint":/^حلّل هذه الفرصة[:：]/.test(prompt)||/فرصة|opportunity/i.test(prompt)?"opportunity":/مال|دخل|cash|payment|pipeline|client/i.test(prompt)?"money":/مهم|تدخل|approval|موافقة|task/i.test(prompt)?"tasks":/osint|رصد|إشارات|signal|radar|sentinel/i.test(prompt)?"osint":"system";
 S.aiMessages.push({role:"user",text:prompt});i.value="";S.aiBusy=true;render();
 try{
   const j=await api("ai_assist",{prompt,route:"ai",ai_mode:mode},true,75000);
   S.aiMessages.push({role:"ai",text:j.answer||"لم يصل رد.",mode:j.mode||mode,evidence:j.evidence||null,run_id:j.run_id||null});
 }catch(e){
   const m=String(e?.message||e);
   S.aiMessages.push({role:"ai",text:/aborted|abort/i.test(m)?"فشل MIDAD AI: انتهت مهلة الرد قبل وصول النتيجة.":"فشل MIDAD AI: "+m});
 }finally{S.aiBusy=false;render()}
}
function bootTelegram(){const t=TG();if(!t)return;try{t.ready();t.expand()}catch{}let tries=0;(function a(){tries++;if(t.initData){refresh(true);return}if(tries<20)setTimeout(a,250)})()}
S.botContext=getBotContext();try{const u=new URL(location.href);if(u.searchParams.get("view"))S.view=u.searchParams.get("view")}catch{}
async function boot(){render();bootTelegram();if(!S.connected&&!TG()?.initData&&savedKey())refresh(true);setInterval(()=>{if(S.connected&&S.view!=="ai")refresh(true)},90000)}
boot().then(()=>{window.MIDAD_COCKPIT_BOOTING=true;window.MIDAD_COCKPIT_BOOTING=false}).catch(e=>{window.MIDAD_COCKPIT_BOOTING=false;window.MIDAD_COCKPIT_ERROR=String(e?.message||e);throw e});
})();