import { compileContext } from "./context-engine.mjs";

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "midad.context-forge.history.v1";
const MAX_HISTORY = 20;
const templates = {
  project: [
    "الهدف: إنشاء تدفق عمل واضح يمكن اختباره.",
    "القيد: لا تنفّذ أي إجراء خارجي دون موافقة صريحة.",
    "القرار: ابدأ بتحليل المتطلبات قبل التنفيذ.",
    "سؤال مفتوح: ما معيار النجاح القابل للتحقق؟",
    "Decision: automatic external execution",
    "Decision: no automatic external execution"
  ].join("\n"),
  decisions: [
    "الهدف: توحيد القرارات والمتطلبات في مصدر واحد.",
    "القرار: احتفظ بالدليل بجانب كل قرار.",
    "القيد: لا تحوّل الاستنتاج إلى حقيقة مؤكدة.",
    "سؤال مفتوح: هل القرار ما زال ساريًا؟"
  ].join("\n"),
  opportunity: [
    "الهدف: تقييم فرصة دخل قبل صرف أي مبلغ.",
    "القيد: لا رسوم مسبقة ولا مفاتيح خاصة ولا عبارة استرداد.",
    "القرار: تحقق من المصدر الرسمي والأهلية والشبكة والرسوم.",
    "سؤال مفتوح: هل الاستحقاق والسحب متاحان في المنطقة؟"
  ].join("\n")
};
const categoryNames = {
  objective: "هدف",
  constraint: "قيد",
  decision: "قرار",
  openQuestion: "سؤال مفتوح",
  claim: "ادعاء"
};

const input = $("#context-input");
const notice = $("#notice");
const resultsPanel = $("#results-panel");
const draftPanel = $("#draft-panel");
const historyPanel = $("#history-panel");
let currentContext = null;

