const EXPECTED_ANSWER = 410;

function collectText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseAnswerObject(text) {
  const candidates = [text];
  const objectMatch = text.match(/\{[^{}]*\}/s);
  if (objectMatch && objectMatch[0] !== text) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const value = parsed.answer;
      if (typeof value === "number" && Number.isFinite(value) && value === EXPECTED_ANSWER) return true;
      if (typeof value === "string" && value.trim() === String(EXPECTED_ANSWER)) return true;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  return false;
}

export function benchmarkAnswerMatches(content) {
  const text = collectText(content);
  if (!text) return false;
  return parseAnswerObject(text);
}
