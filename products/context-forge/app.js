import { compileContext } from "./context-engine.mjs";

const $ = (selector) => document.querySelector(selector);
const source = $("#source-text");
const compileButton = $("#compile-button");
const sampleButton = $("#sample-button");
const clearButton = $("#clear-button");
const fileInput = $("#file-input");
const charCount = $("#char-count");
const resultStatus = $("#result-status");
const emptyState = $("#empty-state");
const resultContent = $("#result-content");
const warningsBox = $("#warnings");
const objectiveBox = $("#objective-box");
const claimsList = $("#claims-list");
const conflictsList = $("#conflicts-list");
const jsonOutput = $("#json-output");

let currentContext = null;

const SAMPLE = [
  "Goal: Evaluate a context package before passing it to an AI agent.",
  "Constraint: Never store API keys or recovery phrases.",
  "Decision: Use a model-agnostic context package.",
  "The API is enabled.",
  "The API is not enabled.",
  "Open question: Which model provider should be supported first?",
  "Evidence: Local project notes; not independently verified."
].join("\n");

const CATEGORY_LABELS = {
  objective: "هدف",
  constraint: "قيد",
  decision: "قرار",
  openQuestion: "سؤال مفتوح",
  claim: "معلومة / ادعاء"
};

function setNotice(message, isError = false) {
  resultStatus.textContent = message;
  resultStatus.className = isError ? "status-chip pending" : "status-chip";
  if (!isError && currentContext) resultStatus.classList.add("ready");
}

function updateCharCount() {
  charCount.textContent = `${source.value.length.toLocaleString("ar")} حرف`;
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text ?? "";
  return element;
}

function renderWarnings(warnings) {
  warningsBox.replaceChildren();
  warningsBox.hidden = warnings.length === 0;
  for (const warning of warnings) {
    const item = document.createElement("div");
    item.className = "warning-item";
    item.append(
      createTextElement("strong", "", warning.code),
      createTextElement("span", "", warning.message)
    );
    warningsBox.append(item);
  }
}

function renderClaims(claims) {
  claimsList.replaceChildren();
  if (!claims.length) {
    claimsList.append(createTextElement("div", "no-conflicts", "لا توجد وحدات سياق."));
    return;
  }
  for (const claim of claims) {
    const card = document.createElement("article");
    card.className = "claim-card";
    const top = document.createElement("div");
    top.className = "claim-top";
    top.append(
      createTextElement("span", "category-label", CATEGORY_LABELS[claim.category] ?? claim.category),
      createTextElement("span", "unverified-label", claim.status)
    );
    card.append(
      top,
      createTextElement("p", "claim-text", claim.text),
      createTextElement("div", "claim-source", `source: ${claim.source.type} · line ${claim.source.line}`)
    );
    claimsList.append(card);
  }
}

function renderConflicts(conflicts) {
  conflictsList.replaceChildren();
  if (!conflicts.length) {
    conflictsList.append(createTextElement("div", "no-conflicts", "لم يرصد المحرك تعارضًا صريحًا وفق قواعده المحدودة. هذا لا يثبت أن السياق خالٍ من التعارض."));
    return;
  }
  for (const conflict of conflicts) {
    const card = document.createElement("article");
    card.className = "conflict-card";
    card.append(
      createTextElement("span", "conflict-tag", `${conflict.status} · ${conflict.id}`),
      createTextElement("p", "", `A: ${conflict.left.text}`),
      createTextElement("p", "", `B: ${conflict.right.text}`),
      createTextElement("p", "", conflict.explanation)
    );
    conflictsList.append(card);
  }
}

function renderContext(context) {
  currentContext = context;
  emptyState.hidden = true;
  resultContent.hidden = false;
  setNotice("تم بناء الحزمة");
  $("#metric-claims").textContent = String(context.claims.length);
  $("#metric-decisions").textContent = String(context.decisions.length);
  $("#metric-constraints").textContent = String(context.constraints.length);
  $("#metric-conflicts").textContent = String(context.conflicts.length);
  objectiveBox.textContent = context.objective ?? "لم يتم تحديد هدف صريح. أضف سطرًا يبدأ بـ Goal: أو «الهدف:».";
  renderWarnings(context.warnings);
  renderClaims(context.claims);
  renderConflicts(context.conflicts);
  jsonOutput.textContent = JSON.stringify(context, null, 2);
}

