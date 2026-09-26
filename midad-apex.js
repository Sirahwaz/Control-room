(function(){
"use strict";
if(window.__MIDAD_APEX_V1__)return;
window.__MIDAD_APEX_V1__=true;

var state={open:false,connected:false,last:null,lastHealth:null,log:[],seqBusy:false};
function esc(v){return String(v==null?"":v).replace(/[&<>"]/g,function(m){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[m]})}
function q(s){return document.querySelector(s)}
function fireAction(name){
  var el=document.querySelector('[data-action="'+name+'"]');
  if(el){el.click();return true}
  return false;
}
function fireRoute(name){
  var el=document.querySelector('[data-route="'+name+'"]');
  if(el){el.click();return true}
  location.hash=name;return false;
}
function toast(msg){
  var box=q("#apx-toast");if(!box)return;
  var d=document.createElement("div");d.className="apx-toast";d.textContent=msg;box.appendChild(d);
  setTimeout(function(){d.remove()},3600);
}
function note(msg){state.log.unshift(new Date().toLocaleTimeString("en-GB")+" · "+msg);state.log=state.log.slice(0,24);renderLog()}
function currentStats(){
  var root=document.getElementById("app");
  var text=root?root.innerText:"";
  function grab(label){
    var re=new RegExp(label+"[\\s\\S]{0,40}?([0-9][0-9,]*(?:\\.[0-9]+)?)");
    var m=text.match(re);return m?m[1]:"—";
  }
  return {signals:grab("إشارات"),opps:grab("فرص"),tasks:grab("مهام"),delivery:grab("جاهزية"),text:text.slice(0,3000)}
}
function renderLog(){var x=q("#apx-log");if(x)x.textContent=state.log.join("\n")}
function renderStats(){
  var s=currentStats();
  ["signals","opps","tasks","delivery"].forEach(function(k){var el=q("#apx-"+k);if(el)el.textContent=s[k]});
}
function renderState(){
  var dot=q("#apx-pulse"),label=q("#apx-state");
  if(dot)dot.classList.toggle("live",state.connected);
  if(label)label.textContent=state.connected?"LIVE / VERIFIED":"READY / CONNECT";
  var ss=currentStats();
  var x=q("#apx-snapshot");if(x)x.textContent=ss.text?"CONNECTED SURFACE":"NO SURFACE";
}
function run(name,label){
  if(state.seqBusy)return toast("هناك عملية أخرى جارية.");
  note("→ "+label);
  if(!fireAction(name)){toast("الأمر غير متاح في الطبقة الحالية: "+label);note("BLOCKED · "+label);return}
  setTimeout(function(){renderStats();note("✓ "+label+" dispatched")},300);
}
function sequence(){
  if(state.seqBusy)return;
  state.seqBusy=true;
  note("=== APEX EXECUTION CYCLE ===");
  var steps=[
    ["refresh","1/4 · Refresh core"],
    ["opportunityScan","2/4 · Opportunity scan"],
    ["scan","3/4 · OSINT scan"],
    ["mining","4/4 · Mining monitor"]
  ];
  var i=0;
  function next(){
    if(i>=steps.length){state.seqBusy=false;note("=== CYCLE COMPLETE / verify results ===");toast("دورة APEX اكتملت؛ النتائج تحتاج تحققًا قبل التنفيذ.");return}
    var pair=steps[i++];
    if(fireAction(pair[0])){note("→ "+pair[1]);setTimeout(next,1100)}else{note("BLOCKED · "+pair[1]);setTimeout(next,250)}
  }
  next();
}
function command(raw){
  var x=String(raw||"").trim().toLowerCase();
  if(!x)return;
  var map=[
    [/(فرص|opportunit|money scan)/,"opportunityScan","تحديث الفرص"],
    [/(osint|إشارات|intel)/,"scan","تحديث الذكاء والإشارات"],
    [/(mining|تعدين|viabtc)/,"mining","فحص التعدين"],
    [/(autonomy|استقلال|دورة)/,"autonomy","تشغيل دورة الاستقلالية"],
    [/(refresh|تحديث|حالة)/,"refresh","تحديث الحالة"],
    [/(money|مال|دخل)/,"money","فتح المال"],
    [/(focus|تركيز|مهمة)/,"needs","فتح مركز التركيز"],
    [/(terminal|طرفية)/,"terminal","فتح الطرفية"],
    [/(ai|ذكاء)/,"aiAsk","فتح MIDAD AI"]
  ];
  for(var i=0;i<map.length;i++)if(map[i][0].test(x)){
    if(map[i][1]==="money")fireRoute("money");
    else if(map[i][1]==="needs")fireRoute("focus");
    else if(map[i][1]==="terminal")fireRoute("terminal");
    else if(map[i][1]==="aiAsk")fireAction("aiAsk");
    else run(map[i][1],map[i][2]);
    return;
  }
  toast("لم أفهم الأمر بعد. جرّب: المال، الفرص، الإشارات، التعدين، الاستقلالية، التركيز.");
}
function inject(){
  if(q("#apx-root"))return;
  var root=document.createElement("div");root.id="apx-root";
  root.innerHTML=
  '<button id="apx-launch" aria-label="MIDAD APEX">M <span id="apx-pulse"></span></button>'+
  '<div id="apx-dock">'+
    '<div class="apx-head">'+
      '<div class="apx-kicker">MIDAD // APEX NEURAL COMMAND</div>'+
      '<div class="apx-title"><div><h2>غرفة القيادة العليا</h2><span id="apx-state">READY / CONNECT</span></div><button class="apx-x" id="apx-close">×</button></div>'+
      '<div class="apx-command"><input id="apx-input" placeholder="اكتب أمرًا طبيعيًا: المال / الفرص / التعدين / ركّز على المهمة…"><button class="apx-btn primary" id="apx-send">نفّذ</button></div>'+
    '</div>'+
    '<div class="apx-grid">'+
      '<div class="apx-card"><h3>SIGNALS</h3><div class="apx-kpi" id="apx-signals">—</div><p>ما يرصده الرادار الآن</p></div>'+
      '<div class="apx-card"><h3>OPPORTUNITIES</h3><div class="apx-kpi" id="apx-opps">—</div><p>المادة الخام لمسار الدخل</p></div>'+
      '<div class="apx-card"><h3>HUMAN TASKS</h3><div class="apx-kpi" id="apx-tasks">—</div><p>ما يحتاج تدخلك</p></div>'+
      '<div class="apx-card"><h3>DELIVERY</h3><div class="apx-kpi" id="apx-delivery">—</div><p>جاهزية وليست ضمانًا</p></div>'+
    '</div>'+
    '<div class="apx-wide"><div class="apx-section">'+
      '<div class="apx-section-head"><b>ONE-TOUCH OPERATIONS</b><span id="apx-snapshot">SURFACE</span></div>'+
      '<div class="apx-actions">'+
        '<button class="apx-btn primary" id="apx-cycle">⚡ APEX CYCLE</button>'+
        '<button class="apx-btn good" id="apx-money">💰 CASH COMMAND</button>'+
        '<button class="apx-btn" id="apx-focus">⌁ FOCUS CENTER</button>'+
        '<button class="apx-btn" id="apx-intel">⌬ INTELLIGENCE</button>'+
        '<button class="apx-btn" id="apx-terminal">⌘ LIVE TERMINAL</button>'+
        '<button class="apx-btn" id="apx-system">✺ SYSTEM HEALTH</button>'+
      '</div>'+
    '</div></div>'+
    '<div class="apx-wide"><div class="apx-section">'+
      '<div class="apx-section-head"><b>DIRECT ENGINES</b><span>SAFE ROUTES</span></div>'+
      '<div class="apx-rail">'+
        '<button class="apx-btn" id="apx-refresh">⟳</button>'+
        '<button class="apx-btn" id="apx-scan">RADAR</button>'+
        '<button class="apx-btn" id="apx-opps">MONEY</button>'+
        '<button class="apx-btn" id="apx-mining">MINING</button>'+
      '</div>'+
    '</div></div>'+
    '<div class="apx-wide"><div class="apx-section">'+
      '<div class="apx-section-head"><b>SAFETY LATTICE</b><span>NON-NEGOTIABLES</span></div>'+
      '<div class="apx-lattice">'+
        '<div class="apx-node"><div><b>Human Gate</b><span>الأفعال الحساسة خلف موافقة بشرية</span></div><i class="apx-dot ok"></i></div>'+
        '<div class="apx-node"><div><b>Paper Trading</b><span>المحاكاة منفصلة عن التنفيذ الحقيقي</span></div><i class="apx-dot ok"></i></div>'+
        '<div class="apx-node"><div><b>Wallet Hygiene</b><span>لا private key ولا seed phrase</span></div><i class="apx-dot ok"></i></div>'+
        '<div class="apx-node"><div><b>Evidence First</b><span>الإشارة لا تتحول إلى قرار تلقائيًا</span></div><i class="apx-dot ok"></i></div>'+
      '</div>'+
    '</div></div>'+
    '<div class="apx-wide"><div class="apx-section">'+
      '<div class="apx-section-head"><b>APEX TELEMETRY</b><span>LOCAL COMMAND LOG</span></div>'+
      '<div class="apx-log" id="apx-log">APEX boot…</div>'+
    '</div></div>'+
    '<div class="apx-footer">APEX لا يستبدل نواة MIDAD؛ هو طبقة قيادة فوقها. كل أمر يمر عبر الأدوات الحالية، وكل نتيجة تشغيلية تبقى خاضعة للتحقق والسياسات.</div>'+
  '</div>'+
  '<div id="apx-toast"></div>';
  document.body.appendChild(root);
  q("#apx-launch").onclick=function(){state.open=!state.open;q("#apx-dock").classList.toggle("open",state.open);renderStats();renderState()};
  q("#apx-close").onclick=function(){state.open=false;q("#apx-dock").classList.remove("open")};
  q("#apx-send").onclick=function(){var x=q("#apx-input");command(x.value);x.value=""};
  q("#apx-input").onkeydown=function(e){if(e.key==="Enter"){q("#apx-send").click()}};
  q("#apx-cycle").onclick=sequence;
  q("#apx-money").onclick=function(){fireRoute("money")};
  q("#apx-focus").onclick=function(){fireRoute("focus")};
  q("#apx-intel").onclick=function(){fireRoute("intelligence")};
  q("#apx-terminal").onclick=function(){fireRoute("terminal")};
  q("#apx-system").onclick=function(){fireRoute("health")};
  q("#apx-refresh").onclick=function(){run("refresh","Refresh core")};
  q("#apx-scan").onclick=function(){run("scan","OSINT scan")};
  q("#apx-opps").onclick=function(){run("opportunityScan","Opportunity scan")};
  q("#apx-mining").onclick=function(){run("mining","Mining monitor")};
  note("APEX layer online");
  renderStats();
}
function hookFetch(){
  var native=window.fetch;
  window.fetch=function(input,init){
    return native(input,init).then(function(res){
      try{
        var url=typeof input==="string"?input:(input&&input.url)||"";
        if(/midad_control_room|midad_control_surface/.test(url) && res.clone){
          res.clone().json().then(function(j){
            if(j&&j.ok){
              state.connected=true;
              state.last=j;
              state.lastHealth=j.health||j.dashboard&&j.dashboard.health||j.data&&j.data.health||null;
              note("backend verified · "+(j.generated_at||j.health?"snapshot":"response"));
              renderState();renderStats();
            }
          }).catch(function(){});
        }
      }catch(e){}
      return res;
    });
  };
}
function bindOutside(){
  document.addEventListener("click",function(e){
    if(!state.open)return;
    var d=q("#apx-dock"),b=q("#apx-launch");
    if(d&&!d.contains(e.target)&&b&&!b.contains(e.target)){state.open=false;d.classList.remove("open")}
  },true);
  window.addEventListener("resize",renderStats);
  setInterval(function(){renderStats();renderState()},2500);
}
function boot(){
  inject();hookFetch();bindOutside();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();