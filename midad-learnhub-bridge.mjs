const LEARNHUB_ORIGIN = "https://alisol.ir/";
const LANGUAGES = new Set(["AR", "EN", "FA", "NL", "DE", "FR", "ES", "IT", "TR", "RU", "HI"]);
const WORKFLOWS = Object.freeze({
  search: "learnhub_search",
  starter: "learnhub_starter",
  topic: null
});

export function buildLearnHubUrl({ workflow, topic = "", lang = "AR" } = {}) {
  if (!Object.hasOwn(WORKFLOWS, workflow)) throw new Error("Unsupported workflow");
  const language = String(lang).trim().toUpperCase();
  if (!LANGUAGES.has(language)) throw new Error("Unsupported language");

  const params = new URLSearchParams();
  if (workflow === "topic") {
    const value = String(topic).trim();
    if (!value) throw new Error("Topic is required");
    if (value.length > 160) throw new Error("Topic must be 160 characters or fewer");
    params.set("ai", value);
  } else {
    params.set("ai", WORKFLOWS[workflow]);
  }
  params.set("lang", language);
  return LEARNHUB_ORIGIN + "?" + params.toString();
}

export function openLearnHubWorkflow({ workflow, topic = "", lang = "AR" } = {}, openWindow = globalThis.window?.open?.bind(globalThis.window)) {
  const url = buildLearnHubUrl({ workflow, topic, lang });
  if (typeof openWindow !== "function") return { ok: false, url, reason: "window_unavailable" };
  const opened = openWindow(url, "_blank");
  if (opened) {
    try { opened.opener = null; } catch { /* Cross-origin WindowProxy may reject assignment. */ }
  }
  return { ok: Boolean(opened), url, reason: opened ? null : "popup_blocked" };
}