function compile() {
  try {
    const context = compileContext(source.value);
    renderContext(context);
  } catch (error) {
    currentContext = null;
    resultContent.hidden = true;
    emptyState.hidden = false;
    setNotice("تعذر بناء الحزمة", true);
    console.error("Context Forge local compile failed", error);
  }
}

async function importFile(file) {
  if (!file) return;
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".json")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.claims)) {
        source.value = parsed.claims.map((claim) => typeof claim === "string" ? claim : claim.text).filter(Boolean).join("\n");
      } else {
        source.value = text;
      }
    } catch {
      source.value = text;
    }
  } else {
    source.value = text;
  }
  updateCharCount();
  setNotice("تم الاستيراد — راجع النص قبل التحليل");
}

function downloadJson() {
  if (!currentContext) return;
  const blob = new Blob([JSON.stringify(currentContext, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `context-forge-${new Date().toISOString().replaceAll(":", "-")}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function copyJson() {
  if (!currentContext) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(currentContext, null, 2));
    setNotice("تم نسخ JSON");
  } catch {
    setNotice("تعذر النسخ التلقائي؛ افتح JSON وانسخه يدويًا", true);
  }
}

compileButton.addEventListener("click", compile);
sampleButton.addEventListener("click", () => {
  source.value = SAMPLE;
  updateCharCount();
  compile();
});
clearButton.addEventListener("click", () => {
  source.value = "";
  updateCharCount();
  currentContext = null;
  resultContent.hidden = true;
  emptyState.hidden = false;
  setNotice("بانتظار التحليل");
});
source.addEventListener("input", updateCharCount);
fileInput.addEventListener("change", async (event) => {
  try {
    await importFile(event.target.files?.[0]);
  } catch {
    setNotice("فشل قراءة الملف", true);
  } finally {
    fileInput.value = "";
  }
});
$("#download-button").addEventListener("click", downloadJson);
$("#copy-button").addEventListener("click", copyJson);
updateCharCount();

const runtimeTokenInput = $("#runtime-token");
const runtimeStatusChip = $("#runtime-status-chip");
const runtimeApiStatus = $("#runtime-api-status");
const runtimeCheckButton = $("#runtime-check-button");
const modelProbeButton = $("#model-probe-button");
const agentPlanButton = $("#agent-plan-button");
const agentGoalInput = $("#agent-goal");
const agentPlanResult = $("#agent-plan-result");
const agentPlanBadge = $("#agent-plan-badge");
const agentPlanOutput = $("#agent-plan-output");
const memorySaveButton = $("#memory-save-button");
const memorySearchButton = $("#memory-search-button");
const learnReportButton = $("#learn-report-button");
const memoryQueryInput = $("#memory-query");
const memoryApiStatus = $("#memory-api-status");
const memoryResults = $("#memory-results");
const memoryOutput = $("#memory-output");

function setRuntimeStatus(message, state = "pending") {
  runtimeStatusChip.textContent = message;
  runtimeStatusChip.className = "status-chip " + state;
}

async function checkRuntime() {
  runtimeCheckButton.disabled = true;
  try {
    const response = await fetch("/api/health", { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error("runtime_unavailable");
    const health = await response.json();
    if (health.service !== "context-forge" || health.status !== "ok") {
      throw new Error("unexpected_runtime");
    }
    setRuntimeStatus("النواة المحلية متصلة", "ready");
    runtimeApiStatus.textContent = health.reasonerReady
      ? "إعداد المزوّد موجود، لكن الاتصال الحي لم يُتحقق منه بعد. اضغط «اختبار اتصال النموذج». الخطط تبقى Dry-run."
      : "النواة متصلة، لكن إعداد النموذج غير مكتمل أو إرسال السياق إلى المزوّد البعيد غير مسموح.";
    runtimeApiStatus.className = "runtime-api-status pending";
  } catch {
    setRuntimeStatus("النواة غير متصلة");
    runtimeApiStatus.textContent = "لا توجد واجهة Runtime على هذا العنوان. شغّل الخادم المحلي بعد إعداد رمز الوصول.";
    runtimeApiStatus.className = "runtime-api-status pending";
  } finally {
    runtimeCheckButton.disabled = false;
  }
}

async function probeModel() {
  const token = runtimeTokenInput.value.trim();
  if (!token) {
    runtimeApiStatus.textContent = "أدخل رمز الوصول المحلي. لا تضع مفتاح النموذج في هذا الحقل.";
    runtimeApiStatus.className = "runtime-api-status pending";
    return;
  }
  modelProbeButton.disabled = true;
  modelProbeButton.textContent = "جارٍ اختبار اتصال النموذج...";
  try {
    const result = await authorizedPost("/api/model/probe", {});
    if (result.status !== "VERIFIED" || result.scope !== "synthetic_connectivity_only") {
      throw new Error("لم يتم إثبات اتصال النموذج.");
    }
    runtimeApiStatus.textContent = "اتصال النموذج VERIFIED للاختبار الاصطناعي فقط. لم يُرسل سياق المستخدم ولم تُنفّذ أدوات.";
    runtimeApiStatus.className = "runtime-api-status ready";
  } catch (error) {
    runtimeApiStatus.textContent = error.message || "فشل اختبار اتصال النموذج؛ راجع إعدادات الخادم.";
    runtimeApiStatus.className = "runtime-api-status pending";
  } finally {
    modelProbeButton.disabled = false;
    modelProbeButton.textContent = "اختبار اتصال النموذج";
  }
}

async function planWithRuntime() {
  const token = runtimeTokenInput.value.trim();
  const goal = agentGoalInput.value.trim();
  if (!token) {
    runtimeApiStatus.textContent = "أدخل رمز الوصول المحلي. لا تضع مفتاح مزوّد النموذج في هذا الحقل.";
    runtimeApiStatus.className = "runtime-api-status pending";
    return;
  }
  if (!goal) {
    runtimeApiStatus.textContent = "اكتب هدفًا واضحًا للوكيل قبل التخطيط.";
    runtimeApiStatus.className = "runtime-api-status pending";
    return;
  }

  agentPlanButton.disabled = true;
  agentPlanButton.textContent = "جارٍ تنفيذ مراحل الدورة...";
  agentPlanResult.hidden = true;
  runtimeApiStatus.textContent = "تنفيذ Context → Plan → Verify → Memory → Learn. التخطيط تجريبي، ولن تُنفّذ الأدوات الخارجية.";
  runtimeApiStatus.className = "runtime-api-status";
  try {
    const response = await fetch("/api/agent/cycle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({ goal, contextText: source.value })
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("استجابة Runtime غير صالحة.");
    }
    if (!response.ok) {
      runtimeApiStatus.textContent = body.error || "تعذر إعداد الخطة.";
      runtimeApiStatus.className = "runtime-api-status pending";
      if (body.code === "REASONER_NOT_CONFIGURED") {
        setRuntimeStatus("النموذج غير مضبوط");
      }
      return;
    }
    agentPlanOutput.textContent = JSON.stringify(body, null, 2);
    agentPlanBadge.textContent = body.stages ? (body.stages.verify.status + " / " + body.taskStatus) : (body.status || "PENDING");
    agentPlanBadge.className = "mini-tag";
    agentPlanResult.hidden = false;
    runtimeApiStatus.textContent = body.stages
      ? "اكتملت مراجعة مراحل الدورة. VERIFIED هنا يعني فحص سياسة الخطة فقط؛ لم تُنفّذ أدوات أو تُثبت نتيجة المهمة. الذاكرة: " + String(body.stages.memory.status) + "، والتعلّم: " + String(body.stages.learn.status) + "."
      : "حالة الخطة: " + String(body.status || "غير معروفة") + ". راجع التفاصيل قبل أي خطوة أخرى.";
    runtimeApiStatus.className = "runtime-api-status " + (body.stages?.verify?.status === "VERIFIED" ? "ready" : "pending");
  } catch {
    runtimeApiStatus.textContent = "فشل الاتصال بالنواة المحلية. تحقق من تشغيل الخادم والمسار ثم أعد الفحص.";
    runtimeApiStatus.className = "runtime-api-status pending";
  } finally {
    agentPlanButton.disabled = false;
    agentPlanButton.textContent = "شغّل دورة Context → Plan → Verify → Memory → Learn";
  }
}

runtimeCheckButton.addEventListener("click", checkRuntime);
modelProbeButton.addEventListener("click", probeModel);
agentPlanButton.addEventListener("click", planWithRuntime);
window.addEventListener("pagehide", () => {
  runtimeTokenInput.value = "";
});
checkRuntime();


async function authorizedPost(path, payload) {
  const token = runtimeTokenInput.value.trim();
  if (!token) throw new Error("أدخل رمز الوصول المحلي أولًا.");
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify(payload)
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("استجابة Runtime غير صالحة.");
  }
  if (!response.ok) throw new Error(body.error || "تعذر إكمال طلب الذاكرة.");
  return body;
}

function renderMemoryResult(status, payload, mode = "ready") {
  memoryApiStatus.textContent = status;
  memoryApiStatus.className = "runtime-api-status " + mode;
  memoryOutput.textContent = JSON.stringify(payload, null, 2);
  memoryResults.hidden = false;
}

async function saveContextNote() {
  const note = source.value.trim();
  if (!note) {
    memoryApiStatus.textContent = "أضف سياقًا أولًا. لن يتم حفظ نص فارغ.";
    memoryApiStatus.className = "runtime-api-status pending";
    return;
  }
  memorySaveButton.disabled = true;
  try {
    const result = await authorizedPost("/api/memory/save", {
      text: note,
      sourceLabel: "context-forge-workbench"
    });
    renderMemoryResult("حُفظت الملاحظة بحالة PENDING؛ لم تُتحقق مستقلًا.", result, "ready");
  } catch (error) {
    memoryApiStatus.textContent = error.message || "تعذر حفظ الملاحظة.";
    memoryApiStatus.className = "runtime-api-status pending";
  } finally {
    memorySaveButton.disabled = false;
  }
}

async function searchMemory() {
  const query = memoryQueryInput.value.trim();
  if (!query) {
    memoryApiStatus.textContent = "اكتب عبارة قصيرة للبحث.";
    memoryApiStatus.className = "runtime-api-status pending";
    return;
  }
  memorySearchButton.disabled = true;
  try {
    const result = await authorizedPost("/api/memory/search", { query });
    renderMemoryResult("عدد النتائج: " + String(result.count), result, "ready");
  } catch (error) {
    memoryApiStatus.textContent = error.message || "تعذر البحث في الذاكرة.";
    memoryApiStatus.className = "runtime-api-status pending";
  } finally {
    memorySearchButton.disabled = false;
  }
}

async function loadLearningReport() {
  learnReportButton.disabled = true;
  try {
    const result = await authorizedPost("/api/agent/learn", { limit: 100 });
    const note = result.cyclesAnalyzed > 0
      ? "تقرير استدلالي من سجل دورات محلية؛ لا يثبت إكمال المهام."
      : "لا توجد دورات سابقة كافية للتعلّم بعد.";
    renderMemoryResult(note, result, result.cyclesAnalyzed > 0 ? "ready" : "pending");
  } catch (error) {
    memoryApiStatus.textContent = error.message || "تعذر تحميل تقرير التعلّم.";
    memoryApiStatus.className = "runtime-api-status pending";
  } finally {
    learnReportButton.disabled = false;
  }
}

memorySaveButton.addEventListener("click", saveContextNote);
memorySearchButton.addEventListener("click", searchMemory);
learnReportButton.addEventListener("click", loadLearningReport);
memoryQueryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchMemory();
});
