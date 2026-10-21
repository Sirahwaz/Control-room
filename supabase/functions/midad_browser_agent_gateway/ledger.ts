const LEDGER_EVENT_TYPES = new Set([
  "job_created",
  "state_transition",
  "navigation_observed",
  "policy_decision",
  "human_gate_opened",
  "human_gate_resumed",
  "evidence_captured",
  "artifact_published",
  "payment_claim_observed",
  "error",
  "job_cancelled",
  "retry_scheduled",
]);

const BROWSER_STATES = new Set([
  "QUEUED",
  "RESEARCHING",
  "PREPARING",
  "RUNNING",
  "HUMAN_GATE",
  "BLOCKED",
  "SUBMITTED",
  "VERIFYING",
  "PAID",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

const EVIDENCE_LIMITS: Record<string, { kind: "string"; max: number } | { kind: "number"; min: number; max: number } | { kind: "boolean" } | { kind: "sha256" } | { kind: "url" }> = {
  source_kind: { kind: "string", max: 100 },
  http_status: { kind: "number", min: 100, max: 599 },
  content_type: { kind: "string", max: 150 },
  bytes_read: { kind: "number", min: 0, max: 2_000_000 },
  duration_ms: { kind: "number", min: 0, max: 120_000 },
  policy_code: { kind: "string", max: 100 },
  policy_status: { kind: "string", max: 30 },
  artifact_sha256: { kind: "sha256" },
  artifact_url: { kind: "url" },
  attempt: { kind: "number", min: 0, max: 3 },
  error_code: { kind: "string", max: 100 },
  retryable: { kind: "boolean" },
};

function safeToken(value: unknown, max = 100): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim().slice(0, max);
  return token && /^[A-Za-z0-9_.:-]+$/.test(token) ? token : null;
}

function isIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

/**
 * Returns a credential-free HTTPS source URL without query, fragment or non-default port.
 * IP-literal hosts are rejected because browser evidence should use an approved DNS host.
 */
export function safeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || isIpLiteral(host)) return null;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    return `https://${host}${url.pathname || "/"}`;
  } catch {
    return null;
  }
}

export function normalizeLedgerEventType(raw: unknown): string {
  const source = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (LEDGER_EVENT_TYPES.has(source)) return source;

  if (source.includes("human_gate_completed") || source.includes("human_gate_resumed") || source.includes("complete_human_gate")) return "human_gate_resumed";
  if (source.includes("human_gate") || source.includes("captcha") || source.includes("human_verification")) return "human_gate_opened";
  if (source.includes("block") || source.includes("policy") || source.includes("denied")) return "policy_decision";
  if (source.includes("navigation") || source.includes("navigate") || source.includes("route")) return "navigation_observed";
  if (source.includes("capture") || source.includes("evidence") || source.includes("screenshot") || source.includes("extract")) return "evidence_captured";
  if (source.includes("publish") || source.includes("artifact")) return "artifact_published";
  if (source.includes("payment") || source.includes("payout") || source.includes("award") || source.includes("receipt")) return "payment_claim_observed";
  if (source.includes("retry")) return "retry_scheduled";
  if (source.includes("cancel")) return "job_cancelled";
  if (source.includes("error") || source.includes("fail")) return "error";
  if (source.includes("created")) return "job_created";
  return "state_transition";
}

export function normalizeTargetState(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const state = raw.trim().toUpperCase();
  return BROWSER_STATES.has(state) ? state : null;
}

export function sanitizeLedgerEvidence(raw: unknown): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const result: Record<string, string | number | boolean> = {};

  for (const key of Object.keys(EVIDENCE_LIMITS).sort()) {
    if (!(key in source)) continue;
    const value = source[key];
    const rule = EVIDENCE_LIMITS[key];
    if (value === null || value === undefined) continue;

    if (rule.kind === "string") {
      if (typeof value !== "string") continue;
      const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
      if (!cleaned || cleaned.length > rule.max) continue;
      if ((key === "policy_code" || key === "error_code") && !/^[A-Za-z0-9_.:-]+$/.test(cleaned)) continue;
      result[key] = cleaned;
      continue;
    }

    if (rule.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) continue;
      if (value < rule.min || value > rule.max) continue;
      result[key] = value;
      continue;
    }

    if (rule.kind === "boolean") {
      if (typeof value === "boolean") result[key] = value;
      continue;
    }

    if (rule.kind === "sha256") {
      if (typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value)) result[key] = value.toLowerCase();
      continue;
    }

    if (rule.kind === "url") {
      const safe = safeSourceUrl(value);
      if (safe) result[key] = safe;
    }
  }
  return result;
}

export interface LedgerEventKeyInput {
  jobId: string;
  eventType: string;
  targetState?: string | null;
  sourceUrl?: string | null;
  nextAction?: string | null;
  blockerCode?: string | null;
  attemptCount?: number | null;
  evidence?: unknown;
}

function validEventKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 200 && /^[A-Za-z0-9_.:-]+$/.test(value);
}

export async function makeLedgerEventKey(input: LedgerEventKeyInput, supplied?: unknown): Promise<string> {
  if (validEventKey(supplied)) return supplied;
  const safeSource = safeSourceUrl(input.sourceUrl) || null;
  const cleanEvidence = sanitizeLedgerEvidence(input.evidence);
  const orderedEvidence: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(cleanEvidence).sort()) orderedEvidence[key] = cleanEvidence[key];

  const canonical = JSON.stringify({
    jobId: input.jobId,
    eventType: normalizeLedgerEventType(input.eventType),
    targetState: normalizeTargetState(input.targetState),
    sourceUrl: safeSource,
    nextAction: safeToken(input.nextAction, 300),
    blockerCode: safeToken(input.blockerCode, 100),
    attemptCount: typeof input.attemptCount === "number" && Number.isInteger(input.attemptCount) ? input.attemptCount : null,
    evidence: orderedEvidence,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `ev:${hex}`;
}

export function normalizeActorKey(raw: unknown, fallback = "midad_browser_gateway"): string {
  return safeToken(raw, 100) || fallback;
}
