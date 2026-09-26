(()=>{
"use strict";
const CFG={url:"https://froegigfmpmvtecztfbf.supabase.co",fn:"/functions/v1/midad_control_room",build:"cockpit-2026-09-26-r1"};
const TG=()=>window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;
const S={view:"cockpit",token:"",connected:false,user:null,data:null,telegram:null,busy:false,aiBusy:false,aiMessages:[],error:""};
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
 try{const j=await api("dashboard",{},true,45000);S.data=j;S.connected=true;S.error="";render();if(!silent)toast("تم تحديث النواة.","ok");return j}
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
function shell(){
 $("#app").innerHTML='<div id="cr"><aside class="cr-rail"><div class="cr-mark '+(S.connected?"live":"")+'">M</div><div class="cr-nav">'+nav("cockpit","⌂","المقود")+nav("ai","✦","AI")+nav("money","◆","المال")+nav("intel","⌬","الرصد")+nav("tasks","✓","المهام")+'</div><div class="cr-rail-spacer"></div><button class="cr-more" data-view="more"><span>☷</span><span>المزيد</span></button></aside><main class="cr-main"><header class="cr-top"><div class="cr-titlebar"><b>MIDAD</b><small>NEURAL CONTROL DECK</small></div><div class="cr-command"><input id="quick" placeholder="اكتب أمرًا: AI / فرص / OSINT / مهام / تعدين / دورة"><button class="btn primary" data-cmd="quick">نفّذ</button></div><div class="cr-actions"><div class="cr-status"><i class="dot '+(S.connected?"live":"")+'"></i><span>'+(S.connected?"VERIFIED":"LOCKED")+'</span></div><button class="iconbtn" data-cmd="refresh">↻</button></div></header><div id="views"></div></main></div><div class="toastbox" id="crToast"></div>';
 $$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===S.view));
}
function rowTask(x){return '<div class="row click" data-task="'+esc(x.id)+'"><div class="row-main"><b>'+esc(x.title||"Human task")+'</b><small>أولوية '+n(x.priority)+' · '+esc(x.risk_class||"—")+' · '+esc(x.instruction||x.reason||"")+'</small></div><span class="badge '+(x.blocking?"red":"amber")+'">'+esc(x.status||"OPEN")+'</span></div>'}
function rowOpp(x){return '<div class="row click" data-opp="'+esc(x.id)+'"><div class="row-main"><b>'+esc(x.title||"Opportunity")+'</b><small>'+esc(x.source||"")+" · score "+n(x.score)+" · "+(x.confidence==null?"—":Math.round(Number(x.confidence)*100)+"%")+'</small></div><span class="badge cyan">'+usd(x.expected_value)+'</span></div>'}
function cockpitView(){
 const h=H(),ts=tasks(),aa=apps(),oo=opps(),mo=moneyOpps(),ss=sigs(),ready=Math.round(Number(S.data?.capability_gate?.avg_delivery_confidence||0)*100);
 return '<div class="cr-page"><section class="cr-hero"><div class="hero-panel"><div class="eyebrow">MIDAD / COMMAND DECK</div><h1>المقود بيدك.<br>والنظام تحت عينيك.</h1><p>واجهة قيادة واحدة بدل طبقات متداخلة. AI منفصل، المال منفصل، الرصد منفصل، والقرارات الحساسة تبقى خلف بوابة بشرية.</p><div class="hero-actions"><button class="btn primary" data-view="ai">✦ افتح AI</button><button class="btn green" data-run="run_opportunity_scan">💰 ابحث عن مال</button><button class="btn" data-run="run_osint_scan">⌬ حدّث الرصد</button><button class="btn warn" data-run="run_autonomy_now">⚡ دورة التشغيل</button></div></div><div class="hero-panel" style="display:grid;place-items:center"><div class="orb"><div><b>MIDAD</b><small>'+(!S.error?(S.connected?"LIVE CORE":"LOCKED"):"ERROR")+'</small></div></div></div></section><div class="kpis"><div class="kpi"><span>MONEY OPPS</span><b>'+n(h.money_opportunities??mo.length)+'</b><div class="sub">فرص عمل قابلة للتحويل</div></div><div class="kpi"><span>SIGNALS</span><b>'+n(h.signals)+'</b><div class="sub">إشارات الرادار</div></div><div class="kpi"><span>HUMAN TASKS</span><b>'+n(h.pending_human_tasks)+'</b><div class="sub">تحتاج يدك</div></div><div class="kpi"><span>CASH PIPELINE</span><b>'+usd(pipeline())+'</b><div class="sub">قيمة متوقعة</div></div><div class="kpi"><span>READINESS</span><b>'+ready+'%</b><div class="sub">قابلية تسليم</div></div></div><section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">NOW</div><h3>ماذا يحتاجني الآن؟</h3></div><button class="btn" data-view="tasks">كل المهام</button></div><div class="list">'+(ts.slice(0,5).map(rowTask).join("")||'<div class="empty">لا توجد مهمة بشرية مفتوحة.</div>')+'</div></div><div class="panel"><div class="panel-head"><div><div class="eyebrow">MONEY LANE</div><h3>الفرص التي تستحق النظر</h3></div><button class="btn" data-view="money">فتح المال</button></div><div class="list">'+(mo.slice(0,5).map(rowOpp).join("")||'<div class="empty">لا توجد حاليًا فرصة paid_work في مسار المال.</div>')+'</div></div></section><section class="grid g2 section-gap"><div class="panel"><div class="panel-head"><div><div class="eyebrow">RADAR</div><h3>الرصد الحي</h3></div><button class="btn" data-view="intel">فتح الرصد</button></div><div class="stream">'+(ss.slice(0,8).map(x=>'<div class="item"><b>'+esc(x.type_label||x.signal_type||"Signal")+'</b> · '+esc(x.entity||"—")+' <span class="badge cyan">'+n(x.score)+'</span><p>'+esc(x.source||"source")+" · confidence "+(x.confidence==null?"—":Math.round(Number(x.confidence)*100)+"%")+"</p></div>").join("")||'<div class="empty">لا توجد إشارات.</div>')+'</div></div><div class="panel"><div class="panel-head"><div><div class="eyebrow">SYSTEM</div><h3>صحة التشغيل</h3></div><button class="btn" data-view="more">التفاصيل</button></div><div class="list"><div class="row"><div class="row-main"><b>Supabase Core</b><small>جلسة التحكم</small></div><span class="badge '+(S.connected?"green":"red")+'">'+(S.connected?"LIVE":"LOCKED")+'</span></div><div class="row"><div class="row-main"><b>Telegram</b><small>Web App identity</small></div><span class="badge '+(TG()?.initData?"green":"amber")+'">'+(TG()?.initData?"CONNECTED":"CONTEXT")+'</span></div><div class="row"><div class="row-main"><b>Opportunity Engine</b><small>'+esc(h.pipeline_note||"")+'</small></div><span class="badge '+(h.pipeline_ok?"green":"amber")+'">'+(h.pipeline_ok?"FLOW":"CHECK")+'</span></div></div></div></section></div>'
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
function aiView(){
 const msgs=S.aiMessages.length?S.aiMessages.map(m=>'<div class="bubble '+m.role+'"><span class="meta">'+(m.role==="ai"?"MIDAD AI":"أنت")+'</span><div class="bubble-body">'+(m.role==="ai"?formatAI(m.text):esc(m.text).replace(/\\n/g,"<br>"))+'</div></div>').join(""):'<div class="empty">هذا AI مستقل عن OSINT. اسأله عن القرار، المال، العوائق، أو إصلاح النظام.</div>';
 return '<div class="cr-page"><div class="ai-shell"><section class="panel ai-chat"><div class="panel-head"><div><div class="eyebrow">MIDAD AI / REASONING</div><h3>العقل هنا، وليس الرادار.</h3><small>AI يقرأ حالة MIDAD ويشرح القرار دون أن يتحول إلى OSINT.</small></div><button class="btn" data-cmd="aiClear">مسح</button></div><div class="ai-scroll" id="aiScroll">'+msgs+'</div><div class="ai-compose"><textarea id="aiInput" placeholder="اسأل MIDAD AI…"></textarea><button class="btn primary" data-cmd="aiSend">إرسال</button></div></section><aside class="panel"><div class="eyebrow">DIRECT QUESTIONS</div><h3>اضغط سؤالًا</h3><div class="prompt-grid"><button data-prompt="ما أهم شيء يحتاج تدخلي الآن؟">ما الذي يحتاجني الآن؟</button><button data-prompt="أين أقرب فرصة دخل قابلة للتنفيذ وما عائقها؟">أين أقرب فرصة دخل؟</button><button data-prompt="حلّل أعلى مهمة بشرية وقل لي ماذا أفعل خطوة بخطوة.">حلّل أعلى مهمة</button><button data-prompt="هل يوجد عطل في مسار تحويل الإشارات إلى فرص دخل؟">هل مسار المال متعطل؟</button><button data-prompt="افحص صحة النظام وما الذي يحتاج إصلاحًا؟">هل النظام سليم؟</button></div></aside></div></div>'
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
function moreView(){
 const h=H(),t=S.telegram?.result||S.telegram||{};
 return '<div class="cr-page"><section class="hero-panel"><div class="eyebrow">MORE / TOOLS</div><h1 style="font-size:48px">الأدوات، لا الصفحات.</h1><p>أبقيت الأدوات ذات الغرض الواضح، وأخرجت الفوضى من المسار الرئيسي.</p></section><section class="more-grid section-gap"><div class="toolcard"><b>⛏ التعدين</b><p>ViaBTC monitor.</p><button class="btn" data-run="run_mining_monitor">تشغيل الفحص</button></div><div class="toolcard"><b>⚡ الاستقلالية</b><p>تشغيل دورة MIDAD مع بقاء بوابات الأمان.</p><button class="btn warn" data-run="run_autonomy_now">تشغيل الدورة</button></div><div class="toolcard"><b>📡 Telegram</b><p>'+esc(t.url||"لم يُفحص بعد")+'</p><button class="btn" data-cmd="telegram">فحص Telegram</button></div><div class="toolcard"><b>✺ النظام</b><p>'+esc(S.connected?"جلسة موثقة":"الجلسة مقفلة")+'</p><button class="btn" data-cmd="system">فحص الصحة</button></div><div class="toolcard"><b>◎ المحافظ</b><p>'+n((S.data?.wallets||[]).length)+' محافظ مسجلة في النواة.</p><button class="btn" data-cmd="wallets">عرض الحالة</button></div><div class="toolcard"><b>⌘ أمر سريع</b><p>نفّذ أمرًا نصيًا من الشريط العلوي.</p><button class="btn" data-cmd="focusCommand">اكتب أمرًا</button></div></section></div>'
}
function lockView(){return '<div class="lock"><div class="box"><div class="eyebrow">MIDAD / SECURE CONTROL</div><h2>الغرفة مقفلة حتى نعرف من أنت.</h2><p>داخل Telegram يتم أخذ هوية Web App تلقائيًا. من المتصفح العادي يمكنك استخدام مفتاح الوصول المحلي إن كان لديك.</p><div class="key-row"><input id="keyInput" type="password" placeholder="Access key"><button class="btn primary" data-cmd="keyConnect">دخول</button></div><div style="margin-top:12px;color:#69788b;font-size:10px">لا تدخل seed phrase أو private key.</div></div></div>'}
let renderGuard=false;\nfunction render(){\n if(renderGuard)return;\n renderGuard=true;\n try{\n  shell();\n  const v=$("#views");\n  if(!S.connected&&!S.token){v.innerHTML=lockView()}\n  else if(S.view==="ai")v.innerHTML=aiView();\n  else if(S.view==="money")v.innerHTML=moneyView();\n  else if(S.view==="intel")v.innerHTML=intelView();\n  else if(S.view==="tasks")v.innerHTML=tasksView();\n  else if(S.view==="more")v.innerHTML=moreView();\n  else v.innerHTML=cockpitView();\n  bind();\n }catch(e){\n  console.error("[MIDAD cockpit render]",e);\n  const app=$("#app");\n  if(app)app.innerHTML="<div class=\"lock\"><div class=\"box\"><div class=\"eyebrow\">MIDAD / UI RECOVERY</div><h2>الواجهة دخلت وضع الاسترداد</h2><p>حدث خطأ داخل الواجهة، لكن النواة لم تُمسح. أعد التحميل بعد حفظ الحالة الحالية.</p><pre style=\"white-space:pre-wrap;color:#ff9cab;font:11px var(--mono)\">"+esc(e?.message||e)+"</pre><button class=\"btn primary\" onclick=\"location.reload()\">إعادة تحميل</button></div></div>";\n }finally{renderGuard=false}\n}
function bind(){
 $$("[data-view]").forEach(b=>b.onclick=()=>{S.view=b.dataset.view;render()});
 $$("[data-run]").forEach(b=>b.onclick=()=>runAction(b.dataset.run));
 $$("[data-approval]").forEach(b=>b.onclick=()=>decide(b.dataset.approval,b.dataset.decision));
 $$("[data-task]").forEach(b=>b.onclick=()=>openTask(b.dataset.task));
 $("[data-opp]").forEach(b=>b.onclick=()=>openOpp(b.dataset.opp));
 $("[data-blueprint]").forEach(b=>b.onclick=()=>openBlueprint(b.dataset.blueprint));
 $("[data-prompt]").forEach(b=>b.onclick=()=>{const i=$("#aiInput");if(i){i.value=b.dataset.prompt;i.focus();sendAI()}});
 $$("[data-cmd]").forEach(b=>b.onclick=()=>command(b.dataset.cmd));
 const q=$("#quick");if(q)q.onkeydown=e=>{if(e.key==="Enter")command("quick")};
 const ai=$("#aiSend");if(ai)ai.onclick=sendAI;
 const ac=$("#aiClear");if(ac)ac.onclick=()=>{S.aiMessages=[];render()};
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
function openOpp(id){const o=[...(S.data?.money_opportunities||[]),...(S.data?.opportunities||[])].find(x=>String(x.id)===String(id));if(!o)return;S.view="ai";render();setTimeout(()=>{const i=$("#aiInput");if(i){i.value="حلّل هذه الفرصة: "+(o.title||"")+"؛ هل أستطيع تنفيذها وما الخطوة التالية؟";sendAI()}},50)}
async function runAction(a){
 if(S.busy)return;
 S.busy=true;$("[data-run]").forEach(b=>b.disabled=true);
 const limits={run_opportunity_scan:90000,run_osint_scan:75000,run_autonomy_now:90000,run_mining_monitor:60000};
 try{
   await api(a,{},true,limits[a]||45000);
   await api("dashboard",{},true,45000);
   await refresh(true);
   toast(({run_opportunity_scan:"مسح الفرص",run_osint_scan:"مسح OSINT",run_autonomy_now:"دورة التشغيل",run_mining_monitor:"فحص التعدين"})[a]||a+" تم.","ok")
 }catch(e){toast("فشل "+a+": "+e.message,"bad")}
 finally{S.busy=false;$("[data-run]").forEach(b=>b.disabled=false)}
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
 if(cmd==="aiSend")return sendAI();
 if(cmd==="quick"){const s=String($("#quick")?.value||"").trim().toLowerCase();if(!s)return;if(/ai|ذكاء|مساعد/.test(s)){S.view="ai";render();return}if(/فرص|مال|دخل/.test(s)){S.view="money";render();return}if(/osint|رصد|إشارات/.test(s)){S.view="intel";render();return}if(/مهم|task|approval|مواف/.test(s)){S.view="tasks";render();return}if(/تعدين|mining/.test(s)){runAction("run_mining_monitor");return}if(/دورة|autonomy/.test(s)){runAction("run_autonomy_now");return}if(/مسح/.test(s)){runAction("run_osint_scan");return}return toast("الأمر غير واضح. جرّب AI، مال، رصد، مهام، تعدين، دورة.","bad")}
 if(cmd==="refresh")refresh();else if(cmd==="aiClear"){S.aiMessages=[];render()}else if(cmd==="keyConnect"){const k=$("#keyInput")?.value?.trim();if(!k)return toast("أدخل مفتاح الوصول.","bad");saveKey(k);refresh()}else if(cmd==="closeTask")$("#taskModal")?.remove();else if(cmd==="wallets")showWallets();else if(cmd==="closeWallets")$("#walletModal")?.remove();else if(cmd==="telegram"){api("telegram_webhook_info").then(j=>{S.telegram=j;render();toast("تم فحص Telegram.","ok")}).catch(e=>toast("Telegram: "+e.message,"bad"))}else if(cmd==="system"){api("dashboard").then(()=>toast("النواة تعمل.","ok")).catch(e=>toast("النواة: "+e.message,"bad"))}else if(cmd==="focusCommand"){const v=window.prompt("أدخل أمر MIDAD");if(v){const q=$("#quick");if(q)q.value=v;command("quick")}}}
async function sendAI(){
 const i=$("#aiInput");if(!i||S.aiBusy)return;const prompt=i.value.trim();if(!prompt)return;
 const mode=/^حلّل هذه الفرصة[:：]/.test(prompt)||/فرصة|opportunity/i.test(prompt)?"opportunity":/مال|دخل|cash|payment|pipeline|client/i.test(prompt)?"money":/مهم|تدخل|approval|موافقة|task/i.test(prompt)?"tasks":/osint|رصد|إشارات|signal|radar|sentinel/i.test(prompt)?"osint":"system";
 S.aiMessages.push({role:"user",text:prompt});i.value="";S.aiBusy=true;render();
 try{
   const j=await api("ai_assist",{prompt,route:"ai",ai_mode:mode},true,75000);
   S.aiMessages.push({role:"ai",text:j.answer||"لم يصل رد."});
 }catch(e){
   const m=String(e?.message||e);
   S.aiMessages.push({role:"ai",text:/aborted|abort/i.test(m)?"فشل MIDAD AI: انتهت مهلة الرد قبل وصول النتيجة.":"فشل MIDAD AI: "+m});
 }finally{S.aiBusy=false;render()}
}
function bootTelegram(){const t=TG();if(!t)return;try{t.ready();t.expand()}catch{}let tries=0;(function a(){tries++;if(t.initData){refresh(true);return}if(tries<20)setTimeout(a,250)})()}
async function boot(){render();bootTelegram();if(!S.connected&&!TG()?.initData&&savedKey())refresh(true);setInterval(()=>{if(S.connected&&S.view!=="ai")refresh(true)},90000)}
boot();
})();