/* MIDAD Control Room v4 — MAXIMUM — runtime configuration. 
 * Keep secrets out of this file. Values are safe-to-edit public configuration only. 
 */ 
window.MIDAD_CONFIG = { 
  supabaseUrl: 'https://froegigfmpmvtecztfb.supabase.co', 
  controlRoomFunction: '/functions/v1/midad_control_room', 
  dashboardAction: 'dashboard', 
  statusAction: 'status', 
  sessionAction: 'session', 
  projectName: 'MIDAD — Intelligence Orchestrator', 
  defaultLocale: 'ar', 
  defaultTheme: 'midnight', 
  emergencyTargetUsd: 1000, 
  buildVersion: 'v4-max-2026-09-22', 
  // The active Telegram Mini App can supply initData automatically. 
  // For browser-only access, the user may optionally enter an access key in Settings. 
  allowBrowserAccessKey: true, 
  persistBrowserAccessKey: false, 
  knownRuntimeSnapshot: { 
    snapshotAt: '2026-09-22T05:15:00+03:30', 
    note: 'Runtime snapshot only. Live health must be verified by the Control Room API.', 
    incidents: [ 
      { id: 'n8n-execution-quota', severity: 'critical', title: 'n8n execution limit reached', detail: 'New workflow executions are currently blocked by the account execution limit.', source: 'n8n runtime', status: 'observed' }, 
      { id: 'openrouter-credits', severity: 'warning', title: 'OpenRouter agent credits unavailable', detail: 'Agent Preview reported insufficient credits on the linked account.', source: 'OpenRouter', status: 'observed' } 
    ], 
    workflows: [ 
      { id: 'fChZsDbnsxP9dwwr', name: 'MIDAD — Revenue Intelligence Scanner v2', configured: true }, 
      { id: '5EqjQcaY0dq8SHTA', name: 'MIDAD — Opportunity Intelligence Mesh v1', configured: true }, 
      { id: 'h9IOP39SuVYaXnDP', name: 'MIDAD — Market Intelligence & New Assets v1', configured: true }, 
      { id: '4aBQunkIwgkwgfki', name: 'MIDAD — Intelligence Read v1', configured: true }, 
      { id: 'LC3tTcFBEukB1R5u', name: 'MIDAD — AI Command Core v2', configured: true } 
    ], 
    agents: [ 
      { id: '8aZ5brqD90KBgosv', name: 'MIDAD — Telegram Control Room Live', lifecycle: 'published' }, 
      { id: 'wunryjaKS9vf5lVX', name: 'MIDAD — Telegram Control Room Agent', lifecycle: 'published' }, 
      { id: 'mH2RVBpG5uKgecYf', name: 'MIDAD — Financial Intelligence & Capital Agent v1', lifecycle: 'draft' }, 
      { id: 'Q49UsxpJbbN7iLXz', name: 'MIDAD — Emergency Revenue Hunter v1', lifecycle: 'draft' }, 
      { id: '5Bl8Tog6rcVTJ3cZ', name: 'MIDAD — Revenue & Outreach Copilot v1', lifecycle: 'draft' } 
    ] 
  } 
}; 
 
