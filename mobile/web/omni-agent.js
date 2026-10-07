(() => {
  "use strict";

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const CONFIG = {
    bridge: localStorage.getItem("midad.bridgeUrl") || ($("#bridge-url")?.value || ""),
    ai: localStorage.getItem("midad.aiUrl") || ($("#ai-url")?.value || "")
  };

  const state = {
    token: localStorage.getItem("midad.omni.token") || "",
    tasks: [],
    activeTask: null,
    webviewId: null,
    selectedFile: null,
    profile: readJson("midad.omni.profile", {}),
    recipes: readJson("midad.omni.recipes", []),
    contexts: readJson("midad.omni.contexts", []),
    proactive: localStorage.getItem("midad.omni.proactive") === "1",
    communications: readJson("midad.omni.communications", []),
    communications: readJson("midad.omni.communications", []),
    live: { socket: null, mediaStream: null, audioContext: null, processor: null, source: null, nextPlayTime: 0 }
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function nowLabel() {
    return new Date().toLocaleTimeString("ar");
  }

  function log(message, type = "info") {
    const host = $("#events");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "task";
    el.innerHTML = "<b>" + escapeHtml(message) + "</b><small>" +
      escapeHtml(nowLabel() + " · " + type) + "</small>";
    host.prepend(el);
  }

  const Plugins = () => window.Capacitor?.Plugins || {};
  const Browser = () => Plugins().InAppBrowser;
  const Notifications = () => Plugins().LocalNotifications;
  const Preferences = () => Plugins().Preferences;

  async function persist(key, value) {
    try {
      const p = Preferences();
      if (p?.set) {
        await p.set({ key, value: typeof value === "string" ? value : JSON.stringify(value) });
        return;
      }
    } catch {}
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch {}
  }

  async function request(url, body, headers = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || ("HTTP " + response.status));
    }
    return data;
  }

  async function bridge(action, payload = {}) {
    if (!state.token) throw new Error("الهاتف غير مقترن بـMIDAD");
    return request(
      CONFIG.bridge,
      { action, ...payload },
      { "x-midad-bridge-token": state.token }
    );
  }

  async function ai(action, payload = {}) {
    if (!state.token) throw new Error("الهاتف غير مقترن بـMIDAD");
    return request(
      CONFIG.ai,
      { action, ...payload },
      { "x-midad-bridge-token": state.token }
    );
  }

  function updatePairState() {
    const badge = $("#pair-state");
    if (!badge) return;
    badge.textContent = state.token ? "MIDAD CONNECTED" : "غير مقترن";
    badge.className = "pill " + (state.token ? "ok" : "warn");
  }

  function switchView(id) {
    $$(".view").forEach((node) => node.classList.toggle("active", node.id === id));
    $$(".bottom-nav button").forEach((node) =>
      node.classList.toggle("active", node.dataset.view === id)
    );
  }

  function ensureAttentionBar() {
    let bar = $("#midad-attention");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "midad-attention";
    bar.className = "attention hidden";
    bar.innerHTML =
      '<div class="attention-icon">!</div>' +
      '<div><b id="midad-attention-title">تدخل بشري مطلوب</b>' +
      '<span id="midad-attention-sub">MIDAD متوقف بانتظار تدخلك.</span></div>' +
      '<button id="midad-attention-open" class="primary">استدعاء</button>';
    document.body.appendChild(bar);
    $("#midad-attention-open").onclick = () => {
      if (!state.activeTask) return;
      showHumanGate(state.activeTask);
      openHumanPage(state.activeTask);
    };
    return bar;
  }

  function gateExplanation(task) {
    const text = [
      task?.title,
      task?.type,
      task?.reason,
      task?.instruction
    ].join(" ").toLowerCase();

    if (/captcha|robot|verify you are human|cloudflare/.test(text)) {
      return "CAPTCHA / Human Check: أكمل التحقق بنفسك داخل الصفحة الرسمية. MIDAD لا يحاول تجاوزه.";
    }
    if (/kyc|identity verification|passport|government id|driver.?s license/.test(text)) {
      return "KYC / Identity: أكمل متطلبات التحقق الرسمية داخل الصفحة. MIDAD لا يتجاوز متطلبات الهوية.";
    }
    if (/otp|2fa|one[- ]time|verification code|security code/.test(text)) {
      return "2FA / OTP: أدخل الرمز بنفسك داخل الصفحة الرسمية، ولا ترسل الرمز إلى MIDAD.";
    }
    if (/signature|sign|approve transaction/.test(text)) {
      return "Signature: راجع الطلب في المحفظة أو المنصة الرسمية ثم نفّذ التوقيع بنفسك فقط عندما تكون موافقًا.";
    }
    if (/seed|private key|recovery phrase/.test(text)) {
      return "Security Stop: MIDAD لا يطلب Seed Phrase أو Private Key. لا تضعهما داخل التطبيق.";
    }
    return "تدخل بشري مطلوب. تم حفظ حالة المهمة وسيستأنف MIDAD بعد التأكيد.";
  }

  function ensureHumanGateModal() {
    let modal = $("#midad-human-gate");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "midad-human-gate";
    modal.className = "intervention-backdrop hidden";
    modal.innerHTML =
      '<div class="intervention-card">' +
      '<div class="intervention-top"><div class="gate-icon">!</div>' +
      '<button id="gate-close" class="icon-btn">×</button></div>' +
      '<div class="eyebrow">MIDAD HUMAN INTERVENTION</div>' +
      '<h2 id="gate-title">تدخل مطلوب</h2>' +
      '<p id="gate-desc">توقف الوكيل مؤقتًا وحُفظت حالة المهمة.</p>' +
      '<div id="gate-info" class="gate-box"></div>' +
      '<div class="intervention-actions">' +
      '<button id="gate-open" class="primary">فتح الصفحة داخل MIDAD</button>' +
      '<button id="gate-done" class="secondary">أتممت المطلوب</button>' +
      '</div><small class="muted">بعد التأكيد، تستأنف المهمة من الحالة المحفوظة.</small>' +
      '</div>';

    document.body.appendChild(modal);
    $("#gate-close").onclick = () => modal.classList.add("hidden");
    $("#gate-open").onclick = () => openHumanPage();
    $("#gate-done").onclick = completeHumanTask;
    return modal;
  }

  function showHumanGate(task) {
    const modal = ensureHumanGateModal();
    state.activeTask = task;
    $("#gate-title").textContent = task?.title || "تدخل مطلوب";
    $("#gate-desc").textContent = task?.instruction || task?.reason || "توقف الوكيل مؤقتًا.";
    $("#gate-info").textContent = gateExplanation(task);
    modal.classList.remove("hidden");

    const bar = ensureAttentionBar();
    $("#midad-attention-title").textContent = task?.title || "تدخل بشري مطلوب";
    $("#midad-attention-sub").textContent = gateExplanation(task);
    bar.classList.remove("hidden");
    log("Human Gate: " + (task?.title || "task"), "human-gate");
  }

  async function notifyHuman(task) {
    try {
      const n = Notifications();
      if (!n?.schedule) return;
      const permission = await n.checkPermissions?.();
      if (permission?.display === "denied") return;
      if (permission && permission.display !== "granted") {
        await n.requestPermissions?.();
      }
      await n.schedule({
        notifications: [{
          id: Math.floor(Date.now() / 1000) % 2147483647,
          title: "MIDAD — تدخل مطلوب",
          body: task?.title || "مهمة بشرية",
          schedule: { at: new Date(Date.now() + 500) }
        }]
      });
    } catch {}
  }

  async function openHumanPage(task = state.activeTask) {
    const url = task?.action_url;
    if (!url) {
      log("لا يوجد رابط رسمي مرتبط بهذه المهمة.", "browser");
      return;
    }
    if (!/^https:\/\//i.test(url)) {
      log("تم رفض رابط غير HTTPS.", "safety");
      return;
    }

    try {
      const b = Browser();
      if (b?.openWebView) {
        if (state.webviewId && b.bringToFront) {
          try {
            await b.bringToFront({ id: state.webviewId });
            return;
          } catch {}
        }
        const result = await b.openWebView({
          url,
          title: "MIDAD · Human Intervention",
          toolbarType: "navigation",
          persistWebViewData: true,
          allowScreenshotsFromWebPage: false
        });
        state.webviewId = result.id;
        window.__midadWebId = result.id;
        log("تم استدعاء الصفحة داخل MIDAD.", "browser");
        return;
      }
      const browserPlugin = Plugins().Browser;
      if (browserPlugin?.open) await browserPlugin.open({ url });
    } catch (error) {
      log("فشل فتح الصفحة: " + error.message, "error");
    }
  }

  async function completeHumanTask() {
    const task = state.activeTask;
    if (!task) return;
    try {
      await bridge("complete_task", {
        task_id: task.id,
        response_data: {
          completed_from: "midad-omni-agent-v0.3",
          human_confirmed: true,
          webview_id: state.webviewId || null
        }
      });
      log("تم تأكيد التدخل واستُؤنفت المهمة.", "resume");
      $("#midad-human-gate")?.classList.add("hidden");
      $("#midad-attention")?.classList.add("hidden");
      const b = Browser();
      if (b?.close && state.webviewId) {
        try { await b.close({ id: state.webviewId }); } catch {}
      }
      state.activeTask = null;
      state.webviewId = null;
      window.__midadWebId = null;
      await refreshMissions();
    } catch (error) {
      log("تعذر استئناف المهمة: " + error.message, "error");
    }
  }

  function renderTasks() {
    const host = $("#tasks");
    if (!host) return;
    $("#task-count").textContent = String(state.tasks.length);
    host.innerHTML = state.tasks.length
      ? state.tasks.map((task) =>
          '<div class="task">' +
          "<b>" + escapeHtml(task.title || "MIDAD Task") + "</b>" +
          "<small>" + escapeHtml((task.status || "OPEN") + " · " + (task.risk_class || "medium")) + "</small>" +
          "<p>" + escapeHtml(task.instruction || task.reason || "") + "</p>" +
          '<div class="task-actions">' +
          (task.action_url ? '<button class="secondary" data-open-task="' + escapeHtml(task.id) + '">فتح</button>' : "") +
          '<button class="primary" data-gate-task="' + escapeHtml(task.id) + '">تدخل</button>' +
          "</div></div>"
        ).join("")
      : '<div class="muted">لا توجد مهام بشرية معلقة.</div>';

    $$("[data-open-task]").forEach((button) => {
      button.onclick = () => {
        const task = state.tasks.find((x) => x.id === button.dataset.openTask);
        if (task) {
          showHumanGate(task);
          openHumanPage(task);
        }
      };
    });

    $$("[data-gate-task]").forEach((button) => {
      button.onclick = () => {
        const task = state.tasks.find((x) => x.id === button.dataset.gateTask);
        if (task) showHumanGate(task);
      };
    });
  }

  async function refreshMissions() {
    if (!state.token) return;
    try {
      const data = await bridge("list_tasks", { limit: 40 });
      const previous = new Set(state.tasks.map((x) => x.id));
      state.tasks = data.tasks || [];
      renderTasks();

      const fresh = state.tasks.find((x) => !previous.has(x.id));
      if (fresh) {
        showHumanGate(fresh);
        await notifyHuman(fresh);
        if (fresh.action_url) {
          await openHumanPage(fresh);
        }
      }

      const jobs = await bridge("list_browser_jobs", { limit: 25 });
      const host = $("#jobs");
      if (host) {
        host.innerHTML = (jobs.jobs || []).map((job) =>
          '<div class="job"><b>' + escapeHtml(job.objective || job.platform_key || job.id) +
          "</b><small>" + escapeHtml(job.state || "") + " · " + escapeHtml(job.current_url || "") +
          "</small><div>" + escapeHtml(job.blocker || job.next_action || "") + "</div></div>"
        ).join("") || '<div class="muted">لا توجد Browser Jobs.</div>';
      }
    } catch (error) {
      const host = $("#tasks");
      if (host && state.token) host.innerHTML = '<div class="task error">' + escapeHtml(error.message) + "</div>";
    }
  }

  function installProactiveBar() {
    const host = $("#agent-prompt")?.parentElement;
    if (!host || $("#midad-proactive-bar")) return;

    const bar = document.createElement("div");
    bar.id = "midad-proactive-bar";
    bar.style.cssText = "display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;";
    bar.innerHTML =
      '<button id="proactive-toggle" class="secondary" type="button"></button>' +
      '<button id="context-add" class="secondary" type="button">🧭 Context</button>' +
      '<button id="evidence-capture" class="secondary" type="button">◉ Evidence</button>';
    host.appendChild(bar);

    function updateProactive() {
      $("#proactive-toggle").textContent =
        state.proactive ? "⚡ مبادرة ذكية: ON" : "⚡ مبادرة ذكية: OFF";
    }

    $("#proactive-toggle").onclick = () => {
      state.proactive = !state.proactive;
      localStorage.setItem("midad.omni.proactive", state.proactive ? "1" : "0");
      updateProactive();
      log(state.proactive ? "تم تفعيل المبادرة الذكية." : "تم إيقاف المبادرة الذكية.", "operator");
    };

    $("#context-add").onclick = () => {
      const name = prompt("اسم المنصة / السياق:");
      if (!name) return;
      const value = name.trim();
      if (!value) return;
      if (!state.contexts.includes(value)) state.contexts.push(value);
      writeJson("midad.omni.contexts", state.contexts);
      renderContexts();
      log("تم حفظ Context: " + value, "context");
    };

    $("#evidence-capture").onclick = async () => {
      const b = Browser();
      const id = window.__midadWebId || state.webviewId;
      if (!id || !b?.takeScreenshot) {
        log("Evidence يحتاج WebView نشطة داخل MIDAD.", "evidence");
        return;
      }
      try {
        const result = await b.takeScreenshot({ id });
        window.__midadLastEvidence = result?.data || result?.path || true;
        log("تم التقاط Evidence من المتصفح.", "evidence");
      } catch (error) {
        log("فشل التقاط Evidence: " + error.message, "error");
      }
    };

    updateProactive();
  }

  function renderContexts() {
    const host = $("#contexts");
    if (!host) return;
    const base = ["Freelance", "Crypto", "Social", "Marketplace", "Business"];
    const all = [...new Set(base.concat(state.contexts))];
    host.innerHTML = all.map((item) => "<span>" + escapeHtml(item) + "</span>").join("");
  }

  function installSafeAutofill() {
    const panel = $("#browser .panel");
    if (!panel || $("#midad-safe-fill")) return;

    const button = document.createElement("button");
    button.id = "midad-safe-fill";
    button.className = "secondary";
    button.type = "button";
    button.textContent = "ملء آمن";
    button.style.marginTop = "9px";
    panel.appendChild(button);

    button.onclick = async () => {
      const id = window.__midadWebId || state.webviewId;
      const b = Browser();
      if (!id || !b?.executeScript) {
        log("افتح صفحة داخل MIDAD أولًا.", "autofill");
        return;
      }

      const profile = readJson("midad.omni.profile", state.profile);
      const safeData = {
        fullName: profile.name || "",
        role: profile.role || "",
        bio: profile.bio || "",
        skills: profile.skills || ""
      };

      const code =
        "(() => {" +
        "const d=" + JSON.stringify(safeData) + ";" +
        "const nodes=[...document.querySelectorAll('input,textarea')];" +
        "const pick=(keys)=>nodes.find(x=>keys.some(k=>((x.name||'')+' '+(x.id||'')+' '+(x.placeholder||'')).toLowerCase().includes(k))&&x.type!=='password'&&x.type!=='hidden'&&x.autocomplete!=='one-time-code');" +
        "const q=[[" +
        "pick(['full name','fullname','name','الاسم']),d.fullName],[" +
        "pick(['role','job title','title','position','الدور']),d.role],[" +
        "pick(['bio','about','description','نبذة']),d.bio],[" +
        "pick(['skills','expertise','مهارات']),d.skills]];" +
        "let changed=0;" +
        "q.forEach(([el,val])=>{if(!el||!val)return;el.focus();el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));changed++});" +
        "window.mobileApp?.postMessage({detail:{message:'midadSafeFill',changed}});" +
        "})();";

      try {
        await b.executeScript({ id, code });
        log("Safe Autofill: تم ملء البيانات العامة فقط دون إرسال النموذج.", "autofill");
      } catch (error) {
        log("Safe Autofill error: " + error.message, "error");
      }
    };
  }

  function installSmartInspector() {
    const button = $("#inspect-browser");
    if (!button || button.dataset.midadUpgraded) return;
    button.dataset.midadUpgraded = "1";

    button.onclick = async () => {
      const b = Browser();
      const id = window.__midadWebId || state.webviewId;
      if (!id || !b?.executeScript) {
        log("افتح صفحة داخل MIDAD أولًا.", "inspect");
        return;
      }

      const code =
        "(() => {" +
        "const text=(document.body?.innerText||'').slice(0,14000).toLowerCase();" +
        "const inputs=[...document.querySelectorAll('input,textarea,select')].slice(0,120).map(x=>({type:x.type||'',name:x.name||'',id:x.id||'',placeholder:x.placeholder||'',autocomplete:x.autocomplete||''}));" +
        "const flags={" +
        "captcha:/captcha|verify you are human|robot|cloudflare/.test(text)," +
        "kyc:/kyc|identity verification|passport|government id|driver.?s license/.test(text)," +
        "twofa:/otp|one[- ]time|verification code|security code/.test(text)," +
        "password:inputs.some(x=>x.type==='password')," +
        "payment:/card number|bank account|routing number/.test(text)};" +
        "window.mobileApp?.postMessage({detail:{message:'midadPageReport',report:{url:location.href,title:document.title,inputCount:inputs.length,flags}}});" +
        "})();";

      try {
        await b.executeScript({ id, code });
        log("Smart Inspector: أرسل تقرير الصفحة.", "inspect");
      } catch (error) {
        log("Inspector error: " + error.message, "error");
      }
    };
  }

  function installMessageBus() {
    const b = Browser();
    if (!b?.addListener || window.__midadOmniMessageBus) return;
    window.__midadOmniMessageBus = true;

    b.addListener("messageFromWebview", (event) => {
      const detail = event?.detail || {};
      if (detail.message === "midadPageReport") {
        const flags = Object.entries(detail.report?.flags || {})
          .filter(([, value]) => Boolean(value))
          .map(([key]) => key);

        log(
          flags.length
            ? "Inspector → حاجز ظاهر: " + flags.join(", ")
            : "Inspector → لا يوجد حاجز ظاهر.",
          "inspect"
        );
      }

      if (detail.message === "midadSafeFill") {
        log("Safe Autofill → تم تغيير " + (detail.changed || 0) + " حقول آمنة.", "autofill");
      }
    });

    b.addListener("urlChangeEvent", (event) => {
      log("Browser URL → " + (event?.url || ""), "browser");
    });

    b.addListener("closeEvent", () => {
      window.__midadWebId = null;
      state.webviewId = null;
      log("تم إغلاق صفحة المتصفح؛ حالة المهمة محفوظة.", "resume");
    });
  }

  function patchWebViewIdCapture() {
    const b = Browser();
    if (!b?.openWebView || window.__midadOpenWrapped) return;
    window.__midadOpenWrapped = true;

    const original = b.openWebView.bind(b);
    b.openWebView = async (options) => {
      const result = await original(options);
      state.webviewId = result?.id || null;
      window.__midadWebId = result?.id || null;
      return result;
    };
  }


  const COMM_LANG_NAMES = {
    ar:"العربية", en:"English", fa:"فارسی", fr:"Français", de:"Deutsch", es:"Español",
    tr:"Türkçe", hi:"हिन्दी", ur:"اردو", "zh-Hans":"中文", ja:"日本語", ko:"한국어"
  };

  function commLangName(code) {
    return COMM_LANG_NAMES[code] || code || "—";
  }

  function renderCommunicationHistory() {
    const host = $("#comm-history");
    if (!host) return;
    host.innerHTML = state.communications.slice(0,20).map((x) =>
      '<div class="history-item"><b>' + escapeHtml((x.channel || "communication") + " · " + (x.target_language || "en")) +
      '</b><small>' + escapeHtml(new Date(x.at || Date.now()).toLocaleString("ar")) + '</small>' +
      '<div class="comm-text">' + escapeHtml(x.reply || "") + '</div></div>'
    ).join("") || '<div class="muted">لا توجد محادثات محفوظة.</div>';
  }

  function setCommStatus(text, kind = "ok") {
    const el = $("#comm-status");
    if (!el) return;
    el.textContent = text;
    el.className = "comm-status";
    if (kind === "warn") el.style.color = "#f1d37e";
    else if (kind === "error") el.style.color = "#ff9d9d";
    else el.style.color = "#8df0c9";
  }

  async function runCommunicationAgent() {
    const message = $("#comm-input")?.value?.trim() || "";
    if (!message) {
      setCommStatus("أدخل رسالة أولًا", "warn");
      return;
    }
    const payload = {
      prompt: message,
      source_language: $("#comm-source-lang")?.value || "auto",
      target_language: $("#comm-target-lang")?.value || "en",
      channel: $("#comm-channel")?.value || "customer_support",
      agent_role: $("#comm-role")?.value || "support",
      tone: $("#comm-tone")?.value || "professional_warm",
      mode: $("#comm-mode")?.value || "reply_translate",
      profile: state.profile,
      context: state.contexts.slice(0,20)
    };
    try {
      setCommStatus("MIDAD يحلل ويصيغ…");
      log("Communication Agent: تحليل الرسالة وصياغة الرد.", "communication");
      const result = await ai("communication", payload);
      const data = result.result || result.communication || result;
      const reply = data.reply_target || data.reply || result.output_text || "";
      const arabic = data.reply_arabic || data.internal_arabic_summary || data.translation_arabic || "";
      const internal = data.internal_arabic_summary || data.intent || "";
      const confidence = data.confidence ?? "—";
      $("#comm-reply").textContent = reply || "لم يتم توليد رد.";
      $("#comm-arabic").textContent = arabic || "—";
      $("#comm-internal").textContent = internal || "—";
      $("#comm-confidence").textContent = typeof confidence === "number" ? Math.round(confidence*100) + "%" : String(confidence);
      $("#comm-target-label").textContent = commLangName(payload.target_language);
      state.communications.unshift({
        at: new Date().toISOString(), channel: payload.channel, target_language: payload.target_language,
        incoming: message, reply, arabic, internal, confidence
      });
      state.communications = state.communications.slice(0,20);
      writeJson("midad.omni.communications", state.communications);
      renderCommunicationHistory();
      setCommStatus("تمت الصياغة — جاهز للمراجعة");
      log("Communication Agent: الرد جاهز، ولم يتم إرساله تلقائيًا.", "communication");
    } catch (error) {
      setCommStatus("فشل التنفيذ", "error");
      log(error.message, "error");
    }
  }

  function speakCommunicationReply() {
    const text = $("#comm-reply")?.textContent?.trim() || "";
    if (!text || text === "—") {
      log("لا يوجد رد جاهز للنطق.", "voice");
      return;
    }
    if (!("speechSynthesis" in window)) {
      log("تحويل النص إلى صوت غير متاح في WebView الحالية.", "voice");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const lang = $("#comm-target-lang")?.value || "en";
    u.lang = lang === "zh-Hans" ? "zh-CN" : lang === "fa" ? "fa-IR" : lang === "ar" ? "ar-SA" : lang;
    u.rate = 0.98;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
    log("تم تشغيل نطق الرد باللغة " + commLangName(lang) + ".", "voice");
  }

  async function copyCommunicationReply() {
    const text = $("#comm-reply")?.textContent?.trim() || "";
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
      log("تم نسخ الرد الجاهز.", "clipboard");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      log("تم نسخ الرد الجاهز.", "clipboard");
    }
  }

  function decodeBase64Pcm16(b64) {
    const bin = atob(b64);
    const out = new Int16Array(bin.length / 2);
    for (let i=0;i<out.length;i++) out[i] = (bin.charCodeAt(i*2) | (bin.charCodeAt(i*2+1)<<8));
    return out;
  }

  function playLivePcm(b64) {
    const ctx = state.live.audioContext;
    if (!ctx) return;
    const pcm = decodeBase64Pcm16(b64);
    const buf = ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i=0;i<pcm.length;i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const start = Math.max(ctx.currentTime + 0.01, state.live.nextPlayTime || 0);
    src.start(start);
    state.live.nextPlayTime = start + buf.duration;
  }

  function floatToPcm16(input) {
    const out = new Int16Array(input.length);
    for (let i=0;i<input.length;i++) {
      const v = Math.max(-1, Math.min(1, input[i]));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return new Uint8Array(out.buffer);
  }

  function toBase64(bytes) {
    let s = "";
    const chunk = 0x8000;
    for (let i=0;i<bytes.length;i+=chunk) s += String.fromCharCode(...bytes.subarray(i, Math.min(i+chunk, bytes.length)));
    return btoa(s);
  }

  async function stopLiveInterpreter() {
    try { state.live.processor?.disconnect?.(); } catch {}
    try { state.live.source?.disconnect?.(); } catch {}
    try { state.live.mediaStream?.getTracks?.().forEach(t => t.stop()); } catch {}
    try { await state.live.audioContext?.close?.(); } catch {}
    try { state.live.socket?.close?.(); } catch {}
    state.live.socket = null;
    state.live.mediaStream = null;
    state.live.processor = null;
    state.live.source = null;
    state.live.audioContext = null;
    state.live.nextPlayTime = 0;
    if ($("#live-state")) {
      $("#live-state").textContent = "متوقف";
      $("#live-state").className = "pill warn";
    }
    log("تم إيقاف Live Interpreter.", "voice");
  }

  async function startLiveInterpreter() {
    if (state.live.socket) { await stopLiveInterpreter(); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      log("الميكروفون غير متاح في WebView الحالية.", "voice");
      return;
    }
    const target = $("#comm-target-lang")?.value || "en";
    try {
      setCommStatus("تهيئة الترجمة المباشرة…");
      const tokenResult = await ai("live_token", { target_language: target });
      const token = tokenResult.token || tokenResult.name || tokenResult.token_name;
      if (!token) throw new Error("لم يتم الحصول على Live token.");
      const ws = new WebSocket(
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=" +
        encodeURIComponent(token)
      );
      state.live.socket = ws;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true }});
      state.live.mediaStream = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      state.live.audioContext = ctx;
      state.live.nextPlayTime = ctx.currentTime;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          setup: {
            model: "models/gemini-3.5-live-translate-preview",
            generationConfig: {
              responseModalities: ["AUDIO"],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              translationConfig: { targetLanguageCode: target, echoTargetLanguage: true }
            }
          }
        }));
        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const pcm = floatToPcm16(event.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({
            realtimeInput: {
              audio: { data: toBase64(pcm), mimeType: "audio/pcm;rate=" + String(ctx.sampleRate) }
            }
          }));
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        state.live.source = source;
        state.live.processor = processor;
        if ($("#live-state")) {
          $("#live-state").textContent = "يستمع";
          $("#live-state").className = "pill ok";
        }
        setCommStatus("Live Interpreter يعمل");
        log("Live Interpreter: بدأ الاستماع والترجمة إلى " + commLangName(target) + ".", "voice");
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const c = msg.serverContent;
          if (c?.inputTranscription?.text) $("#live-input-transcript").textContent = c.inputTranscription.text;
          if (c?.outputTranscription?.text) {
            $("#live-output-transcript").textContent = c.outputTranscription.text;
            $("#comm-input").value = c.inputTranscription?.text || $("#comm-input").value;
          }
          for (const part of (c?.modelTurn?.parts || [])) {
            if (part.inlineData?.data) playLivePcm(part.inlineData.data);
          }
        } catch (e) { log("Live message parse error: " + e.message, "error"); }
      };
      ws.onerror = () => log("Live Interpreter WebSocket error.", "error");
      ws.onclose = () => {
        if (state.live.socket === ws) stopLiveInterpreter();
      };
    } catch (error) {
      await stopLiveInterpreter();
      setCommStatus("تعذر تشغيل Live Interpreter", "error");
      log(error.message, "error");
    }
  }

  function installCommunication() {
    $("#comm-compose")?.addEventListener("click", runCommunicationAgent);
    $("#comm-speak")?.addEventListener("click", speakCommunicationReply);
    $("#comm-copy")?.addEventListener("click", copyCommunicationReply);
    $("#comm-live")?.addEventListener("click", startLiveInterpreter);
    $("#live-stop")?.addEventListener("click", stopLiveInterpreter);
    $("#comm-clear-history")?.addEventListener("click", () => {
      state.communications = [];
      writeJson("midad.omni.communications", state.communications);
      renderCommunicationHistory();
      log("تم مسح Communication Memory المحلية.", "communication");
    });
  }

  function installButtons() {
    $("#settings-btn")?.addEventListener("click", () => switchView("settings"));
    $$(".bottom-nav button").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });

    $("#run-agent")?.addEventListener("click", async () => {
      const field = $("#agent-prompt");
      const original = field?.value?.trim() || "";
      if (!original) return;
      const proactive = state.proactive
        ? "[PROACTIVE OPERATOR MODE: take the next safe step automatically, surface Human Gates immediately, preserve task state, and never bypass policy]\\n"
        : "";
      try {
        log("MIDAD يبدأ Hybrid Mission planning…", "agent");
        const result = await ai("plan", {
          prompt: proactive + original,
          execute: true,
          context: {
            app: "midad-omni-agent",
            profile: state.profile,
            contexts: state.contexts,
            mode: state.proactive ? "proactive" : "standard"
          }
        });
        if ($("#recipe-output")) {
          $("#recipe-output").textContent = JSON.stringify(result.plan || result, null, 2);
        }
        log("تم إرسال المهمة إلى MIDAD Agent Fabric.", "agent");
        switchView("missions");
        await refreshMissions();
      } catch (error) {
        log(error.message, "error");
      }
    });

    $("#plan-agent")?.addEventListener("click", async () => {
      const field = $("#agent-prompt");
      const original = field?.value?.trim() || "";
      if (!original) return;
      try {
        const result = await ai("plan", {
          prompt: original,
          execute: false,
          context: { app: "midad-omni-agent", profile: state.profile, contexts: state.contexts }
        });
        if ($("#recipe-output")) {
          $("#recipe-output").textContent = JSON.stringify(result.plan || result, null, 2);
        }
        log("تم توليد الخطة دون تنفيذ.", "agent");
      } catch (error) {
        log(error.message, "error");
      }
    });

    $("#voice-btn")?.addEventListener("click", () => {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        log("الإدخال الصوتي غير مدعوم في WebView الحالية.", "voice");
        return;
      }
      const recognition = new Recognition();
      recognition.lang = "ar-SA";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        $("#agent-prompt").value = event.results[0][0].transcript;
        log("تم تحويل الصوت إلى أمر بشري.", "voice");
      };
      recognition.onerror = (event) => log("Voice error: " + event.error, "error");
      recognition.start();
    });

    $("#comm-compose")?.addEventListener("click", runCommunicationAgent);
    $("#comm-speak")?.addEventListener("click", speakCommunicationReply);
    $("#comm-copy")?.addEventListener("click", copyCommunicationReply);
    $("#comm-live")?.addEventListener("click", startLiveInterpreter);
    $("#live-stop")?.addEventListener("click", stopLiveInterpreter);
    $("#comm-clear-history")?.addEventListener("click", () => {
      state.communications = [];
      writeJson("midad.omni.communications", state.communications);
      renderCommunicationHistory();
      log("تم مسح Communication Memory المحلية.", "communication");
    });

    $("#comm-compose")?.addEventListener("click", runCommunicationAgent);
    $("#comm-speak")?.addEventListener("click", speakCommunicationReply);
    $("#comm-copy")?.addEventListener("click", copyCommunicationReply);
    $("#comm-clear-history")?.addEventListener("click",()=>{state.communications=[];writeJson("midad.omni.communications",state.communications);renderCommunicationHistory();});
    $("#comm-live")?.addEventListener("click",()=>log("Live Interpreter سيستخدم جلسة الصوت المباشر الآمنة بعد تفعيل Live token على Gateway.","voice"));
    $("#live-stop")?.addEventListener("click",()=>log("لا توجد جلسة Live فعالة.","voice"));
    $("#refresh-tasks")?.addEventListener("click", refreshMissions);
    $("#refresh-jobs")?.addEventListener("click", refreshMissions);

    $("#open-browser")?.addEventListener("click", () => {
      openHumanPage({
        title: "Browser Task",
        type: "BROWSER",
        instruction: "صفحة طلبها المستخدم.",
        action_url: $("#browser-url")?.value?.trim()
      });
    });

    $("#generate-recipe")?.addEventListener("click", async () => {
      const prompt = $("#automation-prompt")?.value?.trim();
      if (!prompt) return;
      try {
        const result = await ai("automation_plan", { prompt });
        if ($("#recipe-output")) {
          $("#recipe-output").textContent = JSON.stringify(result.plan || result, null, 2);
        }
        log("تم توليد Automation Recipe.", "automation");
      } catch (error) {
        if ($("#recipe-output")) {
          $("#recipe-output").textContent = JSON.stringify({ error: error.message }, null, 2);
        }
        log(error.message, "error");
      }
    });

    $("#save-recipe")?.addEventListener("click", () => {
      try {
        const recipe = JSON.parse($("#recipe-output")?.textContent || "{}");
        state.recipes.unshift({ at: new Date().toISOString(), recipe });
        state.recipes = state.recipes.slice(0, 40);
        writeJson("midad.omni.recipes", state.recipes);
        renderRecipes();
        log("تم حفظ Recipe محليًا.", "automation");
      } catch {
        log("لا توجد Recipe صالحة للحفظ.", "automation");
      }
    });

    $("#pick-file")?.addEventListener("click", () => $("#file-input")?.click());
    $("#file-input")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.selectedFile = {
          name: file.name,
          type: file.type,
          dataUrl: reader.result
        };
        $("#file-meta").textContent = file.name;
        $("#image-preview").src = reader.result;
        $("#image-preview").style.display = "block";
        log("تم اختيار صورة من الهاتف.", "files");
      };
      reader.readAsDataURL(file);
    });

    $("#generate-image")?.addEventListener("click", async () => {
      const prompt = $("#image-prompt")?.value?.trim();
      if (!prompt) return;
      try {
        const result = await ai("gemini_image", {
          prompt,
          reference_image: state.selectedFile?.dataUrl || null,
          model: "gemini-3-pro-image"
        });
        if (result.image_data) {
          const src = "data:" + (result.mime_type || "image/png") + ";base64," + result.image_data;
          $("#image-preview").src = src;
          $("#image-preview").style.display = "block";
          state.selectedFile = {
            name: "midad-generated.png",
            type: result.mime_type || "image/png",
            dataUrl: src
          };
        }
        log("تم إنشاء/تحرير الصورة عبر Gemini.", "media");
      } catch (error) {
        log(error.message, "error");
      }
    });

    $("#use-profile")?.addEventListener("click", () => {
      if (!state.selectedFile?.dataUrl) {
        log("اختر صورة أولًا.", "profile");
        return;
      }
      state.profile.avatar_data_url = state.selectedFile.dataUrl;
      writeJson("midad.omni.profile", state.profile);
      renderProfile();
      log("تم اعتماد الصورة كـProfile Avatar.", "profile");
    });

    $("#save-profile")?.addEventListener("click", () => {
      state.profile = {
        ...state.profile,
        name: $("#profile-name")?.value?.trim() || "",
        role: $("#profile-role")?.value?.trim() || "",
        bio: $("#profile-bio")?.value?.trim() || "",
        skills: $("#profile-skills")?.value?.trim() || "",
        updated_at: new Date().toISOString()
      };
      writeJson("midad.omni.profile", state.profile);
      renderProfile();
      log("تم حفظ Profile Context.", "profile");
    });

    $("#open-gemini")?.addEventListener("click", () => openOfficialInApp("https://gemini.google.com/", "Gemini"));
    $("#open-notebook")?.addEventListener("click", () => openOfficialInApp("https://notebooklm.google.com/", "Gemini Notebook"));
    $("#notebook-btn")?.addEventListener("click", () => openOfficialInApp("https://notebooklm.google.com/", "Gemini Notebook"));

    $$("[data-k]").forEach((button) => {
      button.addEventListener("click", () => {
        $("#agent-prompt").value = button.dataset.k || "";
        switchView("command");
      });
    });

    $("#request-connection")?.addEventListener("click", async () => {
      try {
        const provider = $("#conn-provider")?.value?.trim();
        const kind = $("#conn-kind")?.value || "wallet";
        const url = $("#conn-url")?.value?.trim() || "";
        if (!provider) {
          log("اسم المزود مطلوب.", "connection");
          return;
        }
        const result = await bridge("create_connection_request", {
          provider_name: provider,
          kind,
          target_url: url
        });
        log("تم إنشاء Human Gate للربط: " + result.task.id, "connection");
        switchView("missions");
        await refreshMissions();
      } catch (error) {
        log(error.message, "error");
      }
    });

    $("#pair-device")?.addEventListener("click", pairDevice);

    $("#save-settings")?.addEventListener("click", () => {
      CONFIG.bridge = $("#bridge-url")?.value?.trim() || CONFIG.bridge;
      CONFIG.ai = $("#ai-url")?.value?.trim() || CONFIG.ai;
      localStorage.setItem("midad.bridgeUrl", CONFIG.bridge);
      localStorage.setItem("midad.aiUrl", CONFIG.ai);
      log("تم حفظ إعدادات الاتصال.", "settings");
    });

    $("#clear-log")?.addEventListener("click", () => { if ($("#events")) $("#events").innerHTML = ""; });
    $("#new-context")?.addEventListener("click", () => {
      const name = prompt("اسم المنصة / السياق:");
      if (!name) return;
      if (!state.contexts.includes(name.trim())) state.contexts.push(name.trim());
      writeJson("midad.omni.contexts", state.contexts);
      renderContexts();
      log("تمت إضافة Context: " + name.trim(), "context");
    });
  }

  async function pairDevice() {
    const code = prompt("أدخل رمز الربط لمرة واحدة الظاهر في MIDAD Control Room:");
    if (!code) return;
    try {
      const result = await request(CONFIG.bridge, {
        action: "pair_complete",
        code: code.trim().toUpperCase(),
        device_id: "omni-" + crypto.randomUUID(),
        device_name: "MIDAD Omni Agent"
      });
      state.token = result.bridge_token;
      localStorage.setItem("midad.omni.token", state.token);
      updatePairState();
      log("تم ربط الهاتف بـMIDAD.", "pairing");
      await refreshMissions();
    } catch (error) {
      alert(error.message);
    }
  }

  function renderRecipes() {
    const host = $("#recipes");
    if (!host) return;
    host.innerHTML = state.recipes.map((entry) =>
      '<div class="recipe"><b>' +
      escapeHtml(entry.recipe?.title || "Automation Recipe") +
      "</b><small>" + escapeHtml(new Date(entry.at || Date.now()).toLocaleString("ar")) +
      "</small></div>"
    ).join("") || '<div class="muted">لا توجد Recipes.</div>';
  }

  function renderProfile() {
    const p = state.profile;
    if ($("#profile-name")) $("#profile-name").value = p.name || "";
    if ($("#profile-role")) $("#profile-role").value = p.role || "";
    if ($("#profile-bio")) $("#profile-bio").value = p.bio || "";
    if ($("#profile-skills")) $("#profile-skills").value = p.skills || "";
    if ($("#profile-status")) {
      $("#profile-status").innerHTML =
        "<b>Profile Context</b><p class=\"muted\">" +
        escapeHtml(JSON.stringify(p)) + "</p>";
    }
  }

  async function openOfficialInApp(url, title) {
    try {
      const b = Browser();
      if (b?.openWebView) {
        const result = await b.openWebView({
          url,
          title: "MIDAD · " + title,
          toolbarType: "navigation",
          persistWebViewData: true
        });
        state.webviewId = result.id;
        window.__midadWebId = result.id;
        log("تم فتح " + title + " داخل MIDAD.", "browser");
        return;
      }
      await Plugins().Browser?.open?.({ url });
    } catch (error) {
      log(error.message, "error");
    }
  }

  const fileInput = $("#file-input"); if (fileInput) fileInput.setAttribute("capture","environment");
  ensureAttentionBar();
  ensureHumanGateModal();
  patchWebViewIdCapture();
  installMessageBus();
  installButtons();
  installProactiveBar();
  installSafeAutofill();
  installSmartInspector();
  renderContexts();
  renderRecipes();
  renderProfile();
  renderCommunicationHistory();
  renderCommunicationHistory();
  installCommunication();
  updatePairState();

  log("MIDAD Omni Agent v0.3 runtime جاهز · Native primary · Gemini specialist · TinyFish fallback", "boot");

  if (state.token) {
    refreshMissions();
    setInterval(refreshMissions, 12000);
  }
})();