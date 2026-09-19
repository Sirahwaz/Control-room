const CONFIG={n8nWebhook:"",supabaseUrl:"",supabaseAnonKey:""};
const tg=window.Telegram?.WebApp;
if(tg){tg.ready();tg.expand();}
const $=id=>document.getElementById(id);
function toast(t){const x=$("toast");x.textContent=t;x.style.display="block";clearTimeout(window.__t);window.__t=setTimeout(()=>x.style.display="none",2200)}
function setStatus(ok){$("status").textContent=ok?"متصل":"غير متصل";$("status").className="pill "+(ok?"online":"offline")}
function addEvent(title,detail){const e=document.createElement("div");e.className="event";e.innerHTML="<b>"+title+"</b><div>"+detail+"</div>";$("events").prepend(e)}
async function callBackend(action){
 if(!CONFIG.n8nWebhook){toast("واجهة التحكم جاهزة — اربط Webhook الإنتاج أولًا");return null}
 const r=await fetch(CONFIG.n8nWebhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source:"midad-control-room",action,telegram:initTelegramUser()})});
 if(!r.ok)throw new Error("Backend "+r.status); return r.json().catch(()=>({ok:true}));
}
function initTelegramUser(){return tg?.initDataUnsafe?.user?{id:tg.initDataUnsafe.user.id,username:tg.initDataUnsafe.user.username||null}:null}
async function run(action){try{const data=await callBackend(action);if(data){setStatus(true);addEvent(action,"تم تنفيذ الأمر بنجاح");if(Number.isFinite(data.signals))$("signals").textContent=data.signals;if(Number.isFinite(data.opportunities))$("opportunities").textContent=data.opportunities;if(Number.isFinite(data.alerts))$("alerts").textContent=data.alerts}$("lastSync").textContent=new Date().toLocaleTimeString("ar");}catch(e){setStatus(false);toast("تعذر الاتصال بالخدمة");console.error(e)}}
$("refresh").onclick=()=>run("status");
document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>run(b.dataset.action));
setStatus(!!CONFIG.n8nWebhook);
