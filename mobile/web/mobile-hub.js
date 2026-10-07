(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const STORAGE = 'midad-mobile-v03';
  const LEGACY_STORAGE = 'midad-mobile-v02';

  const readStorage = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  };

  const state = (() => {
    const base = { favorites: [], recent: [], notes: [] };
    const current = readStorage(STORAGE);
    const legacy = current ? null : readStorage(LEGACY_STORAGE);
    return Object.assign(base, current || legacy || {});
  })();

  const save = () => {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch (_) {}
    renderState();
  };

  const nativePlugin = (name) => window.Capacitor?.Plugins?.[name] || null;

  const haptic = async (style = 'LIGHT') => {
    try { await nativePlugin('Haptics')?.impact?.({style}); } catch (_) {}
  };

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
    window.__midadToastTimer = setTimeout(() => el.classList.remove('show'), 1900);
  };

  const openExternal = async (url) => {
    const browser = nativePlugin('Browser');
    if (browser?.open) {
      try {
        await browser.open({url, toolbarColor:'#0b111a'});
        return;
      } catch (_) {}
    }
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) { location.href = url; }
  };

  const remember = (id) => {
    state.recent = [id, ...state.recent.filter(x => x !== id)].slice(0, 8);
    save();
  };

  const openTarget = async (el) => {
    const target = el?.dataset.target;
    if (!target) return;
    await haptic();
    const id = el.dataset.id;
    if (id) remember(id);
    if (el.dataset.action === 'open') location.href = target;
    if (el.dataset.action === 'external') await openExternal(target);
  };

  const renderState = () => {
    $$('#stations .fav').forEach((btn) => {
      const id = btn.dataset.fav;
      const active = state.favorites.includes(id);
      btn.textContent = active ? '★' : '☆';
      btn.classList.toggle('is-favorite', active);
      btn.setAttribute('aria-label', active ? 'إزالة من المفضلة' : 'تفضيل');
    });
    $('#favoriteCount').textContent = state.favorites.length;
    $('#recentCount').textContent = state.recent.length;
    $('#notesCount').textContent = state.notes.length;
  };

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));

  const notesRender = () => {
    const box = $('#notesBox');
    if (!box) return;
    if (!state.notes.length) {
      box.innerHTML = '<div class="empty">لا توجد ملاحظات بعد. هذه الطبقة محلية الآن ومهيأة لاحقًا للانتقال إلى MIDAD Database.</div>';
      return;
    }
    box.innerHTML = state.notes.map((n, i) =>
      '<article class="note"><div><time>' + escapeHtml(n.date) + '</time><p>' + escapeHtml(n.text) + '</p></div>' +
      '<button class="note-delete" data-note="' + i + '" aria-label="حذف">×</button></article>'
    ).join('');
    $$('.note-delete').forEach(btn => btn.addEventListener('click', () => {
      state.notes.splice(Number(btn.dataset.note), 1); save(); notesRender(); haptic('MEDIUM');
    }));
  };

  const addNote = () => {
    const text = window.prompt('اكتب ملاحظتك لـ MIDAD:');
    if (!text?.trim()) return;
    state.notes.unshift({date:new Date().toLocaleString('ar'), text:text.trim()});
    save(); notesRender(); haptic('MEDIUM'); showToast('تم حفظ الملاحظة محليًا');
  };

  $$('#stations .fav').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.fav;
      state.favorites = state.favorites.includes(id)
        ? state.favorites.filter(x => x !== id)
        : [...state.favorites, id];
      save(); haptic();
    });
  });

  $$('.card[data-action], .quick-card[data-action]').forEach((el) => {
    el.addEventListener('click', () => openTarget(el));
  });

  function runCommand() {
    const q = ($('#commandInput')?.value || '').trim().toLowerCase();
    if (!q) return;
    if (q.includes('note') || q.includes('ملاح')) { addNote(); return; }
    const rules = [
      {keys:['trade','trader','تداول','تاجر'], target:'./site/iaitrader.html?v=20261007', id:'trader'},
      {keys:['mine','mining','viabtc','تعدين','via'], target:'./site/viabtc.html?v=20261007', id:'mining'},
      {keys:['control','room','مقود','control room'], target:'./site/index.html?v=20261007', id:'control'},
      {keys:['revenue','money','مال','دخل','ربح'], target:'./site/revenue-forge.html?v=20261007', id:'revenue'},
      {keys:['ai','aimidad','بحث','osint'], target:'https://t.me/aimidad_bot', external:true, id:'aimidad'}
    ];
    const hit = rules.find(r => r.keys.some(k => q.includes(k)));
    if (!hit) { showToast('لا توجد وحدة مطابقة بعد'); return; }
    remember(hit.id);
    if (hit.external) openExternal(hit.target); else location.href = hit.target;
  }

  $('#searchBtn')?.addEventListener('click', runCommand);
  $('#commandInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runCommand(); });

  $$('.space-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic();
      const kind = btn.dataset.space;
      if (kind === 'notes') $('#notesBox')?.scrollIntoView({behavior:'smooth', block:'center'});
      else if (kind === 'favorites') {
        const ids = new Set(state.favorites);
        $$('#stations .card').forEach(card => { card.style.display = ids.has(card.dataset.id) ? 'flex' : 'none'; });
        if (!state.favorites.length) showToast('لم تتم إضافة أي محطة للمفضلة بعد');
      } else if (kind === 'recent') {
        const ids = new Set(state.recent);
        $$('#stations .card').forEach(card => { card.style.display = ids.has(card.dataset.id) ? 'flex' : 'none'; });
        if (!state.recent.length) showToast('لا يوجد سجل حديث بعد');
      } else if (kind === 'system') {
        showToast('MIDAD Mobile v0.3 • Native Shell • Safe Local Storage');
      }
    });
  });

  const restoreStations = () => $$('#stations .card').forEach(card => card.style.display = 'flex');
  $('#newNote')?.addEventListener('click', addNote);

  $$('[data-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.scroll;
      if (target === 'home') $('#home')?.scrollIntoView({behavior:'smooth', block:'start'});
      else if (target === 'stations') { restoreStations(); $('#stations')?.scrollIntoView({behavior:'smooth', block:'start'}); }
      else $('#future')?.scrollIntoView({behavior:'smooth', block:'start'});
      $$('.nav-item').forEach(x => x.classList.toggle('active', x === btn));
      haptic();
    });
  });

  const app = nativePlugin('App');
  if (app?.addListener) {
    app.addListener('backButton', async (event) => {
      if (event?.canGoBack && history.length > 1) history.back();
      else if (app.exitApp) await app.exitApp();
    });
    app.addListener('appStateChange', ({isActive}) => {
      $('#runtimeState').textContent = isActive ? 'NATIVE SHELL' : 'PAUSED';
    });
  }

  window.MidadMobileHaptic = haptic;
  window.MidadMobileBrowser = openExternal;

  renderState();
  notesRender();
  document.body.dataset.ready = 'true';
})();
