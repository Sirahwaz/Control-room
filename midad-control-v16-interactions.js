(()=>{"use strict";
const BASE="https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_control_surface";
let lastView="",lastCheck=0,working=false;
const $=s=>document.querySelector(s), esc=v=>String(v==null?"":v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const tx=(a,e)=>localStorage.getItem("m16_lang")==="en"?e:a;
async function api(action,extra){
 const token=localStorage.getItem("m16_token");if(!token)throw Error("session_missing");
 const r=await fetch(BASE,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,action,operation:action,...extra})});
 const j=await r.json().catch(()=>({}));if(!r.ok||j.ok===false)throw Error(j.error||j.detail||("HTTP "+r.status));return j;
}
function taskButtons(){
 document.querySelectorAll('[data-task="ack"]').forEach(b=>{
   const p=b.parentElement;if(!p||p.querySelector(".m16-extra-task-controls"))return;
   const id=b.dataset.id,box=document.createElement("span");box.className="m16-extra-task-controls";box.style.display="contents";
   box.innerHTML='<button class="m16-btn good" data-patch-task="complete" data-id="'+esc(id)+'">'+esc(tx("إكمال","Complete"))+'</button><button class="m16-btn danger" data-patch-task="reject" data-id="'+esc(id)+'">'+esc(tx("إيقاف","Stop"))+'</button>';
   p.appendChild(box);
 });
 document.querySelectorAll("[data-patch-task]").forEach(b=>{if(b.dataset.bound)return;b.dataset.bound="1";b.onclick=async()=>{if(working)return;working=true;try{await api("human_task_update",{task_id:b.dataset.id,status:b.dataset.patchTask==="complete"?"COMPLETED":"REJECTED",response_data:{source:"control_surface_v16_patch"}});location.reload()}catch(e){alert(e.message)}finally{working=false}}});
}
async function approvals(){
 const active=$(".m16-nav button.active"),view=active&&active.dataset.go;
 if(view!=="tasks")return;
 const now=Date.now();if(now-lastCheck<7000)return;lastCheck=now;
 try{
  const j=await api("overview");const items=j.approvals||[];let old=$("#m16ApprovalPatch");
  if(!old){old=document.createElement("section");old.id="m16ApprovalPatch";old.className="m16-panel";old.style.marginTop="12px";document.querySelector("#m16Root .m16-shell")?.appendChild(old)}
  old.innerHTML='<div class="m16-head"><div><h2>'+esc(tx("مركز الموافقات","Approval Center"))+'</h2><p>'+esc(tx("أي قرار مالي أو حساس يظهر هنا بوضوح، بدل أن تضيع داخل الواجهة.","Financial or sensitive decisions appear here clearly instead of being hidden."))+'</p></div><span class="m16-chip '+(items.length?"amber":"green")+'">'+items.length+'</span></div><div class="m16-body m16-list">'+(items.map(a=>'<div class="m16-item"><div class="m16-item-head"><h3>'+esc(a.action||tx("موافقة","Approval"))+'</h3><span class="m16-chip amber">'+esc(String(a.risk_class||"REVIEW"))+'</span></div><p>'+esc(a.reason||tx("المطلوب قرار بشري قبل المتابعة.","A human decision is required before continuing."))+'</p><div class="m16-action"><button class="m16-btn good" data-patch-approval="approved" data-id="'+esc(a.id)+'">'+esc(tx("أوافق وأتابع","Approve & continue"))+'</button><button class="m16-btn danger" data-patch-approval="rejected" data-id="'+esc(a.id)+'">'+esc(tx("أرفض / أوقف","Reject / stop"))+'</button></div></div>').join("")||'<div class="m16-empty">'+esc(tx("لا توجد موافقات معلقة الآن.","No pending approvals now."))+'</div>')+'</div>';
  old.querySelectorAll("[data-patch-approval]").forEach(b=>{b.onclick=async()=>{if(working)return;working=true;try{await api("approval_decide",{approval_id:b.dataset.id,decision:b.dataset.patchApproval,note:"Decision from Control Surface v16"});lastCheck=0;await approvals()}catch(e){alert(e.message)}finally{working=false}}});
 }catch(e){}
}
function tick(){if(window.__MIDAD_V16_READY){taskButtons();approvals()}setTimeout(tick,1800)}
tick();
})();