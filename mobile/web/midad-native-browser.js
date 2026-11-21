(() => {
  "use strict";
  const KEY = "midad-native-browser-state-v1";
  const BOOKMARKS = "nativeBrowserBookmarks";
  const $ = (id) => document.getElementById(id);
  const state = { tabs: [], activeId: null, listenerReady: false };
  const plugin = () => window.Capacitor?.Plugins?.CapgoInAppBrowser || window.Capacitor?.Plugins?.InAppBrowser || null;

  function read(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value ?? fallback; }
    catch (_) { return fallback; }
  }
  function persist() {
    localStorage.setItem(KEY, JSON.stringify({
      tabs: state.tabs.map(({ url, title }) => ({ url, title })),
      activeIndex: Math.max(0, state.tabs.findIndex((tab) => tab.id === state.activeId))
    }));
  }
  function normalizeAddress(raw) {
    const value = String(raw || "").trim();
    if (!value) throw new Error("أدخل عنوان موقع أولاً.");
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : "https://" + value;
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("يسمح فقط بعناوين HTTP وHTTPS.");
    if (url.username || url.password) throw new Error("لا تضع بيانات دخول داخل رابط الموقع.");
    return url.href;
  }
  function setStatus(message, error = false) {
    const node = $("nativeBrowserStatus");
    if (node) { node.textContent = message; node.dataset.state = error ? "error" : "ready"; }
  }
  function render() {
    const tabs = $("nativeBrowserTabs");
    if (tabs) {
      tabs.replaceChildren();
      state.tabs.forEach((tab, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "native-browser-tab" + (tab.id === state.activeId ? " active" : "");
        button.textContent = tab.title || "Tab " + (index + 1);
        button.addEventListener("click", async () => {
          const api = plugin();
          if (!api || !tab.id) return;
          try {
            if (state.activeId && state.activeId !== tab.id) await api.hide({ id: state.activeId });
            await api.show({ id: tab.id });
            state.activeId = tab.id;
            if ($("nativeBrowserAddress")) $("nativeBrowserAddress").value = tab.url || "";
            render();
          } catch (error) { setStatus(error.message || String(error), true); }
        });
        tabs.append(button);
      });
    }
    renderList("nativeBrowserBookmarkList", read(BOOKMARKS, []), "bookmark");
    renderList("nativeBrowserHistoryList", read("midad-native-browser-history-v1", []), "history");
  }
  function renderList(id, items, kind) {
    const node = $(id);
    if (!node) return;
    node.replaceChildren();
    items.slice(0, 8).forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "native-browser-link";
      button.textContent = item.title || item.url;
      button.title = item.url;
      button.addEventListener("click", () => openAddress(item.url, kind === "bookmark"));
      node.append(button);
    });
  }
  function rememberVisit(url) {
    const history = read("midad-native-browser-history-v1", []);
    history.unshift({ url, title: new URL(url).hostname, visitedAt: Date.now() });
    localStorage.setItem("midad-native-browser-history-v1", JSON.stringify(history.filter((item, i) => history.findIndex((x) => x.url === item.url) === i).slice(0, 100)));
  }
  async function bindEvents(api) {
    if (state.listenerReady || !api?.addListener) return;
    state.listenerReady = true;
    await api.addListener("urlChangeEvent", ({ id, url }) => {
      const tab = state.tabs.find((item) => item.id === id);
      if (!tab || !url) return;
      try {
        const safe = normalizeAddress(url);
        tab.url = safe;
        tab.title = new URL(safe).hostname;
        if (state.activeId === id && $("nativeBrowserAddress")) $("nativeBrowserAddress").value = safe;
        rememberVisit(safe);
        persist();
        render();
      } catch (_) {}
    });
    await api.addListener("closeEvent", ({ id }) => {
      state.tabs = state.tabs.filter((tab) => tab.id !== id);
      if (state.activeId === id) state.activeId = state.tabs.at(-1)?.id || null;
      persist(); render();
    });
  }
  async function openAddress(raw, newTab = false) {
    const api = plugin();
    if (!api?.openWebView) {
      setStatus("Native WebView plugin unavailable in this APK build.", true);
      return;
    }
    let url;
    try { url = normalizeAddress(raw); }
    catch (error) { setStatus(error.message || String(error), true); return; }
    try {
      await bindEvents(api);
      const current = state.tabs.find((tab) => tab.id === state.activeId);
      if (current && !newTab) {
        await api.setUrl({ id: current.id, url });
        current.url = url;
        current.title = new URL(url).hostname;
      } else {
        if (state.activeId) await api.hide({ id: state.activeId });
        const opened = await api.openWebView({
          url,
          toolbarType: "navigation",
          title: "MIDAD Browser",
          toolbarColor: "#07131f",
          showURL: true,
          closeButtonText: "Close",
          persistWebViewData: true
        });
        const id = opened?.id;
        if (!id) throw new Error("Native browser did not return a WebView session id.");
        state.tabs.push({ id, url, title: new URL(url).hostname });
        state.activeId = id;
      }
      rememberVisit(url);
      if ($("nativeBrowserAddress")) $("nativeBrowserAddress").value = url;
      persist(); render();
      setStatus("Native WebView active · " + new URL(url).hostname);
    } catch (error) { setStatus(error.message || String(error), true); }
  }
  async function closeActive() {
    const api = plugin();
    const id = state.activeId;
    if (!api || !id) return;
    try {
      await api.close({ id });
      state.tabs = state.tabs.filter((tab) => tab.id !== id);
      state.activeId = state.tabs.at(-1)?.id || null;
      if (state.activeId) await api.show({ id: state.activeId });
      persist(); render();
      setStatus("Browser tab closed.");
    } catch (error) { setStatus(error.message || String(error), true); }
  }
  function bookmarkCurrent() {
    const tab = state.tabs.find((item) => item.id === state.activeId);
    if (!tab?.url) { setStatus("افتح موقعاً قبل حفظه في المفضلة.", true); return; }
    const items = read(BOOKMARKS, []);
    if (!items.some((item) => item.url === tab.url)) {
      items.unshift({ url: tab.url, title: tab.title });
      localStorage.setItem(BOOKMARKS, JSON.stringify(items.slice(0, 100)));
    }
    render(); setStatus("تم حفظ الموقع في المفضلة المحلية.");
  }
  async function init() {
    const api = plugin();
    $("nativeBrowserOpen")?.addEventListener("click", () => openAddress($("nativeBrowserAddress")?.value));
    $("nativeBrowserNewTab")?.addEventListener("click", () => openAddress($("nativeBrowserAddress")?.value || "https://example.com/", true));
    $("nativeBrowserBack")?.addEventListener("click", async () => {
      try { const result = await api?.goBack?.({ id: state.activeId }); setStatus(result?.canGoBack ? "Back navigation requested." : "No previous page."); }
      catch (error) { setStatus(error.message || String(error), true); }
    });
    $("nativeBrowserReload")?.addEventListener("click", async () => {
      try { await api?.reload?.({ id: state.activeId }); setStatus("Page reload requested."); }
      catch (error) { setStatus(error.message || String(error), true); }
    });
    $("nativeBrowserClose")?.addEventListener("click", closeActive);
    $("nativeBrowserBookmark")?.addEventListener("click", bookmarkCurrent);
    $("nativeBrowserAddress")?.addEventListener("keydown", (event) => { if (event.key === "Enter") openAddress(event.currentTarget.value); });
    if (!api?.openWebView) setStatus("هذا الإصدار لا يعرض جسر Native WebView؛ لن يتم فتح متصفح وهمي.", true);
    else { await bindEvents(api); setStatus("Native browser engine available · ready."); }
    render();
  }
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();