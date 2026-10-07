(()=>{"use strict";
const BRIDGE="https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_human_bridge";
const CR="https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_control_room";
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
async function getSession(){
  const tg=window.Telegram?.WebApp,init=tg?.initData||"",key=sessionStorage.getItem("midad_cockpit_key")||"";
  const body=init?{telegram_init_data:init,client:"midad-cockpit",client_version:"human-bridge-control-v1"}:{access_key:key,client:"midad-cockpit",client_version:"human-bridge-control-v1"};
  if(!init&&!key)throw new Error("لا توجد جلسة Control Room صالحة");
  const r=await fetch(CR,{method:"POST",headers:{"content-type":"application/json","x-midad-client":"midad-human-bridge-control"},body:JSON.stringify(body)});
  const j=await r.json();if(!r.ok||!j.token)throw new Error(j.error||"فشل توثيق Control Room");return j.token;
}
function closeModal(){document.getElementById("midadBridgePairModal")?.remove();}
function showPair(j){
  closeModal();
  const box=document.createElement("div");box.id="midadBridgePairModal";
  box.innerHTML="<div style=\"position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.78);backdrop-filter:blur(8px);display:grid;place-items:center;padding:24px\"><div style=\"width:min(560px,100%);border:1px solid rgba(124,244,210,.2);border-radius:22px;background:#0b1119;color:#eef4fb;padding:20px;box-shadow:0 20px 70px rgba(0,0,0,.45);font-family:system-ui,sans-serif\"><div style=\"display:flex;justify-content:space-between;gap:12px;align-items:start\"><div><div style=\"font-size:10px;letter-spacing:.16em;color:#6f7d8e\">MIDAD / HUMAN BRIDGE</div><h2 style=\"margin:5px 0;font-size:22px\">رمز ربط الهاتف</h2><p style=\"margin:0;color:#92a0b0;font-size:12px;line-height:1.7\">افتح تطبيق MIDAD Human Bridge وأدخل الرمز. صالح مرة واحدة ولمدة عشر دقائق.</p></div><button id=\"midadPairClose\" style=\"border:1px solid rgba(255,255,255,.12);background:transparent;color:#92a0b0;border-radius:10px;padding:7px 10px\">×</button></div><div style=\"margin:24px 0;text-align:center\"><div style=\"font:800 34px/1.2 ui-monospace,monospace;letter-spacing:.16em;color:#7cf4d2\">"+esc(j.code)+"</div><div style=\"margin-top:10px;color:#6f7d8e;font-size:10px\">ينتهي: "+new Date(j.expires_at).toLocaleTimeString("ar")+"</div></div><div style=\"padding:12px;border:1px dashed rgba(124,244,210,.2);border-radius:14px;color:#6f7d8e;font-size:10px;line-height:1.6\">رمز bootstrap فقط؛ لا يمنح وصولًا للـSecrets أو المحافظ.</div></div></div>";
  document.body.appendChild(box);
  document.getElementById("midadPairClose").onclick=closeModal;
}
async function pair(){
  try{
    const token=await getSession();
    const r=await fetch(BRIDGE,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"pair_from_control_room",control_room_token:token,device_name:"MIDAD Human Bridge Android"})});
    const j=await r.json();if(!r.ok||j.ok===false)throw new Error(j.error||"تعذر إنشاء رمز الربط");
    showPair(j);
  }catch(e){window.alert("MIDAD Human Bridge: "+String(e.message||e));}
}
function install(){
  if(document.getElementById("midadBridgeButton"))return;
  const b=document.createElement("button");b.id="midadBridgeButton";b.type="button";b.title="MIDAD Human Bridge";b.textContent="🧩 Human Bridge";
  Object.assign(b.style,{position:"fixed",bottom:"18px",left:"18px",zIndex:"80",border:"1px solid rgba(124,244,210,.24)",background:"rgba(9,17,24,.92)",color:"#7cf4d2",borderRadius:"14px",padding:"10px 13px",fontWeight:"800",fontSize:"11px",boxShadow:"0 12px 34px rgba(0,0,0,.34)",backdropFilter:"blur(12px)"});
  b.onclick=pair;document.body.appendChild(b);
}
window.addEventListener("load",()=>setTimeout(install,1800));
})();