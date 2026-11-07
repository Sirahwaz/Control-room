const PUBLIC_SOURCE_SCOPES = new Set(["public_market_data","public_chain_data","public_web_content","public_technical_docs","public_reference"]);
const SANITIZATION_METHODS = new Set(["credential_redaction","pii_redaction","allowlisted_fields","aggregation_only"]);
const SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\\b(?:sk-[a-z0-9_-]{16,}|AIza[a-z0-9_-]{20,})\\b/i,
  /\\bbearer\\s+[a-z0-9._~+\\/-]{16,}/i,
  /\\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|private[_-]?key|mnemonic|seed[_ -]?phrase)\\s*[:=]\\s*["']?[^\\s,"']{8,}/i,
  /\\b(?:seed|recovery|mnemonic)\\s*(?:phrase|words)?\\s*[:=]\\s*(?:[a-z]{3,}\\s+){2,}[a-z]{3,}/i
];

/**
 * @param {{
 *  taskClass?: string,
 *  dataClass?: string,
 *  sourceScope?: string,
 *  sanitizationVerified?: boolean,
 *  sanitizationMethod?: string,
 *  content?: string
 * }} input
 */
export function resolveRouterRoutePolicy(input = {}) {
  const taskClass = String(input.taskClass ?? "").trim().toLowerCase();
  if (taskClass !== "public_sanitized") {
    return { ok: true, taskClass: String(input.taskClass ?? ""), dataClass: null };
  }
  const dataClass = String(input.dataClass ?? "").trim().toLowerCase();
  if (dataClass !== "public" && dataClass !== "sanitized") {
    return { ok: false, error: "public_route_requires_public_or_sanitized_data_class" };
  }
  const sourceScope = String(input.sourceScope ?? "").trim().toLowerCase();
  if (dataClass === "public" && !PUBLIC_SOURCE_SCOPES.has(sourceScope)) {
    return { ok: false, error: "public_route_requires_allowlisted_source_scope" };
  }
  const sanitizationMethod = String(input.sanitizationMethod ?? "").trim().toLowerCase();
  if (dataClass === "sanitized" && (input.sanitizationVerified !== true || !SANITIZATION_METHODS.has(sanitizationMethod))) {
    return { ok: false, error: "sanitized_route_requires_verified_sanitization_method" };
  }
  const content = String(input.content ?? "");
  if (!content.trim()) return { ok: false, error: "public_route_content_required" };
  if (SENSITIVE_PATTERNS.some(pattern => pattern.test(content))) {
    return { ok: false, error: "public_route_sensitive_material_detected" };
  }
  return {
    ok: true,
    taskClass: "public_sanitized",
    dataClass,
    sourceScope,
    sanitizationMethod: dataClass === "sanitized" ? sanitizationMethod : null
  };
}
