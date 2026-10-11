/* MIDAD Meme Trader — standalone Android client. Public market reads; paper ledger stays on this device. */
(function () {
  'use strict';

  const API = 'https://api.dexscreener.com';
  const SUPPORTED = new Set(['solana', 'base', 'ethereum', 'bsc', 'arbitrum']);
  const LEDGER_KEY = 'midad.memeTrader.paper.v1';
  const SETTINGS_KEY = 'midad.memeTrader.settings.v1';
  const WATCH_KEY = 'midad.memeTrader.watchlist.v1';
  const state = { tokens: [], filter: 'ALL', chain: 'all', sort: 'score', view: 'radar', selected: null, scanning: false, lastScan: null };
  const $ = (id) => document.getElementById(id);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const esc = (v) => String(v == null ? '' : v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const safeHttp = (v) => { try { const u = new URL(String(v || '')); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; } };
  const money = (v) => {
    const n = num(v);
    const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 2 : Math.abs(n) >= 0.01 ? 4 : 8;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) }).format(n);
  };
  const compact = (v) => {
    const n = num(v);
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return money(n);
  };
  const pct = (v) => (num(v) > 0 ? '+' : '') + num(v).toFixed(2) + '%';
  const pctClass = (v) => num(v) > 0 ? 'positive' : num(v) < 0 ? 'negative' : 'neutral';
  const when = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const chainLabel = (v) => ({ solana: 'Solana', base: 'Base', ethereum: 'Ethereum', bsc: 'BNB Chain', arbitrum: 'Arbitrum' })[v] || String(v || 'Unknown');
  const riskLabels = { MOMENTUM_WATCH: 'زخم محتمل', OBSERVE: 'مراقبة', EXHAUSTION_RISK: 'اندفاع مفرط', DUMP_RISK: 'خطر هبوط', LIQUIDITY_RISK: 'خطر سيولة' };

  const defaultSettings = { capital: 10000, orderSize: 25, minLiquidity: 10000, stopLoss: 15, takeProfit: 30, slippagePct: 0.5, feePct: 0.3 };
  function loadJson(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (_) { return fallback; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { toast('تعذر الحفظ المحلي؛ تحقق من مساحة التخزين على الهاتف.'); return false; }
  }
  let settings = Object.assign({}, defaultSettings, loadJson(SETTINGS_KEY, {}));
  let ledger = Object.assign({ cash: settings.capital, positions: [], journal: [], realized: 0, createdAt: Date.now() }, loadJson(LEDGER_KEY, {}));
  let watchlist = new Set(loadJson(WATCH_KEY, []));
  if (!Array.isArray(ledger.positions)) ledger.positions = [];
  if (!Array.isArray(ledger.journal)) ledger.journal = [];
  if (!Number.isFinite(Number(ledger.cash))) ledger.cash = settings.capital;

  function persistLedger() { saveJson(LEDGER_KEY, ledger); updateSummary(); }
  function toast(message) {
    const el = $('toast'); if (!el) return;
    el.textContent = message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3400);
  }
  function setStatus(message, kind) {
    const el = $('market-status');
    el.className = 'status-panel' + (kind ? ' ' + kind : '');
    el.innerHTML = (kind === 'loading' ? '<div class="loader"></div>' : '') + '<span>' + esc(message) + '</span>';
  }
  async function requestJSON(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 14000);
    try {
      const res = await fetch(url, { method: 'GET', headers: { 'accept': 'application/json' }, cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for market source');
      return await res.json();
    } finally { clearTimeout(timer); }
  }
  function extractArray(v) { return Array.isArray(v) ? v : Array.isArray(v && v.pairs) ? v.pairs : []; }
  function tokenKey(chain, address) { return String(chain || '').toLowerCase() + '|' + String(address || '').toLowerCase(); }

  function classify(pair) {
    const liquidity = num(pair && pair.liquidity && pair.liquidity.usd);
    const ch5 = num(pair && pair.priceChange && pair.priceChange.m5);
    const ch1 = num(pair && pair.priceChange && pair.priceChange.h1);
    const ch24 = num(pair && pair.priceChange && pair.priceChange.h24);
    const volume24 = num(pair && pair.volume && pair.volume.h24);
    const ageM = pair && pair.pairCreatedAt ? Math.max(0, (Date.now() - num(pair.pairCreatedAt)) / 60000) : null;
    const tx = pair && pair.txns && pair.txns.h1 ? pair.txns.h1 : {};
    const buys = num(tx.buys), sells = num(tx.sells), ratio = (buys + 1) / (sells + 1);
    let risk = 'OBSERVE';
    if (liquidity < Math.max(5000, Number(settings.minLiquidity) * 0.5) || (ageM !== null && ageM < 5 && liquidity < Number(settings.minLiquidity))) risk = 'LIQUIDITY_RISK';
    else if (ch5 <= -12 || ch1 <= -30) risk = 'DUMP_RISK';
    else if (ch5 >= 18 || ch1 >= 90 || (ch1 > 55 && ch24 > 200)) risk = 'EXHAUSTION_RISK';
    else if (liquidity >= Number(settings.minLiquidity) && volume24 >= 10000 && (volume24 / Math.max(liquidity, 1)) >= 0.35 && ch5 > 0 && ch1 > 2 && ratio >= 1.05) risk = 'MOMENTUM_WATCH';
    const flowScore = Math.max(-12, Math.min(12, (ratio - 1) * 10));
    const turnoverScore = Math.max(-12, Math.min(12, Math.log10(1 + volume24 / Math.max(liquidity, 1)) * 8));
    let score = Math.round(Math.max(0, Math.min(100, 48 + ch5 * 0.7 + ch1 * 0.12 + ch24 * 0.018 + flowScore + turnoverScore)));
    if (risk === 'LIQUIDITY_RISK') score = Math.min(score, 35);
    if (risk === 'DUMP_RISK') score = Math.min(score, 30);
    if (risk === 'EXHAUSTION_RISK') score = Math.min(score, 55);
    return { risk, score, ageM, ch5, ch1, ch24, liquidity, volume24, buys, sells };
  }

  function bestPairForToken(candidate, pairs) {
    const wanted = String(candidate.tokenAddress || '').toLowerCase();
    const matches = pairs.filter((p) => {
      if (!p || String(p.chainId || '').toLowerCase() !== String(candidate.chainId || '').toLowerCase()) return false;
      const base = String(p.baseToken && p.baseToken.address || '').toLowerCase();
      const quote = String(p.quoteToken && p.quoteToken.address || '').toLowerCase();
      return base === wanted || quote === wanted;
    });
    if (!matches.length) return null;
    matches.sort((a, b) => num(b.liquidity && b.liquidity.usd) - num(a.liquidity && a.liquidity.usd));
    const p = matches[0];
    const isBase = String(p.baseToken && p.baseToken.address || '').toLowerCase() === wanted;
    const token = isBase ? p.baseToken : p.quoteToken;
    const normalized = Object.assign({}, p);
    normalized._tokenAddress = candidate.tokenAddress;
    normalized._tokenSymbol = token && token.symbol || candidate.symbol || 'TOKEN';
    normalized._tokenName = token && token.name || candidate.name || normalized._tokenSymbol;
    normalized._tokenIcon = safeHttp(candidate.icon) || safeHttp(p.info && p.info.imageUrl) || '';
    normalized._sourceUrl = safeHttp(p.url);
    normalized._tokenDescription = candidate.description || '';
    normalized._boosted = Boolean(candidate.boosted);
    normalized._profiled = Boolean(candidate.profiled);
    normalized._score = classify(normalized);
    return normalized;
  }

  async function scanMarket() {
    if (state.scanning) return;
    state.scanning = true;
    $('scan-btn').disabled = true;
    $('refresh-btn').disabled = true;
    $('feed-state').textContent = 'جاري جلب بيانات السوق';
    setStatus('جارٍ جلب أحدث ملفات الرموز والرموز المعزّزة وتجميع الأزواج المتاحة…', 'loading');
    try {
      const feeds = await Promise.all([
        requestJSON(API + '/token-profiles/latest/v1', 15000),
        requestJSON(API + '/token-boosts/latest/v1', 15000)
      ]);
      const profiles = extractArray(feeds[0]), boosts = extractArray(feeds[1]);
      const map = new Map();
      profiles.forEach((x) => {
        const chain = String(x.chainId || '').toLowerCase();
        if (!SUPPORTED.has(chain) || !x.tokenAddress) return;
        const key = tokenKey(chain, x.tokenAddress);
        map.set(key, Object.assign({}, map.get(key) || {}, x, { chainId: chain, profiled: true }));
      });
      boosts.forEach((x) => {
        const chain = String(x.chainId || '').toLowerCase();
        if (!SUPPORTED.has(chain) || !x.tokenAddress) return;
        const key = tokenKey(chain, x.tokenAddress);
        map.set(key, Object.assign({}, map.get(key) || {}, x, { chainId: chain, boosted: true }));
      });
      const groups = {};
      Array.from(map.values()).forEach((x) => {
        if (!groups[x.chainId]) groups[x.chainId] = [];
        if (groups[x.chainId].length < 30) groups[x.chainId].push(x);
      });
      const pairResults = await Promise.all(Object.entries(groups).map(async ([chain, items]) => {
        if (!items.length) return [];
        const addresses = items.map((x) => encodeURIComponent(x.tokenAddress)).join(',');
        try { return extractArray(await requestJSON(API + '/tokens/v1/' + encodeURIComponent(chain) + '/' + addresses, 18000)); }
        catch (e) { return []; }
      }));
      const pairs = pairResults.flat();
      if (!pairs.length) throw new Error('No priced token pairs returned. The source may be temporarily unavailable.');
      const byChain = {};
      Object.entries(groups).forEach(([chain, items]) => { byChain[chain] = items; });
      const rows = [];
      Object.entries(byChain).forEach(([chain, items]) => {
        const chainPairs = pairs.filter((p) => String(p.chainId || '').toLowerCase() === chain);
        items.forEach((candidate) => {
          const p = bestPairForToken(candidate, chainPairs);
          if (p && num(p.priceUsd) > 0) rows.push(p);
        });
      });
      const unique = new Map();
      rows.forEach((p) => {
        const key = tokenKey(p.chainId, p._tokenAddress);
        const old = unique.get(key);
        if (!old || num(p.liquidity && p.liquidity.usd) > num(old.liquidity && old.liquidity.usd)) unique.set(key, p);
      });
      state.tokens = Array.from(unique.values());
      if (!state.tokens.length) throw new Error('Market feed returned no matching priced tokens on supported chains.');
      state.tokens.forEach((p) => { p._score = classify(p); });
      state.lastScan = Date.now();
      const triggeredExits = [];
      ledger.positions.forEach((pos) => {
        const match = unique.get(tokenKey(pos.chainId, pos.tokenAddress));
        if (!match) return; // Never trigger an automatic paper exit from stale prices.
        pos.lastPrice = num(match.priceUsd);
        pos.lastSeen = Date.now();
        const movePct = num(pos.entryPrice) > 0 ? (pos.lastPrice / num(pos.entryPrice) - 1) * 100 : 0;
        if (movePct <= -Math.abs(num(pos.stopLoss))) triggeredExits.push({ id: pos.id, reason: 'STOP_LOSS' });
        else if (movePct >= Math.abs(num(pos.takeProfit))) triggeredExits.push({ id: pos.id, reason: 'TAKE_PROFIT' });
      });
      triggeredExits.forEach((exit) => sellPaper(exit.id, exit.reason, true));
      persistLedger();
      $('feed-state').textContent = 'بيانات السوق متاحة';
      $('last-scan').textContent = 'آخر مسح: ' + new Date(state.lastScan).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus('تمت قراءة ' + profiles.length + ' ملفًا و' + boosts.length + ' رمزًا معزّزًا؛ عُثر على ' + state.tokens.length + ' أصلًا مسعّرًا. هذه قراءة عامة وليست تحققًا من سلامة العقود.', 'ok');
      renderTokens();
      updateSummary();
      renderPortfolio();
      renderWatchlist();
      toast('اكتمل المسح: ' + state.tokens.length + ' أصلًا مسعّرًا.' + (triggeredExits.length ? ' إغلاق ورقي آلي: ' + triggeredExits.length + ' وفق حدود المخاطرة.' : ''));
    } catch (err) {
      const message = err && err.name === 'AbortError' ? 'انتهت مهلة الاتصال بمصدر السوق. حاول مرة أخرى.' : (err && err.message) || 'تعذر جلب البيانات.';
      $('feed-state').textContent = 'تعذر تحديث المصدر';
      setStatus(message + ' تحقق من اتصال الإنترنت وحاول مجددًا. لم يتم تنفيذ أي صفقة حقيقية.', 'error');
      toast('فشل تحديث السوق: ' + message);
    } finally {
      state.scanning = false;
      $('scan-btn').disabled = false;
      $('refresh-btn').disabled = false;
    }
  }

  function filteredTokens() {
    let list = state.tokens.slice();
    if (state.chain !== 'all') list = list.filter((p) => String(p.chainId).toLowerCase() === state.chain);
    if (state.filter !== 'ALL') list = list.filter((p) => p._score && p._score.risk === state.filter);
    if (state.sort === 'volume') list.sort((a, b) => num(b.volume && b.volume.h24) - num(a.volume && a.volume.h24));
    else if (state.sort === 'change') list.sort((a, b) => num(b.priceChange && b.priceChange.h1) - num(a.priceChange && a.priceChange.h1));
    else if (state.sort === 'liquidity') list.sort((a, b) => num(b.liquidity && b.liquidity.usd) - num(a.liquidity && a.liquidity.usd));
    else list.sort((a, b) => num(b._score && b._score.score) - num(a._score && a._score.score));
    return list;
  }
  function riskWarning(p) {
    const r = p._score.risk;
    if (r === 'DUMP_RISK') return 'هبوط حاد في نافذة قصيرة — راقب خطر استمرار البيع.';
    if (r === 'EXHAUSTION_RISK') return 'اندفاع سعري حاد؛ احتمال شراء القمة مرتفع.';
    if (r === 'LIQUIDITY_RISK') return 'السيولة أو حداثة الزوج غير كافيين لمحاكاة شراء منضبطة.';
    if (r === 'MOMENTUM_WATCH') return 'زخم أولي وفق القواعد؛ لم يتم التحقق من سلامة العقد.';
    return 'إشارة محايدة؛ لا تُفهم كدعوة للشراء.';
  }
  function dexsUrl(p) {
    if (p._sourceUrl) return p._sourceUrl;
    return 'https://dexscreener.com/' + encodeURIComponent(String(p.chainId || '')) + '/' + encodeURIComponent(String(p.pairAddress || p._tokenAddress || ''));
  }
  function tokenCard(p) {
    const s = p._score || classify(p);
    const key = tokenKey(p.chainId, p._tokenAddress);
    const saved = watchlist.has(key);
    const icon = safeHttp(p._tokenIcon);
    const change5 = num(p.priceChange && p.priceChange.m5);
    const change1 = num(p.priceChange && p.priceChange.h1);
    const change24 = num(p.priceChange && p.priceChange.h24);
    const tx = p.txns && p.txns.h1 ? p.txns.h1 : {};
    const volume = p.volume || {};
    const age = s.ageM == null ? 'العمر غير متاح' : s.ageM < 60 ? 'العمر ' + Math.floor(s.ageM) + ' د' : 'العمر ' + Math.floor(s.ageM / 60) + ' س';
    const disabled = ['DUMP_RISK', 'EXHAUSTION_RISK', 'LIQUIDITY_RISK'].includes(s.risk) || s.liquidity < Number(settings.minLiquidity);
    return '<article class="token-card">' +
      '<div class="token-head"><div class="token-identity"><div class="token-logo">' + (icon ? '<img loading="lazy" src="' + esc(icon) + '" alt="" referrerpolicy="no-referrer">' : esc(String(p._tokenSymbol || '?').slice(0, 1))) + '</div><div><h3 class="token-name">' + esc(p._tokenName || p._tokenSymbol) + '</h3><div class="token-symbol">$' + esc(p._tokenSymbol || 'TOKEN') + ' · ' + esc(chainLabel(p.chainId)) + '</div></div></div><span class="risk-badge risk-' + esc(s.risk) + '">' + esc(riskLabels[s.risk] || s.risk) + '</span></div>' +
      '<div class="token-price-row"><strong class="token-price">' + esc(money(p.priceUsd)) + '</strong><span class="token-score">Score ' + esc(s.score) + '/100</span></div>' +
      '<div class="token-metrics"><div class="metric"><span>تغير 5 دقائق</span><b class="' + pctClass(change5) + '">' + esc(pct(change5)) + '</b></div><div class="metric"><span>تغير ساعة</span><b class="' + pctClass(change1) + '">' + esc(pct(change1)) + '</b></div><div class="metric"><span>تغير 24 ساعة</span><b class="' + pctClass(change24) + '">' + esc(pct(change24)) + '</b></div><div class="metric"><span>السيولة</span><b>' + esc(compact(s.liquidity)) + '</b></div><div class="metric"><span>حجم 24 ساعة</span><b>' + esc(compact(volume.h24)) + '</b></div><div class="metric"><span>شراء/بيع (1س)</span><b>' + esc(num(tx.buys)) + ' / ' + esc(num(tx.sells)) + '</b></div></div>' +
      '<div class="token-footer"><div class="chain-age">' + esc(age) + '<br>العقد: غير متحقق</div><div class="token-actions"><button class="mini-action ' + (saved ? 'saved' : '') + '" data-action="watch" data-key="' + esc(key) + '" aria-label="' + (saved ? 'إزالة من المراقبة' : 'إضافة للمراقبة') + '">' + (saved ? '★' : '☆') + '</button><a class="mini-action" href="' + esc(dexsUrl(p)) + '" target="_blank" rel="noopener noreferrer" aria-label="فتح DEX Screener">↗</a><button class="btn btn-primary" data-action="buy" data-key="' + esc(key) + '" ' + (disabled ? 'disabled title="إشارة خطرة أو سيولة دون الحد"' : '') + '>شراء ورقي</button></div></div>' +
      '<div class="risk-warning">' + esc(riskWarning(p)) + '</div></article>';
  }
  function renderTokens() {
    const el = $('token-list');
    const list = filteredTokens();
    if (!list.length) {
      el.innerHTML = '';
      if (state.tokens.length) setStatus('لا توجد أصول ضمن المرشح الحالي. غيّر الشبكة أو فئة المخاطر.', '');
      return;
    }
    el.innerHTML = list.map(tokenCard).join('');
    $('stat-assets').textContent = state.tokens.length;
    $('stat-watch').textContent = state.tokens.filter((p) => p._score && p._score.risk === 'MOMENTUM_WATCH').length;
  }

  function currentToken(key) { return state.tokens.find((p) => tokenKey(p.chainId, p._tokenAddress) === key) || null; }
  function openTradeDialog(key) {
    const p = currentToken(key);
    if (!p) { toast('يجب تحديث بيانات الأصل أولًا.'); return; }
    const score = p._score || classify(p);
    if (['DUMP_RISK', 'EXHAUSTION_RISK', 'LIQUIDITY_RISK'].includes(score.risk)) {
      toast('منع التطبيق فتح صفقة ورقية لهذا الأصل بسبب تصنيف المخاطر.');
      return;
    }
    if (score.liquidity < Number(settings.minLiquidity)) {
      toast('السيولة أقل من الحد المحدد في إعدادات المحاكاة.');
      return;
    }
    state.selected = p;
    $('trade-token-name').textContent = (p._tokenName || p._tokenSymbol) + ' · $' + (p._tokenSymbol || 'TOKEN');
    $('trade-token-meta').textContent = chainLabel(p.chainId) + ' · العقد غير متحقق · تداول ورقي فقط';
    $('trade-price').textContent = money(p.priceUsd);
    $('trade-liquidity').textContent = compact(score.liquidity);
    $('trade-amount').value = String(Math.min(Number(settings.orderSize), Math.max(5, num(ledger.cash))).toFixed(2));
    if (typeof $('trade-dialog').showModal === 'function') $('trade-dialog').showModal();
    else $('trade-dialog').setAttribute('open', '');
  }
  function addJournal(type, p, amount, price, pnl) {
    ledger.journal.unshift({ id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8), type, symbol: p._tokenSymbol || p.symbol || 'TOKEN', tokenName: p._tokenName || p.name || p._tokenSymbol || 'TOKEN', chainId: p.chainId, tokenAddress: p._tokenAddress || p.tokenAddress, amount: num(amount), price: num(price), pnl: num(pnl), time: Date.now(), mode: 'PAPER' });
    ledger.journal = ledger.journal.slice(0, 500);
  }
  function confirmPaperBuy(event) {
    event.preventDefault();
    const p = state.selected;
    if (!p) return;
    const amount = num($('trade-amount').value);
    const price = num(p.priceUsd);
    if (!(amount >= 5) || !(price > 0)) { toast('أدخل قيمة صالحة وسعرًا متاحًا.'); return; }
    if (amount > num(ledger.cash)) { toast('الرصيد الافتراضي لا يكفي لهذه الصفقة.'); return; }
    if (amount > Number(settings.orderSize) * 3) { toast('تجاوزت 3 أضعاف حجم الصفقة المحدد. غيّر الإعدادات أولًا.'); return; }
    const key = tokenKey(p.chainId, p._tokenAddress);
    if (ledger.positions.some((pos) => tokenKey(pos.chainId, pos.tokenAddress) === key)) { toast('لديك مركز ورقي مفتوح لهذا الأصل بالفعل.'); return; }
    const slippagePct = Math.max(0, Math.min(10, num(settings.slippagePct)));
    const feePct = Math.max(0, Math.min(5, num(settings.feePct)));
    const executionPrice = price * (1 + slippagePct / 100);
    const qty = (amount / (1 + feePct / 100)) / executionPrice;
    ledger.cash = Math.max(0, num(ledger.cash) - amount);
    ledger.positions.push({ id: String(Date.now()), chainId: p.chainId, tokenAddress: p._tokenAddress, symbol: p._tokenSymbol, name: p._tokenName, amountUsd: amount, qty, entryPrice: executionPrice, marketEntryPrice: price, lastPrice: price, lastSeen: Date.now(), openedAt: Date.now(), pairUrl: dexsUrl(p), stopLoss: Number(settings.stopLoss), takeProfit: Number(settings.takeProfit), slippagePct, feePct });
    addJournal('BUY_PAPER', p, amount, executionPrice, 0);
    persistLedger();
    $('trade-dialog').close();
    renderPortfolio(); renderJournal(); updateSummary();
    toast('تم فتح صفقة ورقية بقيمة ' + money(amount) + ' — لم يتم إرسال أي أمر حقيقي.');
  }
  function netExitValue(pos, marketPrice) {
    const slippagePct = Math.max(0, Math.min(10, num(pos.slippagePct)));
    const feePct = Math.max(0, Math.min(5, num(pos.feePct)));
    return num(pos.qty) * num(marketPrice) * (1 - slippagePct / 100) * (1 - feePct / 100);
  }
  function sellPaper(id, exitReason, silent) {
    const idx = ledger.positions.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const pos = ledger.positions[idx];
    const price = num(pos.lastPrice || pos.entryPrice);
    if (!(price > 0)) { if (!silent) toast('السعر الحالي غير متاح. حدّث السوق قبل الإغلاق.'); return; }
    if (!silent && (!pos.lastSeen || Date.now() - num(pos.lastSeen) > 90000)) {
      toast('السعر المخزّن قديم. حدّث السوق أولًا حتى لا تُسجَّل نتيجة ورقية على سعر قديم.');
      return;
    }
    const slippagePct = Math.max(0, Math.min(10, num(pos.slippagePct)));
    const exitExecutionPrice = price * (1 - slippagePct / 100);
    const proceeds = netExitValue(pos, price);
    const pnl = proceeds - num(pos.amountUsd);
    ledger.cash = num(ledger.cash) + proceeds;
    ledger.realized = num(ledger.realized) + pnl;
    const journalType = exitReason === 'STOP_LOSS' ? 'SELL_PAPER_STOP' : exitReason === 'TAKE_PROFIT' ? 'SELL_PAPER_TAKE' : 'SELL_PAPER';
    addJournal(journalType, pos, proceeds, exitExecutionPrice, pnl);
    ledger.positions.splice(idx, 1);
    persistLedger();
    if (!silent) {
      renderPortfolio(); renderJournal(); updateSummary();
      toast('أُغلق المركز الورقي. النتيجة بعد الرسوم والانزلاق: ' + money(pnl) + '.');
    }
  }
  function portfolioMetrics() {
    let market = 0, unrealized = 0;
    ledger.positions.forEach((p) => { const value = netExitValue(p, p.lastPrice || p.entryPrice); market += value; unrealized += value - num(p.amountUsd); });
    return { market, unrealized, equity: num(ledger.cash) + market, realized: num(ledger.realized) };
  }
  function updateSummary() {
    const m = portfolioMetrics();
    $('stat-assets').textContent = state.tokens.length || '—';
    $('stat-watch').textContent = state.tokens.filter((p) => p._score && p._score.risk === 'MOMENTUM_WATCH').length;
    $('stat-equity').textContent = money(m.equity);
    $('stat-open').textContent = ledger.positions.length;
    $('portfolio-cash').textContent = money(ledger.cash);
    $('portfolio-market').textContent = money(m.market);
    $('portfolio-unrealized').textContent = money(m.unrealized);
    $('portfolio-realized').textContent = money(m.realized);
    $('portfolio-unrealized').className = m.unrealized >= 0 ? 'positive' : 'negative';
    $('portfolio-realized').className = m.realized >= 0 ? 'positive' : 'negative';
  }
  function renderPortfolio() {
    const host = $('open-positions');
    $('portfolio-empty').classList.toggle('show', ledger.positions.length === 0);
    host.innerHTML = ledger.positions.map((p) => {
      const current = num(p.lastPrice || p.entryPrice), value = netExitValue(p, current), pnl = value - num(p.amountUsd);
      const movePct = num(p.entryPrice) > 0 ? (current / num(p.entryPrice) - 1) * 100 : 0;
      const auto = movePct <= -Math.abs(num(p.stopLoss)) ? ' · سيغلق ورقيًا عند تحديث سعر صالح' : movePct >= Math.abs(num(p.takeProfit)) ? ' · سيغلق ورقيًا عند تحديث سعر صالح' : '';
      return '<article class="position-card"><div class="position-main"><strong>' + esc(p.name || p.symbol) + ' · $' + esc(p.symbol) + '</strong><small>' + esc(chainLabel(p.chainId)) + ' · الدخول ' + esc(money(p.entryPrice)) + ' · الحالي ' + esc(money(current)) + '<br>قيمة المركز ' + esc(money(value)) + ' · الكمية ' + esc(Number(p.qty).toPrecision(6)) + esc(auto) + '</small></div><div class="position-right"><strong class="' + (pnl >= 0 ? 'positive' : 'negative') + '">' + esc(money(pnl)) + '</strong><small>' + esc(pct(num(p.entryPrice) ? ((current / num(p.entryPrice)) - 1) * 100 : 0)) + '</small><button class="btn btn-small btn-ghost" data-action="sell" data-id="' + esc(p.id) + '">إغلاق ورقي</button></div></article>';
    }).join('');
    updateSummary();
  }
  function renderWatchlist() {
    const host = $('watchlist-items');
    const rows = Array.from(watchlist).map((key) => currentToken(key)).filter(Boolean);
    $('watchlist-empty').classList.toggle('show', rows.length === 0);
    host.innerHTML = rows.map((p) => {
      const score = p._score || classify(p);
      const key = tokenKey(p.chainId, p._tokenAddress);
      return '<article class="watch-card"><div class="position-main"><strong>' + esc(p._tokenName || p._tokenSymbol) + ' · $' + esc(p._tokenSymbol) + '</strong><small>' + esc(chainLabel(p.chainId)) + ' · ' + esc(money(p.priceUsd)) + ' · ' + esc(riskLabels[score.risk] || score.risk) + '</small></div><div class="token-actions"><button class="mini-action" data-action="watch" data-key="' + esc(key) + '">★</button><button class="btn btn-small btn-ghost" data-action="buy" data-key="' + esc(key) + '" ' + (['DUMP_RISK', 'EXHAUSTION_RISK', 'LIQUIDITY_RISK'].includes(score.risk) || score.liquidity < Number(settings.minLiquidity) ? 'disabled' : '') + '>شراء ورقي</button></div></article>';
    }).join('');
  }
  function renderJournal() {
    const host = $('journal-items');
    $('journal-empty').classList.toggle('show', ledger.journal.length === 0);
    host.innerHTML = ledger.journal.map((x) => '<article class="journal-card"><div class="position-main"><strong>' + esc(x.type === 'BUY_PAPER' ? 'شراء ورقي' : 'بيع ورقي') + ' · ' + esc(x.tokenName || x.symbol) + ' · $' + esc(x.symbol) + '</strong><small>' + esc(chainLabel(x.chainId)) + ' · ' + esc(when(x.time)) + ' · ' + esc(money(x.price)) + ' للوحدة</small></div><div class="position-right"><strong class="' + (num(x.pnl) >= 0 ? 'positive' : 'negative') + '">' + (x.type === 'BUY_PAPER' ? '−' : '') + esc(money(x.type === 'BUY_PAPER' ? x.amount : x.pnl)) + '</strong><small>PAPER</small></div></article>').join('');
  }
  function renderAll() { renderTokens(); renderPortfolio(); renderWatchlist(); renderJournal(); updateSummary(); }
  function setView(view) {
    if (!['radar', 'portfolio', 'watchlist', 'journal', 'settings'].includes(view)) return;
    state.view = view;
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + view));
    document.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === view && el.classList.contains('nav-item')));
    if (view === 'portfolio') renderPortfolio();
    if (view === 'watchlist') renderWatchlist();
    if (view === 'journal') renderJournal();
    if (view === 'settings') loadSettingsForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function toggleWatch(key) {
    if (watchlist.has(key)) { watchlist.delete(key); toast('أزيل الأصل من قائمة المراقبة.'); }
    else { watchlist.add(key); toast('أضيف الأصل إلى قائمة المراقبة على هذا الهاتف.'); }
    saveJson(WATCH_KEY, Array.from(watchlist));
    renderTokens(); renderWatchlist();
  }
  function loadSettingsForm() {
    $('setting-capital').value = settings.capital;
    $('setting-order').value = settings.orderSize;
    $('setting-liquidity').value = settings.minLiquidity;
    $('setting-stop').value = settings.stopLoss;
    $('setting-take').value = settings.takeProfit;
    $('setting-slippage').value = settings.slippagePct;
    $('setting-fee').value = settings.feePct;
  }
  function saveSettings() {
    const next = {
      capital: Math.max(100, Math.min(10000000, num($('setting-capital').value))),
      orderSize: Math.max(5, Math.min(1000, num($('setting-order').value))),
      minLiquidity: Math.max(1000, Math.min(10000000, num($('setting-liquidity').value))),
      stopLoss: Math.max(1, Math.min(80, num($('setting-stop').value))),
      takeProfit: Math.max(5, Math.min(500, num($('setting-take').value))),
      slippagePct: Math.max(0, Math.min(10, num($('setting-slippage').value))),
      feePct: Math.max(0, Math.min(5, num($('setting-fee').value)))
    };
    settings = next;
    saveJson(SETTINGS_KEY, settings);
    state.tokens.forEach((p) => { p._score = classify(p); });
    renderAll();
    toast('حُفظت إعدادات المخاطرة والمحاكاة.');
  }
  function resetPaper() {
    if (!window.confirm('إعادة ضبط المحفظة الورقية والسجل بالكامل؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    ledger = { cash: num(settings.capital), positions: [], journal: [], realized: 0, createdAt: Date.now() };
    persistLedger(); renderAll();
    toast('أُعيد ضبط المحاكاة إلى ' + money(ledger.cash) + '.');
  }
  function exportJournal() {
    if (!ledger.journal.length) { toast('لا توجد عمليات للتصدير بعد.'); return; }
    const cols = ['time_utc', 'type', 'mode', 'symbol', 'token_name', 'chain', 'amount_usd', 'price_usd', 'realized_pnl_usd'];
    const csvEscape = (v) => '"' + String(v == null ? '' : v).replaceAll('"', '""') + '"';
    const rows = [cols.map(csvEscape).join(',')].concat(ledger.journal.map((x) => [
      new Date(x.time).toISOString(), x.type, x.mode, x.symbol, x.tokenName, x.chainId, x.amount, x.price, x.pnl
    ].map(csvEscape).join(',')));
    const blob = new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'midad-meme-trader-paper-journal.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  document.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) { setView(viewButton.dataset.view); return; }
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    if (actionButton.dataset.action === 'watch') { toggleWatch(actionButton.dataset.key); return; }
    if (actionButton.dataset.action === 'buy') { openTradeDialog(actionButton.dataset.key); return; }
    if (actionButton.dataset.action === 'sell') { sellPaper(actionButton.dataset.id); return; }
  });
  document.querySelectorAll('[data-risk]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-risk]').forEach((x) => x.classList.remove('active'));
    button.classList.add('active'); state.filter = button.dataset.risk; renderTokens();
  }));
  $('chain-filter').addEventListener('change', (e) => { state.chain = e.target.value; renderTokens(); });
  $('sort-filter').addEventListener('change', (e) => { state.sort = e.target.value; renderTokens(); });
  $('scan-btn').addEventListener('click', scanMarket);
  $('refresh-btn').addEventListener('click', scanMarket);
  $('trade-form').addEventListener('submit', confirmPaperBuy);
  $('close-trade').addEventListener('click', () => $('trade-dialog').close());
  $('save-settings').addEventListener('click', saveSettings);
  $('reset-paper').addEventListener('click', resetPaper);
  $('export-journal').addEventListener('click', exportJournal);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.tokens.length) {
      const now = Date.now();
      if (!state.lastScan || now - state.lastScan > 90000) scanMarket();
    }
  });
  loadSettingsForm();
  renderAll();
  setStatus('التطبيق مستقل عن Control Room. اضغط «امسح السوق الآن» لجلب أحدث بيانات DEX العامة.', '');
  // An automatic first scan helps the app behave like a native market terminal on launch.
  setTimeout(scanMarket, 500);
})();
