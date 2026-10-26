const NEGATION = /\b(?:not|never|no|cannot|can't|mustn't|don't|doesn't|isn't|aren't|won't|without|non)\b|\b(?:غير|لا|ليس|ليست|لن|لم|ماكو|مو|ممنوع)\b/i;
const NEGATION_WORDS = /\b(?:not|never|no|cannot|can't|mustn't|don't|doesn't|isn't|aren't|won't|without|non)\b|\b(?:غير|لا|ليس|ليست|لن|لم|ماكو|مو|ممنوع)\b/gi;
const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "do", "does", "did", "of", "to"]);
const PREFIX = /^\s*(?:[-*•]|\d+[.)]|\[[ xX]\])\s*/;

function cleanLine(line) {
  return String(line ?? "").replace(PREFIX, "").trim();
}

function classifyLine(text) {
  if (/(?:\?|؟|\b(?:todo|tbd|unknown|pending|open question|needs? verification|unclear)\b|غير معروف|غير محسوم|بحاجة إلى تحقق|بحاجة للتحقق|سؤال مفتوح|معلّق|معلق)/i.test(text)) {
    return "openQuestion";
  }
  if (/^(?:goal|objective|aim|purpose)\s*[:—-]|\b(?:goal|objective|our aim)\b|(?:الهدف|الغاية|أريد|اريد|نريد|المطلوب|نبني|تطوير المنتج)\s*[:：]?/i.test(text)) {
    return "objective";
  }
  if (/^(?:decision|decided|chosen approach)\s*[:—-]|\b(?:we decided|decision|we will use|adopted)\b|(?:قررنا|القرار|اعتمدنا|سنعتمد|تم اعتماد)\s*[:：]?/i.test(text)) {
    return "decision";
  }
  if (/^(?:constraint|requirement|policy|must not|must|never|do not)\s*[:—-]?|\b(?:must not|must|never|do not|don't|only|cannot|should not|requirement|constraint|forbidden|limit)\b|(?:يجب|لا يجوز|ممنوع|لا تخزن|لا تحفظ|ينبغي|قيد|شرط|عدم السماح)/i.test(text)) {
    return "constraint";
  }
  return "claim";
}

function polarity(text) {
  return NEGATION.test(text);
}

function canonicalize(text) {
  return text
    .toLocaleLowerCase()
    .replace(NEGATION_WORDS, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word))
    .join(" ")
    .trim();
}

export function detectConflicts(lines) {
  const items = (lines ?? [])
    .map((entry, index) => ({ text: typeof entry === "string" ? entry : entry.text, index }))
    .filter((entry) => typeof entry.text === "string" && entry.text.trim());
  const conflicts = [];
  const seen = new Set();

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i];
      const right = items[j];
      if (left.text.trim().toLocaleLowerCase() === right.text.trim().toLocaleLowerCase()) continue;
      if (polarity(left.text) === polarity(right.text)) continue;
      const leftCanonical = canonicalize(left.text);
      const rightCanonical = canonicalize(right.text);
      if (!leftCanonical || leftCanonical !== rightCanonical) continue;
      const key = [left.index, right.index].join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        id: `conflict-${conflicts.length + 1}`,
        left: { index: left.index, text: left.text },
        right: { index: right.index, text: right.text },
        status: "PENDING_REVIEW",
        explanation: "Possible opposite polarity for the same normalized statement; review source and timestamp before deciding."
      });
    }
  }
  return conflicts;
}

export function compileContext(rawText, options = {}) {
  const now = typeof options.now === "function" ? options.now() : new Date();
  const generatedAt = now.toISOString();
  const lines = String(rawText ?? "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  const claims = lines.map((text, index) => ({
    id: `claim-${index + 1}`,
    text,
    category: classifyLine(text),
    status: "UNVERIFIED",
    source: {
      type: "user_input",
      line: index + 1,
      capturedAt: generatedAt
    }
  }));

  const objectives = claims.filter((claim) => claim.category === "objective");
  const constraints = claims.filter((claim) => claim.category === "constraint");
  const decisions = claims.filter((claim) => claim.category === "decision");
  const openQuestions = claims.filter((claim) => claim.category === "openQuestion");
  const conflicts = detectConflicts(claims);
  const warnings = [];

  if (objectives.length === 0) {
    warnings.push({
      code: "OBJECTIVE_MISSING",
      severity: "warning",
      message: "No explicit objective was detected. Add a goal before using this context for task execution."
    });
  }
  if (conflicts.length > 0) {
    warnings.push({
      code: "CONFLICTS_PENDING_REVIEW",
      severity: "warning",
      message: `${conflicts.length} possible conflict(s) require human or evidence-based review.`
    });
  }

  return {
    schemaVersion: "context-forge/0.1",
    generatedAt,
    objective: objectives[0]?.text ?? null,
    objectives,
    constraints,
    decisions,
    openQuestions,
    claims,
    conflicts,
    warnings,
    executionPolicy: {
      mode: "analysis_only",
      autonomousExternalActions: false,
      humanApprovalRequiredForHighImpact: true
    }
  };
}
