/* MIDAD MAXIMUM — resilient runtime + personalization layer */
(function () {
  "use strict";

  var STORAGE = "midad_visual_profile_v1";
  var DEFAULTS = {
    theme: "neural",
    font: "system",
    scale: 1.2,
    density: "normal",
    accent: "#5be7d9",
    accent2: "#9b8cff",
    glow: 70,
    motion: true,
    transparency: true,
    contrast: false,
    language: "auto",
    focus: false
  };
  var PROFILE = Object.assign({}, DEFAULTS, readProfile());
  var NATIVE_FETCH = window.fetch.bind(window);
  var REQUEST_TIMEOUT = 25000;

  function readProfile() {
    try {
      var raw = localStorage.getItem(STORAGE);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveProfile() {
    try { localStorage.setItem(STORAGE, JSON.stringify(PROFILE)); } catch (e) {}
  }
  function mergeProfile(next) {
    PROFILE = Object.assign({}, PROFILE, next || {});
    saveProfile();
    applyProfile();
  }
  function uid(prefix) {
    return (prefix || "midad") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function safeText(v) {
    return String(v == null ? "" : v);
  }
  function esc(v) {
    return safeText(v).replace(/[&<>"]/g, function (m) {
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[m];
    });
  }

  function extractError(payload, status) {
    if (!payload) return "HTTP " + status;
    if (typeof payload === "string") return payload;
    var e = payload.error;
    if (e && typeof e === "object") e = e.message || e.detail || e.code || JSON.stringify(e);
    return safeText(e || payload.message || payload.detail || payload.hint || payload.description || ("HTTP " + status));
  }

  /* Operational hardening: preserve the legacy action contract while adding
     the operation field expected by the backend contract. */
  window.fetch = function (input, init) {
    init = init || {};
    var method = String(init.method || "GET").toUpperCase();
    if (method !== "POST" || !init.body || typeof init.body !== "string") {
      return NATIVE_FETCH(input, init);
    }

    var parsed = null;
    try { parsed = JSON.parse(init.body); } catch (e) {}
    if (!parsed || typeof parsed !== "object") return NATIVE_FETCH(input, init);

    if (parsed.action && !parsed.operation) parsed.operation = parsed.action;
    if (parsed.operation && !parsed.action) parsed.action = parsed.operation;
    parsed.request_id = parsed.request_id || uid("req");
    parsed.client = "midad-control-room";
    parsed.client_version = (window.MIDAD_CONFIG && window.MIDAD_CONFIG.buildVersion) || "unknown";
    init.body = JSON.stringify(parsed);

    var headers = new Headers(init.headers || {});
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    headers.set("X-MIDAD-Request-ID", parsed.request_id);
    headers.set("X-MIDAD-Client", "control-room");
    init.headers = headers;

    var timer = null;
    var controller = new AbortController();
    var priorSignal = init.signal;
    if (priorSignal) {
      if (priorSignal.aborted) controller.abort();
      else priorSignal.addEventListener("abort", function () { controller.abort(); }, { once: true });
    }
    init.signal = controller.signal;
    timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT);

    return NATIVE_FETCH(input, init).then(function (response) {
      clearTimeout(timer);
      return response.clone().json().then(function (payload) {
        var explicitFailure = payload && (
          payload.ok === false ||
          payload.success === false ||
          payload.status === "error" ||
          payload.error
        );
        if (!response.ok || explicitFailure) {
          var message = extractError(payload, response.status);
          if (/field\s*to\s*fetch\s*:?\s*operation/i.test(message)) {
            message = "Backend contract rejected the request because 'operation' was missing. The UI now sends operation + action together; refresh once and retry.";
          }
          logRuntime("Backend: " + message, "err");
          var body = JSON.stringify({
            error: message,
            request_id: payload && payload.request_id || parsed.request_id,
            original_status: response.status,
            original: payload
          });
          return new Response(body, {
            status: response.ok ? 422 : response.status,
            headers: { "Content-Type": "application/json" }
          });
        }
        return response;
      }).catch(function () {
        return response;
      });
    }).catch(function (error) {
      clearTimeout(timer);
      var message = error && error.name === "AbortError"
        ? "Request timed out after " + (REQUEST_TIMEOUT / 1000) + "s."
        : (error && error.message) || "Network request failed.";
      logRuntime(message, "err");
      throw error;
    });
  };

  function logRuntime(message, type) {
    try {
      if (typeof window.__MIDAD_APPEND_LOG === "function") window.__MIDAD_APPEND_LOG(message, type);
      else console[type === "err" ? "error" : "info"]("[MIDAD]", message);
    } catch (e) {}
  }


  function applyRenderedTypography() {
    var scale = Math.max(0.95, Math.min(1.8, Number(PROFILE.scale || 1.2)));
    var roots = [];
    var appRoot = document.getElementById("app");
    var stylePanel = document.getElementById("midadAppearancePanel");
    if (appRoot) roots.push(appRoot);
    if (stylePanel) roots.push(stylePanel);
    roots.forEach(function(root){
      var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll("*")));
      /* Capture the original computed size before changing any descendant. */
      nodes.forEach(function(el){
        if (!el || !el.getAttribute) return;
        if (el.matches("script,style,svg,svg *,path,rect,circle,line,polyline,polygon")) return;
        if (!el.hasAttribute("data-midad-base-font")) {
          var size = parseFloat(window.getComputedStyle(el).fontSize || "0");
          if (size > 0 && isFinite(size)) el.setAttribute("data-midad-base-font", String(size));
        }
      });
      nodes.forEach(function(el){
        if (!el || !el.getAttribute) return;
        if (el.matches("script,style,svg,svg *,path,rect,circle,line,polyline,polygon")) return;
        var base = parseFloat(el.getAttribute("data-midad-base-font") || "0");
        if (!base || !isFinite(base)) return;
        var next = Math.max(12, base * scale);
        el.style.fontSize = next.toFixed(2) + "px";
      });
    });
  }

  var FONT_STACKS = {
    system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    inter: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
    arabic: '"IBM Plex Sans Arabic", "Noto Sans Arabic", Tahoma, Arial, sans-serif',
    tahoma: 'Tahoma, Arial, sans-serif',
    mono: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'
  };

  var THEMES = {
    neural: { name: "NEURAL", bg:"#05070c", panel:"#0b1019", panel2:"#0f1622", text:"#edf5ff", muted:"#8ea1ba", border:"#243246", accent:"#5be7d9", accent2:"#9b8cff" },
    obsidian: { name: "OBSIDIAN", bg:"#070707", panel:"#111111", panel2:"#171717", text:"#f3f3f3", muted:"#9a9a9a", border:"#2a2a2a", accent:"#f1f1f1", accent2:"#8f8f8f" },
    aurora: { name: "AURORA", bg:"#04100e", panel:"#081b18", panel2:"#0d2420", text:"#edfffb", muted:"#86b9ae", border:"#1d4c43", accent:"#48f2c9", accent2:"#7da7ff" },
    ember: { name: "EMBER", bg:"#100704", panel:"#1a0d08", panel2:"#22140d", text:"#fff4eb", muted:"#c5a18b", border:"#4a2a19", accent:"#ff9e52", accent2:"#ff5f7a" },
    ice: { name: "ICE", bg:"#06101b", panel:"#0b1927", panel2:"#112438", text:"#eff8ff", muted:"#8ca9bf", border:"#29445c", accent:"#7dd3ff", accent2:"#b6a7ff" },
    daylight: { name: "DAYLIGHT", bg:"#f4f7fb", panel:"#ffffff", panel2:"#eef3f8", text:"#132235", muted:"#63758a", border:"#d6e0ea", accent:"#1769e0", accent2:"#6a45d9" }
  };

  function cssVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }
  function applyProfile() {
    var theme = THEMES[PROFILE.theme] || THEMES.neural;
    document.body.setAttribute("data-midad-theme", PROFILE.theme);
    document.body.classList.toggle("midad-focus-mode", !!PROFILE.focus);
    document.body.classList.toggle("midad-no-motion", !PROFILE.motion);
    document.body.classList.toggle("midad-no-transparency", !PROFILE.transparency);
    document.body.classList.toggle("midad-high-contrast", !!PROFILE.contrast);
    document.documentElement.lang = PROFILE.language === "en" ? "en" : "ar";
    document.documentElement.dir = PROFILE.language === "en" ? "ltr" : "rtl";

    cssVar("--midad-bg", theme.bg);
    cssVar("--midad-panel", theme.panel);
    cssVar("--midad-panel-2", theme.panel2);
    cssVar("--midad-text", theme.text);
    cssVar("--midad-muted", theme.muted);
    cssVar("--midad-border", theme.border);
    cssVar("--midad-accent", PROFILE.accent || theme.accent);
    cssVar("--midad-accent-2", PROFILE.accent2 || theme.accent2);
    cssVar("--midad-font", FONT_STACKS[PROFILE.font] || FONT_STACKS.system);
    cssVar("--midad-text-scale", String(PROFILE.scale || 1.2));
    cssVar("--midad-glow", String(Math.max(0, Math.min(100, Number(PROFILE.glow || 0))) / 100));
    applyRenderedTypography();
    cssVar("--midad-density", PROFILE.density === "compact" ? "0.86" : PROFILE.density === "relaxed" ? "1.12" : "1");

    updateLanguageLabels();
    renderProfileState();
  }

  var ROUTE_LABELS = {
    dashboard:["الرئيسية","NEURAL INDEX","Command Center","NEURAL INDEX"],
    mission:["غرفة المهمة","MISSION","Mission Control","MISSION"],
    automation:["الأتمتة والمهام","TASK MATRIX","Automation & Tasks","TASK MATRIX"],
    trading:["التداول المحاكى","PAPER TERMINAL","Paper Terminal","PAPER TERMINAL"],
    clients:["العملاء ومساحات العمل","WORKSPACE HUB","Clients & Workspaces","WORKSPACE HUB"],
    terminal:["الطرفية والسجلات","LIVE TERMINAL","Terminal & Logs","LIVE TERMINAL"],
    opportunities:["الفرص","OPPORTUNITY INTELLIGENCE","Opportunities","OPPORTUNITY INTELLIGENCE"],
    revenue:["الإيرادات","REVENUE","Revenue","REVENUE"],
    capital:["رأس المال","CAPITAL","Capital","CAPITAL"],
    wallets:["المحافظ","WALLETS","Wallets","WALLETS"],
    mining:["التعدين","MINING","Mining","MINING"],
    intelligence:["الذكاء وOSINT","OSINT","Intelligence & OSINT","OSINT"],
    alerts:["التنبيهات","ALERT ENGINE","Alerts","ALERT ENGINE"],
    personal:["المساحة الشخصية","PRIVATE","Private Workspace","PRIVATE"],
    digital:["لوحة الحالة الرقمية","DIGITAL DASHBOARD","Digital Dashboard","DIGITAL DASHBOARD"],
    settings:["الإعدادات","CONTROL","Settings","CONTROL"],
    health:["صحة النظام","HEALTH","System Health","HEALTH"]
  };

  var CORE_TEXT = {
    "الرئيسية":"Home","لوحة الحالة الرقمية":"Digital Dashboard","غرفة المهمة":"Mission Control","الأتمتة والمهام":"Automation & Tasks",
    "التداول المحاكى":"Paper Trading","العملاء ومساحات العمل":"Clients & Workspaces",
    "الطرفية والسجلات":"Terminal & Logs","الفرص":"Opportunities","الإيرادات":"Revenue",
    "رأس المال":"Capital","المحافظ":"Wallets","التعدين":"Mining","الذكاء وOSINT":"Intelligence & OSINT",
    "التنبيهات":"Alerts","المساحة الشخصية":"Private Workspace","الإعدادات":"Settings","صحة النظام":"System Health",
    "⚡ Verify":"⚡ Verify","↻ Refresh":"↻ Refresh","↻ Probe":"↻ Probe","Save":"Save","Cancel":"Cancel",
    "Disconnect":"Disconnect","Connect / Verify":"Connect / Verify","＋ Income":"＋ Income",
    "＋ Add Wallet":"＋ Add Wallet","＋ Prospect":"＋ Prospect","＋ Paper Trade":"＋ Paper Trade",
    "⛏ Run Monitor":"⛏ Run Monitor","⌘ Terminal":"⌘ Terminal","Open approval center":"Open approval center",
    "Nothing needs you":"Nothing needs you","WHAT NEEDS ME?":"WHAT NEEDS ME?"
  };

  function translateExact(root, toEnglish) {
    if (!toEnglish) return;
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var value = node.nodeValue.trim();
      if (CORE_TEXT[value]) node.nodeValue = node.nodeValue.replace(value, CORE_TEXT[value]);
    });
  }

  function updateLanguageLabels() {
    var en = PROFILE.language === "en";
    document.querySelectorAll("[data-route]").forEach(function (el) {
      var id = el.getAttribute("data-route");
      var row = ROUTE_LABELS[id];
      if (!row) return;
      var name = el.querySelector(".nav-name");
      var meta = el.querySelector(".nav-meta");
      if (name) name.textContent = en ? row[2] : row[0];
      if (meta) meta.textContent = en ? row[3] : row[1];
      var mi = el.querySelector(".mi");
      if (mi) {
        var labelNode = Array.prototype.slice.call(el.childNodes).filter(function(n){ return n.nodeType === 3; })[0];
        if (labelNode) labelNode.nodeValue = en ? " " + row[2] : row[0];
      }
    });
    var crumb = document.querySelector(".crumb");
    if (crumb) {
      var id2 = (window.location.hash || "#dashboard").slice(1);
      var row2 = ROUTE_LABELS[id2] || ROUTE_LABELS.dashboard;
      var strong = crumb.querySelector("strong"), span = crumb.querySelector("span");
      if (strong) strong.textContent = en ? row2[2] : row2[0];
      if (span) span.textContent = en ? row2[3] : row2[1];
    }
    var cmd = document.querySelector("#cmdInput");
    if (cmd) cmd.placeholder = en ? "Search pages or commands…  Ctrl / Cmd + K" : "ابحث عن صفحة أو أمر…  Ctrl / Cmd + K";
    document.querySelectorAll(".brand-mini").forEach(function (x) { x.textContent = "MIDAD"; });
    if (en) translateExact(document.getElementById("app"), true);
  }

  function themePreview(themeKey) {
    var t = THEMES[themeKey];
    return '<button class="midad-theme-swatch ' + (PROFILE.theme === themeKey ? "selected" : "") + '" data-midad-set-theme="' + esc(themeKey) + '" title="' + esc(t.name) + '">' +
      '<span class="midad-swatch" style="background:' + t.bg + '"></span>' +
      '<span class="midad-swatch" style="background:' + t.accent + '"></span>' +
      '<b>' + esc(t.name) + '</b></button>';
  }

  function buildPanel() {
    if (document.getElementById("midadAppearancePanel")) return;

    var trigger = document.createElement("button");
    trigger.id = "midadAppearanceTrigger";
    trigger.className = "midad-appearance-trigger";
    trigger.setAttribute("aria-label", "Appearance Lab");
    trigger.innerHTML = "✦<span>STYLE</span>";
    trigger.onclick = function () {
      document.getElementById("midadAppearancePanel").classList.toggle("open");
    };
    document.body.appendChild(trigger);

    var panel = document.createElement("aside");
    panel.id = "midadAppearancePanel";
    panel.className = "midad-appearance-panel";
    panel.innerHTML =
      '<div class="midad-panel-head"><div><div class="midad-panel-kicker">MIDAD VISUAL SYSTEM</div><h3>Appearance Lab</h3><small>ثبّت الهوية البصرية للواجهة على هذا الجهاز.</small></div><button class="midad-panel-close" data-midad-close>×</button></div>' +
      '<div class="midad-panel-scroll">' +
        '<section class="midad-control-group"><div class="midad-control-title">THÈMES <span>THEMES</span></div><div class="midad-theme-grid">' + Object.keys(THEMES).map(themePreview).join("") + '</div></section>' +
        '<section class="midad-control-group"><div class="midad-control-title">TYPOGRAPHY <span>الخط والقياس</span></div><div class="midad-scale-hint">حجم النص يطبّق على صفحات النظام نفسها، وليس صفحة الإعدادات فقط.</div>' +
          '<div class="midad-control-row"><label>Font</label><select id="midadFont"><option value="system">System</option><option value="inter">Inter / UI</option><option value="arabic">Arabic Pro</option><option value="tahoma">Tahoma</option><option value="mono">Monospace</option></select></div>' +
          '<div class="midad-control-row"><label>Text size <output id="midadScaleOut">120%</output></label><input id="midadScale" type="range" min="100" max="180" step="5" value="120"></div><div class="midad-scale-presets"><button type="button" data-midad-scale-preset="120">Comfort</button><button type="button" data-midad-scale-preset="140">Large</button><button type="button" data-midad-scale-preset="160">XL</button><button type="button" data-midad-scale-preset="180">MAX</button></div>' +
          '<div class="midad-control-row"><label>Density <select id="midadDensity"><option value="compact">Compact</option><option value="normal">Normal</option><option value="relaxed">Relaxed</option></select></label></div>' +
        '</section>' +
        '<section class="midad-control-group"><div class="midad-control-title">COLOR ENGINE <span>الألوان</span></div>' +
          '<div class="midad-color-row"><label>Accent <input id="midadAccent" type="color"></label><label>Accent 2 <input id="midadAccent2" type="color"></label></div>' +
          '<div class="midad-control-row"><label>Glow <output id="midadGlowOut">70%</output></label><input id="midadGlow" type="range" min="0" max="100" step="1" value="70"></div>' +
        '</section>' +
        '<section class="midad-control-group"><div class="midad-control-title">BEHAVIOR <span>السلوك</span></div>' +
          '<div class="midad-toggle-row"><label><span>Motion</span><input id="midadMotion" type="checkbox"><i></i></label><label><span>Glass</span><input id="midadGlass" type="checkbox"><i></i></label></div>' +
          '<div class="midad-toggle-row"><label><span>High contrast</span><input id="midadContrast" type="checkbox"><i></i></label><label><span>Focus mode</span><input id="midadFocus" type="checkbox"><i></i></label></div>' +
        '</section>' +
        '<section class="midad-control-group"><div class="midad-control-title">LANGUAGE <span>اللغة</span></div>' +
          '<div class="midad-lang-grid"><button data-midad-lang="auto">AUTO</button><button data-midad-lang="ar">العربية</button><button data-midad-lang="en">ENGLISH</button></div>' +
        '</section>' +
        '<section class="midad-control-group"><div class="midad-control-title">RUNTIME DIAGNOSTICS <span>التشخيص</span></div>' +
          '<div class="midad-diagnostic" id="midadDiagnostic">Ready.</div>' +
          '<div class="midad-control-actions"><button class="midad-action-btn primary" data-midad-diagnose>Run self-check</button><button class="midad-action-btn" data-midad-reset>Reset visual profile</button></div>' +
        '</section>' +
      '</div>';

    document.body.appendChild(panel);
    bindPanel();
    renderProfileState();
  }

  function bindPanel() {
    var p = document.getElementById("midadAppearancePanel");
    if (!p) return;
    p.querySelector("[data-midad-close]").onclick = function () { p.classList.remove("open"); };
    p.querySelectorAll("[data-midad-set-theme]").forEach(function (b) {
      b.onclick = function () { mergeProfile({ theme: b.getAttribute("data-midad-set-theme") }); };
    });
    p.querySelector("#midadFont").onchange = function (e) { mergeProfile({ font: e.target.value }); };
    p.querySelector("#midadScale").oninput = function (e) { mergeProfile({ scale: Number(e.target.value) / 100 }); }; p.querySelectorAll("[data-midad-scale-preset]").forEach(function(b){ b.onclick=function(){ mergeProfile({ scale:Number(b.getAttribute("data-midad-scale-preset"))/100 }); }; });
    p.querySelector("#midadDensity").onchange = function (e) { mergeProfile({ density: e.target.value }); };
    p.querySelector("#midadAccent").oninput = function (e) { mergeProfile({ accent: e.target.value }); };
    p.querySelector("#midadAccent2").oninput = function (e) { mergeProfile({ accent2: e.target.value }); };
    p.querySelector("#midadGlow").oninput = function (e) { mergeProfile({ glow: Number(e.target.value) }); };
    p.querySelector("#midadMotion").onchange = function (e) { mergeProfile({ motion: e.target.checked }); };
    p.querySelector("#midadGlass").onchange = function (e) { mergeProfile({ transparency: e.target.checked }); };
    p.querySelector("#midadContrast").onchange = function (e) { mergeProfile({ contrast: e.target.checked }); };
    p.querySelector("#midadFocus").onchange = function (e) { mergeProfile({ focus: e.target.checked }); };
    p.querySelectorAll("[data-midad-lang]").forEach(function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-midad-lang");
        mergeProfile({ language: v });
      };
    });
    p.querySelector("[data-midad-reset]").onclick = function () {
      PROFILE = Object.assign({}, DEFAULTS);
      saveProfile();
      applyProfile();
      showDiagnostic("Visual profile reset.", true);
    };
    p.querySelector("[data-midad-diagnose]").onclick = runDiagnostic;
  }

  function renderProfileState() {
    var p = document.getElementById("midadAppearancePanel");
    if (!p) return;
    var font = p.querySelector("#midadFont"), scale = p.querySelector("#midadScale"), density = p.querySelector("#midadDensity");
    var accent = p.querySelector("#midadAccent"), accent2 = p.querySelector("#midadAccent2"), glow = p.querySelector("#midadGlow");
    if (font) font.value = PROFILE.font;
    if (scale) scale.value = Math.round((PROFILE.scale || 1.2) * 100);
    if (density) density.value = PROFILE.density;
    if (accent) accent.value = PROFILE.accent;
    if (accent2) accent2.value = PROFILE.accent2;
    if (glow) glow.value = PROFILE.glow;
    var scaleOut = p.querySelector("#midadScaleOut"), glowOut = p.querySelector("#midadGlowOut");
    if (scaleOut) scaleOut.textContent = Math.round((PROFILE.scale || 1) * 100) + "%";
    if (glowOut) glowOut.textContent = Math.round(PROFILE.glow) + "%";
    [["midadMotion",PROFILE.motion],["midadGlass",PROFILE.transparency],["midadContrast",PROFILE.contrast],["midadFocus",PROFILE.focus]].forEach(function (pair) {
      var x = p.querySelector("#" + pair[0]); if (x) x.checked = !!pair[1];
    });
    p.querySelectorAll("[data-midad-lang]").forEach(function (b) {
      b.classList.toggle("selected", b.getAttribute("data-midad-lang") === PROFILE.language);
    });
    p.querySelectorAll("[data-midad-set-theme]").forEach(function (b) {
      b.classList.toggle("selected", b.getAttribute("data-midad-set-theme") === PROFILE.theme);
    });
  }

  function showDiagnostic(message, good) {
    var d = document.getElementById("midadDiagnostic");
    if (d) {
      d.textContent = message;
      d.className = "midad-diagnostic " + (good ? "good" : "warn");
    }
  }

  async function runDiagnostic() {
    var checks = [];
    checks.push(!!window.MIDAD_CONFIG ? "config:OK" : "config:MISSING");
    checks.push(document.getElementById("app") ? "ui-root:OK" : "ui-root:MISSING");
    checks.push(window.fetch ? "fetch:OK" : "fetch:MISSING");
    try {
      localStorage.setItem("midad_diag_ping", "1");
      localStorage.removeItem("midad_diag_ping");
      checks.push("storage:OK");
    } catch (e) { checks.push("storage:BLOCKED"); }
    checks.push(window.Telegram && window.Telegram.WebApp ? "telegram:DETECTED" : "telegram:BROWSER");
    var url = window.MIDAD_CONFIG && window.MIDAD_CONFIG.supabaseUrl;
    var fn = window.MIDAD_CONFIG && window.MIDAD_CONFIG.controlRoomFunction;
    if (url && fn) {
      try {
        var input = JSON.stringify({
          operation: "dashboard",
          action: "dashboard",
          telegram_init_data: window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initData || "" : "",
          access_key: (document.querySelector("#accessKey") || {}).value || "",
          request_id: uid("diag"),
          client: "midad-control-room"
        });
        var res = await window.fetch(url + fn, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: input
        });
        checks.push("backend:" + res.status);
        if (!res.ok) {
          var body = await res.clone().json().catch(function(){return{};});
          checks.push("error:" + extractError(body, res.status));
        }
      } catch (e2) {
        checks.push("backend:" + (e2.message || "FAIL"));
      }
    } else {
      checks.push("backend:CONFIG_MISSING");
    }
    showDiagnostic(checks.join(" • "), !checks.some(function(x){return /MISSING|BLOCKED|backend:(4|5|[A-Z])/i.test(x);}));
  }

  function injectAppearanceCard() {
    if (!window.location.hash || window.location.hash.slice(1) !== "settings") return;
    var root = document.querySelector(".main .route.active");
    if (!root || root.querySelector("#midadAppearanceCard")) return;
    var card = document.createElement("section");
    card.id = "midadAppearanceCard";
    card.className = "card midad-inline-appearance";
    card.innerHTML =
      '<div class="card-head"><div><div class="eyebrow">VISUAL SYSTEM</div><div class="card-title">Appearance Lab</div></div><span class="pill blue">LOCAL PROFILE</span></div>' +
      '<p class="sub">الهوية البصرية، اللغة، المقاس، الكثافة، والألوان محفوظة محليًا ولا تتطلب تعديل الـ backend.</p>' +
      '<div class="midad-inline-actions"><button class="btn primary" data-midad-open-style>✦ Open Visual Controls</button><button class="btn" data-midad-diagnose-inline>◌ Diagnose Runtime</button></div>';
    root.appendChild(card);
    card.querySelector("[data-midad-open-style]").onclick = function () {
      document.getElementById("midadAppearancePanel").classList.add("open");
    };
    card.querySelector("[data-midad-diagnose-inline]").onclick = runDiagnostic;
  }

  function enhance() {
    buildPanel();
    applyProfile();
    injectAppearanceCard();
  }

  /*
   * IMPORTANT: Do not observe #app with a broad MutationObserver.
   * app-max.js re-renders the entire shell on many actions; combining that
   * with textContent updates here can create a mutation/render feedback loop
   * that freezes Telegram WebViews.
   */
  function boot() {
    enhance();
    window.addEventListener("hashchange", function () {
      setTimeout(function () {
        try {
          injectAppearanceCard();
          updateLanguageLabels();
          renderProfileState();
        } catch (e) {}
      }, 0);
    });
    window.__MIDAD_APPEND_LOG = function (message, type) {
      try {
        if (window.__MIDAD_LAST_RUNTIME_LOG === message) return;
        window.__MIDAD_LAST_RUNTIME_LOG = message;
        var body = document.getElementById("consoleBody");
        if (body) {
          var div = document.createElement("div");
          div.className = "log " + (type || "info");
          div.textContent = "[" + new Date().toLocaleTimeString("en-GB") + "] " + message;
          body.prepend(div);
        }
      } catch (e) {}
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();