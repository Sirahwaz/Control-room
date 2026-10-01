(()=>{const API="https://froegigfmpmvtecztfb.supabase.co/functions/v1/midad_live_status";let el=null,restore=null;
function readState(){try{return localStorage.getItem("midad_live_ops_state")||"collapsed"}catch{return"collapsed"}}
function writeState(v){try{localStorage.setItem("midad_live_ops_state",v)}catch{}}
function put(sel,v){const q=document.querySelector(sel);if(q)q.textContent=String(v??"—")}
function mount(){
 if(el)return;
 el=document.createElement("section");el.id="midadLiveOps";el.setAttribute("aria-label","MIDAD Live Ops");
 el.innerHTML='<div class="mlo-head"><button class="mlo-title" type="button" data-mlo="toggle" aria-expanded="false"><span class="mlo-dot"></span><strong>MIDAD LIVE OPS</strong><span class="mlo-state">CONNECTING</span></button><div class="mlo-head-actions"><button class="mlo-action" type="button" data-mlo="collapse" aria-label="تجميع LIVE OPS" title="تجميع">−</button><button class="mlo-action" type="button" data-mlo="close" aria-label="إغلاق LIVE OPS" title="إغلاق">×</button></div></div><div class="mlo-body"><div class="mlo-grid"><div><small>Loop</small><b id="mloLoop">—</b></div><div><small>Money</small><b id="mloMoney">—</b></div><div><small>Ledger</small><b id="mloLedger">—</b></div><div><small>Tasks</small><b id="mloTasks">—</b></div><div><small>Mode</small><b id="mloMode">—</b></div><div><small>Live</small><b id="mloLive">LOCKED</b></div></div><div id="mloDetail">جاري قراءة نبض MIDAD…</div></div>';
 document.body.appendChild(el);
 restore=document.createElement("button");restore.id="midadLiveOpsRestore";restore.type="button";restore.hidden=true;restore.textContent="◉ LIVE OPS";restore.setAttribute("aria-label","إظهار MIDAD LIVE OPS");restore.title="إظهار MIDAD LIVE OPS";document.body.appendChild(restore);
 el.querySelector('[data-mlo="toggle"]').onclick=()=>setState(el.classList.contains("mlo-collapsed")?"expanded":"collapsed");
 el.querySelector('[data-mlo="collapse"]').onclick=()=>setState("collapsed");
 el.querySelector('[data-mlo="close"]').onclick=()=>setState("closed");
 restore.onclick=()=>setState("collapsed");
 setState(readState());
}
function setState(state){
 if(!el||!restore)return;
 if(state==="closed"){el.classList.add("mlo-hidden");el.classList.remove("mlo-collapsed");restore.hidden=false;}
 else{el.classList.remove("mlo-hidden");restore.hidden=true;el.classList.toggle("mlo-collapsed",state!=="expanded");const t=el.querySelector('[data-mlo="toggle"]');if(t)t.setAttribute("aria-expanded",state==="expanded"?"true":"false");}
 writeState(state);
}
async function tick(){
 try{
  const r=await fetch(API,{cache:"no-store"}),s=await r.json();if(!s.ok)throw new Error("status");
  const g=s.control||{},c=s.counts||{},x=s.latest_cycle||{};
  put("#mloLoop",x.decision||"—");put("#mloMoney",c.money_candidates??"—");put("#mloLedger",c.decision_ledger??"—");put("#mloTasks",c.open_human_tasks??"—");put("#mloMode",String(g.mode||"—").toUpperCase());put("#mloLive",s.live_financial_execution?"OPEN":"LOCKED");put(".mlo-state",(s.state||"ACTIVE").toUpperCase());
  put("#mloDetail","آخر دورة: "+(x.started_at?new Date(x.started_at).toLocaleTimeString():"—")+" · Signal "+String(x.signal_direction||"—")+" · Confidence "+(Number(x.signal_confidence||0)*100).toFixed(1)+"% · Blueprint "+String(c.ready_blueprints??"—")+" · Outbox sent "+String(c.outbox_sent??"—");
 }catch(e){put(".mlo-state","OFFLINE");put("#mloDetail","تعذر قراءة نبض MIDAD الآن — الواجهة الأساسية مستمرة.");}
}
window.addEventListener("DOMContentLoaded",()=>{mount();tick();setInterval(tick,30000)});
})();