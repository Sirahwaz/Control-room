(()=>{"use strict";
const $=s=>document.querySelector(s);
const API="/functions/v1/midad_browser_user_api";
const state={connected:false,worker:false};
function setStatus(ready,title,detail,pill){$("#bridgeTitle").textContent=title;$("#bridgeDetail").textContent=detail;$("#bridgePill").textContent=pill;$("#bridgePill").className="pill pending";$("#statusDot").style.background=ready?"var(--green)":"var(--amber)";$("#connectionLabel").textContent=ready?"متصل":"بانتظار الربط";}
function lockControls(ready){["#addressInput","#navigateButton","#commandInput","#sendCommand"].forEach(s=>$(s).disabled=!ready);document.querySelectorAll("[data-local-action]").forEach(b=>b.disabled=!ready);}
function addActivity(title,detail){const box=$("#activityList");$("#activityEmpty").hidden=true;const item=document.createElement("div");item.className="activity-item";const b=document.createElement("b");b.textContent=title;const small=document.createElement("small");small.textContent=detail;item.append(b,small);box.prepend(item);}
async function getAccessToken(){const adapter=window.MIDAD_BROWSER_AUTH;if(!adapter||typeof adapter.getAccessToken!=="function")return null;return await adapter.getAccessToken();}
async function api(payload){const token=await getAccessToken();if(!token)throw new Error("جلسة MIDAD غير متاحة");const r=await fetch(API,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+token},body:JSON.stringify(payload)});const d=await r.json().catch(()=>({}));if(!r.ok||d.ok!==true)throw new Error(d.error||("HTTP "+r.status));return d;}
async function checkBridge(){lockControls(false);let token;try{token=await getAccessToken()}catch(e){setStatus(false,"تعذّر قراءة جلسة الدخول","تعذر الحصول على جلسة مستخدم موثقة. أعد فتح Control Room ثم حاول مجدداً.","AUTH REQUIRED");return}
if(!token){setStatus(false,"طبقة الاتصال غير مفعّلة","الواجهة جاهزة؛ يلزم ربط جلسة دخول MIDAD مع واجهة المتصفح. لا يُرسل أي مفتاح خاص من هذه الصفحة.","BRIDGE PENDING");return}
try{const d=await api({action:"capabilities"});state.connected=true;state.worker=d.worker_online===true;setStatus(true,"بوابة المتصفح متصلة",state.worker?"تم التحقق من البوابة والعامل.":"البوابة متصلة لكن Worker لم يثبت أنه يعمل.","CONNECTED");lockControls(state.worker);$("#sessionState").textContent=state.worker?"Worker متصل — لا توجد جلسة مؤكدة":"Worker غير متصل";if(!state.worker)$("#bridgePill").textContent="WORKER OFFLINE";addActivity("فحص الاتصال","تم التحقق من البوابة. لم يتم فتح أي موقع.");}
catch(e){state.connected=false;setStatus(false,"بوابة المتصفح غير متاحة","تعذر التحقق من الواجهة الخلفية الآمنة: "+String(e.message||e),"BRIDGE UNAVAILABLE");}}
$("#navigateForm").addEventListener("submit",async e=>{e.preventDefault();const url=$("#addressInput").value.trim();if(!url)return;try{const d=await api({action:"navigate",url});addActivity("طلب تنقل",d.state||"استلمت البوابة الطلب");}catch(err){addActivity("تعذر التنقل",String(err.message||err));}});
$("#sendCommand").addEventListener("click",async()=>{const command=$("#commandInput").value.trim();if(!command)return;try{const d=await api({action:"command",command});addActivity("تم إرسال الأمر",d.state||"استلمت البوابة الطلب");}catch(err){addActivity("تعذر إرسال الأمر",String(err.message||err));}});
$("#refreshStatus").addEventListener("click",checkBridge);
document.querySelectorAll("[data-local-action]").forEach(b=>b.addEventListener("click",()=>addActivity("الإجراء غير متاح","يتطلب جلسة متصفح حقيقية مؤكدة.")));
lockControls(false);checkBridge();
})();