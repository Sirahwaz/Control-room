(()=>{"use strict";
const CFG={url:"https://froegigfmpmvtecztfbf.supabase.co",fn:"/functions/v1/midad_viabtc_public"};
const S={mining:null,trade:null,busy:false,error:"",workers:[],selected:null,filter:"all",query:"",sort:"status"};
const $=s=>document.querySelector(s);
const esc=v=>String(v??"—").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]));
const num=(v,d=2)=>v==null||!Number.isFinite(Number(v))?"—":Number(v).toLocaleString("en-US",{maximumFractionDigits:d});
const ths=v=>v==null?"—":num(v,2)+" TH/s";
const pct=v=>v==null?"—":num(Number(v)*100,1)+"%";
const ageMinutes=ts=>{if(!ts)return null;const n=Number(ts);const ms=n>2e12?n:n*1000;return Math.max(0,Math.round((Date.now()-ms)/60000))};
function profileKey(w){return "midad_miner_profile_"+String(w?.worker_id??w?.worker_name??"unknown")}
function profile(w){try{return JSON.parse(localStorage.getItem(profileKey(w))||"{}")}catch{return{}}}
function saveProfile(w,p){try{localStorage.setItem(profileKey(w),JSON.stringify(p))}catch{}}
function statusInfo(w){
  const st=String(w?.worker_status||"unknown").toLowerCase();
  const age=ageMinutes(w?.last_active);
  if(["active","online"].includes(st))return {label:"ACTIVE",cls:"green"};
  if(["unactive","inactive","offline"].includes(st))return {label:"INACTIVE",cls:"red"};
  if(age!=null&&age>20)return {label:"STALE",cls:"amber"};
  return {label:String(st||"UNKNOWN").toUpperCase(),cls:"amber"};
}
function workerAlert(w){
  const a=[];
  const st=statusInfo(w),age=ageMinutes(w?.last_active);
  if(st.label==="INACTIVE"||st.label==="STALE")a.push("worker_offline");
  if(Number(w?.reject_rate)>1)a.push("high_reject");
  const h10=Number(w?.hashrate_10min_ths),h24=Number(w?.hashrate_24hour_ths);
  if(Number.isFinite(h10)&&Number.isFinite(h24)&&h24>0&&Math.abs(h10-h24)/h24>.2)a.push("hashrate_drift");
  return {count:a.length,items:a,age};
}
function fleetStats(){
  const ws=S.workers||[];
  const active=ws.filter(w=>statusInfo(w).label==="ACTIVE");
  const inactive=ws.length-active.length;
  const total10=ws.reduce((s,w)=>s+(Number(w.hashrate_10min_ths)||0),0);
  const total1h=ws.reduce((s,w)=>s+(Number(w.hashrate_1hour_ths)||0),0);
  const total24=ws.reduce((s,w)=>s+(Number(w.hashrate_24hour_ths)||0),0);
  const rejects=ws.map(w=>Number(w.reject_rate)).filter(Number.isFinite);
  const avgReject=rejects.length?rejects.reduce((a,b)=>a+b,0)/rejects.length:null;
  const alerts=ws.reduce((s,w)=>s+workerAlert(w).count,0);
  const groups=[...new Set(ws.map(w=>w.group_name||"Default").filter(Boolean))];
  return {count:ws.length,active:active.length,inactive,total10,total1h,total24,avgReject,alerts,groups};
}
function badge(v,cls){return '<span class="badge '+(cls||"amber")+'">'+esc(v)+'</span>'}
function getWorkers(){return (S.workers||[]).filter(w=>{
  const st=statusInfo(w).label.toLowerCase();
  const q=S.query.trim().toLowerCase();
  const hay=[w.worker_name,w.worker_id,w.group_name,w.group_id,w.worker_status].join(" ").toLowerCase();
  const f=S.filter==="all"||st===S.filter;
  return f&&(!q||hay.includes(q));
}).sort((a,b)=>{
  if(S.sort==="hash")return (Number(b.hashrate_10min_ths)||0)-(Number(a.hashrate_10min_ths)||0);
  if(S.sort==="reject")return (Number(b.reject_rate)||0)-(Number(a.reject_rate)||0);
  if(S.sort==="name")return String(a.worker_name||"").localeCompare(String(b.worker_name||""));
  const av=statusInfo(a).label==="ACTIVE"?0:1,bv=statusInfo(b).label==="ACTIVE"?0:1;
  return av-bv;
})}
function minerCard(w){
  const p=profile(w),st=statusInfo(w),al=workerAlert(w),h10=Number(w.hashrate_10min_ths)||0,h24=Number(w.hashrate_24hour_ths)||0;
  const drift=h24>0?((h10-h24)/h24)*100:null;
  return '<article class="miner-card '+st.cls+'" data-worker-id="'+esc(w.worker_id)+'">'+
    '<div class="miner-top"><div><div class="miner-kicker">WORKER #'+esc(w.worker_id)+'</div><h3>'+esc(w.worker_name||"Unnamed Miner")+'</h3><div class="miner-group">'+esc(w.group_name||"Default Group")+'</div></div><div class="miner-state">'+badge(st.label,st.cls)+'</div></div>'+
    '<div class="miner-hash"><span>'+ths(w.hashrate_10min_ths)+'</span><small>10 MIN</small><div class="hashbar"><i style="width:'+Math.min(100,Math.max(4,h10?Math.round((h10/Math.max(h10,h24||h10))*100):4))+'%"></i></div></div>'+
    '<div class="miner-metrics"><div><span>1H</span><b>'+ths(w.hashrate_1hour_ths)+'</b></div><div><span>24H</span><b>'+ths(w.hashrate_24hour_ths)+'</b></div><div><span>REJECT</span><b>'+esc(w.reject_rate==null?"—":num(w.reject_rate,3)+"%")+'</b></div><div><span>LAST ACTIVE</span><b>'+esc(al.age==null?"—":al.age+"m ago")+'</b></div></div>'+
    '<div class="miner-foot">'+(p.model?'<span class="profile-pill">'+esc(p.model)+'</span>':'<span class="profile-pill muted">Machine profile not set</span>')+(drift==null?"":'<span class="profile-pill '+(Math.abs(drift)>20?"warn":"ok")+'">24H drift '+num(drift,1)+'%</span>')+(al.count?'<span class="alert-pill">⚠ '+al.count+' alerts</span>':"")+'<button class="btn miner-open" data-worker-detail="'+esc(w.worker_id)+'">التفاصيل</button></div>'+
  '</article>';
}
function dashboardHtml(){
  const f=fleetStats(),m=S.mining||{};
  return '<section class="dashboard-grid">'+
    '<article class="dash-card hero-stat accent"><div class="dash-label">FLEET HASHRATE · 10M</div><strong>'+ths(f.total10)+'</strong><span>'+num(f.total24,2)+' TH/s · 24H aggregate</span></article>'+
    '<article class="dash-card"><div class="dash-label">MINERS</div><strong>'+num(f.count,0)+'</strong><span><em class="okdot"></em>'+num(f.active,0)+' active · '+num(f.inactive,0)+' inactive</span></article>'+
    '<article class="dash-card"><div class="dash-label">AVG REJECT</div><strong>'+esc(f.avgReject==null?"—":num(f.avgReject,3)+"%")+'</strong><span>من Workers التي أرسلت Reject Rate</span></article>'+
    '<article class="dash-card"><div class="dash-label">PROFIT 24H</div><strong>'+esc(m.profit_24h??"—")+'</strong><span>ViaBTC profit summary</span></article>'+
    '<article class="dash-card"><div class="dash-label">BALANCE</div><strong>'+esc(m.balance??"—")+'</strong><span>Unpaid / available snapshot</span></article>'+
    '<article class="dash-card"><div class="dash-label">SMART ALERTS</div><strong>'+num(f.alerts,0)+'</strong><span>'+esc(f.alerts?"يوجد Workers تحتاج مراجعة":"لا توجد تنبيهات مشتقة")+'</span></article>'+
  '</section>';
}
function controlsHtml(){
  const f=fleetStats();
  return '<section class="miners-toolbar card"><div class="toolbar-head"><div><div class="eyebrow">MINER WALL / DIGITAL TWIN</div><h2>كل Miner على حدة</h2><p>بيانات ViaBTC الحية + ملف الجهاز المحلي عند إضافته.</p></div><div class="toolbar-count">'+num(f.count,0)+' WORKERS</div></div>'+
    '<div class="toolbar-controls"><label><span>بحث</span><input id="minerSearch" placeholder="اسم / Worker ID / Group" value="'+esc(S.query)+'"></label>'+
    '<label><span>الحالة</span><select id="minerFilter"><option value="all">الكل</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="stale">Stale</option></select></label>'+
    '<label><span>ترتيب</span><select id="minerSort"><option value="status">الحالة</option><option value="hash">Hashrate 10m</option><option value="reject">Reject</option><option value="name">الاسم</option></select></label></div>'+
    '<div class="group-row">'+f.groups.map(g=>'<button class="chip" data-group="'+esc(g)+'">'+esc(g)+'</button>').join("")+'</div></section>';
}
function render(){
  const f=fleetStats(),m=S.mining||{},t=S.trade||{},sig=t.signal||{},risk=t.risk||{},e=t.evidence||{},dir=sig.direction||"WAIT";
  $("#vm").innerHTML='<header class="top"><div class="brand"><div class="orb">₿</div><div><b>ViaBTC Monitor</b><small>MIDAD / DIGITAL MINING OPS</small></div></div><div class="top-actions"><span class="status"><i class="dot '+(S.mining?"live":"")+'"></i>'+esc(S.mining?"LIVE TELEMETRY":"LOCKED")+'</span><button class="icon-btn" id="refreshTop" aria-label="تحديث">↻</button></div></header>'+
  '<main><section class="hero"><div><div class="eyebrow">VIABTC / MINING + NON-COPY INTELLIGENCE</div><h1>Digital <span>Mining Dashboard</span></h1><p>محطة تشغيل للمزرعة: كل Miner منفصل، حالته، Hashrate، Reject، Last Active، History، Alerts، وMachine Profile — دون خلطها مع Control Room.</p><div class="actions"><button class="btn primary" id="refresh">تحديث المحطة</button><button class="btn" id="run">تشغيل التحليل</button><button class="btn subtle" id="focusMiners">عرض الـMiners</button></div></div><div class="orbit"><div class="core"><b>BTC</b><small>'+esc(dir)+'</small></div></div></section>'+
  '<section class="system-strip"><div><span>TRANSPORT</span><b>'+esc(m.transport||"—")+'</b></div><div><span>LAST SNAPSHOT</span><b>'+esc(m.updated_at?new Date(m.updated_at).toLocaleString():"—")+'</b></div><div><span>READ ONLY</span><b>ON</b></div><div><span>LIVE EXECUTION</span><b>LOCKED</b></div></section>'+
  dashboardHtml()+
  controlsHtml()+
  '<section class="miners-list" id="minersList">'+(getWorkers().map(minerCard).join("")||'<div class="empty">لم تصل قائمة Workers بعد. اضغط «تحديث المحطة».</div>')+'</section>'+
  '<section class="ops-grid"><article class="card"><div class="head"><div><div class="eyebrow">MINING TELEMETRY</div><h2>الحالة المباشرة</h2></div>'+badge(m.status||"UNKNOWN",(m.status||"").toUpperCase()==="CONNECTED"?"green":"amber")+'</div><div class="facts"><div class="fact"><span>ACCOUNT HASHRATE</span><b>'+ths(m.hashrate)+'</b><p>الإجمالي كما يعيده حساب ViaBTC.</p></div><div class="fact"><span>WORKERS OBSERVED</span><b>'+num(f.count,0)+'</b><p>تفصيل القائمة الحالية.</p></div><div class="fact"><span>PROFIT</span><b>'+esc(m.profit_24h??"—")+'</b><p>لا نُخمن عندما لا يصل المصدر.</p></div><div class="fact"><span>ERROR</span><b class="'+(m.error?"error":"")+'">'+esc(m.error||"لا يوجد خطأ مسجل")+'</b></div></div></article>'+
  '<article class="card"><div class="head"><div><div class="eyebrow">SMART RECOMMENDATIONS</div><h2>اقتراحات التشغيل</h2></div><span class="badge violet">DIGITAL OPS</span></div><div class="recommendations"><div><b>01 · Worker Stability</b><span>راقب أي Miner INACTIVE/STALE أكثر من 20 دقيقة ثم افحص الشبكة والطاقة قبل إعادة التشغيل.</span></div><div><b>02 · Reject Control</b><span>أي Reject Rate مرتفع يجب أن يظهر بوضوح على مستوى الـWorker بدل دفنه داخل المتوسط.</span></div><div><b>03 · Machine Profile</b><span>أدخل Model + Rated TH/s + Watts لكل Miner. بعدها يمكن حساب Efficiency وNet daily value بشكل حقيقي.</span></div><div><b>04 · Fleet vs Miner</b><span>قارن 10m مقابل 24h لكل Miner لاكتشاف drift قبل أن يؤثر على الناتج الكلي.</span></div><div><b>05 · Intelligence</b><span>نربط لاحقًا نتائج التعدين مع Money/Opportunity بدون خلط Mining telemetry مع قرار التداول.</span></div></div></article></section>'+
  '<section class="card section"><div class="head"><div><div class="eyebrow">NON-COPY INTELLIGENCE</div><h2>Trading Lab</h2></div><span class="badge cyan">PAPER ONLY</span></div><div class="facts"><div class="fact"><span>SIGNAL</span><b>'+esc(dir)+'</b><p>Confidence: '+(sig.confidence==null?"—":Math.round(Number(sig.confidence)*100)+"%")+'</p></div><div class="fact"><span>RISK GATE</span><b>'+esc(risk.gate_decision||"—")+'</b><p>لا يتحول إلى أمر حي.</p></div><div class="fact"><span>REGIME</span><b>'+esc(t.features?.regime||"—")+'</b></div><div class="fact"><span>PAPER</span><b>'+esc(t.paper_trade?.status||"NOT_CREATED")+'</b></div></div></section>'+
  '<section class="card section"><div class="head"><div><div class="eyebrow">EVIDENCE</div><h2>مصادر وقيود</h2></div></div><div class="facts"><div class="fact"><span>MARKET SOURCES</span><b>'+esc(Array.isArray(e.market_sources)?e.market_sources.length:"—")+'</b></div><div class="fact"><span>TRANSPORT BLOCKS</span><b>'+esc(Array.isArray(e.source_errors)?e.source_errors.length:"—")+'</b></div></div></section>'+
  '<div class="errorBox" id="errorBox" style="display:'+(S.error?"block":"none")+'"><b>تعذر تنفيذ آخر عملية</b><pre>'+esc(S.error||"")+'</pre><button class="btn" id="retryError">إعادة المحاولة</button></div>'+
  '<p class="note">MIDAD قاعدة الفصل: ViaBTC Monitor يراقب التعدين ويعرض التحليل المستقل فقط. لا copy-trading، لا سحب، ولا live trade من هذه الواجهة.</p></main>'+
  '<div class="bottom"><button class="btn" id="refresh2">↻ تحديث</button><button class="btn primary" id="run2">▶ تشغيل التحليل</button></div>';
  bind();
}
function bind(){
  ["#refresh","#refresh2","#refreshTop"].forEach(s=>{const q=$(s);if(q)q.onclick=refresh});
  ["#run","#run2"].forEach(s=>{const q=$(s);if(q)q.onclick=run});
  const f=$("#minerFilter");if(f){f.value=S.filter;f.onchange=e=>{S.filter=e.target.value;render()}}
  const so=$("#minerSort");if(so){so.value=S.sort;so.onchange=e=>{S.sort=e.target.value;render()}}
  const search=$("#minerSearch");if(search){search.oninput=e=>{S.query=e.target.value;const list=$("#minersList");if(list)list.innerHTML=getWorkers().map(minerCard).join("")||'<div class="empty">لا يوجد تطابق.</div>';bindMinerButtons()}}
  const focus=$("#focusMiners");if(focus)focus.onclick=()=>document.getElementById("minersList")?.scrollIntoView({behavior:"smooth",block:"start"});
  const retry=$("#retryError");if(retry)retry.onclick=refresh;
  bindMinerButtons();
  document.querySelectorAll("[data-group]").forEach(b=>b.onclick=()=>{S.query=b.dataset.group;S.filter="all";render();document.getElementById("minersList")?.scrollIntoView({behavior:"smooth"})});
}
function bindMinerButtons(){
  document.querySelectorAll("[data-worker-detail]").forEach(b=>b.onclick=()=>openWorker(b.dataset.workerDetail));
}
function applySnapshot(x){
  const s=x?.snapshot?.snapshot||x?.snapshot||x;
  S.mining=s?.mining||null;
  S.workers=Array.isArray(s?.mining?.workers)?s.mining.workers:[];
  S.connected=Boolean(s?.ok&&S.mining);
}
async function refresh(){
  if(S.busy)return;S.busy=true;S.error="";render();
  try{
    const j=await post("refresh");applySnapshot(j);
    S.trade=null;
    S.error=j?.monitor?.ok?"":(j?.monitor?.error||j?.snapshot?.error||"");
  }catch(e){S.connected=false;S.error=String(e?.message||e)}
  finally{S.busy=false;render()}
}
async function run(){
  if(S.busy)return;S.busy=true;S.error="";render();
  try{
    const j=await post("analysis",90000);applySnapshot(j);S.trade=j?.analysis?.analysis||j?.analysis||null;
    S.error=j?.ok?"":(j?.analysis?.error||"paper_analysis_failed");
  }catch(e){S.error=String(e?.message||e)}
  finally{S.busy=false;render()}
}
async function openWorker(id){
  const w=S.workers.find(x=>String(x.worker_id)===String(id));if(!w)return;
  const old=document.getElementById("minerModal");if(old)old.remove();
  const p=profile(w),al=workerAlert(w),st=statusInfo(w);
  const loading='<div id="workerHistory" class="history-box"><div class="history-loading">جاري قراءة History…</div></div>';
  document.body.insertAdjacentHTML("beforeend",'<div class="modal-backdrop" id="minerModal"><section class="miner-modal"><div class="modal-head"><div><div class="eyebrow">MINER DETAIL / WORKER #'+esc(w.worker_id)+'</div><h2>'+esc(w.worker_name||"Unnamed Miner")+'</h2><div class="modal-sub">'+esc(w.group_name||"Default Group")+' · '+badge(st.label,st.cls)+'</div></div><button class="icon-btn close" id="closeMiner" aria-label="إغلاق">×</button></div><div class="detail-grid"><div><span>10 MIN</span><b>'+ths(w.hashrate_10min_ths)+'</b></div><div><span>1 HOUR</span><b>'+ths(w.hashrate_1hour_ths)+'</b></div><div><span>24 HOUR</span><b>'+ths(w.hashrate_24hour_ths)+'</b></div><div><span>REJECT</span><b>'+esc(w.reject_rate==null?"—":num(w.reject_rate,3)+"%")+'</b></div><div><span>LAST ACTIVE</span><b>'+esc(al.age==null?"—":al.age+" minutes ago")+'</b></div><div><span>WORKER STATUS</span><b>'+esc(w.worker_status||"—")+'</b></div></div>'+
    '<section class="profile-panel"><div class="profile-head"><div><div class="eyebrow">MACHINE PROFILE</div><h3>مواصفات الجهاز</h3><small>هذه البيانات محلية لهذا المتصفح ولا ندّعي أنها من ViaBTC.</small></div><span class="badge '+(p.model?"green":"amber")+'">'+(p.model?"CONFIGURED":"NOT SET")+'</span></div><div class="profile-grid">'+
    '<label><span>Model</span><input id="pfModel" value="'+esc(p.model||"")+'" placeholder="e.g. Antminer M31+"></label><label><span>Rated Hashrate TH/s</span><input id="pfThs" inputmode="decimal" value="'+esc(p.rated_ths??"")+'"></label><label><span>Power Watts</span><input id="pfWatts" inputmode="decimal" value="'+esc(p.watts??"")+'"></label><label><span>Location</span><input id="pfLocation" value="'+esc(p.location||"")+'" placeholder="Farm / Rack"></label><label><span>Firmware</span><input id="pfFirmware" value="'+esc(p.firmware||"")+'"></label><label><span>Notes</span><input id="pfNotes" value="'+esc(p.notes||"")+'"></label></div><div class="profile-actions"><button class="btn primary" id="saveProfile">حفظ المواصفات</button><span id="profileSaveMsg"></span></div></section>'+
    loading+
    '<div class="modal-footer"><button class="btn" id="closeMiner2">إغلاق</button></div></section></div>');
  $("#closeMiner").onclick=()=>$("#minerModal")?.remove();$("#closeMiner2").onclick=()=>$("#minerModal")?.remove();
  $("#minerModal").onclick=e=>{if(e.target.id==="minerModal")e.currentTarget.remove()};
  $("#saveProfile").onclick=()=>{
    const np={model:$("#pfModel").value.trim(),rated_ths:Number($("#pfThs").value)||null,watts:Number($("#pfWatts").value)||null,location:$("#pfLocation").value.trim(),firmware:$("#pfFirmware").value.trim(),notes:$("#pfNotes").value.trim()};
    saveProfile(w,np);$("#profileSaveMsg").textContent="✓ محفوظ محليًا";$("#profileSaveMsg").className="saved";render();
  };
  try{
    const r=await fetch(CFG.url+CFG.fn,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"worker_detail",worker_id:String(id)})});
    const j=await r.json().catch(()=>({}));
    const d=j?.detail||{};
    const hist=Array.isArray(d.history)?d.history:[];
    $("#workerHistory").innerHTML=renderHistory(hist,d.transport,d.history_partial);
  }catch(e){$("#workerHistory").innerHTML='<div class="history-error">تعذر قراءة history: '+esc(e.message||e)+'</div>'}
}
function renderHistory(rows,transport,partial){
  if(!rows.length)return '<div class="history-empty">لا توجد نقاط History راجعة من ViaBTC لهذا الـWorker.</div>';
  const vals=rows.map(x=>({date:x.date||"—",ths:Number(x.hashrate)>=1e9?Number(x.hashrate)/1e12:Number(x.hashrate)||0,reject:x.reject_rate}));
  const mx=Math.max(...vals.map(x=>x.ths),1);
  return '<div class="history-head"><div><div class="eyebrow">7D HASHRATE HISTORY</div><h3>مسار الأداء</h3></div><span class="badge '+(partial?"amber":"green")+'">'+(partial?"PARTIAL":"VERIFIED")+'</span></div><div class="history-chart">'+vals.slice().reverse().map(x=>'<div class="bar-col"><div class="bar-value">'+num(x.ths,1)+'</div><div class="bar" style="height:'+Math.max(8,Math.round((x.ths/mx)*100))+'%"></div><small>'+esc(String(x.date).slice(5))+'</small></div>').join("")+'</div><div class="history-note">Transport: '+esc(transport||"—")+' · القيم الأصلية من ViaBTC Hashrate History.</div>';
}
async function post(action,timeout=60000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(CFG.url+CFG.fn,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action}),signal:c.signal});const j=await r.json().catch(()=>({}));if(!r.ok||j.ok===false)throw new Error(j.error||j.message||"HTTP "+r.status);return j}
  finally{clearTimeout(t)}
}
window.addEventListener("load",()=>{render();refresh();window.setInterval(()=>{if(!S.busy)refresh()},30000)});
})();