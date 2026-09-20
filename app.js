const CONFIG={controlRoomUrl:"https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_control_room"};
const tg=window.Telegram?.WebApp;
if(tg){tg.ready();tg.expand();}
const $=id=>document.getElementById(id);
let session=localStorage.getItem("midad_cr_session")||"";
function toast(t){const x=$("toast");x.textContent=t;x.style.display="block";clearTimeout(window.__t);window.__t=setTimeout(()=>x.style.display="none",2600)}
function setStatus(ok){$("status").textContent=ok?"متصل":"غير متصل";$("status").className="pill "+(ok?"online":"offline")}
function addEvent(title,detail){const e=document.createElement("div");e.className="event";e.innerHTML="<b>"+escapeHtml(title)+"</b><div>"+escapeHtml(detail)+"</div>";$("events").prepend(e)}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function showLogin(){if($("loginCard"))$("loginCard").style.display="block"}
async function login(){
 const key=$("controlKey")?.value||"";
 if(key.length<12){toast("مفتاح غرفة التحكم غير صالح");return}
 const b=$("loginBtn");b.disabled=true;b.textContent="جارِ التحقق…";
 try{const r=await fetch(CONFIG.controlRoomUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key})});const j=await r.json();if(!r.ok||!j.token)throw new Error(j.error||"رفض الدخول");session=j.token;localStorage.setItem("midad_cr_session",session);$("controlKey").value="";$("loginCard").style.display="none";setStatus(true);toast("تم الدخول بأمان");run("status");}
 catch(e){setStatus(false);toast(e.message||"تعذر الدخول");}
 finally{b.disabled=false;b.textContent="دخول آمن"}
}
async function callBackend(command){
 if(!session){showLogin();toast("أدخل مفتاح غرفة التحكم أولًا");return null}
 const r=await fetch(CONFIG.controlRoomUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:session,command})});
 const j=await r.json().catch(()=>({}));
 if(r.status===401){session="";localStorage.removeItem("midad_cr_session");showLogin();setStatus(false);throw new Error("انتهت الجلسة، أعد الدخول")}
 if(!r.ok)throw new Error(j.error||("Backend "+r.status));
 return j;
}
function updateMetrics(reply){const s=String(reply||"");const m=s.match(/الإشارات:\s*(\\d+)[\\s\\S]*?الفرص:\s*(\\d+)/);if(m){$("signals").textContent=m[1];$("opportunities").textContent=m[2]}}
async function run(action){try{const command=action==="status"?"/status":action==="revenue"?"/revenue":action==="scan"?"menu:radar":action==="opportunities"?"menu:opps":action==="alerts"?"menu:radar":action;const data=await callBackend(command);if(!data)return;setStatus(true);const reply=data.reply||"تم تنفيذ الأمر";updateMetrics(reply);addEvent(command,reply);$("lastSync").textContent=new Date().toLocaleTimeString("ar");}catch(e){setStatus(false);toast(e.message||"تعذر الاتصال بالخدمة");console.error(e)}}
$("refresh").onclick=()=>run("status");
$("loginBtn")?.addEventListener("click",login);
$("controlKey")?.addEventListener("keydown",e=>{if(e.key==="Enter")login()});
document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>run(b.dataset.action));
if(session){setStatus(true);run("status")}else{setStatus(false)}
