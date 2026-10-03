(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const showToast = (message) => {
    let el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(window.__midadToastTimer);
    window.__midadToastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  };

  const openTarget = (action, target) => {
    if (!target) return;
    if (action === 'open') {
      location.href = target;
      return;
    }
    if (action === 'external') {
      // Open Telegram / external destinations through the Android browser handoff.
      location.href = target;
    }
  };

  $$('.card[data-action], .quick-card[data-action]').forEach((el) => {
    el.addEventListener('click', () => openTarget(el.dataset.action, el.dataset.target));
  });

  const commandInput = $('#commandInput');
  const runCommand = () => {
    const q = (commandInput.value || '').trim().toLowerCase();
    if (!q) return;
    const rules = [
      { keys:['trade','trader','تداول','تاجر'], target:'./site/iaitrader.html?v=20261003' },
      { keys:['mine','mining','viabtc','تعدين','via'], target:'./site/viabtc.html?v=20261003' },
      { keys:['control','room','مقود','control room'], target:'./site/index.html?v=20261003' },
      { keys:['revenue','money','مال','دخل','ربح'], target:'./site/revenue-forge.html?v=20261003' }
    ];
    const hit = rules.find(r => r.keys.some(k => q.includes(k)));
    if (hit) {
      location.href = hit.target;
      return;
    }
    showToast('لم أجد محطة مطابقة بعد');
  };

  $('#searchBtn')?.addEventListener('click', runCommand);
  commandInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runCommand();
  });

  $$('[data-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.scroll;
      if (target === 'top') window.scrollTo({top:0, behavior:'smooth'});
      else if (target === 'stations') $('.section')?.scrollIntoView({behavior:'smooth', block:'start'});
      else $('.future')?.scrollIntoView({behavior:'smooth', block:'start'});
      $$('.nav-item').forEach(x => x.classList.toggle('active', x === btn));
    });
  });

  // Keep Android/system back navigation predictable inside the local shell.
  window.addEventListener('pageshow', () => {
    document.body.dataset.ready = 'true';
  });
})();
