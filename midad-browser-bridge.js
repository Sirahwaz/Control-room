const ALLOWED_SUBACTIONS = new Set(["capabilities", "list_sessions", "command", "get_result"]);
const SENSITIVE_COMMAND = /\b(?:password|passcode|access[_ -]?token|refresh[_ -]?token|secret|api[_ -]?key|private[_ -]?key|recovery phrase|seed phrase)\s*[:=]\s*[^\s,;]+/i;

export function buildBridgePayload(token, subaction, fields = {}) {
  if (typeof token !== "string" || !token.trim()) throw new Error("SESSION_REQUIRED");
  if (!ALLOWED_SUBACTIONS.has(subaction)) throw new Error("SUBACTION_NOT_ALLOWED");
  return { ...fields, action: "user_bridge", subaction, token };
}

export function validateOperatorHint(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("COMMAND_REQUIRED");
  const command = value.trim();
  if (command.length > 500) throw new Error("COMMAND_LENGTH_INVALID");
  if (SENSITIVE_COMMAND.test(command) ||
      /(?:Bearer\s+[A-Za-z0-9._~+/=-]{12,}|(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}))/i.test(command)) {
    throw new Error("SENSITIVE_COMMAND_REJECTED");
  }
  return command;
}
