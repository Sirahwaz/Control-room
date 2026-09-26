(function(){
"use strict";
if(window.__MIDAD_MESH_V1__)return;window.__MIDAD_MESH_V1__=true;
var mesh={last:null,health:null,route:"dashboard"};
function q(s){return document.querySelector(s)}
function fireAction(a){var x=document.querySelector('[data-action="'+a+'"]');if(x){x.click();return true}return false}
function route(r){var x=document.querySelector('[data-route="'+r+'"]');if(x){x.click();return true}location.hash=r;return false}
function esc(v){return String(v==null?"":v).replace(/[&<>"]/g,function(m){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[m]})}
function classify(){
  var j=mesh.last||{},h=mesh.health||j.health||{};
  var tasks=h.open_tasks!=null?Number(h.open_tasks):null;
  var opps=h.opportunities!=null?Number(h.opportunities):null;
  var signals=h.signals!=null?Number(h.signals):null;
  var bp=h.income_blueprints!=null?Number(h.income_blueprints):null;
  return [
    {id:"signal",title:"SIGNAL",sub:signals==null?"بيانات غير مؤكدة":signals.toLocaleString()+" مرصودة",state:signals>0?"live":"wait",route:"intelligence"},
    {id:"opportunity",title:"OPPORTUNITY",sub:opps==null?"بانتظار الحالة":"محفظة فرص",state:opps>0?"live":"wait",route:"opportunities"},
    {id:"capability",title:"CAPABILITY",sub:"مطابقة القدرة مع الطلب",state:"live",route:"automation"},
    {id:"blueprint",title:"MONEY BLUEPRINT",sub:bp==null?"تحتاج تحقق":"مسار دخل",state:bp>0?"live":"wait",route:"money"},
    {id:"human",title:"HUMAN GATE",sub:tasks==null?"بانتظار الحالة":tasks+" مهام",state:tasks>0?"block":"done",route:"focus"},
    {id:"delivery",title:"DELIVERY",sub:"أثر تسليم + إثبات",state:"wait",route:"clients"},
    {id:"settlement",title:"SETTLEMENT",sub:"دفع مؤكد فقط",state:"wait",route:"revenue"},
    {id:"learning",title:"LEARNING",sub:"قياس النتيجة → تحسين",state:"live",route:"health"}
  ];
}
function next(c){
  var h=mesh.health||{};
  var tasks=Number(h.open_tasks||0),bp=Number(h.income_blueprints||0),opps=Number(h.opportunities||0);
  if(tasks>0)return {title:"أنت أهم بوابة الآن",desc:"هناك عمل ينتظر تدخلك. افتح Focus Center وابدأ بأعلى مهمة أولوية.",actions:[["focus","فتح التركيز"],["refresh","تحديث"]]};
  if(!opps)return {title:"غذِّ الرادار قبل التنفيذ",desc:"لا يوجد رصيد فرص موثّق في اللقطة الحالية؛ شغّل Opportunity + OSINT scan.",actions:[["opportunityScan","Opportunity"],["scan","OSINT"]]};
  if(!bp)return {title:"حوّل الفرصة إلى Blueprint",desc:"المسار المالي يحتاج خطة دخل قابلة للتنفيذ قبل أن نسجّل أي إيراد.",actions:[["opportunityScan","إعادة تقييم"],["autonomy","Autonomy cycle"]]};
  return {title:"الدورة جاهزة للمرحلة التشغيلية",desc:"المبدأ: لا تنفيذ حساس ولا تحويل مالي دون بوابة بشرية وأثر قابل للتدقيق.",actions:[["autonomy","تشغيل الدورة"],["moneyRadar","تحديث المال"]]};
}
function render(){
  var root=q("#apx-dock");if(!root)return;
  var old=q("#midad-mesh");if(old)old.remove();
  var c=classify(),n=next(c);
  var html='<div id="midad-mesh"><div class="mm-head"><b>NEURAL OPERATING MESH</b><span>FLOW OF TRUTH → MONEY → OUTCOME</span></div><div class="mm-spine">';
  html+=c.map(function(x){return '<div class="mm-node" data-mm-route="'+x.route+'"><b><i class="mm-dot '+(x.state==="live"?"live":x.state==="block"?"block":x.state==="done"?"done":"")+'"></i>'+esc(x.title)+'</b><small>'+esc(x.sub)+'</small></div>'}).join("");
  html+='</div><div class="mm-next"><div class="label">NEXT SAFE MOVE</div><b>'+esc(n.title)+'</b><p>'+esc(n.desc)+'</p><div class="mm-actions">'+n.actions.map(function(a){return '<button class="mm-btn" data-mm-action="'+a[0]+'">'+esc(a[1])+'</button>'}).join("")+'</div></div><div class="mm-foot">المسار لا يتخطى الأدلة أو الموافقات. «الجاهز» يعني قابلية تشغيل، وليس نجاحًا أو دفعًا مضمونًا.</div></div>';
  var anchor=q(".apx-grid"); if(anchor)anchor.insertAdjacentHTML("afterend",html);else root.insertAdjacentHTML("beforeend",html);
  document.querySelectorAll("[data-mm-route]").forEach(function(x){x.onclick=function(){route(x.dataset.mmRoute)}});
  document.querySelectorAll("[data-mm-action]").forEach(function(x){x.onclick=function(){fireAction(x.dataset.mmAction)}});
}
function hook(){
  var native=window.fetch;
  window.fetch=function(input,init){return native(input,init).then(function(res){
    try{
      var u=typeof input==="string"?input:(input&&input.url)||"";
      if(/midad_control_room|midad_control_surface/.test(u)&&res.clone){res.clone().json().then(function(j){if(j){mesh.last=j;mesh.health=j.health||j.dashboard&&j.dashboard.health||j.data&&j.data.health||{};render()}}).catch(function(){})}
    }catch(e){}
    return res;
  })}
}
function boot(){hook();render();setInterval(render,5000)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();