function setNotice(message, state = "") {
  notice.textContent = message;
  notice.className = "notice" + (state ? " " + state : "");
}
function updateCounter() {
  $("#char-count").textContent = input.value.length.toLocaleString("ar") + " حرف";
}
function safeReadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.source === "string") : [];
  } catch {
    return [];
  }
}
function computeStructureScore(context) {
  let score = 0;
  if (context.objectives.length) score += 30;
  if (context.constraints.length) score += 20;
  if (context.decisions.length) score += 20;
  if (context.claims.length) score += 15;
  score += context.openQuestions.length === 0 ? 15 : Math.max(0, 15 - context.openQuestions.length * 5);
  score -= Math.min(35, context.conflicts.length * 15);
  return Math.max(0, Math.min(100, score));
}
function makeNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function renderClaims(context) {
  const list = $("#claims-list");
  list.replaceChildren();
  for (const claim of context.claims) {
    const card = makeNode("article", "claim-card");
    const top = makeNode("div", "claim-top");
    top.append(
      makeNode("span", "category-label", categoryNames[claim.category] || claim.category),
      makeNode("span", "unverified-label", "UNVERIFIED")
    );
    card.append(
      top,
      makeNode("p", "claim-text", claim.text),
      makeNode("div", "claim-source", "المصدر: إدخال المستخدم · السطر " + claim.source.line)
    );
    list.append(card);
  }
  if (!context.claims.length) list.append(makeNode("div", "empty-history", "لا توجد وحدات سياق بعد."));
}
function renderWarnings(context) {
  const area = $("#warnings-area");
  area.replaceChildren();
  for (const warning of context.warnings) {
    area.append(makeNode("div", "warning-card", warning.message));
  }
  if (!context.claims.length) area.append(makeNode("div", "warning-card", "أضف سطرًا واحدًا على الأقل للتحليل."));
}
function renderConflicts(context) {
  const list = $("#conflicts-list");
  list.replaceChildren();
  if (!context.conflicts.length) {
    list.append(makeNode("div", "empty-history", "لم يرصد المحرك تعارضًا صريحًا وفق قواعده المحدودة. هذا لا يثبت غياب التعارض."));
    return;
  }
  for (const conflict of context.conflicts) {
    const card = makeNode("article", "conflict-card");
    card.append(
      makeNode("span", "conflict-tag", "PENDING_REVIEW · " + conflict.id),
      makeNode("p", "", "أ: " + conflict.left.text),
      makeNode("p", "", "ب: " + conflict.right.text),
      makeNode("p", "", "يجب مراجعة المصدر والتوقيت قبل حسم التعارض.")
    );
    list.append(card);
  }
}
function analyze(options = {}) {
  const text = input.value.trim();
  if (!text) {
    setNotice("أدخل سياقًا أو اختر قالبًا سريعًا.", "error");
    return null;
  }
  try {
    currentContext = compileContext(text);
    $("#metric-claims").textContent = String(currentContext.claims.length);
    $("#metric-constraints").textContent = String(currentContext.constraints.length);
    $("#metric-decisions").textContent = String(currentContext.decisions.length);
    $("#metric-conflicts").textContent = String(currentContext.conflicts.length);
    $("#readiness-score").textContent = String(computeStructureScore(currentContext));
    renderWarnings(currentContext);
    renderClaims(currentContext);
    renderConflicts(currentContext);
    resultsPanel.hidden = false;
    if (!options.quiet) setNotice("اكتمل التحليل. الادعاءات غير مؤكدة والتعارضات تحتاج مراجعة.", "success");
    return currentContext;
  } catch (error) {
    currentContext = null;
    setNotice("تعذر تحليل السياق: " + (error?.message || "خطأ غير معروف"), "error");
    return null;
  }
}
function makeDraftPlan() {
  const context = analyze({ quiet: true });
  if (!context) return;
  const steps = [];
  if (!context.objectives.length) {
    steps.push(["حدد الهدف", "اكتب نتيجة قابلة للتحقق قبل اختيار طريقة التنفيذ."]);
  }
  if (context.conflicts.length) {
    steps.push(["راجع التعارضات", "قارن مصادر الطرفين وتواريخهما، ولا تحسم التعارض آليًا."]);
  }
  if (context.openQuestions.length) {
    steps.push(["أجب عن الأسئلة المفتوحة", "حوّل كل سؤال غير محسوم إلى خطوة تحقق محددة."]);
  }
  steps.push(["تحقق من الأدلة", "اربط الادعاءات المهمة بمصدر موثوق وتاريخ ومقتطف داعم."]);
  steps.push(["راجع القيود والموافقات", "تأكد من توافق الخطوات مع القيود، واحتفظ بموافقة بشرية للإجراءات الحساسة."]);
  steps.push(["حدد اختبار النجاح", "اكتب نتيجة متوقعة يمكن فحصها بشكل مستقل، دون اعتبار إعداد الخطة إنجازًا للمهمة."]);

  const list = $("#draft-list");
  list.replaceChildren();
  for (const [title, description] of steps) {
    const item = makeNode("li", "draft-item");
    item.append(
      makeNode("strong", "", title),
      makeNode("p", "", description),
      makeNode("span", "draft-state", "INFERRED · يحتاج مراجعة")
    );
    list.append(item);
  }
  draftPanel.hidden = false;
  setNotice("أُنشئت مسودة استدلالية محلية فقط؛ لا توجد استدعاءات لنموذج أو أدوات.", "success");
  draftPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}
