(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const API = "https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_human_bridge";
  const K = {token:"midad_bridge_token",device:"midad_bridge_device",profile:"midad_bridge_profile",log:"midad_bridge_log"};
  const plug = (name) => window.Capacitor?.Plugins?.[name] || null;
  const prefs = () => plug("Preferences");
  const browser = () => plug("InAppBrowser");
  const localNotifications = () => plug("LocalNotifications");
  let tasks=[],activeTask=null,webviewId=null,profile={};

  async function getStore(k){
    try{const p=prefs();if(p?.get){const r=await p.get({key:k});if(r?.value)return r.value;}}catch(_){}
    try{return localStorage.getItem(k);}catch(_){return null;}
  }
  async function setStore(k,v){
    try{const p=prefs();if(p?.set){await p.set({key:k,value:v});return;}}catch(_){}
    try{localStorage.setItem(k,v);}catch(_){}
  }
  async function removeStore(k){
    try{const p=prefs();if(p?.remove){await p.remove({key:k});return;}}catch(_){}
    try{localStorage.removeItem(k);}catch(_){}
  }
  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
  function toast(m){const e=$("#toast");e.textContent=m;e.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.remove("show"),2200);}
  async function log(m){
    let a=[];try{const r=await getStore(K.log);a=r?JSON.parse(r):[];}catch(_){}
    a.unshift({t:new Date().toISOString(),m});await setStore(K.log,JSON.stringify(a.slice(0,80)));renderLog();
  }
  async function renderLog(){
    let a=[];try{const r=await getStore(K.log);a=r?JSON.parse(r):[];}catch(_){}
    $("#events").innerHTML=a.map(x=>`<div class="event"><span class="event-dot"></span><div><time>${new Date(x.t).toLocaleString("ar")}</time><p>${esc(x.m)}</p></div></div>`).join("")||'<div class="empty">لا توجد أحداث بعد.</div>';
  }
  async function deviceId(){let d=await getStore(K.device);if(d)return d;d="midad-bridge-"+crypto.randomUUID();await setStore(K.device,d);return d;}
  async function api(action,body={}){
    const token=await getStore(K.token);
    const headers={"content-type":"application/json"};if(token)headers["x-midad-bridge-token"]=token;
    const r=await fetch(API,{method:"POST",headers,body:JSON.stringify(Object.assign({action},body))});
    const t=await r.text();let data={};try{data=JSON.parse(t);}catch(_){data={raw:t};}
    if(!r.ok||data.ok===false)throw new Error(data.error||"bridge_request_failed");return data;
  }
  function connected(on){
    $("#connectionPill").textContent=on?"MIDAD CONNECTED":"غير مربوط";
    $("#connectionPill").className="pill "+(on?"ok":"danger");
    $("#pairCard").classList.toggle("hidden",on);$("#taskPanel").classList.toggle("hidden",!on);
  }
  function renderTasks(){
    $("#taskCount").textContent=String(tasks.length);
    if(!tasks.length){$("#tasks").innerHTML='<div class="empty">لا توجد مهام بشرية معلقة. عندما يحتاج MIDAD تدخلًا ستظهر هنا.</div>';return;}
    $("#tasks").innerHTML=tasks.map(t=>`<article class="task"><div class="task-top"><h3>${esc(t.title)}</h3><span class="tag">${esc((t.risk_class||"medium").toUpperCase())}</span></div><p>${esc(t.instruction||t.reason||"")}</p><div class="task-meta"><span class="tag">${esc(t.type||"HUMAN_INPUT")}</span><span class="tag">${esc(t.requested_by_agent||"MIDAD")}</span></div><button data-task="${esc(t.id)}">فتح المهمة</button></article>`).join("");
    $$("#tasks button").forEach(b=>b.onclick=()=>activateTask(b.dataset.task));
  }
  function activateTask(id){
    const t=tasks.find(x=>x.id===id);if(!t)return;activeTask=t;
    $("#activePanel").classList.remove("hidden");$("#activeTitle").textContent=t.title||"MIDAD Human Task";$("#activeRisk").textContent=(t.risk_class||"medium").toUpperCase();
    $("#activeAgent").textContent=t.requested_by_agent||"MIDAD";$("#activeState").textContent=t.status||"OPEN";$("#activeReason").textContent=t.reason||t.instruction||"";
    $("#pageStatus").textContent=t.action_url?"الصفحة جاهزة للفتح.":"لا يوجد رابط فتح مباشر لهذه المهمة.";
    $("#activePanel").scrollIntoView({behavior:"smooth",block:"start"});
    api("ack_task",{task_id:t.id}).catch(()=>{});
  }
  async function openTask(){
    if(!activeTask?.action_url){toast("لا توجد صفحة مرتبطة بهذه المهمة");return;}
    try{
      const b=browser();
      if(b?.openWebView){const r=await b.openWebView({url:activeTask.action_url,toolbarType:"navigation",title:"MIDAD Human Bridge",persistWebViewData:true,allowScreenshotsFromWebPage:false});webviewId=r.id;}
      else if(plug("Browser")?.open)await plug("Browser").open({url:activeTask.action_url});
      else window.open(activeTask.action_url,"_blank");
      $("#pageStatus").textContent="الصفحة أمامك الآن. حلّ التحقق المطلوب ثم عُد إلى التطبيق.";
      log("فتح Human WebView: "+activeTask.action_url);
    }catch(e){toast("تعذر فتح الصفحة");log("فشل فتح الصفحة: "+e.message);}
  }
  async function inspect(){
    if(!webviewId||!browser()?.executeScript){toast("لا توجد WebView نشطة");return;}
    const code="(()=>{const text=(document.body?.innerText||'').slice(0,7000).toLowerCase();const nodes=[...document.querySelectorAll('input,textarea,select')].slice(0,80).map(x=>({type:x.type||'',name:x.name||'',id:x.id||'',placeholder:x.placeholder||'',autocomplete:x.autocomplete||''}));const flags={captcha:/captcha|verify you are human|i am not a robot|i'm not a robot|cloudflare/.test(text),otp:/one[- ]time|verification code|security code|otp/.test(text)||nodes.some(x=>x.autocomplete==='one-time-code'),kyc:/know your customer|kyc|government id|identity verification|passport|driver.?s license/.test(text),password:nodes.some(x=>x.type==='password'),payment:/card number|credit card|bank account|routing number/.test(text)};window.mobileApp?.postMessage({detail:{message:'midadPageReport',report:{url:location.href,title:document.title,inputCount:nodes.length,flags}}});})();";
    try{await browser().executeScript({id:webviewId,code});toast("تم فحص الصفحة");log("Page Inspector نفّذ فحصًا للحقول والحواجز");}catch(e){toast("فشل فحص الصفحة");log("Page Inspector error: "+e.message);}
  }
  async function safeFill(){
    if(!webviewId||!browser()?.executeScript){toast("لا توجد WebView نشطة");return;}
    const safe={fullName:profile?.identity?.full_name||"",businessName:profile?.identity?.business_name||"",bio:profile?.positioning?.description||"",audience:profile?.positioning?.target_audience||""};
    if(!Object.values(safe).some(Boolean)){toast("لا توجد بيانات ملف آمنة");return;}
    const data=JSON.stringify(safe).replace(/</g,"\\u003c");
    const code="(()=>{const data="+data+";const nodes=[...document.querySelectorAll('input,textarea')];const pick=(keys)=>nodes.find(x=>{const s=[x.name,x.id,x.placeholder,x.autocomplete].join(' ').toLowerCase();return keys.some(k=>s.includes(k))&&!['password','hidden'].includes((x.type||'').toLowerCase())&&x.autocomplete!=='one-time-code';});const pairs=[[pick(['full name','fullname','your name','name','الاسم']),data.fullName],[pick(['company','organization','business','company name','الشركة']),data.businessName],[pick(['bio','about','description','profile','نبذة','وصف']),data.bio],[pick(['audience','target audience','الجمهور']),data.audience]];let changed=0;pairs.forEach(([el,val])=>{if(!el||!val)return;el.focus();const setter=Object.getOwnPropertyDescriptor(el,'value')?.set;if(setter)setter.call(el,val);else el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));changed++;});window.mobileApp?.postMessage({detail:{message:'midadSafeFill',changed}});})();";
    try{await browser().executeScript({id:webviewId,code});toast("تم الملء الآمن دون إرسال النموذج");log("Safe Autofill: تم تغيير "+safe+"");}catch(e){toast("فشل Safe Autofill");log("Safe Autofill error: "+e.message);}
  }
  async function complete(){
    if(!activeTask)return;
    try{await api("complete_task",{task_id:activeTask.id,response_data:{completed_from:"midad-human-bridge",human_confirmed:true,webview_id:webviewId||null}});log("أُكملت المهمة: "+activeTask.title);toast("تم إرسال التأكيد إلى MIDAD");if(browser()?.close&&webviewId){try{await browser().close({id:webviewId});}catch(_){}}webviewId=null;activeTask=null;$("#activePanel").classList.add("hidden");await loadAll();}catch(e){toast("تعذر إكمال المهمة");log("Complete error: "+e.message);}
  }
  async function pair(){
    const c=$("#pairCode").value.trim().toUpperCase();if(c.length<6){toast("أدخل رمز الاقتران");return;}
    try{const d=await api("pair_complete",{code:c,device_id:await deviceId(),device_name:"MIDAD Human Bridge Android"});await setStore(K.token,d.bridge_token);await setStore(K.profile,"{}");connected(true);$("#pairStatus").textContent="تم الربط بنجاح";log("تم اقتران الجهاز");await loadAll();}catch(e){$("#pairStatus").textContent=e.message;toast("فشل الاقتران");log("Pairing failed: "+e.message);}
  }
  async function requestConnection(){
    const provider=($("#connectionProvider").value||"").trim();
    const kind=$("#connectionKind").value||"wallet";
    const targetUrl=($("#connectionUrl").value||"").trim();
    if(!provider){toast("اكتب اسم المنصة أولًا");return;}
    if(targetUrl&&!/^https:\/\//i.test(targetUrl)){toast("استخدم رابط HTTPS رسمي فقط");return;}
    try{
      const d=await api("create_connection_request",{provider_name:provider,kind,target_url:targetUrl});
      $("#connectionProvider").value="";$("#connectionUrl").value="";
      log("تم إنشاء مهمة Human-Gated لربط "+provider+" ("+kind+")");
      toast("تم إنشاء مهمة الربط");
      await loadAll();
      if(d.task)activateTask(d.task.id);
    }catch(e){toast("تعذر إنشاء مهمة الربط");log("Connection request failed: "+e.message);}
  }
  async function loadProfile(){try{const d=await api("profile");profile=d.profile||{};await setStore(K.profile,JSON.stringify(profile));renderWallets();}catch(_){}}
  function renderWallets(){
    const q=($("#walletSearch").value||"").trim().toLowerCase();
    const rows=[...(profile.public_wallets||[]).map(x=>({name:x.label,chain:x.chain,address:x.address,purpose:x.purpose})),...(profile.wallet_connectors||[]).map(x=>({name:x.provider,chain:(x.chains||[]).join(", "),address:"—",purpose:x.connector_key}))];
    const f=rows.filter(x=>!q||[x.name,x.chain,x.address,x.purpose].join(" ").toLowerCase().includes(q));
    $("#walletResults").innerHTML=f.map(x=>`<div class="wallet-item"><strong>${esc(x.name)}</strong><code>${esc(x.address)}</code><small>${esc(x.chain)} • ${esc(x.purpose)}</small></div>`).join("")||'<div class="empty">لا توجد نتائج.</div>';
  }
  async function loadAll(){
    try{const d=await api("list_tasks");const old=new Set(tasks.map(x=>x.id));tasks=d.tasks||[];renderTasks();connected(true);const fresh=tasks.find(x=>!old.has(x.id));if(fresh){toast("MIDAD يحتاج تدخلًا بشريًا");log("مهمة بشرية جديدة: "+fresh.title);notify(fresh);}}catch(e){connected(false);}
    await loadProfile();
  }
  async function notify(t){
    try{const n=localNotifications();if(!n?.schedule)return;const p=await n.checkPermissions?.();if(p&&p.display==="denied")return;if(p&&p.display!=="granted")await n.requestPermissions?.();await n.schedule({notifications:[{id:Math.floor(Date.now()/1000)%2147483647,title:"MIDAD — تدخل مطلوب",body:t.title||"مهمة بشرية",schedule:{at:new Date(Date.now()+1000)}}]});}catch(_){}
  }
  async function init(){
    renderLog();
    const tok=await getStore(K.token);
    if(tok){try{await api("heartbeat");connected(true);await loadAll();}catch(_){await removeStore(K.token);connected(false);}}else connected(false);
    $("#pairBtn").onclick=pair;$("#connectionBtn").onclick=requestConnection;$("#refreshBtn").onclick=loadAll;$("#openTaskBtn").onclick=openTask;$("#inspectBtn").onclick=inspect;$("#safeFillBtn").onclick=safeFill;$("#completeBtn").onclick=complete;$("#clearActiveBtn").onclick=()=>$("#activePanel").classList.add("hidden");$("#profileBtn").onclick=loadProfile;$("#walletSearch").oninput=renderWallets;
    $("#clearLogBtn").onclick=async()=>{await setStore(K.log,"[]");renderLog();};
    try{const b=browser();if(b?.addListener){await b.addListener("urlChangeEvent",e=>{$("#pageStatus").textContent="تنقل: "+e.url;log("تنقل داخل الصفحة: "+e.url);});await b.addListener("messageFromWebview",e=>{const d=e?.detail||{};if(d.message==="midadPageReport"){const r=d.report||{};const flags=Object.entries(r.flags||{}).filter(([,v])=>v).map(([k])=>k).join(", ");$("#pageStatus").textContent="Inspector: "+(r.title||r.url||"")+" • "+(r.inputCount||0)+" حقول"+(flags?" • "+flags:"");if(flags)toast("حاجز مكتشف: "+flags);log("Inspector: "+flags);}});}}catch(_){}
    setInterval(async()=>{if(await getStore(K.token))await loadAll();},12000);
  }
  init();
})();