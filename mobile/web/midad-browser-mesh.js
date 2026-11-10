(() => {
  "use strict";
  const STORAGE_KEY = "midad-browser-mesh-settings-v1";
  const defaults = {
    theme: "dark",
    accent: "cyan",
    fontScale: 100,
    language: "ar",
    headline: "متصفح مداد Mesh",
    subtitle: "متصفح محلي متصل بمعمارية تشغيل موزعة — دون اشتراط خادم VPS دائم."
  };
  const translations = {
    ar: {
      localReady:"المحرك المحلي جاهز", cloudPending:"الخدمات السحابية بانتظار التفعيل",
      navMesh:"الشبكة والتشغيل", navNetwork:"Proxy & Network", navVault:"الخزنة الآمنة", navAppearance:"المظهر والتخصيص",
      runtimeTitle:"خريطة التشغيل الموزّع", runtimeDescription:"كل منصة تؤدي دوراً محدداً؛ ولا نفترض جاهزية أي عقدة قبل وصول دليل تشغيل حي.",
      androidDescription:"محرك WebView مدمج، صفحة رئيسية محفوظة داخل APK، وتصفح مباشر من شريط العنوان الأصلي.",
      cloudDescription:"Durable Objects + Queues لإدارة المهام والـ leases والـ checkpoints والإشارات.",
      githubDescription:"عمال Linux مؤقتون لمهام CPU_BATCH المحددة؛ لا تُشغّل جلسات المتصفح المستمرة هنا.",
      browserRunDescription:"جلسات متصفح سحابية قصيرة العمر كمسار Browser-capable منفصل عن عمال CPU.",
      topologyTitle:"تدفق العمل بين المنصات", topologyLocal:"تصفح بشري · Offline Home · واجهة التحكم",
      noVpsTitle:"لا يتطلب VPS دائم", noVpsDescription:"يمكن تشغيل المعمارية عبر Control Plane serverless وعمال مؤقتين وجهاز Android المحلي. يبقى VPS أو Linux node خياراً تخصصياً فقط، وليس شرطاً أساسياً.",
      deviceStateTitle:"حالة الجهاز", appBundle:"حزمة التطبيق المحلية", internetState:"اتصال الإنترنت", cloudHealth:"فحص Cloudflare Health", browserWorker:"Browser Worker Heartbeat",
      honestyNote:"لا يوجد اتصال حي بخدمات MNCF بعد. هذه الواجهة تعرض الكود المتوفر وحالة التفعيل بصدق، ولا تنشئ حالة اتصال وهمية.",
      networkTitle:"التحكم بالاتصال وProxy", networkDescription:"سياسات واضحة لكل نطاق تشغيل، مع منع التحويل الصامت إلى Direct عند فشل المسار.",
      proxyStatus:"لا توجد مسارات Proxy فعّالة", proxyStatusDescription:"مصادر السياسة موجودة في المستودع؛ لم يتم ربط API حي أو تفعيل مزوّد.",
      proxyNoSecrets:"بيانات اعتماد Proxy لا تدخل APK ولا Local Storage. تُحلّ عبر Vault lease من جهة الخادم فقط.",
      scopeTitle:"نطاقات التوجيه", vaultTitle:"الخزنة المركزية الآمنة",
      vaultDescription:"تخزين مشفر ومراجع أسرار قصيرة العمر، دون إظهار قيمة أي مفتاح في واجهة المستخدم.",
      vaultBrokerTitle:"Vault Broker", vaultBrokerDescription:"الكود المركزي يدعم التشفير، ربط المالك والنطاق والغرض، leases محددة المدة، الإبطال والتدقيق. يحتاج نشر Worker ومفاتيح بيئة آمنة قبل التشغيل الحقيقي.",
      securityBoundary:"حد أمان أساسي", securityBoundaryDescription:"لا تُدخل كلمات مرور أو API keys هنا. الـ APK لا يحمل Cloudflare Admin Key أو GitHub App Private Key أو أسرار Proxy.",
      appearanceTitle:"المظهر وتخصيص الواجهة", appearanceDescription:"عدّل الإضاءة والألوان وحجم الخط واللغة والنصوص؛ تُحفظ التفضيلات على الجهاز دون حساب سحابي.",
      themeLabel:"نمط الإضاءة", accentLabel:"لون الواجهة", fontLabel:"حجم الخط", languageLabel:"لغة الواجهة",
      textEditorTitle:"تعديل نصوص الصفحة الرئيسية", headlineLabel:"العنوان الرئيسي", subtitleLabel:"الوصف",
      previewLabel:"معاينة مباشرة", saveButton:"حفظ التغييرات", resetButton:"استعادة الافتراضي",
      footerTrust:"واجهة Offline-first · لا أسرار داخل التطبيق · لا ادعاء تشغيل حي",
      saved:"تم حفظ تفضيلات الواجهة على هذا الجهاز.", reset:"تمت استعادة الإعدادات الافتراضية."
    },
    en: {
      localReady:"Local engine ready", cloudPending:"Cloud services pending activation",
      navMesh:"Runtime Mesh", navNetwork:"Proxy & Network", navVault:"Secure Vault", navAppearance:"Appearance",
      runtimeTitle:"Distributed runtime topology", runtimeDescription:"Each platform has a defined role. A node is not marked ready without live operational evidence.",
      androidDescription:"Embedded WebView, packaged offline home, and direct browsing from the native address bar.",
      cloudDescription:"Durable Objects + Queues for tasks, leases, checkpoints and wake events.",
      githubDescription:"Ephemeral Linux runners for bounded CPU_BATCH tasks; not for persistent browser sessions.",
      browserRunDescription:"Short-lived cloud browser sessions, separate from CPU workers.",
      topologyTitle:"Cross-platform execution flow", topologyLocal:"Human browsing · Offline home · Control surface",
      noVpsTitle:"No permanent VPS required", noVpsDescription:"The architecture can use a serverless control plane, ephemeral runners and the local Android device. A VPS or Linux node remains an optional specialist substrate, not a prerequisite.",
      deviceStateTitle:"Device status", appBundle:"Packaged app assets", internetState:"Internet connection", cloudHealth:"Cloudflare health", browserWorker:"Browser worker heartbeat",
      honestyNote:"MNCF services are not live-connected yet. This surface reports implementation and activation state honestly; it does not invent an online status.",
      networkTitle:"Network access & Proxy", networkDescription:"Explicit routing policy by execution scope, with no silent direct fallback on route failure.",
      proxyStatus:"No active Proxy routes", proxyStatusDescription:"Policy source exists in the repository; no live API or provider is connected.",
      proxyNoSecrets:"Proxy credentials never enter the APK or local storage. Resolve them server-side through a Vault lease.",
      scopeTitle:"Routing scopes", vaultTitle:"Central secure Vault",
      vaultDescription:"Encrypted storage and short-lived secret references. Secret values are never displayed in the UI.",
      vaultBrokerTitle:"Vault Broker", vaultBrokerDescription:"The central code supports encryption, owner/scope/purpose binding, time-limited leases, revocation and audit. A Worker deployment and protected environment keys are still required.",
      securityBoundary:"Security boundary", securityBoundaryDescription:"Do not enter passwords or API keys here. The APK contains no Cloudflare Admin Key, GitHub App private key or Proxy credentials.",
      appearanceTitle:"Appearance and workspace settings", appearanceDescription:"Change lighting, accent color, font size, language and home-page copy. Preferences stay on this device.",
      themeLabel:"Theme", accentLabel:"Accent color", fontLabel:"Font size", languageLabel:"Interface language",
      textEditorTitle:"Edit home-page copy", headlineLabel:"Main heading", subtitleLabel:"Description",
      previewLabel:"Live preview", saveButton:"Save changes", resetButton:"Reset defaults",
      footerTrust:"Offline-first UI · No secrets in APK · No false live status",
      saved:"Appearance preferences saved on this device.", reset:"Default preferences restored."
    },
    fa: {
      localReady:"موتور محلی آماده است", cloudPending:"خدمات ابری در انتظار فعال‌سازی",
      navMesh:"شبکه و اجرا", navNetwork:"پروکسی و شبکه", navVault:"خزانه امن", navAppearance:"ظاهر و شخصی‌سازی",
      runtimeTitle:"نقشه اجرای توزیع‌شده", runtimeDescription:"هر پلتفرم نقش مشخصی دارد؛ هیچ گره‌ای بدون شواهد زنده آماده اعلام نمی‌شود.",
      androidDescription:"WebView داخلی، صفحه خانگی آفلاین در APK و مرور مستقیم از نوار آدرس بومی.",
      cloudDescription:"Durable Objects و Queues برای وظایف، اجاره‌ها، نقاط بازیابی و رویدادها.",
      githubDescription:"اجراکننده‌های موقت Linux برای وظایف محدود CPU_BATCH؛ نه برای نشست دائمی مرورگر.",
      browserRunDescription:"نشست‌های کوتاه‌مدت مرورگر ابری، جدا از کارگرهای CPU.",
      topologyTitle:"جریان اجرای چندسکویی", topologyLocal:"مرور انسانی · صفحه آفلاین · پنل کنترل",
      noVpsTitle:"بدون نیاز به VPS دائمی", noVpsDescription:"معماری با کنترل‌پلین serverless، اجراکننده‌های موقت و دستگاه Android محلی کار می‌کند. VPS یا Linux node فقط گزینه تخصصی است، نه پیش‌نیاز.",
      deviceStateTitle:"وضعیت دستگاه", appBundle:"دارایی‌های محلی برنامه", internetState:"اتصال اینترنت", cloudHealth:"سلامت Cloudflare", browserWorker:"ضربان Browser Worker",
      honestyNote:"هنوز اتصال زنده به سرویس‌های MNCF وجود ندارد. این رابط وضعیت واقعی کد و فعال‌سازی را نشان می‌دهد.",
      networkTitle:"دسترسی شبکه و Proxy", networkDescription:"سیاست مسیریابی روشن برای هر حوزه اجرا و بدون برگشت پنهانی به اتصال مستقیم.",
      proxyStatus:"هیچ مسیر Proxy فعالی وجود ندارد", proxyStatusDescription:"کد سیاست در مخزن وجود دارد؛ API زنده یا ارائه‌دهنده‌ای متصل نیست.",
      proxyNoSecrets:"اعتبارنامه‌های Proxy وارد APK یا حافظه محلی نمی‌شوند؛ فقط از سمت سرور با Vault lease دریافت می‌شوند.",
      scopeTitle:"حوزه‌های مسیریابی", vaultTitle:"خزانه امن مرکزی",
      vaultDescription:"ذخیره‌سازی رمزنگاری‌شده و ارجاع‌های کوتاه‌مدت؛ مقدار کلیدها در رابط نمایش داده نمی‌شود.",
      vaultBrokerTitle:"Vault Broker", vaultBrokerDescription:"کد مرکزی از رمزنگاری، اتصال مالک/حوزه/هدف، lease زمان‌دار، لغو و ممیزی پشتیبانی می‌کند. انتشار Worker و کلیدهای محافظت‌شده هنوز لازم است.",
      securityBoundary:"مرز امنیتی", securityBoundaryDescription:"رمز عبور یا API key وارد نکنید. APK شامل کلید ادمین Cloudflare یا کلید خصوصی GitHub یا اطلاعات Proxy نیست.",
      appearanceTitle:"ظاهر و تنظیمات محیط کار", appearanceDescription:"نور، رنگ، اندازه قلم، زبان و متن صفحه اصلی را تغییر دهید؛ تنظیمات روی همین دستگاه ذخیره می‌شوند.",
      themeLabel:"حالت نمایش", accentLabel:"رنگ اصلی", fontLabel:"اندازه قلم", languageLabel:"زبان رابط",
      textEditorTitle:"ویرایش متن صفحه اصلی", headlineLabel:"عنوان اصلی", subtitleLabel:"توضیح",
      previewLabel:"پیش‌نمایش زنده", saveButton:"ذخیره تغییرات", resetButton:"بازنشانی پیش‌فرض",
      footerTrust:"رابط آفلاین‌محور · بدون اسرار در APK · بدون ادعای اتصال زنده",
      saved:"تنظیمات ظاهر روی این دستگاه ذخیره شد.", reset:"تنظیمات پیش‌فرض بازیابی شد."
    }
  };
  let settings = { ...defaults };
  const $ = selector => document.querySelector(selector);
  function safeRead() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { ...defaults };
      const parsed = JSON.parse(stored);
      return {
        theme: ["dark","light","system"].includes(parsed.theme) ? parsed.theme : defaults.theme,
        accent: ["cyan","violet","emerald","amber","rose"].includes(parsed.accent) ? parsed.accent : defaults.accent,
        fontScale: Math.min(125,Math.max(90,Number(parsed.fontScale)||100)),
        language: ["ar","en","fa"].includes(parsed.language) ? parsed.language : defaults.language,
        headline: typeof parsed.headline === "string" ? parsed.headline.slice(0,60) : defaults.headline,
        subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle.slice(0,180) : defaults.subtitle
      };
    } catch { return { ...defaults }; }
  }
  function applyTheme() {
    const mode = settings.theme === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : settings.theme;
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.accent = settings.accent;
    document.documentElement.style.setProperty("--scale", String(settings.fontScale / 100));
  }
  function applyLanguage() {
    const lang = settings.language;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
    document.querySelectorAll("[data-i18n]").forEach(node => {
      const key = node.dataset.i18n;
      if (translations[lang] && translations[lang][key]) node.textContent = translations[lang][key];
    });
  }
  function applyText() {
    $("#headline").textContent = settings.headline;
    $("#subtitle").textContent = settings.subtitle;
    $("#headlineInput").value = settings.headline;
    $("#subtitleInput").value = settings.subtitle;
    $("#previewHeadline").textContent = settings.headline;
  }
  function applySettings() {
    applyTheme();
    applyLanguage();
    applyText();
    $("#themeSelect").value = settings.theme;
    $("#languageSelect").value = settings.language;
    $("#fontScale").value = String(settings.fontScale);
    $("#fontScaleValue").value = settings.fontScale + "%";
    document.querySelectorAll(".accent-choice").forEach(button => {
      button.classList.toggle("selected", button.dataset.accent === settings.accent);
      button.setAttribute("aria-pressed", button.dataset.accent === settings.accent ? "true" : "false");
    });
  }
  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      $("#settingsFeedback").textContent = translations[settings.language].saved;
    } catch {
      $("#settingsFeedback").textContent = "Local storage unavailable; changes apply only until the app closes.";
    }
  }
  function selectTab(tabName) {
    document.querySelectorAll(".tab").forEach(button => {
      const active = button.dataset.tab === tabName;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach(panel => {
      const active = panel.dataset.panel === tabName;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  }
  function updateInternetStatus() {
    const online = navigator.onLine === true;
    $("#internetStatus").textContent = online ? "ONLINE" : "OFFLINE";
    $("#internetStatus").className = online ? "value-ok" : "value-pending";
    $("#footerNetwork").textContent = "DEVICE NETWORK: " + (online ? "ONLINE" : "OFFLINE");
  }
  function bindEvents() {
    document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => selectTab(button.dataset.tab)));
    $("#themeSelect").addEventListener("change", event => { settings.theme = event.target.value; applySettings(); });
    $("#languageSelect").addEventListener("change", event => { settings.language = event.target.value; applySettings(); });
    $("#fontScale").addEventListener("input", event => { settings.fontScale = Number(event.target.value); applySettings(); });
    document.querySelectorAll(".accent-choice").forEach(button => button.addEventListener("click", () => {
      settings.accent = button.dataset.accent; applySettings();
    }));
    $("#headlineInput").addEventListener("input", event => { settings.headline = event.target.value.slice(0,60); applyText(); });
    $("#subtitleInput").addEventListener("input", event => { settings.subtitle = event.target.value.slice(0,180); applyText(); });
    $("#saveAppearance").addEventListener("click", saveSettings);
    $("#resetAppearance").addEventListener("click", () => {
      settings = { ...defaults }; applySettings(); saveSettings();
      $("#settingsFeedback").textContent = translations[settings.language].reset;
    });
    $("#themeQuick").addEventListener("click", () => {
      settings.theme = settings.theme === "dark" ? "light" : "dark";
      applySettings(); saveSettings();
    });
    window.addEventListener("online", updateInternetStatus);
    window.addEventListener("offline", updateInternetStatus);
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => {
        if (settings.theme === "system") applyTheme();
      });
    }
  }
  function init() {
    settings = safeRead();
    applySettings();
    bindEvents();
    updateInternetStatus();
    selectTab("mesh");
  }
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
