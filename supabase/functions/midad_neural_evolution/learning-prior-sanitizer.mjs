const MAX_DEPTH = 7;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_FIELDS = 40;
const MAX_STRING_LENGTH = 512;
const SENSITIVE_KEY = /(?:secret|token|api[-_]?key|password|credential|authorization|private[-_]?key|mnemonic|seed|bearer)/i;
const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bsb_secret_[A-Za-z0-9_-]{12,}\b/g,
  /\bsk-or-[A-Za-z0-9_-]{12,}\b/g,
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
];

function sanitizeString(value) {
  let result = value.slice(0, MAX_STRING_LENGTH);
  for (const pattern of TOKEN_PATTERNS) result = result.replace(pattern, "[REDACTED_SECRET_LIKE]");
  return result;
}

export function sanitizeDecisionAction(value) {
  const seen = new WeakSet();

  function visit(input, depth) {
    if (depth >= MAX_DEPTH) return "[DEPTH_LIMIT]";
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (typeof input === "string") return sanitizeString(input);
    if (typeof input !== "object") return undefined;
    if (seen.has(input)) return "[CIRCULAR_REFERENCE]";
    seen.add(input);

    if (Array.isArray(input)) {
      const output = input.slice(0, MAX_ARRAY_ITEMS).map((item) => {
        const cleaned = visit(item, depth + 1);
        return cleaned === undefined ? null : cleaned;
      });
      if (input.length > MAX_ARRAY_ITEMS) output.push("[TRUNCATED]");
      return output;
    }

    const output = {};
    const entries = Object.entries(input);
    let accepted = 0;
    for (const [key, item] of entries) {
      if (SENSITIVE_KEY.test(key)) continue;
      if (accepted >= MAX_OBJECT_FIELDS) {
        output.__truncated__ = true;
        break;
      }
      const cleaned = visit(item, depth + 1);
      if (cleaned === undefined) continue;
      output[key.slice(0, 128)] = cleaned;
      accepted++;
    }
    return output;
  }

  const result = visit(value, 0);
  return result === undefined ? {} : result;
}
