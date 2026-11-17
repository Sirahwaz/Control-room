const api = globalThis.chrome;

function callApi(method, ...args) {
  return new Promise((resolve, reject) => {
    method(...args, (result) => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message || "browser_api_failed"));
      else resolve(result);
    });
  });
}

function safeUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function extractVisiblePage() {
  const source = document.body || document.documentElement;
  if (!source) return { title: document.title || "", url: location.origin, text: "", headings: [], links: [], metadata: {} };
  const clone = source.cloneNode(true);
  clone.querySelectorAll(
    "script,style,noscript,template,form,input,textarea,select,option,button," +
    "[contenteditable],[autocomplete],[aria-hidden='true'],iframe,canvas,video,audio"
  ).forEach((node) => node.remove());
  const text = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 20000);
  const headings = Array.from(clone.querySelectorAll("h1,h2,h3"))
    .slice(0, 100)
    .map((node) => (node.innerText || node.textContent || "").trim().slice(0, 300))
    .filter(Boolean);
  const links = Array.from(document.querySelectorAll("a"))
    .filter((node) => !node.closest("form"))
    .slice(0, 100)
    .map((node) => {
      let url = "";
      try {
        const parsed = new URL(node.href);
        if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
          parsed.search = "";
          parsed.hash = "";
          url = parsed.toString();
        }
      } catch {}
      return { text: (node.innerText || node.textContent || "").trim().slice(0, 200), url };
    })
    .filter((item) => item.text && item.url);
  const description = document.querySelector('meta[name="description"]')?.content || "";
  const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
  let canonicalUrl = "";
  try {
    const parsed = new URL(canonical || location.href);
    if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
      parsed.search = "";
      parsed.hash = "";
      canonicalUrl = parsed.toString();
    }
  } catch {}
  return {
    title: (document.title || "").slice(0, 500),
    url: canonicalUrl || location.origin,
    text,
    headings,
    links,
    metadata: { description: description.slice(0, 1000) },
    extractedAt: new Date().toISOString(),
  };
}

function flattenBookmarks(nodes, folderPath = [], out = []) {
  for (const node of nodes || []) {
    if (node.url) {
      out.push({
        title: String(node.title || "").slice(0, 500),
        url: safeUrl(node.url),
        folderPath: folderPath.join(" / ").slice(0, 1000),
        dateAdded: Number.isFinite(node.dateAdded) ? node.dateAdded : null,
      });
    } else if (Array.isArray(node.children)) {
      const nextPath = node.title ? [...folderPath, String(node.title).slice(0, 200)] : folderPath;
      flattenBookmarks(node.children, nextPath, out);
    }
    if (out.length >= 500) break;
  }
  return out.slice(0, 500).filter((item) => item.url);
}

async function requirePermission(permission) {
  const granted = await callApi(api.permissions.contains, { permissions: [permission] });
  if (!granted) throw new Error("permission_not_granted");
}

async function extractSource(source) {
  if (!["active_tab", "tabs", "bookmarks", "history", "downloads"].includes(source)) {
    throw new Error("source_unsupported");
  }
  const activeTabs = await callApi(api.tabs.query, { active: true, currentWindow: true });
  const activeTab = activeTabs && activeTabs[0];
  if (!activeTab || activeTab.incognito) throw new Error("private_context_blocked");

  if (source === "active_tab") {
    if (!Number.isInteger(activeTab.id) || !/^https?:\/\//i.test(activeTab.url || "")) {
      throw new Error("unsupported_page");
    }
    const results = await callApi(api.scripting.executeScript, {
      target: { tabId: activeTab.id },
      func: extractVisiblePage,
    });
    const data = results && results[0] && results[0].result;
    if (!data) throw new Error("page_extraction_failed");
    return { source, count: 1, items: [data] };
  }

  const permission = { tabs: "tabs", bookmarks: "bookmarks", history: "history", downloads: "downloads" }[source];
  await requirePermission(permission);

  if (source === "tabs") {
    const tabs = await callApi(api.tabs.query, {});
    const items = (tabs || []).filter((tab) => !tab.incognito).slice(0, 200).map((tab) => ({
      id: tab.id,
      title: String(tab.title || "").slice(0, 500),
      url: safeUrl(tab.url),
      favIconUrl: safeUrl(tab.favIconUrl),
      active: tab.active === true,
      windowId: tab.windowId,
    })).filter((tab) => tab.url);
    return { source, count: items.length, items };
  }

  if (source === "bookmarks") {
    const tree = await callApi(api.bookmarks.getTree);
    const items = flattenBookmarks(tree);
    return { source, count: items.length, items };
  }

  if (source === "history") {
    const items = await callApi(api.history.search, { text: "", startTime: 0, maxResults: 200 });
    const safeItems = (items || []).slice(0, 200).map((item) => ({
      title: String(item.title || "").slice(0, 500),
      url: safeUrl(item.url),
      lastVisitTime: Number.isFinite(item.lastVisitTime) ? item.lastVisitTime : null,
      visitCount: Number.isFinite(item.visitCount) ? item.visitCount : 0,
    })).filter((item) => item.url);
    return { source, count: safeItems.length, items: safeItems };
  }

  const items = await callApi(api.downloads.search, { limit: 100, orderBy: ["-startTime"] });
  const safeItems = (items || []).slice(0, 100).map((item) => ({
    filename: String(item.filename || "").split(/[\\/]/).pop().slice(0, 255),
    url: safeUrl(item.url),
    startedAt: Number.isFinite(item.startTime) ? item.startTime : null,
    state: String(item.state || "").slice(0, 40),
    bytesReceived: Number.isFinite(item.bytesReceived) ? item.bytesReceived : 0,
    totalBytes: Number.isFinite(item.totalBytes) ? item.totalBytes : 0,
  })).filter((item) => item.url);
  return { source, count: safeItems.length, items: safeItems };
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== api.runtime.id || message?.type !== "MIDAD_EXTRACT") return false;
  extractSource(message.source)
    .then(async (result) => {
      const record = { ...result, extractedAt: new Date().toISOString(), destination: "local" };
      await callApi(api.storage.local.set, { lastExtraction: record });
      sendResponse({ ok: true, data: record });
    })
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || "extraction_failed") }));
  return true;
});