(() => { 
  'use strict'; 
 
  const CFG = window.MIDAD_CONFIG || {}; 
  const APP = document.getElementById('app'); 
 
  const ICONS = { 
    grid:'▦', mission:'✦', radar:'⌁', revenue:'◈', bot:'◉', capital:'◌', wallet:'◇', mining:'⛏', trade:'↗', intelligence:'⌬', alerts:'◍', person:'●', settings:'⚙', health:'✦', lab:'⌁', search:'⌕', menu:'☰' 
  }; 
 
  const routes = [ 
    ['dashboard','الرئيسية','Dashboard','grid'], 
    ['mission','غرفة المهمة','Mission Control','mission'], 
    ['opportunities','الفرص','Opportunities','radar'], 
    ['revenue','الإيرادات والعملاء','Revenue & Clients','revenue'], 
    ['automation','الأتمتة والوكلاء','Automation & Agents','bot'], 
    ['capital','رأس المال','Capital','capital'], 
    ['wallets','المحافظ','Wallets','wallet'], 
    ['mining','التعدين','Mining','mining'], 
    ['trading','التداول المحاكى','Trading • Paper','trade'], 
    ['intelligence','الذكاء وOSINT','Intelligence / OSINT','intelligence'], 
    ['alerts','التنبيهات والرسائل','Alerts & Messages','alerts'], 
    ['personal','المساحة الشخصية','Personal','person'], 
    ['settings','الإعدادات','Settings','settings'], 
    ['health','صحة النظام','System / Health','health'] 
  ]; 
 
  const navGroups = [ 
    {title:'COMMAND', items:['dashboard','mission']}, 
    {title:'REVENUE', items:['opportunities','revenue','automation']}, 
    {title:'CAPITAL', items:['capital','wallets','mining','trading']}, 
    {title:'INTELLIGENCE', items:['intelligence','alerts']}, 
    {title:'PERSONAL', items:['personal','settings','health']} 
  ]; 
 
  const STORE_KEY = 'midad_control_room_v4_local'; 
  const state = { 
    route:'dashboard', 
    locale: localStorage.getItem('midad_locale') || CFG.defaultLocale || 'ar', 
    theme: localStorage.getItem('midad_theme') || CFG.defaultTheme || 'midnight', 
    connected:false, 
    connectionLabel:'غير متصل', 
    user:{name:'',email:'',telegram:''}, 
    live:null, 
    accessKey:'', 
    commandOpen:false, 
    drawerOpen:false, 
    search:'', 
    activeFilter:'all', 
    personal:loadLocal(), 
    pendingApproval:[], 
    activity:[], 
    mission:{now:'Secure first cashflow', next:'Build qualified lead pipeline', waiting:'Verified buyer response', blocked:'n8n execution quota'}, 
    lastProbe:null 
  }; 
 
  function loadLocal(){ 
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {wallets:[],income:[],goals:[],notes:[],paperTrades:[]}; } 
    catch { return {wallets:[],income:[],goals:[],notes:[],paperTrades:[]}; } 
  } 
  function saveLocal(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(state.personal)); }catch{ toast('Local storage is unavailable; changes may not persist.','warn'); } } 
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); } 
  function fmt(n,cur='$'){ return `${cur}${Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})}`; } 
  function nowLabel(){ return new Intl.DateTimeFormat('ar',{dateStyle:'short',timeStyle:'short'}).format(new Date()); } 
  function routeMeta(id){ return routes.find(x=>x[0]===id) || routes[0]; } 
  function navButton(route){ const r=routeMeta(route); return `<button class="nav-item ${state.route===route?'active':''}" data-route="${route}"><span class="nav-icon">${ICONS[r[3]]}</span><span class="nav-label">${r[1]}</span><span class="nav-meta" dir="ltr">${r[2]}</span></button>`; } 
  function mobileButton(route){ const r=routeMeta(route); return `<button class="${state.route===route?'active':''}" data-route="${route}"><span class="nav-ico">${ICONS[r[3]]}</span>${esc(r[1])}</button>`; } 
 
  function shell(){ 
    const meta=routeMeta(state.route); 
    APP.className='app-shell'; 
    APP.innerHTML=` 
      <aside class="sidebar" id="sidebar"> 
        <div class="brand"><div class="brand-mark">M</div><div class="brand-copy"><strong>MIDAD</strong><span>INTELLIGENCE CONTROL ROOM</span></div></div> 
        ${navGroups.map(g=>`<div class="nav-group"><div class="nav-heading">${g.title}</div>${g.items.map(navButton).join('')}</div>`).join('')} 
        <div class="sidebar-bottom"> 
          <div class="connection-line"><span class="connection-dot ${state.connected?'ok':''}"></span><span>${esc(state.connectionLabel)}</span></div> 
          <div class="section-note" style="margin-top:7px">الأرقام الحية لا تُعرض إلا بعد التحقق من المصدر.</div> 
        </div> 
      </aside> 
      <header class="topbar"> 
        <div class="topbar-left"><button class="icon-btn" id="menuBtn" aria-label="القائمة">${ICONS.menu}</button><div class="brand-mini">MIDAD</div><div class="page-title"><strong>${esc(meta[1])}</strong><span>${esc(meta[2])}</span></div></div> 
        <div class="topbar-right"><button class="icon-btn" id="commandBtn" title="Command Palette">⌘K</button><button class="icon-btn" id="whatBtn" title="What needs me?">◍</button><div class="identity"><div class="avatar">${esc(identityInitial())}</div><div class="identity-meta"><strong>${esc(displayName())}</strong><span>${state.connected?'Connected / verified context':'Degraded / awaiting connection'}</span></div></div></div> 
      </header> 
      <main class="main" id="main">${renderRoute()}</main> 
      <nav class="mobile-nav">${['dashboard','mission','opportunities','revenue'].map(mobileButton).join('')}<button data-mobile-menu><span class="nav-ico">${ICONS.menu}</span>المزيد</button></nav> 
      <div class="drawer" id="approvalDrawer"><div class="drawer-head"><div><strong>What Needs Me?</strong><div class="muted" style="font-size:10px;margin-top:4px">موافقات وأحداث تحتاج تدخلك</div></div><button class="icon-btn" id="closeDrawer">×</button></div><div class="drawer-body">${renderApprovals()}</div></div> 
      <div class="command" id="command"><div class="command-box"><input id="commandInput" class="command-input" placeholder="ابحث عن صفحة أو إجراء… / Search" autocomplete="off"><div class="command-list" id="commandList"></div></div></div> 
      <div class="modal" id="modal"><div class="modal-box" id="modalBox"></div></div> 
      <div class="toast-stack" id="toastStack"></div> 
    `; 
    bindShell(); 
  } 
 
  function identityInitial(){ const n=displayName(); return n ? n.slice(0,1).toUpperCase() : 'M'; } 
  function displayName(){ return state.user.name || state.user.telegram || state.user.email || 'مستخدم MIDAD'; } 
  function renderApprovals(){ 
    const items = state.pendingApproval.length ? state.pendingApproval : [{title:'لا توجد موافقات الآن',body:'ستظهر هنا المعاملات والأفعال الحساسة فقط بعد أن يطلبها نظام موثوق.',kind:'info'}]; 
    return items.map((x,i)=>`<div class="approval"><strong>${esc(x.title)}</strong><p>${esc(x.body||'')}</p>${x.kind==='info'?'':`<div class="approval-actions"><button class="btn btn-primary" data-approval="approve" data-i="${i}">موافقة</button><button class="btn btn-danger" data-approval="reject" data-i="${i}">رفض</button></div>`}</div>`).join(''); 
  } 
 
  function renderRoute(){ 
    const renderers={dashboard:renderDashboard,mission:renderMission,opportunities:renderOpportunities,revenue:renderRevenue,automation:renderAutomation,capital:renderCapital,wallets:renderWallets,mining:renderMining,trading:renderTrading,intelligence:renderIntelligence,alerts:renderAlerts,personal:renderPersonal,settings:renderSettings,health:renderHealth}; 
    return `<section class="route active">${(renderers[state.route]||renderDashboard)()}</section>`; 
  } 
 
  function pageHero(title,sub,actions=''){ 
    const mode=state.connected?'VERIFIED SESSION':'DEGRADED / AWAITING VERIFY'; 
    return `<div class="hero"><div><div class="route-kicker"><span class="pulse-dot ${state.connected?'live':''}"></span><span>MIDAD OS // ${esc(routeMeta(state.route)[2])}</span><span class="route-sep">•</span><span>${mode}</span></div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="hero-actions">${actions}</div></div>`; 
  } 
  function card(title,eyebrow,body,cls=''){ return `<section class="card ${cls}"><div class="card-head"><div><div class="eyebrow">${esc(eyebrow)}</div><div class="card-title">${esc(title)}</div></div></div>${body}</section>`; } 
  function dataBadge(label='Snapshot',tone='gray'){ return `<span class="status-chip ${tone}">${esc(label)}</span>`; } 
  function empty(title,desc,action=''){ return `<div class="empty"><strong>${esc(title)}</strong><p>${esc(desc)}</p>${action?`<div style="margin-top:11px">${action}</div>`:''}</div>`; } 
 
  function dashboardData(){ 
    const live=state.live || {}; 
    const target=1000; 
    const realized=Number(live?.cashflow?.realized_usd||sum(state.personal.income,'amount')||0); 
    return {target,realized,progress:Math.min(100, target ? realized/target*100 : 0),opps:Number(live?.opportunities?.new_count||0),alerts:Number(live?.alerts?.unread_count||0)}; 
  } 
  function sum(arr,key){ return (arr||[]).reduce((a,x)=>a+Number(x?.[key]||0),0); } 
 
  function renderMission(){ 
    const d=dashboardData(); 
    const incidents=CFG.knownRuntimeSnapshot?.incidents||[]; 
    return `${pageHero('غرفة المهمة','Mission Control — طبقة التفكير والتنفيذ: الآن، التالي، المنتظر، المحجوب.',`<button class="btn btn-primary" data-action="scan">⚡ Run Mission Scan</button><button class="btn" data-action="openApprovals">◍ What Needs Me?</button>`)} 
      <div class="mission-grid"> 
        ${missionLane('NOW','الآن',[[state.mission.now,'cashflow-first','blue'],['تحقق من مصادر الحقيقة قبل التنفيذ','evidence-first','green'],['حماية الأموال والحسابات','human gate','amber']])} 
        ${missionLane('NEXT','التالي',[[state.mission.next,'lead engine','blue'],['عرض صغير + milestone','productized service','green'],['تعلم من كل رد','feedback loop','purple']])} 
        ${missionLane('WAITING','منتظر',[[state.mission.waiting,'external response','amber'],['Agent runtime credits','provider dependency','amber']])} 
        ${missionLane('BLOCKED','محجوب',[[state.mission.blocked,'runtime dependency','red'],['Agent Preview credits','provider dependency','red']])} 
      </div> 
      <div class="grid grid-3" style="margin-top:14px"> 
        ${card('Decision Stack','SIGNAL → ACTION',`<div class="decision-stack"><div><span class="step-index">01</span><strong>Signal</strong><span>حدث أو طلب جديد</span></div><div><span class="step-index">02</span><strong>Evidence</strong><span>مصدر + freshness + reliability</span></div><div><span class="step-index">03</span><strong>Economics</strong><span>net value + effort + time-to-cash</span></div><div><span class="step-index">04</span><strong>Risk</strong><span>security + custody + counterparty</span></div><div><span class="step-index">05</span><strong>Action</strong><span>prepare → approve → execute → verify</span></div></div>`,'span-2')} 
        ${card('Emergency Cash','7-DAY MISSION',`<div class="metric">${fmt(d.realized)}</div><div class="metric-sub">realized / ${fmt(d.target)} target</div><div class="progress mission-progress" style="margin-top:12px"><span style="width:${d.progress}%"></span></div><div class="metric-sub" style="margin-top:8px">${d.progress.toFixed(1)}% of current target • not a guarantee</div>`)} 
      </div> 
      <div style="margin-top:14px">${card('Observed Incidents','SYSTEM MEMORY',incidents.length?`<div class="incident-list">${incidents.map(i=>`<div class="incident-row ${esc(i.severity)}"><div><strong>${esc(i.title)}</strong><p>${esc(i.detail)}</p></div><div><span class="tag">${esc(i.source)}</span><div class="mini-desc ltr">${esc(CFG.knownRuntimeSnapshot?.snapshotAt||'snapshot')}</div></div></div>`).join('')}</div>`:empty('لا توجد حوادث مسجلة','سيظهر هنا التاريخ التشغيلي عندما توجد مشكلة موثقة.'))}</div>`; 
  } 
 
  function missionLane(code,title,items){ 
    return `<section class="mission-lane"><div class="mission-lane-head"><span>${code}</span><strong>${title}</strong></div>${items.map(x=>`<div class="mission-card ${x[2]}"><div class="mission-dot"></div><div><strong>${esc(x[0])}</strong><span>${esc(x[1])}</span></div></div>`).join('')}</section>`; 
  } 
 
  function renderDashboard(){ 
    const d=dashboardData(); 
    return `${pageHero('مركز القيادة','نظرة تنفيذية واحدة: ماذا يحدث؟ ماذا يحتاجني؟ أين يوجد التدفق النقدي؟ وما الذي تعطل؟',`<button class="btn btn-primary" data-action="connect">⚡ اتصال / Connect</button><button class="btn" data-action="quickOpportunity">＋ فرصة</button>`)} 
      <div class="command-strip"><button class="quick-chip primary" data-action="quickOpportunity">＋ Opportunity</button><button class="quick-chip" data-action="quickLead">＋ Prospect</button><button class="quick-chip" data-action="recordIncome">＋ Income</button><button class="quick-chip" data-action="addWallet">＋ Wallet</button><button class="quick-chip" data-action="scan">⌁ Scan</button></div> 
      <div class="grid grid-4"> 
        ${card('الهدف الطارئ','EMERGENCY CASHFLOW',`<div class="metric-row"><div><div class="metric">${fmt(d.realized)}</div><div class="metric-sub">من أصل ${fmt(d.target)} خلال 7 أيام</div></div>${dataBadge(d.realized?'تقدم':'بانتظار دخل',d.realized?'green':'amber')}</div><div style="margin-top:12px"><div class="progress"><span style="width:${d.progress}%"></span></div></div>`)} 
        ${card('فرص جديدة','OPPORTUNITIES',`<div class="metric-row"><div><div class="metric">${d.opps}</div><div class="metric-sub">إشارة جديدة بعد التحقق</div></div>${dataBadge(state.live?'LIVE':'Snapshot',state.live?'green':'gray')}</div>`)} 
        ${card('موافقات','WHAT NEEDS ME',`<div class="metric-row"><div><div class="metric">${state.pendingApproval.length}</div><div class="metric-sub">إجراءات تنتظر قرارك</div></div>${dataBadge('Human gate','blue')}</div>`)} 
        ${card('تنبيهات','ALERTS',`<div class="metric-row"><div><div class="metric">${d.alerts}</div><div class="metric-sub">غير مقروءة</div></div>${dataBadge(d.alerts?'Review':'Clear',d.alerts?'amber':'green')}</div>`)} 
      </div> 
      <div class="grid grid-3" style="margin-top:14px"> 
        ${card('أولوية الآن','NOW',renderNowPanel(),'span-2')} 
        ${card('هوية التشغيل','IDENTITY',renderIdentityPanel())} 
      </div> 
      <div class="grid grid-3" style="margin-top:14px"> 
        ${card('Revenue Pipeline','REVENUE',renderRevenueMini())} 
        ${card('Automation / Agents','AUTOMATION',renderAgentsMini())} 
        ${card('System Health','HEALTH',renderHealthMini())} 
      </div> 
      <div style="margin-top:14px">${card('آخر النشاطات','ACTIVITY',renderActivity())}</div>`; 
  } 
 
  function renderNowPanel(){ 
    const rows=[ 
      ['🧲', 'استهداف عميل', 'ابدأ بأقرب فرصة n8n/automation موثقة، ثم اعرض milestone صغير.','إجراء تجاري'], 
      ['🤖', 'طبقة Agents', 'الأتمتة تُسرّع البحث والصياغة، لكنها لا تتجاوز بوابة الموافقة المالية.','مبدأ تشغيل'], 
      ['🛡', 'حماية المال', 'لا live trading ولا تحويلات تلقائية ولا أسرار في الواجهة.','قاعدة أمان'] 
    ]; 
    return `<div class="mini-list">${rows.map(r=>`<div class="mini-row"><div style="display:flex;gap:10px"><div style="font-size:16px">${r[0]}</div><div><div class="mini-name">${r[1]}</div><div class="mini-desc">${r[2]}</div></div></div><span class="tag">${r[3]}</span></div>`).join('')}</div>`; 
  } 
  function renderIdentityPanel(){ 
    return `<div class="callout"><strong>${esc(displayName())}</strong><p>${state.connected?'تم التحقق من سياق الاتصال الحالي.':'لم يتم التحقق من اسم شخصي بعد؛ لن نخمن هوية المستخدم.'}</p><div style="margin-top:10px;display:flex;gap:7px;flex-wrap:wrap">${dataBadge(state.connected?'Connected':'Not Connected',state.connected?'green':'amber')} ${dataBadge(state.user.email||'Email unknown','gray')}</div></div>`; 
  } 
  function renderRevenueMini(){ 
    const rows=[['Leads','إشارات مستهدفة','—'],['Proposals','عروض قيد التفاوض','—'],['Receivables','مبالغ مستحقة','—']]; 
    return `<div class="mini-list">${rows.map(r=>`<div class="mini-row"><div><div class="mini-name">${r[0]}</div><div class="mini-desc">${r[1]}</div></div><div class="mini-right">${r[2]}</div></div>`).join('')}</div><div style="margin-top:10px">${dataBadge('No verified live totals','gray')}</div>`; 
  } 
  function renderAgentsMini(){ 
    const a=CFG.knownRuntimeSnapshot?.agents||[]; 
    return `<div class="mini-list">${a.slice(0,4).map(x=>`<div class="mini-row"><div><div class="mini-name">${esc(x.name.replace('MIDAD — ',''))}</div><div class="mini-desc">${esc(x.lifecycle)}</div></div>${dataBadge(x.lifecycle==='published'?'Configured':'Draft',x.lifecycle==='published'?'green':'amber')}</div>`).join('')}</div>`; 
  } 
  function renderHealthMini(){ 
    const systems=['Supabase','n8n','Telegram','Vespa','TinyFish']; 
    return `<div class="mini-list">${systems.map(s=>`<div class="mini-row"><div class="mini-name">${s}</div>${dataBadge('Unverified','gray')}</div>`).join('')}</div><div style="margin-top:10px" class="section-note">لا نعلن Healthy إلا إذا وصل probe موثوق.</div>`; 
  } 
  function renderActivity(){ 
    const rows=[['blue','واجهة جديدة قيد التصميم','Control Room v4 — MAXIMUM'],['amber','تنبيه توصيل','Telegram delivery not verified'],['green','دفتر فرص الطوارئ','Revenue leads updated'],['blue','قاعدة البيانات الشخصية','Local-only mode']]; 
    return `<div class="activity">${rows.map(r=>`<div class="activity-item"><span class="activity-dot" style="background:${r[0]==='green'?'var(--green)':r[0]==='amber'?'var(--amber)':'var(--blue)'}"></span><div class="activity-main"><strong>${r[1]}</strong><p>${r[2]}</p></div><div class="activity-time">${nowLabel()}</div></div>`).join('')}</div>`; 
  } 
 
  function renderOpportunities(){ 
    const leads = state.live?.opportunities?.items || []; 
    const known = leads.length ? leads : []; 
    const filtered=known.filter(x=>state.activeFilter==='all'||x.stage===state.activeFilter).filter(x=>!state.search||JSON.stringify(x).toLowerCase().includes(state.search.toLowerCase())); 
    const stages=['all','new','verified','qualified','contacted','negotiating','won','lost','watch']; 
    return `${pageHero('الفرص','Opportunity pipeline — دليل + مصدر + ثقة + خطوة تالية، لا مجرد قائمة روابط.',`<button class="btn btn-primary" data-action="scan">↻ Scan</button><button class="btn" data-action="quickOpportunity">＋ إضافة</button>`)} 
      <div class="card"><div class="filter-bar">${stages.map(s=>`<button class="filter ${state.activeFilter===s?'active':''}" data-filter="${s}">${s==='all'?'All / الكل':s}</button>`).join('')}</div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="searchbox"><span>⌕</span><input id="opSearch" value="${esc(state.search)}" placeholder="ابحث في الفرص / Search" /></div>${dataBadge(known.length?'Live data loaded':'No verified live leads',known.length?'green':'gray')}</div></div> 
      <div class="card" style="margin-top:12px">${filtered.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Lead</th><th>Stage</th><th>Reward</th><th>Payment</th><th>Confidence</th><th>Next</th></tr></thead><tbody>${filtered.map(x=>`<tr><td><strong>${esc(x.title||x.name||'—')}</strong><div class="muted" style="margin-top:4px">${esc(x.source||'Unknown source')}</div></td><td><span class="tag">${esc(x.stage||'—')}</span></td><td class="ltr">${x.reward_usd?fmt(x.reward_usd):'—'}</td><td>${esc(x.payment_method||'—')}</td><td class="ltr">${x.confidence!=null?(Number(x.confidence)*100).toFixed(0)+'%':'—'}</td><td>${esc(x.next_action||'—')}</td></tr>`).join('')}</tbody></table></div>`:empty('لا توجد فرص موثقة حية هنا بعد','الواجهة جاهزة، لكن لن نخترع فرصاً أو أرقاماً. اضغط Scan بعد توفر مصدر موثوق.','<button class="btn btn-primary" data-action="scan">تشغيل Radar</button>')}</div>`; 
  } 
 
  function renderRevenue(){ 
    return `${pageHero('الإيرادات والعملاء','من أول رسالة إلى الاتفاق ثم milestone والتحصيل. كل مرحلة لها حالة واضحة.',`<button class="btn btn-primary" data-action="quickLead">＋ Prospect</button>`)} 
      <div class="grid grid-4">${['Prospects','Proposals','Negotiating','Receivables'].map((x,i)=>card(x,i===0?'PIPELINE':'PIPELINE',`<div class="metric">—</div><div class="metric-sub">No verified live total</div>`)).join('')}</div> 
      <div class="offer-deck"><div class="offer-card"><span>01</span><strong>$99</strong><em>Quick Fix</em><p>One bounded n8n/API/Telegram problem.</p><button class="btn" data-action="quickLead">Prepare offer</button></div><div class="offer-card hot"><span>02</span><strong>$199</strong><em>Automation Sprint</em><p>Repair/build one small workflow end-to-end.</p><button class="btn btn-primary" data-action="quickLead">Prepare offer</button></div><div class="offer-card"><span>03</span><strong>$399+</strong><em>AI / Web3 System Slice</em><p>Paid milestone before any large commitment.</p><button class="btn" data-action="quickLead">Prepare offer</button></div></div> 
      <div class="grid grid-2" style="margin-top:14px"> 
        ${card('Deal Workspace','CLIENT WORKSPACE',empty('لا يوجد عميل نشط','أضف prospect أو اربط lead موثق. سنستخدم scope صغيراً وmilestone واضحاً قبل التزام كبير.','<button class="btn btn-primary" data-action="quickLead">＋ Prospect</button>'))} 
        ${card('Payment Rail','CRYPTO SETTLEMENT',`<div class="mini-list"><div class="mini-row"><div><div class="mini-name">USDC / USDT</div><div class="mini-desc">Preferred when the buyer explicitly agrees</div></div>${dataBadge('Negotiation','amber')}</div><div class="mini-row"><div><div class="mini-name">Escrow / Milestone</div><div class="mini-desc">Use when platform/client supports it</div></div>${dataBadge('Recommended','blue')}</div></div>`)} 
      </div>`; 
  } 
 
  function renderAutomation(){ 
    const agents=CFG.knownRuntimeSnapshot?.agents||[]; const workflows=CFG.knownRuntimeSnapshot?.workflows||[]; 
    return `${pageHero('الأتمتة والوكلاء','Agent layer + workflow layer + approval gate. السرعة آلية، المال والحذف تحت موافقة.',`<button class="btn btn-primary" data-action="agentStatus">↻ Health</button>`)} 
      <div class="grid grid-2"> 
        ${card('Agents','AI AGENTS',`<div class="table-wrap"><table class="table"><thead><tr><th>Agent</th><th>Lifecycle</th><th>Control</th></tr></thead><tbody>${agents.map(a=>`<tr><td><strong>${esc(a.name)}</strong><div class="muted" style="margin-top:3px">${esc(a.id)}</div></td><td>${dataBadge(a.lifecycle,a.lifecycle==='published'?'green':'amber')}</td><td>${a.lifecycle==='published'?'<button class="btn" disabled>Published</button>':'<button class="btn" disabled>Draft / needs runtime</button>'}</td></tr>`).join('')}</tbody></table></div>`)} 
        ${card('Workflows','N8N',`<div class="mini-list">${workflows.map(w=>`<div class="mini-row"><div><div class="mini-name">${esc(w.name)}</div><div class="mini-desc ltr">${esc(w.id)}</div></div>${dataBadge('Configured','blue')}</div>`).join('')}</div><div style="margin-top:10px">${dataBadge('Execution quota currently blocked','amber')}</div>`)} 
      </div>`; 
  } 
 
  function renderCapital(){ 
    return `${pageHero('رأس المال','Capital ledger — مصدر المال، تكلفته، استخدامه، السيولة، والـrunway.',`<button class="btn btn-primary" data-action="recordIncome">＋ Record Income</button>`)} 
      <div class="grid grid-4">${['Available','Committed','Monthly Costs','Runway'].map(x=>card(x,'CAPITAL',`<div class="metric">—</div><div class="metric-sub">Awaiting verified source</div>`)).join('')}</div> 
      <div class="grid grid-2" style="margin-top:14px">${card('Capital Sources','SOURCES',empty('لا توجد مصادر موثقة معروضة','أضف أو اربط مصدراً حقيقياً فقط. التعدين يمكن أن يظهر هنا كمصدر منفصل.'))}${card('Risk Envelope','RISK',`<div class="callout"><strong>Default: capital-preserving</strong><p>لا live trade، لا تحويل أموال تلقائي، ولا تدوير يرفع المخاطر دون موافقة.</p></div>`)}</div>`; 
  } 
 
  function renderWallets(){ 
    const ws=state.personal.wallets||[]; 
    return `${pageHero('المحافظ','Wallets — فصل تام بين operational wallets والمحافظ الشخصية. لا مفاتيح خاصة في النظام.',`<button class="btn btn-primary" data-action="addWallet">＋ Add Wallet</button>`)} 
      <div class="grid grid-2"> 
        ${card('Operational Wallets','SYSTEM / OPERATIONS',empty('لا توجد محفظة تشغيلية معروضة','سيتم ربطها فقط عندما يدعم backend المصدر والتحقق. لا توجد أرقام وهمية.'))} 
        ${card('Personal Wallets','PERSONAL',ws.length?`<div class="mini-list">${ws.map((w,i)=>`<div class="mini-row"><div><div class="mini-name">${esc(w.label)}</div><div class="mini-desc ltr">${esc(w.address)} · ${esc(w.network)}</div></div><button class="btn" data-remove-wallet="${i}">حذف</button></div>`).join('')}</div>`:empty('محافظك الشخصية هنا','مساحة شخصية منفصلة تماماً عن Wallets التشغيلية. لا نحفظ seed phrase/private key.','<button class="btn btn-primary" data-action="addWallet">＋ Add personal wallet</button>'))} 
      </div>`; 
  } 
 
  function renderMining(){ return `${pageHero('التعدين','Mining — مسار مستقل عن المحافظ والتداول.',`<button class="btn btn-primary" data-action="refresh">↻ Refresh</button>`)}<div class="grid grid-4">${['M31+ · 84 TH/s','M21 · 56 TH/s','Pool','Revenue'].map((x,i)=>card(x,'MINING',`<div class="metric">${i<2?x.split('·')[1].trim():'—'}</div><div class="metric-sub">${i<2?'Known configuration snapshot':'Awaiting verified live data'}</div>`)).join('')}</div><div class="card" style="margin-top:14px">${empty('تفاصيل التشغيل ستظهر هنا','Uptime, pool, realized revenue, costs, alerts — بعد تحقق المصدر. الكهرباء المجانية لا تعني أننا نخترع الربح؛ سنحسب بعد وصول البيانات.')}</div>`; } 
 
  function renderTrading(){ 
    const trades=state.personal.paperTrades||[]; 
    return `${pageHero('التداول المحاكى','Trading — PAPER / SIMULATION FIRST. لا يوجد تحريك أموال ولا أوامر حية من هذه الواجهة.',`<button class="btn btn-primary" data-action="paperTrade">＋ Paper Trade</button>`)} 
      <div class="callout" style="margin-bottom:14px"><strong>SIMULATION MODE</strong><p>كل trade هنا فكرة أو محاكاة. أي انتقال إلى live execution يحتاج موافقة بشرية صريحة وممر backend منفصل.</p></div> 
      ${trades.length?card('Paper Trade Ledger','SIMULATION',`<div class="table-wrap"><table class="table"><thead><tr><th>Asset</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Status</th></tr></thead><tbody>${trades.map(t=>`<tr><td>${esc(t.asset)}</td><td>${esc(t.side)}</td><td class="ltr">${esc(t.entry)}</td><td class="ltr">${esc(t.stop)}</td><td class="ltr">${esc(t.target)}</td><td>${dataBadge('Paper','blue')}</td></tr>`).join('')}</tbody></table></div>`):empty('لا توجد محاكاة بعد','لا نملأ دفتر التداول بصفقات خيالية. أضف فكرة محاكاة فقط عندما تريد اختبار فرضية.')}`; 
  } 
 
  function renderIntelligence(){ return `${pageHero('الذكاء وOSINT','Signal → Evidence → Confidence → Action. لا إشاعة بلا مصدر.',`<button class="btn btn-primary" data-action="scan">↻ Scan</button>`)}<div class="grid grid-3">${['Signals','Evidence','Entities'].map(x=>card(x,'INTELLIGENCE',`<div class="metric">—</div><div class="metric-sub">No verified live feed</div>`)).join('')}</div><div class="card" style="margin-top:14px">${empty('Intelligence canvas جاهز','هنا سنعرض freshness، source reliability، fingerprints، anomalies، entity links، وسبب الانتقال من signal إلى opportunity.')}</div>`; } 
 
  function renderAlerts(){ 
    const incidents=CFG.knownRuntimeSnapshot?.incidents||[]; 
    const liveAlerts=state.live?.alerts?.items||[]; 
    const items=liveAlerts.length?liveAlerts:incidents.map(i=>({title:i.title,body:i.detail,source:i.source,severity:i.severity,delivery:'observed',timestamp:CFG.knownRuntimeSnapshot?.snapshotAt})); 
    return `${pageHero('التنبيهات والرسائل','Unified inbox — source, severity, freshness, and verified delivery state.',`<button class="btn btn-primary" data-action="refresh">↻ Refresh</button>`)}<div class="filter-bar"><button class="filter active">All</button><button class="filter">Unread</button><button class="filter">Critical</button><button class="filter">Opportunity</button><button class="filter">Mining</button><button class="filter">Security</button></div>${items.length?card('Inbox','MESSAGES',`<div class="incident-list">${items.map(x=>`<div class="incident-row ${esc(x.severity||'info')}"><div><strong>${esc(x.title||'—')}</strong><p>${esc(x.body||'')}</p><div class="mini-desc">${esc(x.source||'unknown source')} · ${esc(x.timestamp||'time not verified')}</div></div><div style="text-align:left"><span class="tag">${esc(x.delivery||'not verified')}</span></div></div>`).join('')}</div>`):card('Inbox','MESSAGES',empty('لا توجد رسائل موثقة وصلت بعد','لن نعرض “تم الإرسال” إلا إذا أكد مزود النقل نجاح التوصيل.'))}`; 
  } 
 
  function renderPersonal(){ 
    const income=sum(state.personal.income,'amount'); 
    return `${pageHero('المساحة الشخصية','هذه مساحتك أنت: الهوية، المحافظ الشخصية، الأرباح، الأهداف والملاحظات. منفصلة عن النظام.',`<button class="btn btn-primary" data-action="recordIncome">＋ Income</button>`)} 
      <div class="grid grid-3"> 
        ${card('My Identity','PROFILE',`<div class="callout"><strong>${esc(displayName())}</strong><p>${esc(state.user.email||'لا يوجد بريد متحقق')} · ${esc(state.user.telegram||'Telegram not verified')}</p></div>`)} 
        ${card('My Income','EARNINGS',`<div class="metric">${fmt(income)}</div><div class="metric-sub">محفوظ محلياً فقط · لا يمثل ledger مالي رسمي</div>`)} 
        ${card('Goals','GOALS',state.personal.goals.length?`<div class="mini-list">${state.personal.goals.map(g=>`<div class="mini-row"><div class="mini-name">${esc(g.title)}</div><span class="tag">${esc(g.status||'active')}</span></div>`).join('')}</div>`:empty('لا أهداف بعد','أضف هدفاً واضحاً: أسبوع / شهر / مشروع.'))} 
      </div> 
      <div style="margin-top:14px">${card('Notes','PRIVATE NOTES',`<textarea id="personalNote" class="field" style="width:100%;min-height:150px;background:#0b111a;border:1px solid var(--line);border-radius:12px;color:#fff;padding:12px" placeholder="ملاحظاتك الخاصة…">${esc(state.personal.notes?.[0]?.text||'')}</textarea><div style="margin-top:10px"><button class="btn btn-primary" data-action="saveNote">Save</button> <span class="section-note">محلياً في المتصفح، لا يتم رفعها إلى backend في هذه النسخة.</span></div>`)}</div>`; 
  } 
 
  function renderSettings(){ 
    return `${pageHero('الإعدادات','Settings — لا مزيد من صفحة طويلة. كل فئة لها مكانها.',`<button class="btn btn-primary" data-action="saveSettings">Save</button>`)} 
      <div class="grid grid-2"> 
        ${card('Appearance','UI',`<div class="form-grid"><div class="field"><label>Language</label><select id="setLocale"><option value="ar" ${state.locale==='ar'?'selected':''}>العربية</option><option value="en" ${state.locale==='en'?'selected':''}>English</option></select></div><div class="field"><label>Theme</label><select id="setTheme"><option value="midnight" selected>Midnight</option><option value="light">Light (future)</option></select></div></div>`)} 
        ${card('Connection','CONTROL ROOM',`<div class="form-grid"><div class="field"><label>Access key</label><input id="accessKey" type="password" placeholder="اختياري للـbrowser فقط" value="${esc(state.accessKey)}"></div><div class="field"><label>Telegram Mini App</label><input value="${window.Telegram?.WebApp?.initData?'Detected':'Not detected'}" disabled></div></div><div class="section-note" style="margin-top:8px">لا نحفظ مفتاح الوصول في LocalStorage افتراضياً.</div><div style="margin-top:10px"><button class="btn btn-primary" data-action="connect">Connect / Verify</button> <button class="btn" data-action="disconnect">Disconnect</button></div>`)} 
        ${card('Notifications','DELIVERY',`<div class="mini-list"><div class="mini-row"><div><div class="mini-name">Telegram alerts</div><div class="mini-desc">Show verified delivery only</div></div><span class="tag">Audit</span></div><div class="mini-row"><div><div class="mini-name">Security alerts</div><div class="mini-desc">Critical events require review</div></div><span class="tag">Priority</span></div></div>`)} 
        ${card('Privacy & Safety','GUARDRAILS',`<div class="mini-list"><div class="mini-row"><span class="mini-name">Seed phrases / private keys</span>${dataBadge('Never stored','green')}</div><div class="mini-row"><span class="mini-name">Live trading</span>${dataBadge('Disabled by default','green')}</div><div class="mini-row"><span class="mini-name">Destructive actions</span>${dataBadge('Human approval','blue')}</div></div>`)} 
      </div>`; 
  } 
 
  function renderHealth(){ 
    const systems=[ 
      ['Supabase','Backend / Edge Function'],['n8n','Automation runtime'],['Telegram','Control channel'],['Vespa','Cognitive / search layer'],['TinyFish','Browser automation'],['GitHub Pages','UI deployment'] 
    ]; 
    return `${pageHero('صحة النظام','System / Health — حالة موثقة فقط، مع وضع degraded صريح عند الفشل.',`<button class="btn btn-primary" data-action="refresh">↻ Probe</button>`)} 
      <div class="grid grid-3">${systems.map(s=>card(s[0],'SYSTEM',`<div class="metric" style="font-size:20px">${state.connected&&s[0]==='Supabase'?'Connected':'Unverified'}</div><div class="metric-sub">${esc(s[1])}</div><div style="margin-top:10px">${dataBadge(state.connected&&s[0]==='Supabase'?'Verified connection':'No live probe','gray')}</div>`)).join('')}</div> 
      <div class="grid grid-2" style="margin-top:14px"><div class="card">${empty('Incident timeline','Loading, delivery, execution quota, AI credit and API errors enter this audit stream with timestamp + source.','<button class="btn btn-primary" data-action="refresh">↻ Probe again</button>')}</div><div class="card"><div class="card-head"><div><div class="eyebrow">OBSERVED NOW</div><div class="card-title">Known blockers</div></div></div>${(CFG.knownRuntimeSnapshot?.incidents||[]).map(i=>`<div class="incident-row ${esc(i.severity)}"><div><strong>${esc(i.title)}</strong><p>${esc(i.detail)}</p></div><span class="tag">${esc(i.status)}</span></div>`).join('')||empty('None','No stored incident snapshot.')}</div></div>`; 
  } 
 
  function bindShell(){ 
    document.querySelectorAll('[data-route]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.route))); 
    document.getElementById('menuBtn')?.addEventListener('click',()=>document.getElementById('sidebar')?.classList.toggle('open')); 
    document.querySelector('[data-mobile-menu]')?.addEventListener('click',()=>document.getElementById('sidebar')?.classList.add('open')); 
    document.getElementById('commandBtn')?.addEventListener('click',openCommand); 
    document.getElementById('whatBtn')?.addEventListener('click',()=>document.getElementById('approvalDrawer')?.classList.add('open')); 
    document.getElementById('closeDrawer')?.addEventListener('click',()=>document.getElementById('approvalDrawer')?.classList.remove('open')); 
    document.getElementById('command')?.addEventListener('click',e=>{if(e.target.id==='command')closeCommand()}); 
    document.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',()=>handleAction(el.dataset.action))); 
    document.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener('click',()=>{state.activeFilter=el.dataset.filter;render()})); 
    document.querySelectorAll('[data-approval]').forEach(el=>el.addEventListener('click',()=>toast('هذا الإجراء يحتاج backend approval flow فعلي قبل التنفيذ.','warn'))); 
    document.querySelectorAll('[data-remove-wallet]').forEach(el=>el.addEventListener('click',()=>{state.personal.wallets.splice(Number(el.dataset.removeWallet),1);saveLocal();render();toast('تم حذف المحفظة محلياً.','good')})); 
    const opSearch=document.getElementById('opSearch'); if(opSearch) opSearch.addEventListener('input',e=>{state.search=e.target.value;render();document.getElementById('opSearch')?.focus()}); 
    bindPageInputs(); 
    window.onkeydown=(e)=>{ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommand();} if(e.key==='Escape'){closeCommand();document.getElementById('approvalDrawer')?.classList.remove('open');}}; 
  } 
 
  function bindPageInputs(){ 
    document.getElementById('commandInput')?.addEventListener('input',e=>renderCommands(e.target.value)); 
    document.getElementById('commandInput')?.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCommand();return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const rows=[...document.querySelectorAll('.command-row')];if(!rows.length)return;const idx=Math.max(0,rows.findIndex(r=>r.classList.contains('active')));const next=e.key==='ArrowDown'?Math.min(rows.length-1,idx+1):Math.max(0,idx-1);rows.forEach(r=>r.classList.remove('active'));rows[next].classList.add('active');rows[next].scrollIntoView({block:'nearest'});return;}if(e.key==='Enter'){const a=document.querySelector('.command-row.active');if(a){if(a.dataset.cmdKind==='action'){closeCommand();handleAction(a.dataset.action);}else{go(a.dataset.route);closeCommand();}}}}); 
  } 
 
  function openCommand(){ state.commandOpen=true; document.getElementById('command')?.classList.add('open'); document.getElementById('commandInput')?.focus(); renderCommands(''); } 
  function closeCommand(){ state.commandOpen=false; document.getElementById('command')?.classList.remove('open'); } 
  function renderCommands(q){ 
    const list=document.getElementById('commandList');if(!list)return;const term=(q||'').toLowerCase(); 
    const actions=[ 
      ['quickOpportunity','＋ إضافة فرصة','Add Opportunity','radar'],['quickLead','＋ إضافة Prospect','Add Prospect','revenue'],['recordIncome','＋ تسجيل دخل','Record Income','capital'],['addWallet','＋ إضافة محفظة','Add Wallet','wallet'],['scan','⌁ تشغيل Radar','Run Scan','intelligence'],['openApprovals','◍ ما الذي يحتاجني؟','What Needs Me?','alerts'] 
    ]; 
    const routeRows=routes.filter(r=>!term || r[1].toLowerCase().includes(term)||r[2].toLowerCase().includes(term)).map(r=>({kind:'route',route:r[0],title:r[1],meta:r[2],icon:r[3]})); 
    const actionRows=actions.filter(a=>!term||a[1].toLowerCase().includes(term)||a[2].toLowerCase().includes(term)).map(a=>({kind:'action',action:a[0],title:a[1],meta:a[2],icon:a[3]})); 
    const rows=[...actionRows,...routeRows]; 
    list.innerHTML=rows.map((r,i)=>`<div class="command-row ${i===0?'active':''}" data-cmd-kind="${r.kind}" data-route="${r.route||''}" data-action="${r.action||''}"><div class="nav-icon">${ICONS[r.icon]||ICONS.search}</div><div><strong>${esc(r.title)}</strong><span>${esc(r.meta)}</span></div></div>`).join('') || `<div class="empty">لا نتيجة</div>`; 
    list.querySelectorAll('.command-row').forEach(x=>x.addEventListener('click',()=>{if(x.dataset.cmdKind==='action'){closeCommand();handleAction(x.dataset.action);}else{go(x.dataset.route);closeCommand();}})); 
  } 
 
  function go(route){ if(!routeMeta(route))return; state.route=route; location.hash=route; document.getElementById('sidebar')?.classList.remove('open'); render(); window.scrollTo({top:0,behavior:'smooth'}); } 
  function render(){ shell(); } 
 
  async function handleAction(action){ 
    if(action==='connect'){ await connect(); return; } 
    if(action==='disconnect'){ state.connected=false;state.live=null;state.connectionLabel='غير متصل';render();toast('تم فصل الاتصال.','good');return; } 
    if(action==='scan'){ toast('Radar جاهز، لكن التنفيذ الفعلي متوقف حالياً حتى تتوفر قناة runtime غير مقيدة. لا يوجد نجاح وهمي.','warn');return; } 
    if(action==='agentStatus'){ toast('Agent health يحتاج execution runtime؛ n8n execution quota مستنفد حالياً.','warn');return; } 
    if(action==='refresh'){ await connect(true);return; } 
    if(action==='quickOpportunity'){ modalForm('إضافة فرصة','opportunity');return; } 
    if(action==='quickLead'){ modalForm('إضافة Prospect','lead');return; } 
    if(action==='recordIncome'){ modalForm('تسجيل دخل شخصي','income');return; } 
    if(action==='addWallet'){ modalForm('إضافة محفظة شخصية','wallet');return; } 
    if(action==='paperTrade'){ modalForm('إضافة Paper Trade','trade');return; } 
    if(action==='saveNote'){ const v=document.getElementById('personalNote')?.value||''; state.personal.notes=[{text:v,updatedAt:Date.now()}];saveLocal();toast('تم حفظ الملاحظة محلياً.','good');return; } 
    if(action==='saveSettings'){ state.locale=document.getElementById('setLocale')?.value||'ar';state.theme=document.getElementById('setTheme')?.value||'midnight';state.accessKey=(document.getElementById('accessKey')?.value||'').trim();localStorage.setItem('midad_locale',state.locale);localStorage.setItem('midad_theme',state.theme);toast('تم حفظ تفضيلات الواجهة.','good');render();return; } 
  } 
 
  function modalForm(title,kind){ 
    const map={ 
      opportunity:[['title','اسم/عنوان الفرصة'],['source','المصدر'],['reward_usd','المكافأة بالدولار','number']], 
      lead:[['title','اسم العميل / المشروع'],['source','مصدر العميل'],['budget','الميزانية التقريبية','number']], 
      income:[['title','وصف الدخل'],['amount','المبلغ USD','number']], 
      wallet:[['label','اسم المحفظة'],['address','العنوان العام فقط'],['network','Network']], 
      trade:[['asset','Asset'],['side','Side: long/short'],['entry','Entry'],['stop','Stop'],['target','Target']] 
    }; 
    const fields=map[kind]||[]; 
    const box=document.getElementById('modalBox');const modal=document.getElementById('modal'); 
    box.innerHTML=`<h3>${esc(title)}</h3><p>هذا السجل المحلي لا يرسل أموالاً ولا يغير النظام. لا تدخل seed phrase أو private key.</p><div class="form-grid">${fields.map(f=>`<div class="field"><label>${esc(f[1])}</label><input id="mf_${f[0]}" type="${f[2]||'text'}"></div>`).join('')}</div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn" id="modalCancel">إلغاء</button><button class="btn btn-primary" id="modalSave">حفظ</button></div>`; 
    modal.classList.add('open'); 
    document.getElementById('modalCancel').onclick=()=>modal.classList.remove('open'); 
    document.getElementById('modalSave').onclick=()=>{ if(kind==='wallet'){state.personal.wallets.push({label:v('label'),address:v('address'),network:v('network')});} else if(kind==='income'){state.personal.income.push({title:v('title'),amount:Number(v('amount')||0),createdAt:Date.now()});} else if(kind==='trade'){state.personal.paperTrades.push({asset:v('asset'),side:v('side'),entry:v('entry'),stop:v('stop'),target:v('target')});} else { toast('السجل حُفِظ كمخطط محلي.','good'); } 
      saveLocal(); modal.classList.remove('open'); render(); 
    }; 
    function v(k){return document.getElementById('mf_'+k)?.value.trim()||'';} 
  } 
 
  function toast(msg,type='good'){ 
    const stack=document.getElementById('toastStack');if(!stack)return;const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=msg;stack.appendChild(el);setTimeout(()=>el.remove(),4200); 
  } 
 
  async function connect(){ 
    const tg = window.Telegram?.WebApp?.initData || ''; 
    const access = (document.getElementById('accessKey')?.value || state.accessKey || '').trim(); 
    state.accessKey = access; 
    const url=(CFG.supabaseUrl||'')+(CFG.controlRoomFunction||''); 
    if(!url){toast('Supabase URL/function غير مضبوطين.','bad');return;} 
    const body={action:CFG.dashboardAction||'dashboard',telegram_init_data:tg,access_key:access}; 
    try{ 
      const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); 
      const data=await res.json().catch(()=>({})); 
      if(!res.ok) throw new Error(data?.error||data?.message||`HTTP ${res.status}`); 
      state.connected=true;state.connectionLabel='متصل ومُتحقق';state.lastProbe=Date.now();state.live=data?.dashboard||data?.data||data||{}; 
      const u=state.live?.user||data?.user||{}; state.user={name:u.name||u.full_name||'',email:u.email||'',telegram:u.telegram||u.username||''}; 
      render();toast('تم التحقق من اتصال غرفة التحكم.','good'); 
    }catch(err){ state.connected=false;state.connectionLabel='Degraded / غير متصل';state.live=null;render();toast(`تعذر التحقق من الاتصال: ${err.message}`,'warn'); } 
  } 
 
  function boot(){ 
    const hash=(location.hash||'').replace('#','');if(routes.some(r=>r[0]===hash))state.route=hash; 
    if(window.Telegram?.WebApp){ try{window.Telegram.WebApp.ready();window.Telegram.WebApp.expand();}catch{} } 
    render(); 
    setTimeout(()=>APP.classList.remove('is-loading'),40); 
    if(window.Telegram?.WebApp?.initData){ setTimeout(()=>connect(),120); } 
  } 
  window.addEventListener('hashchange',()=>{const h=(location.hash||'').slice(1);if(routes.some(r=>r[0]===h)){state.route=h;render();}}); 
  boot(); 
})();
