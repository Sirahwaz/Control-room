(() => {
  const fallbackRegistry = {
    schema_version: 1,
    engine: 'MIDAD Neural Morphogenesis',
    capabilities: [
      {id:'revenue',label:'Revenue',keywords:['revenue','money','income','profit','دخل','مال','ربح'],stations:['revenue-forge','aimidad','control'],actions:['Find monetizable opportunities','Rank by effort and payout','Prepare a delivery path'],risk:'MEDIUM'},
      {id:'mining',label:'Mining',keywords:['mine','mining','miner','viabtc','hashrate','تعدين','ماينر','هشريت'],stations:['mining','control'],actions:['Inspect worker health','Detect hashrate anomalies','Review profit signals'],risk:'LOW'},
      {id:'trading',label:'Trading',keywords:['trade','trading','market','btc','crypto','risk','تداول','سوق','بيتكوين'],stations:['trader','aimidad','control'],actions:['Build market context','Score risk','Keep execution paper-only by default'],risk:'HIGH'},
      {id:'osint',label:'OSINT',keywords:['research','osint','intel','بحث','استخبارات','معلومات'],stations:['aimidad','control'],actions:['Collect evidence','Cross-check sources','Produce an explainable brief'],risk:'LOW'},
      {id:'operations',label:'Operations',keywords:['operate','operations','bot','control','task','workflow','تشغيل','عمليات','بوت','مهمة'],stations:['control','ahwaz','keys'],actions:['Inspect system state','Route tasks','Verify execution gates'],risk:'MEDIUM'},
      {id:'security',label:'Security',keywords:['security','secure','credential','secret','token','privacy','أمان','سر','مفتاح'],stations:['keys','control'],actions:['Check exposure boundaries','Review least-privilege posture','Block unsafe client-side secrets'],risk:'HIGH'},
      {id:'content',label:'Content',keywords:['content','video','photo','post','marketing','محتوى','فيديو','صورة','تسويق'],stations:['aimidad','ahwaz','revenue'],actions:['Define deliverable','Select production route','Package for monetization'],risk:'LOW'}
    ],
    station_aliases:{
      control:{title:'Neural Control Room',path:'./site/index.html'},
      trader:{title:'iAiTrader',path:'./site/iaitrader.html?v=20261003'},
      mining:{title:'ViaBTC Monitor',path:'./site/viabtc.html?v=20261003'},
      aimidad:{title:'AIMIDAD',path:'https://t.me/aimidad_bot',external:true},
      ahwaz:{title:'AHWAZ AI',path:'https://t.me/ahwazai_bot',external:true},
      keys:{title:'MIDAD Keys',path:'https://t.me/midadkeys_bot',external:true},
      revenue:{title:'Revenue Forge',path:'./site/revenue-forge.html?v=20261003'}
    }
  };

  const normalize=(value)=>String(value||'').toLowerCase().trim();
  const tokenize=(value)=>normalize(value)
    .replace(/[،,;|/]/g,' ')
    .split(/\s+/)
    .filter(Boolean);

  function planMission(goal, registry=fallbackRegistry){
    const tokens=tokenize(goal);
    const joined=tokens.join(' ');
    const scored=registry.capabilities.map(cap=>{
      let score=0;
      for(const keyword of cap.keywords){
        const k=normalize(keyword);
        if(joined.includes(k)) score += k.length > 3 ? 3 : 1;
      }
      return {...cap,score};
    }).filter(cap=>cap.score>0).sort((a,b)=>b.score-a.score);

    const winner=scored[0] || {
      id:'general',
      label:'General',
      stations:['control','aimidad'],
      actions:['Clarify the objective','Collect evidence','Choose the safest next action'],
      risk:'MEDIUM',
      score:0
    };

    const combined=scored.slice(0,3);
    const stationScores=new Map();
    for(const cap of combined){
      for(const station of cap.stations) stationScores.set(station,(stationScores.get(station)||0)+Math.max(cap.score,1));
    }
    const stations=[...stationScores.entries()]
      .sort((a,b)=>b[1]-a[1])
      .slice(0,4)
      .map(([id,score])=>({
        id,
        score,
        ...(registry.station_aliases[id] || {title:id,path:'#'})
      }));

    const risks=combined.map(x=>x.risk);
    const risk=risks.includes('HIGH')?'HIGH':risks.includes('MEDIUM')?'MEDIUM':'LOW';
    return {
      mode:'MISSION_CAPSULE',
      title: winner.id==='general' ? 'Capsule عامة' : 'Capsule: '+winner.label,
      objective:goal.trim(),
      primary:winner.id,
      confidence: Math.min(99, winner.score===0 ? 42 : 55 + winner.score*8),
      risk,
      capabilities:combined.map(x=>({id:x.id,label:x.label,score:x.score})),
      stations,
      actions:[...new Set(combined.flatMap(x=>x.actions))].slice(0,5),
      explain: winner.id==='general'
        ? 'لم تُكتشف إشارة قوية؛ تم اختيار مسار عام قابل للتعديل.'
        : 'تمت مطابقة الهدف مع إشارات لغوية متعددة، ثم دمج أفضل القدرات وترتيب محطات MIDAD بحسب الصلة.'
    };
  }

  let activeRegistry=fallbackRegistry;

  async function loadRegistry(){
    try{
      const response=await fetch('./morph-registry.json',{cache:'no-store'});
      if(!response.ok) throw new Error('registry '+response.status);
      const remote=await response.json();
      if(remote?.schema_version===1 && Array.isArray(remote.capabilities)) activeRegistry=remote;
    }catch(_){ /* local fallback stays active */ }
    return activeRegistry;
  }

  function esc(value){
    return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function renderCapsule(plan){
    const box=document.querySelector('#morphOutput');
    if(!box) return;
    const riskClass=plan.risk==='HIGH'?'morph-risk-high':plan.risk==='MEDIUM'?'morph-risk-medium':'morph-risk-low';
    const stationHtml=plan.stations.map(s=>
      '<button class="morph-station" data-morph-target="'+esc(s.path)+'" data-morph-external="'+(s.external?'true':'false')+'">'+
      '<span>'+esc(s.title)+'</span><em>'+esc(s.score)+'</em></button>'
    ).join('');
    const actionHtml=plan.actions.map(a=>'<li>'+esc(a)+'</li>').join('');
    const capabilityHtml=plan.capabilities.map(c=>'<span>'+esc(c.label)+' · '+esc(c.score)+'</span>').join('');
    box.innerHTML=
      '<div class="morph-head"><div><span class="label">MISSION CAPSULE</span><h3>'+esc(plan.title)+'</h3></div><span class="morph-risk '+riskClass+'">'+esc(plan.risk)+'</span></div>'+
      '<p class="morph-objective">'+esc(plan.objective)+'</p>'+
      '<div class="morph-metrics"><span>CONFIDENCE <b>'+esc(plan.confidence)+'%</b></span><span>MODE <b>MORPH</b></span></div>'+
      '<div class="morph-capabilities">'+capabilityHtml+'</div>'+
      '<div class="morph-columns"><div><span class="label">NEXT ACTIONS</span><ol>'+actionHtml+'</ol></div><div><span class="label">WHY</span><p>'+esc(plan.explain)+'</p></div></div>'+
      '<div class="label morph-label-gap">ROUTED STATIONS</div><div class="morph-stations">'+stationHtml+'</div>';
    box.classList.add('is-ready');
    box.querySelectorAll('.morph-station').forEach(btn=>btn.addEventListener('click',async()=>{
      try{await window.MidadMobileHaptic?.('MEDIUM');}catch(_){}
      const target=btn.dataset.morphTarget;
      if(!target || target==='#') return;
      if(btn.dataset.morphExternal==='true'){
        const browser=window.MidadMobileBrowser;
        if(browser) await browser(target); else window.open(target,'_blank','noopener,noreferrer');
      }else{
        location.href=target;
      }
    }));
  }

  async function morph(goal){
    const clean=String(goal||'').trim();
    if(!clean) return null;
    const registry=await loadRegistry();
    const plan=planMission(clean,registry);
    renderCapsule(plan);
    try{
      localStorage.setItem('midad-morph-last',JSON.stringify(plan));
    }catch(_){}
    document.dispatchEvent(new CustomEvent('midad:morph',{detail:plan}));
    return plan;
  }

  window.MidadMorph={planMission,morph,loadRegistry};
})();
