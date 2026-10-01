(()=>{"use strict";
const CFG={url:"https://froegigfmpmvtecztfbf.supabase.co",fn:"/functions/v1/midad_viabtc_public"};
const S={mining:null,trade:null,busy:false,error:"",workers:[],selected:null,filter:"all",query:"",sort:"status",view:"cards"};
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
  const a=[],st=statusInfo(w),age=ageMinutes(w?.last_active);
  const h10=Number(w?.hashrate_10min_ths),h1=Number(w?.hashrate_1hour_ths),h24=Number(w?.hashrate_24hour_ths),rej=Number(w?.reject_rate);
  const drift=h24>0&&Number.isFinite(h10)?((h10-h24)/h24)*100:null;
  const shortDrift=h1>0&&Number.isFinite(h10)?((h10-h1)/h1)*100:null;
  if(st.label==="INACTIVE"||st.label==="STALE")a.push("worker_offline");
  if(Number.isFinite(rej)&&rej>.5)a.push("high_reject");
  if(Number.isFinite(rej)&&rej>1)a.push("critical_reject");
  if(Number.isFinite(drift)&&Math.abs(drift)>20)a.push("hashrate_drift");
  if(Number.isFinite(shortDrift)&&Math.abs(shortDrift)>12)a.push("short_term_drift");
  if(age!=null&&age>60)a.push("stale_telemetry");
  const penalties=(st.label==="INACTIVE"?55:st.label==="STALE"?35:0)+(Number.isFinite(rej)?Math.min(25,rej*18):0)+(Number.isFinite(drift)?Math.min(20,Math.abs(drift)/4):0);
  const health=Math.max(0,Math.min(100,Math.round(100-penalties)));
  const anomaly=Math.max(0,Math.min(100,Math.round(100-health)));
  const dna=health>=90?"STABLE":health>=75?"WATCH":health>=50?"UNSTEADY":"CRITICAL";
  return {count:a.length,items:a,age,drift,shortDrift,health,anomaly,dna};
}
function fleetStats(){
  const ws=S.workers||[],active=ws.filter(w=>statusInfo(w).label==="ACTIVE"),inactive=ws.length-active.length;
  const total10=ws.reduce((s,w)=>s+(Number(w.hashrate_10min_ths)||0),0),total1h=ws.reduce((s,w)=>s+(Number(w.hashrate_1hour_ths)||0),0),total24=ws.reduce((s,w)=>s+(Number(w.hashrate_24hour_ths)||0),0);
  const rejects=ws.map(w=>Number(w.reject_rate)).filter(Number.isFinite),avgReject=rejects.length?rejects.reduce((a,b)=>a+b,0)/rejects.length:null;
  const alerts=ws.reduce((s,w)=>s+workerAlert(w).count,0),avgHealth=ws.length?Math.round(ws.reduce((s,w)=>s+workerAlert(w).health,0)/ws.length):null,avgAnomaly=ws.length?Math.round(ws.reduce((s,w)=>s+workerAlert(w).anomaly,0)/ws.length):null;
  const groups=[...new Set(ws.map(w=>w.group_name||"Default").filter(Boolean))],drift=total24>0?((total10-total24)/total24)*100:null,coverage=ws.length?Math.round((active.length/ws.length)*100):0;
  return {count:ws.length,active:active.length,inactive,total10,total1h,total24,avgReject,alerts,groups,avgHealth,avgAnomaly,drift,coverage};
}
function badge(v,cls){return '<span class="badge '+(cls||"amber")+'">'+esc(v)+'</span>'}
function scoreClass(n){return n>=90?"green":n>=75?"cyan":n>=50?"amber":"red"}
function derivedShare(w){
  const fleet=fleetStats(),h24=Number(w?.hashrate_24hour_ths),profitRaw=S.mining?.profit_24h;
  if(!Number.isFinite(h24)||fleet.total24<=0||profitRaw==null)return null;
  const p=Number.parseFloat(String(profitRaw).replace(/[^0-9eE+\-.]/g,""));
  return Number.isFinite(p)?p*(h24/fleet.total24):null;
}
function actionFor(w){
  const a=workerAlert(w),p=profile(w);
  if(a.items.includes("worker_offline")||a.items.includes("stale_telemetry"))return "RECOVERY · الشبكة/الطاقة";
  if(a.items.includes("critical_reject"))return "INSPECT · Reject";
  if(a.items.includes("hashrate_drift"))return "COMPARE · Hashrate";
  if(!p.model||!p.rated_ths||!p.watts)return "CONFIG · Machine Profile";
  return "OPTIMIZE · Efficiency";
}
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
  const p=profile(w),st=statusInfo(w),al=workerAlert(w),f=fleetStats(),h10=Number(w.hashrate_10min_ths)||0,h24=Number(w.hashrate_24hour_ths)||0;
  const drift=al.drift,share=h24>0&&f.total24>0?(h24/f.total24)*100:null,value=derivedShare(w),rated=Number(p.rated_ths),watts=Number(p.watts);
  const eff=Number.isFinite(rated)&&rated>0&&Number.isFinite(watts)&&watts>0?(rated/watts*1000):null;
  const load=Number.isFinite(rated)&&rated>0&&h10>0?(h10/rated)*100:null,action=actionFor(w);
  return '<article class="miner-card '+st.cls+'" data-worker-id="'+esc(w.worker_id)+'"><div class="miner-glow"></div>'+
    '<div class="miner-top"><div><div class="miner-kicker">DIGITAL TWIN · WORKER #'+esc(w.worker_id)+'</div><h3>'+esc(w.worker_name||"Unnamed Miner")+'</h3><div class="miner-group">'+esc(w.group_name||"Default Group")+'</div></div><div class="miner-state">'+badge(st.label,st.cls)+'</div></div>'+
    '<div class="twin-row"><span class="twin-score '+scoreClass(al.health)+'"><b>'+al.health+'</b><small>HEALTH</small></span><div class="twin-meta"><span>DNA <b>'+al.dna+'</b></span><span>ANOMALY <b>'+al.anomaly+'</b></span><span>10M↔24H <b class="'+(Number.isFinite(drift)&&Math.abs(drift)>20?"warn":"")+'">'+(drift==null?"—":num(drift,1)+"%")+'</b></span></div></div>'+
    '<div class="miner-hash"><div class="hash-main"><span>'+ths(w.hashrate_10min_ths)+'</span><small>LIVE 10 MIN</small></div><div class="hash-rings"><i style="--v:'+Math.min(100,Math.max(4,h10?Math.round((h10/Math.max(h10,h24||h10))*100):4))+'%"></i></div></div>'+
    '<div class="miner-metrics"><div><span>1H</span><b>'+ths(w.hashrate_1hour_ths)+'</b></div><div><span>24H</span><b>'+ths(w.hashrate_24hour_ths)+'</b></div><div><span>REJECT</span><b class="'+(Number(w.reject_rate)>.5?"warn":"")+'">'+esc(w.reject_rate==null?"—":num(w.reject_rate,3)+"%")+'</b></div><div><span>LAST ACTIVE</span><b>'+esc(al.age==null?"—":al.age+"m")+'</b></div></div>'+
    '<div class="miner-insights"><span class="micro-tag">'+(share==null?"—":"FLEET SHARE "+num(share,1)+"%")+'</span>'+(eff==null?"":'<span class="micro-tag cyanish">EFF '+num(eff,1)+' TH/s·kW</span>')+(load==null?"":'<span class="micro-tag '+(load<85?"warn":"ok")+'">LOAD '+num(load,0)+'%</span>')+(value==null?"":'<span class="micro-tag violetish">DERIVED VALUE '+num(value,6)+'</span>')+'</div>'+
    '<div class="miner-foot"><span class="action-chip '+st.cls+'">↳ '+esc(action)+'</span>'+(al.count?'<span class="alert-pill">⚠ '+al.count+' alerts</span>':"")+'<button class="btn miner-open" data-worker-detail="'+esc(w.worker_id)+'">فتح الـTwin</button></div></article>';
}
function dashboardHtml(){
  const f=fleetStats(),m=S.mining||{},drift=f.drift;
  return '<section class="dashboard-grid"><article class="dash-card hero-stat accent"><div class="dash-label">FLEET PULSE · 10M</div><strong>'+ths(f.total10)+'</strong><span>'+num(f.total24,2)+' TH/s · 24H baseline</span><div class="pulse-line"><i style="width:'+Math.min(100,Math.max(4,f.total24?Math.round((f.total10/f.total24)*100):4))+'%"></i></div></article><article class="dash-card"><div class="dash-label">DIGITAL TWINS</div><strong>'+num(f.count,0)+'</strong><span><em class="okdot"></em>'+num(f.active,0)+' active · '+num(f.inactive,0)+' inactive</span></article><article class="dash-card"><div class="dash-label">FLEET HEALTH</div><strong>'+esc(f.avgHealth??"—")+'</strong><span>Derived: status · reject · drift</span></article><article class="dash-card"><div class="dash-label">24H DRIFT</div><strong class="'+(Number.isFinite(drift)&&Math.abs(drift)>10?"warn":"")+'">'+esc(drift==null?"—":num(drift,1)+"%")+'</strong><span>10m versus 24h fleet baseline</span></article><article class="dash-card"><div class="dash-label">AVG REJECT</div><strong>'+esc(f.avgReject==null?"—":num(f.avgReject,3)+"%")+'</strong><span>Worker-level observed average</span></article><article class="dash-card"><div class="dash-label">SMART ALERTS</div><strong>'+num(f.alerts,0)+'</strong><span>'+esc(f.alerts?"Derived alerts need review":"No derived alerts")+'</span></article><article class="dash-card"><div class="dash-label">PROFIT 24H</div><strong>'+esc(m.profit_24h??"—")+'</strong><span>ViaBTC account snapshot</span></article><article class="dash-card"><div class="dash-label">BALANCE</div><strong>'+esc(m.balance??"—")+'</strong><span>Available / unpaid snapshot</span></article></section>';
}
function controlsHtml(){
  const f=fleetStats();
  return '<section class="miners-toolbar card"><div class="toolbar-head"><div><div class="eyebrow">MINER WALL / DIGITAL TWIN</div><h2>كل Miner ككيان مستقل</h2><p>Telemetry حيّة + Health + Anomaly + Efficiency + Derived Value + Action.</p></div><div class="toolbar-side"><div class="toolbar-count">'+num(f.count,0)+' WORKERS</div><div class="backup-tools"><button class="chip" id="profileExport">تصدير Profiles</button><button class="chip" id="profileImport">استيراد</button><input id="profileFile" type="file" accept="application/json" hidden></div></div></div><div class="toolbar-controls"><label><span>بحث</span><input id="minerSearch" placeholder="اسم / Worker ID / Group" value="'+esc(S.query)+'"></label><label><span>الحالة</span><select id="minerFilter"><option value="all">الكل</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="stale">Stale</option></select></label><label><span>ترتيب</span><select id="minerSort"><option value="status">الحالة</option><option value="hash">Hashrate 10m</option><option value="reject">Reject</option><option value="name">الاسم</option></select></label></div><div class="group-row">'+f.groups.map(g=>'<button class="chip group-chip" data-group="'+esc(g)+'">'+esc(g)+'</button>').join("")+'</div></section>';
}
function render(){
  const f=fleetStats(),m=S.mining||{},t=S.trade||{},sig=t.signal||{},risk=t.risk||{},e=t.evidence||{},dir=sig.direction||"WAIT",topAction=f.alerts?"REVIEW ALERTS":"SYSTEM NOMINAL";
  $("#vm").innerHTML='<header class="top"><div class="brand"><div class="orb">₿</div><div><b>ViaBTC Monitor</b><small>MIDAD / DIGITAL MINING OPS</small></div></div><div class="top-actions"><span class="status"><i class="dot '+(S.mining?"live":"")+'"></i>'+esc(S.mining?"LIVE TELEMETRY":"LOCKED")+'</span><span class="live-badge">'+esc(topAction)+'</span><button class="icon-btn" id="refreshTop" aria-label="تحديث">↻</button></div></header><main><section class="hero"><div><div class="eyebrow">VIABTC / MINING + NON-COPY INTELLIGENCE</div><h1>Digital <span>Mining Dashboard</span></h1><p>من “Hashrate” إلى <b>Digital Twin</b>: لكل Miner هوية تشغيلية، صحة، شذوذ، كفاءة، تاريخ، مساهمة مشتقة، وتوصية قابلة للتنفيذ — مع بقاء التنفيذ المالي الحي محجوبًا.</p><div class="actions"><button class="btn primary" id="refresh">تحديث المحطة</button><button class="btn" id="run">تشغيل التحليل</button><button class="btn subtle" id="focusMiners">استكشف الـMiners</button></div><div class="command-ribbon"><span>◉ '+esc(f.count)+" Twins"+'</span><span>◉ '+esc(f.avgHealth??"—")+" Health"+'</span><span>◉ '+esc(f.alerts)+" Alerts"+'</span><span>◉ '+esc(f.coverage)+"% Active"+'</span></div></div><div class="orbit"><div class="orbit-ring ring-a"></div><div class="orbit-ring ring-b"></div><div class="core"><b>BTC</b><small>'+esc(dir)+'</small></div></div></section><section class="system-strip"><div><span>TRANSPORT</span><b>'+esc(m.transport||"—")+'</b></div><div><span>DATA FRESHNESS</span><b>'+esc(m.updated_at?new Date(m.updated_at).toLocaleTimeString():"—")+'</b></div><div><span>OBSERVATION</span><b>READ ONLY</b></div><div><span>LIVE EXECUTION</span><b>LOCKED</b></div></section>'+dashboardHtml()+insightDeck()+heatmapHtml()+controlsHtml()+'<section class="miners-list" id="minersList">'+(getWorkers().map(minerCard).join("")||'<div class="empty">لم تصل قائمة Workers بعد. اضغط «تحديث المحطة».</div>')+'</section><section class="ops-grid"><article class="card"><div class="head"><div><div class="eyebrow">MINING TELEMETRY</div><h2>الحالة المباشرة</h2></div>'+badge(m.status||"UNKNOWN",(m.status||"").toUpperCase()==="CONNECTED"?"green":"amber")+'</div><div class="facts"><div class="fact"><span>ACCOUNT HASHRATE</span><b>'+ths(m.hashrate)+'</b><p>الإجمالي الذي يعيده حساب ViaBTC.</p></div><div class="fact"><span>WORKERS OBSERVED</span><b>'+num(f.count,0)+'</b><p>التفصيل الحالي لكل Worker.</p></div><div class="fact"><span>PROFIT</span><b>'+esc(m.profit_24h??"—")+'</b><p>لا يوجد تخمين عند غياب المصدر.</p></div><div class="fact"><span>ERROR</span><b class="'+(m.error?"error":"")+'">'+esc(m.error||"لا يوجد خطأ مسجل")+'</b></div></div></article><article class="card"><div class="head"><div><div class="eyebrow">SMART RECOMMENDATIONS</div><h2>اقتراحات تتغيّر مع الحالة</h2></div><span class="badge violet">ADAPTIVE</span></div><div class="recommendations">'+smartRecommendations().map((x,i)=>'<div><div class="rec-num">0'+(i+1)+'</div><b>'+esc(x.title)+'</b><span>'+esc(x.body)+'</span><em>'+esc(x.action)+'</em></div>').join("")+'</div></article></section><section class="card section"><div class="head"><div><div class="eyebrow">NON-COPY INTELLIGENCE</div><h2>Trading Lab</h2></div><span class="badge cyan">PAPER ONLY</span></div><div class="facts"><div class="fact"><span>SIGNAL</span><b>'+esc(dir)+'</b><p>Confidence: '+(sig.confidence==null?"—":Math.round(Number(sig.confidence)*100)+"%")+'</p></div><div class="fact"><span>RISK GATE</span><b>'+esc(risk.gate_decision||"—")+'</b><p>لا يتحول إلى أمر حي.</p></div><div class="fact"><span>REGIME</span><b>'+esc(t.features?.regime||"—")+'</b></div><div class="fact"><span>PAPER</span><b>'+esc(t.paper_trade?.status||"NOT_CREATED")+'</b></div></div></section><section class="card section"><div class="head"><div><div class="eyebrow">EVIDENCE</div><h2>مصادر وقيود</h2></div></div><div class="facts"><div class="fact"><span>MARKET SOURCES</span><b>'+esc(Array.isArray(e.market_sources)?e.market_sources.length:"—")+'</b></div><div class="fact"><span>TRANSPORT BLOCKS</span><b>'+esc(Array.isArray(e.source_errors)?e.source_errors.length:"—")+'</b></div></div></section><div class="errorBox" id="errorBox" style="display:'+(S.error?"block":"none")+'"><b>تعذر تنفيذ آخر عملية</b><pre>'+esc(S.error||"")+'</pre><button class="btn" id="retryError">إعادة المحاولة</button></div><p class="note">MIDAD: ViaBTC Monitor يراقب التعدين ويعرض التحليل المستقل فقط. لا copy-trading، لا سحب، ولا live trade من هذه الواجهة. كل “Derived Value / Health / Anomaly / Efficiency” حساب محلي مشتق وليس قيمة ViaBTC أصلية.</p></main><div class="bottom"><button class="btn" id="refresh2">↻ تحديث</button><button class="btn primary" id="run2">▶ تشغيل التحليل</button></div>';
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
  const exp=$("#profileExport");if(exp)exp.onclick=exportProfiles;
  const imp=$("#profileImport"),file=$("#profileFile");if(imp&&file){imp.onclick=()=>file.click();file.onchange=()=>importProfiles(file)}
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
  const p=profile(w),al=workerAlert(w),st=statusInfo(w),f=fleetStats(),share=Number(w.hashrate_24hour_ths)>0&&f.total24>0?(Number(w.hashrate_24hour_ths)/f.total24)*100:null,value=derivedShare(w),rated=Number(p.rated_ths),watts=Number(p.watts),eff=Number.isFinite(rated)&&rated>0&&Number.isFinite(watts)&&watts>0?(rated/watts*1000):null,load=Number.isFinite(rated)&&rated>0&&Number(w.hashrate_10min_ths)>0?(Number(w.hashrate_10min_ths)/rated)*100:null,action=actionFor(w);
  const completion=[p.model,p.rated_ths,p.watts,p.location,p.firmware,p.notes].filter(Boolean).length*100/6;
  const loading='<div id="workerHistory" class="history-box"><div class="history-loading">جاري قراءة History…</div></div>';
  document.body.insertAdjacentHTML("beforeend",'<div class="modal-backdrop" id="minerModal"><section class="miner-modal"><div class="modal-head"><div><div class="eyebrow">MINER DETAIL / DIGITAL TWIN</div><h2>'+esc(w.worker_name||"Unnamed Miner")+'</h2><div class="modal-sub">WORKER #'+esc(w.worker_id)+' · '+esc(w.group_name||"Default Group")+' · '+badge(st.label,st.cls)+'</div></div><button class="icon-btn close" id="closeMiner" aria-label="إغلاق">×</button></div>'+
    '<section class="twin-hero"><div class="twin-score giant '+scoreClass(al.health)+'"><b>'+al.health+'</b><small>HEALTH / 100</small></div><div class="twin-hero-copy"><div class="eyebrow">TWIN READOUT</div><h3>'+esc(al.dna)+' · '+esc(action)+'</h3><p>الـHealth وAnomaly وDrift مؤشرات مشتقة محليًا من Telemetry الحالية. لا تمثل تصنيفًا أصليًا من ViaBTC.</p><div class="twin-alerts">'+(al.items.length?al.items.map(x=>'<span>'+esc(x.replaceAll("_"," "))+'</span>').join(""):'<span class="ok-alert">✓ no derived alerts</span>')+'</div></div></section>'+
    '<div class="detail-grid"><div><span>10 MIN</span><b>'+ths(w.hashrate_10min_ths)+'</b></div><div><span>1 HOUR</span><b>'+ths(w.hashrate_1hour_ths)+'</b></div><div><span>24 HOUR</span><b>'+ths(w.hashrate_24hour_ths)+'</b></div><div><span>10M↔24H</span><b class="'+(Math.abs(al.drift||0)>20?"warn":"")+'">'+(al.drift==null?"—":num(al.drift,1)+"%")+'</b></div><div><span>REJECT</span><b>'+esc(w.reject_rate==null?"—":num(w.reject_rate,3)+"%")+'</b></div><div><span>LAST ACTIVE</span><b>'+esc(al.age==null?"—":al.age+" minutes ago")+'</b></div></div>'+
    '<section class="derived-grid"><div><span>FLEET SHARE · 24H</span><b>'+esc(share==null?"—":num(share,2)+"%")+'</b><small>مساهمة نسبية مشتقة من Hashrate فقط.</small></div><div><span>EFFICIENCY</span><b>'+esc(eff==null?"—":num(eff,1)+" TH/s·kW")+'</b><small>يظهر بعد إدخال Rated TH/s + Watts.</small></div><div><span>LOAD VS RATED</span><b>'+esc(load==null?"—":num(load,0)+"%")+'</b><small>10m Hashrate ÷ Rated Hashrate.</small></div><div><span>DERIVED VALUE</span><b>'+esc(value==null?"—":num(value,6))+'</b><small>Allocation داخلي إذا كان Profit رقميًا.</small></div></section>'+
    '<section class="playbook"><div class="eyebrow">NEXT BEST ACTION</div><h3>'+esc(action)+'</h3><p>'+esc(action.includes("RECOVERY")?"تحقق من الاتصال والطاقة وLast Active قبل أي إعادة تشغيل.":action.includes("Reject")?"افحص جودة الاتصال، إعدادات/مشاركة العمل، وReject Rate لهذا Worker.":action.includes("COMPARE")?"قارن 10m و1h و24h وافتح History لمعرفة هل الانحراف لحظي أم مستمر.":action.includes("CONFIG")?"أدخل مواصفات الجهاز حتى يتحول الـTwin من Telemetry فقط إلى Efficiency-aware Twin.":"استمر بالمراقبة؛ استخدم Efficiency وHistory لاكتشاف أي تدهور تدريجي.")+'</p><div class="playbook-actions"><button class="btn" id="copyWorkerId">نسخ Worker ID</button><span id="copyMsg"></span></div></section>'+
    '<section class="profile-panel"><div class="profile-head"><div><div class="eyebrow">MACHINE PROFILE</div><h3>مواصفات الجهاز</h3><small>محلية في هذا المتصفح. لا ندّعي أنها من ViaBTC.</small></div><div><span class="badge '+(completion>=100?"green":"amber")+'">'+num(completion,0)+'% COMPLETE</span></div></div><div class="profile-progress"><i style="width:'+completion+'%"></i></div><div class="profile-grid">'+
    '<label><span>Model</span><input id="pfModel" value="'+esc(p.model||"")+'" placeholder="e.g. Antminer M31+"></label><label><span>Rated Hashrate TH/s</span><input id="pfThs" inputmode="decimal" value="'+esc(p.rated_ths??"")+'"></label><label><span>Power Watts</span><input id="pfWatts" inputmode="decimal" value="'+esc(p.watts??"")+'"></label><label><span>Location</span><input id="pfLocation" value="'+esc(p.location||"")+'" placeholder="Farm / Rack"></label><label><span>Firmware</span><input id="pfFirmware" value="'+esc(p.firmware||"")+'"></label><label><span>Notes</span><input id="pfNotes" value="'+esc(p.notes||"")+'"></label></div><div class="profile-actions"><button class="btn primary" id="saveProfile">حفظ المواصفات</button><span id="profileSaveMsg"></span></div></section>'+
    loading+'<div class="modal-footer"><button class="btn" id="closeMiner2">إغلاق</button></div></section></div>');
  $("#closeMiner").onclick=()=>$("#minerModal")?.remove();$("#closeMiner2").onclick=()=>$("#minerModal")?.remove();
  $("#minerModal").onclick=e=>{if(e.target.id==="minerModal")e.currentTarget.remove()};
  $("#copyWorkerId").onclick=async()=>{try{await navigator.clipboard.writeText(String(w.worker_id));$("#copyMsg").textContent="✓ copied";$("#copyMsg").className="saved"}catch{$("#copyMsg").textContent="ID: "+w.worker_id}};
  $("#saveProfile").onclick=()=>{
    const np={model:$("#pfModel").value.trim(),rated_ths:Number($("#pfThs").value)||null,watts:Number($("#pfWatts").value)||null,location:$("#pfLocation").value.trim(),firmware:$("#pfFirmware").value.trim(),notes:$("#pfNotes").value.trim()};
    saveProfile(w,np);$("#profileSaveMsg").textContent="✓ محفوظ محليًا";$("#profileSaveMsg").className="saved";render();
  };
  try{
    const r=await fetch(CFG.url+CFG.fn,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"worker_detail",worker_id:String(id)})});
    const j=await r.json().catch(()=>({})),d=j?.detail||{},hist=Array.isArray(d.history)?d.history:[];
    $("#workerHistory").innerHTML=renderHistory(hist,d.transport,d.history_partial);
  }catch(e){$("#workerHistory").innerHTML='<div class="history-error">تعذر قراءة history: '+esc(e.message||e)+'</div>'}
}
function renderHistory(rows,transport,partial){
  if(!rows.length)return '<div class="history-empty">لا توجد نقاط History راجعة من ViaBTC لهذا الـWorker.</div>';
  const vals=rows.map(x=>({date:x.date||"—",ths:Number(x.hashrate)>=1e9?Number(x.hashrate)/1e12:Number(x.hashrate)||0}));
  const mx=Math.max(...vals.map(x=>x.ths),1),min=Math.min(...vals.map(x=>x.ths),0),max=Math.max(...vals.map(x=>x.ths),1),delta=max>0?((max-min)/max)*100:0;
  return '<div class="history-head"><div><div class="eyebrow">7D PERFORMANCE ARC</div><h3>مسار الأداء + Range</h3></div><span class="badge '+(partial?"amber":"green")+'">'+(partial?"PARTIAL":"VERIFIED")+'</span></div><div class="history-kpis"><span>RANGE <b>'+num(min,1)+' → '+num(max,1)+' TH/s</b></span><span>VOLATILITY <b>'+num(delta,1)+'%</b></span><span>TRANSPORT <b>'+esc(transport||"—")+'</b></span></div><div class="history-chart">'+vals.slice().reverse().map(x=>'<div class="bar-col"><div class="bar-value">'+num(x.ths,1)+'</div><div class="bar" style="height:'+Math.max(8,Math.round((x.ths/mx)*100))+'%"></div><small>'+esc(String(x.date).slice(5))+'</small></div>').join("")+'</div><div class="history-note">المصدر: ViaBTC Hashrate History. Range/Volatility حساب مشتق للعرض وليس حقلًا أصليًا.</div>';
}
function insightDeck(){
  const f=fleetStats(),m=S.mining||{},focus=f.alerts?"ALERT TRIAGE":f.avgHealth!=null&&f.avgHealth<85?"HEALTH FOCUS":"PERFORMANCE FOCUS";
  const message=f.alerts?f.alerts+" derived alerts تحتاج فتح الـTwin المتأثر قبل أي تدخل.":f.drift!=null&&Math.abs(f.drift)>10?"Fleet drift أعلى من 10%: افصل السبب حسب Worker بدل الاعتماد على المتوسط.":"Fleet telemetry تبدو مستقرة؛ ركّز على calibration والكفاءة إذا كانت Machine Profiles مكتملة.";
  return '<section class="insight-deck"><div class="insight-primary"><div class="eyebrow">MIDAD / OPERATING INTELLIGENCE</div><h2>Control Signal</h2><strong>'+esc(focus)+'</strong><p>'+esc(message)+'</p><div class="signal-meter"><i style="width:'+Math.min(100,Math.max(5,f.avgHealth||0))+'%"></i></div><div class="signal-foot"><span>HEALTH <b>'+esc(f.avgHealth??"—")+'</b></span><span>ANOMALY <b>'+esc(f.avgAnomaly??"—")+'</b></span><span>ACCOUNT <b>'+esc(m.status||"—")+'</b></span></div></div><div class="insight-side"><div><span>OBSERVED</span><b>'+f.count+'</b><small>individual workers</small></div><div><span>ACTIVE COVERAGE</span><b>'+f.coverage+'%</b><small>active / observed</small></div><div><span>GROUPS</span><b>'+f.groups.length+'</b><small>topology partitions</small></div></div></section>';
}
function smartRecommendations(){
  const f=fleetStats(),ws=S.workers||[],out=[];
  if(f.alerts)out.push({title:"Alert triage",body:"يوجد "+f.alerts+" تنبيهات مشتقة على مستوى Workers.",action:"افتح الـTwin المتأثر وابدأ بـRecovery / Inspect."});
  else out.push({title:"Night Watch",body:"لا توجد تنبيهات مشتقة حاليًا؛ النظام يواصل مراقبة drift وreject.",action:"اترك auto-refresh يعمل كل 30 ثانية."});
  if(f.avgHealth!=null&&f.avgHealth<85)out.push({title:"Health compression",body:"متوسط صحة المزرعة تحت 85/100 بسبب status أو drift أو reject.",action:"رتّب حسب Hashrate ثم راجع الأقل صحة."});
  if(f.drift!=null&&Math.abs(f.drift)>10)out.push({title:"Fleet divergence",body:"فرق ملحوظ بين 10m و24h على مستوى المزرعة.",action:"قارن الـMiners واحدًا واحدًا قبل أي قرار."});
  if(ws.some(w=>{const p=profile(w);return !p.model||!p.rated_ths||!p.watts}))out.push({title:"Twin calibration",body:"بعض الـDigital Twins بلا Rated TH/s وWatts.",action:"أكمل Machine Profile حتى يظهر Efficiency وLoad."});
  out.push({title:"Revenue topology",body:"Derived Value يظهر فقط عندما يصل Profit رقمي قابل للقراءة.",action:"اعتبره allocation داخليًا، وليس ربحًا موثقًا لكل Miner من ViaBTC."});
  return out.slice(0,5);
}
function heatmapHtml(){
  const ws=S.workers||[],groups=[...new Set(ws.map(w=>w.group_name||"Default Group"))];
  return '<section class="heatmap card"><div class="head"><div><div class="eyebrow">FARM TOPOLOGY / LIVE HEATMAP</div><h2>خريطة صحة المزرعة</h2><p class="section-sub">كل مربع = Worker. اللون = Health، والضغط يفتح الـDigital Twin فورًا.</p></div><span class="badge cyan">'+esc(groups.length)+' GROUPS</span></div><div class="heatmap-grid">'+ws.map(w=>{const a=workerAlert(w),st=statusInfo(w);return '<button class="heat-tile '+a.dna.toLowerCase()+'" data-worker-detail="'+esc(w.worker_id)+'"><span class="heat-id">#'+esc(w.worker_id)+'</span><b>'+esc(w.worker_name||"Unnamed")+'</b><small>'+esc(st.label)+' · '+a.health+'</small><i style="width:'+Math.max(5,a.health)+'%"></i></button>'}).join("")+'</div></section>';
}
function exportProfiles(){
  const data={exported_at:new Date().toISOString(),schema:"midad-miner-profiles-v1",profiles:{}};
  (S.workers||[]).forEach(w=>{const p=profile(w);if(Object.keys(p).length)data.profiles[String(w.worker_id)]=p});
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="midad-miner-profiles.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
async function importProfiles(fileInput){
  const file=fileInput?.files?.[0];if(!file)return;
  try{const data=JSON.parse(await file.text()),profiles=data?.profiles||{};Object.entries(profiles).forEach(([id,p])=>{if(p&&typeof p==="object")localStorage.setItem("midad_miner_profile_"+id,JSON.stringify(p))});fileInput.value="";render()}catch(e){S.error="Profile import failed: "+String(e?.message||e);fileInput.value="";render()}
}
async function post(action,timeout=60000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(CFG.url+CFG.fn,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action}),signal:c.signal});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||j.ok===false)throw new Error(j.error||j.message||"HTTP "+r.status);
    return j;
  }finally{clearTimeout(t)}
}

window.addEventListener("load",()=>{render();refresh();window.setInterval(()=>{if(!S.busy)refresh()},30000)});
})();