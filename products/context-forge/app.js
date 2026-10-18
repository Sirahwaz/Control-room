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