function likelyContainsSecret(text) {
  return /(?:api[_ -]?key|access[_ -]?token|password|private[_ -]?key|secret)\s*[:=]|(?:كلمة المرور|المفتاح الخاص|رمز الوصول)\s*[:=]/i.test(text);
}
function saveLocal() {
  const context = currentContext || analyze({ quiet: true });
  if (!context) return;
  const source = input.value.trim();
  if (likelyContainsSecret(source)) {
    setNotice("أوقفت الحفظ: قد يتضمن النص قيمة سرية. احذف الأسرار قبل المتابعة.", "error");
    return;
  }
  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    savedAt: new Date().toISOString(),
    objective: context.objective || "سياق بلا هدف صريح",
    preview: source.slice(0, 170),
    source,
    status: "PENDING"
  };
  const history = safeReadHistory().filter(item => item.source !== source);
  history.unshift(record);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    setNotice("تعذر الحفظ المحلي؛ قد تكون مساحة تخزين التطبيق ممتلئة.", "error");
    return;
  }
  renderHistory();
  historyPanel.hidden = false;
  setNotice("تم حفظ السياق على هذا الجهاز فقط، بحالة PENDING.", "success");
}
function renderHistory() {
  const list = $("#history-list");
  const history = safeReadHistory();
  list.replaceChildren();
  if (!history.length) {
    list.append(makeNode("div", "empty-history", "لا توجد عناصر محفوظة. اضغط «احفظ محليًا» بعد مراجعة السياق."));
    return;
  }
  for (const record of history) {
    const card = makeNode("article", "history-card");
    const copy = makeNode("div", "history-copy");
    const date = new Date(record.savedAt);
    copy.append(
      makeNode("strong", "", record.objective || "سياق محفوظ"),
      makeNode("p", "", date.toLocaleString("ar") + " · " + record.preview)
    );
    const restore = makeNode("button", "button button-quiet", "استرجاع");
    restore.type = "button";
    restore.dataset.restoreId = record.id;
    card.append(copy, restore);
    list.append(card);
  }
}
function downloadJson() {
  const context = currentContext || analyze({ quiet: true });
  if (!context) return;
  const payload = {
    product: "Context Forge",
    exportPolicy: "user_initiated_local_export",
    context,
    sourceText: input.value
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "context-forge-" + new Date().toISOString().replace(/:/g, "-") + ".json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setNotice("تم تجهيز ملف JSON للتصدير.", "success");
}
async function copyJson() {
  const context = currentContext || analyze({ quiet: true });
  if (!context) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify({ context, sourceText: input.value }, null, 2));
    setNotice("تم نسخ JSON.", "success");
  } catch {
    setNotice("تعذر النسخ التلقائي على هذا الجهاز؛ استخدم «صدّر التقرير».", "error");
  }
}
async function importFile(file) {
  if (!file) return;
  const contents = await file.text();
  if (file.name.toLowerCase().endsWith(".json")) {
    try {
      const parsed = JSON.parse(contents);
      if (Array.isArray(parsed.claims)) {
        input.value = parsed.claims.map(item => typeof item === "string" ? item : item.text).filter(Boolean).join("\n");
      } else if (parsed.sourceText && typeof parsed.sourceText === "string") {
        input.value = parsed.sourceText;
      } else {
        input.value = contents;
      }
    } catch {
      input.value = contents;
    }
  } else {
    input.value = contents;
  }
  currentContext = null;
  updateCounter();
  setNotice("تم استيراد الملف. راجع محتواه ثم شغّل التحليل.", "success");
}
function loadTemplate(name) {
  input.value = templates[name] || templates.project;
  currentContext = null;
  updateCounter();
  analyze();
}
$("#analyze-button").addEventListener("click", () => analyze());
$("#draft-plan-button").addEventListener("click", makeDraftPlan);
$("#save-button").addEventListener("click", saveLocal);
$("#copy-button").addEventListener("click", copyJson);
$("#export-button").addEventListener("click", downloadJson);
$("#clear-button").addEventListener("click", () => {
  input.value = "";
  currentContext = null;
  resultsPanel.hidden = true;
  draftPanel.hidden = true;
  updateCounter();
  setNotice("تم مسح مساحة الإدخال. السجل المحلي لم يتغير.");
});
$("#import-button").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", async event => {
  try { await importFile(event.target.files?.[0]); }
  catch { setNotice("تعذرت قراءة الملف.", "error"); }
  finally { event.target.value = ""; }
});
document.querySelectorAll("[data-template]").forEach(button => {
  button.addEventListener("click", () => loadTemplate(button.dataset.template));
});
$("#history-title").addEventListener("click", () => {
  historyPanel.hidden = !historyPanel.hidden;
});
$("#history-list").addEventListener("click", event => {
  const button = event.target.closest("[data-restore-id]");
  if (!button) return;
  const record = safeReadHistory().find(item => item.id === button.dataset.restoreId);
  if (!record) return;
  input.value = record.source;
  currentContext = null;
  updateCounter();
  analyze();
  setNotice("تم استرجاع سياق محفوظ؛ راجعه قبل الاعتماد.", "success");
  $("#input-title").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#clear-history-button").addEventListener("click", () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
    setNotice("تم مسح السجل المحلي من هذا الجهاز.", "success");
  } catch {
    setNotice("تعذر مسح السجل المحلي.", "error");
  }
});
input.addEventListener("input", () => {
  currentContext = null;
  updateCounter();
});
updateCounter();
renderHistory();
