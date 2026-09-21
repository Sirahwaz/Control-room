const CONFIG={controlRoomUrl:"https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_control_room"};
const tg=(window.Telegram&&window.Telegram.WebApp)?window.Telegram.WebApp:null;
if(tg){
  try{if(typeof tg.ready==="function")tg.ready();if(typeof tg.expand==="function")tg.expand();if(typeof tg.setHeaderColor==="function")tg.setHeaderColor("#07111f");if(typeof tg.setBackgroundColor==="function")tg.setBackgroundColor("#07111f");}
  catch(e){console.warn("MIDAD Telegram bootstrap warning",e);}
}
const $=id=>document.getElementById(id);
function storageGet(k){try{return localStorage.getItem(k)||""}catch(e){console.warn("MIDAD storage read blocked",e);return ""}}
function storageSet(k,v){try{localStorage.setItem(k,v)}catch(e){console.warn("MIDAD storage write blocked",e)}}
function storageRemove(k){try{localStorage.removeItem(k)}catch(e){console.warn("MIDAD storage remove blocked",e)}}
let session=storageGet("midad_cr_session");let state=null;let authMode=session?"unknown":"";let loginOverlay=null;
function toast(t){const x=$("toast");x.textContent=t;x.style.display="block";clearTimeout(window.__toast);window.__toast=setTimeout(()=>x.style.display="none",3000)}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function pct(v){const n=Number(v||0);return (n<=1?n*100:n).toFixed(0)+"%"}function num(v){return v==null||v===""?"—":Number(v).toLocaleString("ar")}
function time(v){if(!v)return "—";try{return new Date(v).toLocaleString("ar",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return v}}
function setStatus(ok,text){$("status").textContent=text|| (ok?"متصل":"غير متصل");$("status").className="pill "+(ok?"online":"offline")}
async function showLogin(show=true){
  if(!show)return;
  if(isTelegramMiniApp())return;
  if(loginOverlay)return;
  loginOverlay=true;
  try{
    const key=window.prompt("MIDAD Control Room\\nأدخل مفتاح وصول الويب:");
    if(!key){setStatus(false,"Web ينتظر مفتاح الدخول");setBootFailure("وضع الويب جاهز؛ أدخل مفتاح غرفة التحكم لفتح البيانات.");return;}
    setStatus(false,"جارِ التحقق…");
    const j=await apiWithoutSession({access_key:String(key).trim()});
    session=j.token;authMode="web";storageSet("midad_cr_session",session);
    setStatus(true,"Web متصل");showLogin(false);
    await load();await loadMining();
  }catch(e){
    setStatus(false,"تعذر التحقق");
    setBootFailure("تعذر دخول غرفة التحكم: "+(e?.message||"مفتاح غير صالح"));
    toast(e?.message||"مفتاح غير صالح");
  }finally{loginOverlay=false;}
}
function isTelegramMiniApp(){return !!(tg&&typeof tg.initData==="string"&&tg.initData.trim())}
function isTelegramContext(){return !!tg}
function setAuthMessage(t){}
function setBootFailure(message){
  setStatus(false,message||"تعذر تشغيل الواجهة");
  const p=$("pipelineNote");if(p)p.textContent=message||"تعذر تشغيل واجهة غرفة التحكم.";
}
window.addEventListener("error",e=>{
  const msg=e?.error?.message||e?.message||"JavaScript runtime error";
  console.error("MIDAD Control Room error",e?.error||e);
  if($("status")?.textContent?.includes("جار"))setBootFailure("خطأ في تشغيل الواجهة: "+msg);
});
window.addEventListener("unhandledrejection",e=>{
  const msg=e?.reason?.message||String(e?.reason||"Unhandled promise rejection");
  console.error("MIDAD Control Room rejection",e?.reason);
  if($("status")?.textContent?.includes("جار"))setBootFailure("خطأ اتصال: "+msg);
})

async function api(body){
  if(!session)throw new Error("جلسة غرفة التحكم غير جاهزة");
  const r=await fetch(CONFIG.controlRoomUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,token:session})});
  const j=await r.json().catch(()=>({}));
  if(r.status===401){
    session="";storageRemove("midad_cr_session");setStatus(false);
    throw new Error(j.error||"انتهت الجلسة، أعد الدخول");
  }
  if(!r.ok||j.error)throw new Error(j.error||"تعذر تنفيذ الطلب");
  return j;
}
async function apiWithoutSession(body){
  const r=await fetch(CONFIG.controlRoomUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.token)throw new Error(j.error||"رفض الدخول");
  return j;
}
async function loginWithWebAccessKey(){
  authMode="web";
  showLogin(true);
  return false;
}
async function loginWithTelegram(){
  if(!isTelegramMiniApp()){
    setStatus(false,"افتح من Telegram");
    return false;
  }
  try{
    setStatus(false,"جارِ التحقق…");
    setAuthMessage("جارِ الاتصال…");
    const j=await apiWithoutSession({telegram_init_data:tg.initData});
    session=j.token;
    storageSet("midad_cr_session",session);
    showLogin(false);
    setStatus(true,"Telegram متصل");
    await load();
    await loadMining();
    return true;
  }catch(e){
    session="";
    storageRemove("midad_cr_session");
    setStatus(false,"تعذر التحقق");
    showLogin(true);
    setAuthMessage("تعذر الاتصال بغرفة التحكم.",false);
    toast(e.message||"تعذر التحقق");
    return false;
  }
}
async function load(){
  try{
    const j=await api({action:"dashboard"});
    state=j;showLogin(false);setStatus(true,authMode==="web"?"Web متصل":"Telegram متصل");render();return true;
  }catch(e){
    const m=String(e.message||"");
    if(m.includes("انتهت الجلسة")||m.includes("session_expired")){
      session="";storageRemove("midad_cr_session");
      if(authMode==="telegram")return await loginWithTelegram();
      showLogin(true);return false;
    }
    setStatus(false);toast(e.message);return false;
  }
}
function approvalHtml(a){
  const ev=a.evidence||{};
  return '<article class="alert-card '+esc(a.risk_class||"medium")+'"><div class="row"><div><b>'+esc(a.action||"Approval")+'</b><div class="muted">'+esc(a.subject_type||"")+' · '+esc(time(a.created_at))+'</div></div><span class="pill warning">'+esc(a.status||"pending")+'</span></div><p>'+esc(a.reason||"")+'</p><div class="tags"><span class="tag">Risk '+esc(a.risk_class||"medium")+'</span><span class="tag">Confidence '+pct(ev.confidence)+'</span></div><div class="actions-inline"><button data-approval="'+esc(a.id)+'" data-decision="approved" class="primary">موافقة</button><button data-approval="'+esc(a.id)+'" data-decision="rejected" class="danger">رفض</button></div></article>';
}
function clientHtml(c){
  return '<article class="wallet-card"><div class="row"><div><b>'+esc(c.display_name||c.external_ref||"عميل")+'</b><div class="muted">'+esc(c.contact||"")+'</div></div><span class="pill '+(c.trust_level==="trusted"?"online":"warning")+'">'+esc(c.trust_level||"unknown")+'</span></div><div class="tags"><span class="tag">'+esc(c.preferred_language||c.detected_language||"لغة غير معروفة")+'</span><span class="tag">'+esc(c.external_ref||"")+'</span></div></article>';
}
function paymentHtml(p){
  return '<article class="capital-card"><div class="row"><div><b>'+esc(p.project_ref||"Payment Intent")+'</b><div class="muted">'+esc(p.settlement_asset||"crypto TBD")+' · '+esc(p.network||"network TBD")+'</div></div><span class="pill '+(p.status==="paid"||p.status==="reconciled"?"online":"warning")+'">'+esc(p.status||"created")+'</span></div><div class="tags"><span class="tag">'+num(p.amount_fiat)+' '+esc(p.fiat_currency||"USD")+'</span><span class="tag">Crypto '+num(p.quoted_crypto_amount)+'</span><span class="tag">Reconcile '+esc(p.reconciliation_status||"unreconciled")+'</span></div></article>';
}
function osintHtml(e){
  return '<article class="signal-card '+(e.severity==="critical"?"critical":e.severity==="high"?"high":"")+'"><div class="row"><div><b>'+esc(e.event_type||"OSINT")+'</b><div class="muted">'+esc(e.subject_key||"")+' · '+esc(time(e.observed_at))+'</div></div><div class="score">'+num(e.confidence*100)+'</div></div><div class="tags"><span class="tag">'+esc(e.severity||"info")+'</span><span class="tag">conf '+pct(e.confidence)+'</span></div></article>';
}
function renderControlPlane(){
  const h=state.health||{}, approvals=state.approvals||[], clients=state.clients||[], payments=state.payments||[], osint=state.osint||{sources:[],events:[]};
  $("pendingApprovals").textContent=num(h.pending_approvals);
  $("clientCount").textContent=num(h.clients);
  $("conversationCount").textContent=num(h.open_conversations);
  $("paymentCount").textContent=num(h.payment_intents);
  $("osintEventCount").textContent=num(h.osint_events);
  $("osintSourceCount").textContent=num(h.osint_sources);
  $("approvalList").innerHTML=approvals.map(approvalHtml).join("")||'<div class="empty">لا توجد موافقات معلّقة.</div>';
  $("clientList").innerHTML=clients.map(clientHtml).join("")||'<div class="empty">لم تصل محادثات عملاء بعد.</div>';
  $("paymentList").innerHTML=payments.map(paymentHtml).join("")||'<div class="empty">لا توجد طلبات دفع.</div>';
  $("osintList").innerHTML=osint.events.map(osintHtml).join("")||'<div class="empty">لا توجد أحداث OSINT في الفترة الحالية.</div>';
}
function render(){const h=state.health; $("signals").textContent=num(h.signals);$("opportunities").textContent=num(h.opportunities);$("sentinelAlerts").textContent=num(h.sentinel_alerts);$("derivedAlerts").textContent=num(state.alerts.filter(a=>a.kind==="derived_signal").length);$("engineRuns").textContent=num(h.engine_runs);$("entities").textContent=num(h.entities);$("pipelineNote").textContent=h.pipeline_note;const healthy=h.pipeline_ok; $("healthBadge").textContent=healthy?"المسار يعمل":"يوجد انقطاع تشغيلي";$("healthBadge").className="pill "+(healthy?"online":"warning");
$("healthRows").innerHTML=[["إدخال الإشارات",h.signals>0,"615+ إشارة موجودة"],["مولّد الفرص",h.opportunities>0,"الجدول الحالي: "+num(h.opportunities)],["سجل المحرك",h.engine_runs>0,"Engine runs: "+num(h.engine_runs)],["Sentinel",h.sentinel_alerts>0,"Active/review: "+num(h.sentinel_alerts)],["Wallet layer",h.wallets>0,"المحافظ: "+num(h.wallets)],["Trade review",h.trade_intents>0,"نوايا التداول: "+num(h.trade_intents)]].map(x=>'<div class="status-row"><span>'+esc(x[0])+'</span><span class="'+(x[1]?"good":"warning-text")+'">'+esc(x[2])+'</span></div>').join("");
$("strongSignals").innerHTML=state.signals.filter(s=>s.score>=85).slice(0,6).map(signalHtml).join("")||'<div class="empty">لا توجد إشارات قوية الآن.</div>';
$("signalList").innerHTML=state.signals.map(signalHtml).join("")||'<div class="empty">لا توجد إشارات.</div>';
$("opportunityList").innerHTML=state.opportunities.map(o=>'<article class="opp-card"><div class="row"><div><b>'+esc(o.title)+'</b><div class="muted">'+esc(o.source||"unknown")+' · '+esc(o.opportunity_type||"review")+'</div></div><div class="score">'+num(o.score)+'</div></div><div class="tags"><span class="tag">الثقة '+pct(o.confidence)+'</span><span class="tag">'+esc(o.status||"new")+'</span><span class="tag">القيمة '+(o.expected_value==null?"غير محددة":num(o.expected_value))+'</span></div><p>'+esc(o.description||"لا يوجد وصف إضافي.")+'</p></article>').join("")||'<div class="empty">لا توجد فرصة مثبتة. استخرجها من إشارة قوية عبر زر «تكوين فرصة للمراجعة».</div>';
$("alertList").innerHTML=state.alerts.map(alertHtml).join("")||'<div class="empty">لا توجد تنبيهات نشطة.</div>';
$("capitalList").innerHTML=state.capital.map(c=>'<article class="capital-card"><div class="row"><div><b>'+esc(c.label)+'</b><div class="muted">'+esc(c.source_type)+' · '+esc(c.asset||"")+'</div></div><div class="score">'+(c.estimated_daily_value==null?"—":num(c.estimated_daily_value)+" "+esc(c.currency||"USD"))+'</div></div><div class="tags"><span class="tag">الرصيد '+num(c.amount)+'</span><span class="tag">التكلفة '+num(c.operating_cost)+'</span><span class="tag">'+esc(c.status||"active")+'</span></div></article>').join("")||'<div class="empty">أضف مصدر رأس المال، مثل ViaBTC Mining.</div>';
$("walletList").innerHTML=state.wallets.map(w=>'<article class="wallet-card"><div class="row"><div><b>'+esc(w.label)+'</b><div class="muted">'+esc(w.chain)+' · '+esc(w.purpose)+'</div></div><span class="pill online">watch</span></div><div class="tags"><span class="tag address">'+esc(w.address)+'</span></div></article>').join("")||'<div class="empty">لا توجد محافظ مراقبة.</div>';
$("exchangeList").innerHTML=state.exchanges.map(x=>'<article class="wallet-card"><div class="row"><div><b>'+esc(x.exchange)+' · '+esc(x.label)+'</b><div class="muted">'+esc(x.mode)+' · '+esc(x.status)+'</div></div><span class="pill '+(x.status==="connected"?"online":"warning")+'">'+esc(x.supports_crypto?"crypto":"fiat-only")+'</span></div><div class="tags"><span class="tag">إيداع '+(x.deposit_enabled?"متاح":"غير مفعّل")+'</span><span class="tag">سحب '+(x.withdrawal_enabled?"متاح":"غير مفعّل")+'</span></div></article>').join("")||'<div class="empty">لا توجد منصات مسجلة بعد.</div>';$("tradeList").innerHTML=state.trades.map(t=>'<article class="trade-card"><div class="row"><div><b>'+esc(t.asset_symbol)+' @ '+esc(t.venue)+'</b><div class="muted">'+esc(t.strategy)+' · '+esc(t.side)+'</div></div><span class="pill warning">'+esc(t.status||"review")+'</span></div><div class="tags"><span class="tag">Amount '+num(t.amount)+'</span><span class="tag">Max loss '+num(t.max_loss_pct)+'%</span><span class="tag">Max fee '+num(t.max_fee_pct)+'%</span><span class="tag">'+(t.requires_approval?"موافقة مطلوبة":"—")+'</span></div></article>').join("")||'<div class="empty">لا توجد نوايا تداول. ابدأ بوضع Watch/Review.</div>';
$("automationPanel").innerHTML='<article class="card"><h3>🔌 مسار البيانات</h3><p>'+esc(h.pipeline_note)+'</p><div class="tags"><span class="tag">signals '+num(h.signals)+'</span><span class="tag">opportunities '+num(h.opportunities)+'</span><span class="tag">engine '+num(h.engine_runs)+'</span><span class="tag">approvals '+num(h.pending_approvals)+'</span><span class="tag">osint '+num(h.osint_events)+'</span><span class="tag">autonomy '+esc(h.autonomy_last_status||"never")+'</span></div></article><article class="card"><h3>🛡️ حدود التنفيذ</h3><p>التواصل منخفض المخاطر يمكن أن يؤتمت؛ التفاوض، الالتزامات، الدفع، التحويل والتداول الحساس تبقى تحت Policy + Approval.</p><div class="actions-inline"><button data-action="dashboard_refresh" class="primary">إعادة فحص</button><button class="danger" onclick="toast(&quot;لا يوجد تنفيذ مالي تلقائي&quot;)">سلامة التنفيذ</button></div></article>';
}
renderControlPlane();
function renderMining(accounts){$("miningList").innerHTML=(accounts||[]).map(x=>'<article class="capital-card"><div class="row"><div><b>'+esc(x.label)+'</b><div class="muted">'+esc(x.provider)+' · '+esc(x.coin)+' · '+esc(x.mode)+'</div></div><span class="pill '+(x.status==="connected"?"online":x.status==="planned"?"warning":"offline")+'">'+esc(x.status)+'</span></div><div class="tags"><span class="tag">Hashrate '+num(x.last_hashrate_ths)+' TH/s</span><span class="tag">Workers '+num(x.last_worker_count)+'</span><span class="tag">'+(x.read_only?"Read-only":"—")+'</span><span class="tag">آخر تحديث '+esc(time(x.last_snapshot_at))+'</span></div></article>').join("")||'<div class="empty">لا يوجد حساب تعدين مسجل بعد.</div>'}
async function loadMining(){try{const j=await api({action:"mining_status"});renderMining(j.accounts)}catch(e){toast(e.message)}}
function signalHtml(s){const strong=Number(s.score)>=90;return '<article class="signal-card '+(strong?"critical":Number(s.score)>=85?"high":"")+'"><div class="row"><div><b>'+esc(s.type_label)+'</b><div class="muted">'+esc(s.source)+' · '+esc(s.entity||"كيان غير محدد")+'</div></div><div class="score">'+num(s.score)+'</div></div><div class="tags"><span class="tag">الثقة '+pct(s.confidence)+'</span><span class="tag">'+esc(time(s.occurred_at))+'</span></div><div class="actions-inline"><button onclick="promote(&quot;'+esc(s.id)+'&quot;)" class="primary">تكوين فرصة للمراجعة</button></div></article>'}
function alertHtml(a){return '<article class="alert-card '+esc(a.severity)+'"><div class="row"><div><b>'+esc(a.title)+'</b><div class="muted">'+esc(a.entity||"")+' · '+esc(a.source)+'</div></div><div class="score">'+num(a.score)+'</div></div><div class="tags"><span class="tag">'+esc(a.severity)+'</span><span class="tag">الثقة '+pct(a.confidence)+'</span><span class="tag">'+esc(time(a.occurred_at))+'</span></div><p>'+esc(a.note)+'</p></article>'}
async function promote(id){try{const j=await api({action:"promote_signal",signal_id:id});toast(j.opportunity?"تم تكوين فرصة للمراجعة":"تمت المعالجة");await load()}catch(e){toast(e.message)}}
async function addForm(action,payload){try{await api({action,payload});toast("تم الحفظ");await load()}catch(e){toast(e.message)}}
async function decideApproval(id,decision){
  try{
    const note=decision==="approved"?"تمت الموافقة من غرفة التحكم.":"تم رفض المسودة من غرفة التحكم.";
    const j=await api({action:"approval_decide",approval_id:id,decision,note});
    toast(j.status==="approved"?"تم اعتماد وإرسال الرد":"تم تحديث الموافقة");
    await load();
  }catch(e){toast(e.message)}
}
$("refresh").onclick=load;
$("runOsint").onclick=async()=>{try{const j=await api({action:"run_osint_scan"});toast("OSINT: "+num(j.osint_events_inserted||0)+" حدث جديد");await load()}catch(e){toast(e.message)}};
$("runAutonomy").onclick=async()=>{try{const j=await api({action:"run_autonomy_now"});toast(j.ok?"دورة MIDAD اكتملت":"تعذر تشغيل الدورة");await load()}catch(e){toast(e.message)}};
$("switchTelegramRouter").onclick=async()=>{if(!confirm("تفعيل Telegram Router سيغيّر Webhook الحالي إلى طبقة الفصل بين المالك والعملاء. يمكن التراجع بزر الإعادة."))return;try{const j=await api({action:"telegram_webhook_router"});toast(j.ok?"Telegram Router مفعّل":"فشل تفعيل Router");}catch(e){toast(e.message)}};
$("restoreTelegramBot").onclick=async()=>{if(!confirm("إعادة Webhook إلى telegram_bot الحالي؟"))return;try{const j=await api({action:"telegram_webhook_bot"});toast(j.ok?"تمت إعادة Telegram Bot":"فشل الإرجاع");}catch(e){toast(e.message)}};
$("runMining").onclick=async()=>{try{const j=await api({action:"run_mining_monitor"});toast(j.configured?"ViaBTC تمت مزامنته":"ViaBTC API غير مهيأ بعد");await loadMining()}catch(e){toast(e.message)}};
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));$("tab-"+b.dataset.tab).classList.add("active");});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-action]");
  if(b?.dataset.action==="dashboard_refresh")load();
  const ap=e.target.closest("[data-approval]");
  if(ap)decideApproval(ap.dataset.approval,ap.dataset.decision);
});
$("addWallet").onclick=()=>addForm("wallet_add",{label:$("walletLabel").value,chain:$("walletChain").value,address:$("walletAddress").value,purpose:$("walletPurpose").value});
$("addExchange").onclick=()=>addForm("exchange_add",{exchange:$("exchangeName").value,label:$("exchangeLabel").value,account_ref:$("exchangeRef").value});
$("runOppScan").onclick=async()=>{try{const j=await api({action:"run_opportunity_scan"});toast("محرك الفرص: "+num(j.created||0)+" فرصة جديدة");await load()}catch(e){toast(e.message)}};
$("addTrade").onclick=()=>addForm("trade_add",{asset_symbol:$("tradeAsset").value,venue:$("tradeVenue").value,side:$("tradeSide").value,strategy:$("tradeStrategy").value,amount:$("tradeAmount").value,max_loss_pct:$("tradeLoss").value,max_fee_pct:$("tradeFee").value});
$("addCapital").onclick=()=>addForm("capital_add",{label:$("capLabel").value,source_type:$("capType").value||"capital",asset:$("capAsset").value,amount:$("capAmount").value,estimated_daily_value:$("capDaily").value,operating_cost:$("capCost").value});
window.promote=promote;
async function bootstrapAuth(){
  try{
    if(isTelegramMiniApp()){
      authMode="telegram";
      if(session){
        const ok=await load();
        if(ok){await loadMining();return}
      }
      await loginWithTelegram();
      return;
    }
    if(isTelegramContext()){
      setBootFailure("Telegram فتح الصفحة بدون initData؛ افتح Mini App من زر Telegram الرسمي وتأكد من إعداداته.");
      setAuthMessage("لم تصل بيانات Telegram الآمنة إلى الصفحة.");
      return;
    }
    authMode="web";
    if(session){
      const ok=await load();
      if(ok){await loadMining();return}
    }
    setStatus(false,"Web ينتظر مفتاح الدخول");
    setBootFailure("وضع الويب جاهز؛ أدخل مفتاح غرفة التحكم لفتح البيانات.");
    showLogin(true);
  }catch(e){
    console.error("MIDAD bootstrap failed",e);
    setBootFailure("تعذر تشغيل غرفة التحكم: "+(e?.message||"خطأ غير معروف"));
    toast(e?.message||"تعذر التشغيل");
  }
}

