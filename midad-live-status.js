(function(){
  var API="https://froegigfmpmvtecztfb.supabase.co/functions/v1/midad_live_status";
  var el=null,restore=null;
  function stateRead(){try{return localStorage.getItem("midad_live_ops_state")||"collapsed"}catch(e){return"collapsed"}}
  function stateWrite(v){try{localStorage.setItem("midad_live_ops_state",v)}catch(e){}}
  function put(sel,v){var q=document.querySelector(sel);if(q)q.textContent=String(v==null?"—":v)}
  function mount(){
    if(el)return;
    el=document.createElement("section");
    el.id="midadLiveOps";
    el.setAttribute("aria-label","MIDAD Live Ops");
    el.innerHTML='<div class="mlo-head"><button class="mlo-title" type="button" data-mlo="toggle" aria-expanded="false"><span class="mlo-dot"></span><strong>MIDAD LIVE OPS</strong><span class="mlo-state">CONNECTING</span></button><div class="mlo-head-actions"><button class="mlo-action" type="button" data-mlo="collapse" aria-label="تجميع LIVE OPS" title="تجميع">− تجميع</button><button class="mlo-action" type="button" data-mlo="close" aria-label="إغلاق LIVE OPS" title="إغلاق">× إغلاق</button></div></div><div class="mlo-body"><div class="mlo-grid"><div><small>Loop</small><b id="mloLoop">—</b></div><div><small>Money</small><b id="mloMoney">—</b></div><div><small>Ledger</small><b id="mloLedger">—</b></div><div><small>Tasks</small><b id="mloTasks">—</b></div><div><small>Mode</small><b id="mloMode">—</b></div><div><small>Live</small><b id="mloLive">LOCKED</b></div></div><div id="mloDetail">جاري قراءة نبض MIDAD…</div></div>';
    document.body.appendChild(el);
    restore=document.createElement("button");
    restore.id="midadLiveOpsRestore";
    restore.type="button";
    restore.hidden=true;
    restore.textContent="◉ LIVE OPS";
    restore.setAttribute("aria-label","إظهار MIDAD LIVE OPS");
    restore.title="إظهار MIDAD LIVE OPS";
    document.body.appendChild(restore);
    el.querySelector('[data-mlo="toggle"]').onclick=function(){setState(el.classList.contains("mlo-collapsed")?"expanded":"collapsed")};
    el.querySelector('[data-mlo="collapse"]').onclick=function(){setState("collapsed")};
    el.querySelector('[data-mlo="close"]').onclick=function(){setState("closed")};
    restore.onclick=function(){setState("collapsed")};
    setState(stateRead());
  }
  function setState(state){
    if(!el||!restore)return;
    if(state==="closed"){
      el.classList.add("mlo-hidden");el.classList.remove("mlo-collapsed");restore.hidden=false;
    }else{
      el.classList.remove("mlo-hidden");restore.hidden=true;el.classList.toggle("mlo-collapsed",state!=="expanded");
      var t=el.querySelector('[data-mlo="toggle"]');
      if(t)t.setAttribute("aria-expanded",state==="expanded"?"true":"false");
    }
    stateWrite(state);
  }
  function tick(){
    fetch(API,{cache:"no-store"}).then(function(r){return r.json()}).then(function(s){
      if(!s.ok)throw new Error("status");
      var g=s.control||{},c=s.counts||{},x=s.latest_cycle||{};
      put("#mloLoop",x.decision||"—");
      put("#mloMoney",c.money_candidates==null?"—":c.money_candidates);
      put("#mloLedger",c.decision_ledger==null?"—":c.decision_ledger);
      put("#mloTasks",c.open_human_tasks==null?"—":c.open_human_tasks);
      put("#mloMode",String(g.mode||"—").toUpperCase());
      put("#mloLive",s.live_financial_execution?"OPEN":"LOCKED");
      put(".mlo-state",String(s.state||"ACTIVE").toUpperCase());
      var started=x.started_at?new Date(x.started_at).toLocaleTimeString():"—";
      var conf=((Number(x.signal_confidence)||0)*100).toFixed(1);
      var bp=c.ready_blueprints==null?"—":c.ready_blueprints;
      var sent=c.outbox_sent==null?"—":c.outbox_sent;
      put("#mloDetail","آخر دورة: "+started+" · Signal "+String(x.signal_direction||"—")+" · Confidence "+conf+"% · Blueprint "+bp+" · Outbox sent "+sent);
    }).catch(function(){
      put(".mlo-state","OFFLINE");
      put("#mloDetail","تعذر قراءة نبض MIDAD الآن — الواجهة الأساسية مستمرة.");
    });
  }
  window.addEventListener("DOMContentLoaded",function(){mount();tick();window.setInterval(tick,30000)});
})();