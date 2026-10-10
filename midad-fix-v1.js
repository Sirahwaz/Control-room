/* MIDAD FIX v1 runtime guard. Additive only; leaves the existing app/API contract unchanged. */
(()=>{"use strict";
  const mobile=()=>!!(window.matchMedia&&window.matchMedia("(max-width:760px)").matches);
  const $=(s,r=document)=>r.querySelector(s);
  function syncActiveNavigation(){
    let view="cockpit";
    try{view=new URL(location.href).searchParams.get("view")||"cockpit"}catch{}
    document.querySelectorAll(".navbtn[data-view]").forEach(button=>{
      const active=button.dataset.view===view;
      button.classList.toggle("active",active);
      if(active)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");
    });
  }
  function containLegacyLiveOps(){
    const panel=$("#midadLiveOps"),restore=$("#midadLiveOpsRestore");
    if(!panel||!mobile())return;
    let userOpened=false;
    try{userOpened=sessionStorage.getItem("midad_fix_live_ops_mobile_open")==="1"}catch{}
    if(!userOpened){
      panel.classList.add("mlo-hidden");
      panel.classList.remove("mlo-collapsed");
      if(restore)restore.hidden=false;
    }
  }
  document.addEventListener("click",event=>{
    const nav=event.target&&event.target.closest?event.target.closest(".navbtn[data-view]"):null;
    if(nav){setTimeout(syncActiveNavigation,0);setTimeout(syncActiveNavigation,90)}
    const restore=event.target&&event.target.closest?event.target.closest("#midadLiveOpsRestore"):null;
    const liveAction=event.target&&event.target.closest?event.target.closest('#midadLiveOps [data-mlo="toggle"],#midadLiveOps [data-mlo="collapse"]'):null;
    if(restore||liveAction){try{sessionStorage.setItem("midad_fix_live_ops_mobile_open","1")}catch{};setTimeout(()=>{
      const p=$("#midadLiveOps"),r=$("#midadLiveOpsRestore");
      if(p){p.classList.remove("mlo-hidden");p.classList.add("mlo-collapsed")}
      if(r)r.hidden=true;
    },0)}
    const close=event.target&&event.target.closest?event.target.closest('#midadLiveOps [data-mlo="close"]'):null;
    if(close){try{sessionStorage.removeItem("midad_fix_live_ops_mobile_open")}catch{}}
  },true);
  window.addEventListener("popstate",syncActiveNavigation);
  window.addEventListener("pageshow",()=>{syncActiveNavigation();containLegacyLiveOps()});
  window.addEventListener("resize",()=>{if(mobile())containLegacyLiveOps()});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{syncActiveNavigation();containLegacyLiveOps();setTimeout(syncActiveNavigation,240)},{once:true});
  else{syncActiveNavigation();containLegacyLiveOps();setTimeout(syncActiveNavigation,240)}
  window.MIDAD_FIX_V1={version:"2026-10-11.1",navigationSync:syncActiveNavigation,liveOpsContainment:containLegacyLiveOps};
})();
