(()=>{"use strict";
const SUPABASE_URL="https://froegigfmpmvtecztfbf.supabase.co";
const USER_API=SUPABASE_URL+"/functions/v1/midad_browser_agent_gateway";
const TELEGRAM_AUTH=SUPABASE_URL+"/functions/v1/midad_telegram_auth";
const CONTROL_API=SUPABASE_URL+"/functions/v1/midad_control_room";
const $=s=>document.querySelector(s);
const state={token:null,worker:false,ownerReady:false};
function setStatus(ready,title,detail,pill){$("#bridgeTitle").textContent=title;$("#bridgeDetail").textContent=detail;$("#bridgePill").textContent=pill;$("#bridgePill").className="pill pending";$("#statusDot").style.background=ready?"var(--green)":"var(--amber)";$("#connectionLabel").textContent=ready?"متصل":"بانتظار الربط";}
function lockControls(ready){["#platformInput","#addressInput","#navigateButton","#commandInput","#sendCommand"].forEach(s=>$(s).disabled=!ready);}
function addActivity(title,detail){const box=$("#activityList");$("#activityEmpty").hidden=true;const item=document.createElement("div");item.className="activity-item";const b=document.createElement("b");b.textContent=title;const small=document.createElement("small");small.textContent=detail;item.append(b,small);box.prepend(item);}
async function obtainSession(force=false){
 if(state.token&&!force)return state.token;
 const tg=window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;
 const initData=tg?.initData||"";
 let response;
 if(initData){
  response=await fetch(TELEGRAM_AUTH,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({telegram_init_data:initData,client:"midad-control-v2"})});
 }else{
  let key="";try{key=sessionStorage.getItem("midad_cockpit_key")||""}catch{}
  if(!key)return null;
  response=await fetch(CONTROL_API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({access_key:key,client:"midad-control-v2"})});
 }
 const data=await response.json().catch(()=>({}));
 if(!response.ok||!data.token)throw new Error(data.error||"MIDAD_LOGIN_REQUIRED");
 state.token=data.token;return state.token;
}
async function api(payload,retry=true){
 const token=await obtainSession();if(!token)throw new Error("افتح Control Room وسجّل الدخول أولاً");
 const response=await fetch(USER_API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...payload,session_token:token})});
 const data=await response.json().catch(()=>({}));
 if(response.status===401&&retry){state.token=null;return api(payload,false)}
 if(!response.ok||data.ok!==true)throw new Error(data.error||("HTTP "+response.status));
 return data;
}
function renderSessions(sessions){
 const list=$("#sessionsList");list.replaceChildren();$("#sessionCount").textContent=String(sessions.length);
 $("#sessionsEmpty").hidden=sessions.length>0;
 for(const session of sessions){
  const card=document.createElement("div");card.className="session-item";
  const title=document.createElement("b");title.textContent=(session.platform_key||"Browser job")+" · "+session.state;
  const detail=document.createElement("small");detail.textContent=(session.current_url||"لا يوجد عنوان بعد")+" · "+new Date(session.updated_at).toLocaleString();
  card.append(title,detail);list.append(card);
  if(session.result?.text_preview&&$("#browserViewport").dataset.jobId!==session.job_id){
   $("#browserViewport").dataset.jobId=session.job_id;
   const view=document.createElement("div");view.className="viewport-placeholder";
   const heading=document.createElement("b");heading.textContent=session.result.title||"معاينة الصفحة";
   const p=document.createElement("p");p.textContent=session.result.text_preview;
   const stateLabel=document.createElement("span");stateLabel.className="pill neutral";stateLabel.textContent=session.result.status||"RESULT";
   view.replaceChildren(heading,p,stateLabel);$("#browserViewport").replaceChildren(view);
  }
 }
}
async function refreshSessions(){const data=await api({action:"ui_list_sessions"});renderSessions(data.sessions||[]);}
async function waitForResult(jobId){
 for(let attempt=0;attempt<12;attempt++){
  await new Promise(resolve=>setTimeout(resolve,2500));
  try{
   const result=await api({action:"ui_get_result",job_id:jobId});
   if(result.ready){addActivity("اكتمل تنفيذ الأمر",result.result?.status||result.state);await refreshSessions();return;}
  }catch(e){addActivity("تعذر جلب النتيجة",String(e.message||e));return;}
 }
 addActivity("الأمر ما زال قيد التنفيذ","يمكنك تحديث الحالة لاحقاً لمتابعة النتيجة.");
}
async function checkBridge(){
 lockControls(false);
 try{
  const data=await api({action:"ui_capabilities"});
  state.ownerReady=true;state.worker=data.worker_online===true;
  if(state.worker){setStatus(true,"بوابة المتصفح والعامل متصلان","آخر نبضة مؤكدة: "+(data.worker_last_seen||"الآن"),"WORKER ONLINE");lockControls(true);$("#sessionState").textContent="Worker متصل — الجلسات في الذاكرة";}
  else{setStatus(true,"بوابة المتصفح متصلة","العامل غير متصل أو لم يرسل Heartbeat حديثاً. الأوامر تبقى معطّلة حتى تأكيد تشغيله.","WORKER OFFLINE");$("#bridgePill").textContent="WORKER OFFLINE";$("#sessionState").textContent="Worker غير متصل";}
  await refreshSessions();
 }catch(e){state.ownerReady=false;state.worker=false;setStatus(false,"تعذر الاتصال الآمن",String(e.message||e),"AUTH / BRIDGE REQUIRED");lockControls(false);}
}
$("#navigateForm").addEventListener("submit",async e=>{
 e.preventDefault();const platform=$("#platformInput").value.trim(),url=$("#addressInput").value.trim();
 if(!platform||!url){addActivity("بيانات ناقصة","أدخل اسم المنصة المعتمدة وعنوان HTTPS.");return}
 if(!/^https:\/\//i.test(url)){addActivity("عنوان مرفوض","المتصفح يقبل HTTPS فقط.");return}
 await sendCommand("navigate "+platform+" "+url);
});
async function sendCommand(command){
 const requestId=crypto.randomUUID().replace(/-/g,"");
 try{const data=await api({action:"ui_command",command,request_id:requestId});addActivity("أُرسل الأمر إلى الطابور",data.job_id+" · "+data.state);await refreshSessions();await waitForResult(data.job_id);}
 catch(e){addActivity("تعذر إرسال الأمر",String(e.message||e));}
}
$("#sendCommand").addEventListener("click",()=>{const command=$("#commandInput").value.trim();if(command)sendCommand(command);});
$("#refreshStatus").addEventListener("click",checkBridge);
document.querySelectorAll("[data-local-action]").forEach(b=>b.addEventListener("click",()=>addActivity("الإجراء غير متاح حالياً","التنقل والتحكم يتمان عبر أوامر المنصة المعتمدة حتى نضيف بثّاً مباشراً للجلسة.")));
lockControls(false);checkBridge();
})();