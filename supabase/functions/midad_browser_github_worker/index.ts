import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyGithubActionsOidc, OidcVerificationError, type GithubOidcClaims } from "./oidc.ts";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "https://sirahwaz.github.io",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: HEADERS });
const WORKFLOW_REF =
  "Sirahwaz/Control-room/.github/workflows/midad-browser-ephemeral-worker.yml@refs/heads/main";
const EXPECTED = {
  audience: "midad-browser-worker",
  repository: "Sirahwaz/Control-room",
  repositoryOwner: "Sirahwaz",
  ref: "refs/heads/main",
  workflowRef: WORKFLOW_REF,
  allowedEvents: ["schedule", "workflow_dispatch"],
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_TOKEN = /^[A-Za-z0-9_-]{32,200}$/;
const EVENT_TYPES = new Set([
  "state_transition",
  "navigation_observed",
  "evidence_captured",
  "error",
  "job_cancelled",
]);
const STATES = new Set(["RUNNING", "COMPLETED", "FAILED", "CANCELLED", "BLOCKED"]);
const ALLOWED_READONLY_HOSTS = new Set([
  "github.com", "docs.github.com",
  "supabase.com", "www.supabase.com",
  "developer.mozilla.org", "arxiv.org",
  "stackoverflow.com", "reddit.com", "www.reddit.com",
  "wikipedia.org", "www.wikipedia.org",
  "coingecko.com", "www.coingecko.com",
  "coinmarketcap.com", "www.coinmarketcap.com",
  "etherscan.io", "www.etherscan.io",
  "defillama.com", "www.defillama.com",
  "openai.com", "www.openai.com",
  "cloudflare.com", "www.cloudflare.com",
  "n8n.io", "www.n8n.io",
]);
const NEXT_ACTIONS = new Set([
  "capture_public_evidence",
  "review_public_evidence",
  "review_or_retry",
  "resume_or_review",
]);

function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function workerIdFromClaims(claims: { run_id: string; run_attempt: string }): string {
  const workerId = `gh-${claims.run_id}-${claims.run_attempt}`;
  if (!/^[A-Za-z0-9_.:-]{3,120}$/.test(workerId)) throw new Error("github_worker_identity_invalid");
  return workerId;
}

async function gatewayRequest(action: string, payload: Record<string, unknown>) {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ingestKey = Deno.env.get("MIDAD_INGEST_KEY") || "";
  if (!base.startsWith("https://") || !serviceRole || !ingestKey) {
    return { ok: false, status: 503, data: { error: "browser_worker_backend_not_configured" } };
  }
  let response: Response;
  try {
    response = await fetch(base + "/functions/v1/midad_browser_agent_gateway", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + serviceRole,
        "x-midad-ingest-key": ingestKey,
      },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { ok: false, status: 502, data: { error: "browser_gateway_unreachable" } };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    return { ok: false, status: 502, data: { error: clip(data?.error || "browser_gateway_rejected", 120) } };
  }
  return { ok: true, status: 200, data };
}

async function resolveOwner() {
  const identity = await gatewayRequest("worker_identity", {});
  if (!identity.ok) return identity;
  const ownerUserId = clip(identity.data.owner_user_id, 80);
  if (!UUID.test(ownerUserId)) {
    return { ok: false, status: 503, data: { error: "browser_worker_owner_identity_invalid" } };
  }
  return { ok: true, status: 200, data: { owner_user_id: ownerUserId } };
}

function safeRecordEvent(payload: Record<string, unknown>, ownerUserId: string, workerId: string) {
  const jobId = clip(payload.job_id, 80);
  const eventType = clip(payload.event_type, 120);
  const state = clip(payload.state, 40).toUpperCase();
  const leaseToken = clip(payload.lease_token, 200);
  if (!UUID.test(jobId) || !EVENT_TYPES.has(eventType) || !STATES.has(state) || !LEASE_TOKEN.test(leaseToken)) {
    return null;
  }
  const rawEvidence = payload.evidence && typeof payload.evidence === "object" && !Array.isArray(payload.evidence)
    ? payload.evidence as Record<string, unknown>
    : {};
  const evidence: Record<string, unknown> = {};
  const sourceKind = clip(rawEvidence.source_kind, 80);
  if (sourceKind) evidence.source_kind = sourceKind;
  const title = clip(rawEvidence.title, 500);
  if (title) evidence.title = title;
  const excerpt = clip(rawEvidence.text_excerpt, 2500);
  if (excerpt) evidence.text_excerpt = excerpt;
  const errorCode = clip(rawEvidence.error_code, 80);
  if (errorCode) evidence.error_code = errorCode;
  for (const key of ["http_status", "bytes_read", "duration_ms", "attempt"] as const) {
    if (rawEvidence[key] === undefined) continue;
    const value = Number(rawEvidence[key]);
    const max = key === "http_status" ? 599 : key === "attempt" ? 3 : 300000;
    if (!Number.isInteger(value) || value < 0 || value > max) return null;
    evidence[key] = value;
  }
  if (typeof rawEvidence.retryable === "boolean") evidence.retryable = rawEvidence.retryable;
  if (JSON.stringify(evidence).length > 5000) return null;
  const digest = payload.content_sha256 === undefined ? undefined : clip(payload.content_sha256, 64).toLowerCase();
  if (digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) return null;
  const attemptCount = payload.attempt_count === undefined ? undefined : Number(payload.attempt_count);
  if (attemptCount !== undefined && (!Number.isInteger(attemptCount) || attemptCount < 0 || attemptCount > 3)) return null;
  const nextAction = clip(payload.next_action, 80);
  if (nextAction && !NEXT_ACTIONS.has(nextAction)) return null;
  const currentUrl = payload.current_url === undefined ? undefined : clip(payload.current_url, 1500);
  if (currentUrl !== undefined && currentUrl) {
    if (!currentUrl.startsWith("https://")) return null;
    try {
      if (!ALLOWED_READONLY_HOSTS.has(new URL(currentUrl).hostname.toLowerCase())) return null;
    } catch {
      return null;
    }
  }

  return {
    job_id: jobId,
    owner_user_id: ownerUserId,
    worker_id: workerId,
    lease_token: leaseToken,
    event_type: eventType,
    state,
    ...(currentUrl !== undefined ? { current_url: currentUrl } : {}),
    evidence,
    ...(nextAction ? { next_action: nextAction } : {}),
    ...(digest ? { content_sha256: digest } : {}),
    ...(attemptCount !== undefined ? { attempt_count: attemptCount } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return json({ ok: false, error: "github_oidc_token_required" }, 401);

  let claims: GithubOidcClaims;
  try {
    claims = await verifyGithubActionsOidc(token, EXPECTED);
  } catch (error) {
    const code = error instanceof OidcVerificationError ? error.code : "github_oidc_verification_failed";
    return json({ ok: false, error: code }, 401);
  }

  const raw = await req.text();
  if (raw.length > 20000) return json({ ok: false, error: "request_too_large" }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, error: "invalid_request_body" }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_request_json" }, 400);
  }
  const action = clip(body.action, 80).toLowerCase();
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
    ? body.payload as Record<string, unknown>
    : {};
  let workerId: string;
  try {
    workerId = workerIdFromClaims(claims);
  } catch {
    return json({ ok: false, error: "github_worker_identity_invalid" }, 401);
  }
  if (!new Set(["worker_heartbeat", "claim_readonly_jobs", "record_event", "renew_operator_lease", "release_operator_lease"]).has(action)) {
    return json({ ok: false, error: "github_worker_action_forbidden" }, 403);
  }

  const owner = await resolveOwner();
  if (!owner.ok) return json({ ok: false, error: owner.data.error }, owner.status);
  const ownerUserId = owner.data.owner_user_id;

  if (action === "worker_heartbeat") {
    const result = await gatewayRequest("worker_heartbeat", {
      owner_user_id: ownerUserId,
      worker_id: workerId,
      worker_version: "github_ephemeral_readonly_v1",
    });
    return result.ok ? json(result.data) : json(result.data, result.status);
  }

  if (action === "claim_readonly_jobs") {
    const result = await gatewayRequest("claim_readonly_jobs", {
      owner_user_id: ownerUserId,
      worker_id: workerId,
      lease_seconds: 300,
      limit: 1,
    });
    if (!result.ok) return json(result.data, result.status);
    const claimed = Array.isArray(result.data.jobs) ? result.data.jobs : [];
    const allowedJobs = [];
    for (const job of claimed) {
      let host = "";
      try {
        const target = new URL(String(job.current_url || ""));
        if (
          target.protocol === "https:" &&
          !target.username &&
          !target.password &&
          (!target.port || target.port === "443")
        ) host = target.hostname.toLowerCase();
      } catch {
        host = "";
      }
      if (ALLOWED_READONLY_HOSTS.has(host)) {
        allowedJobs.push(job);
        continue;
      }
      const jobId = clip(job.id, 80);
      const leaseToken = clip(job.lease_token, 200);
      if (UUID.test(jobId) && LEASE_TOKEN.test(leaseToken)) {
        await gatewayRequest("record_event", {
          job_id: jobId,
          owner_user_id: ownerUserId,
          worker_id: workerId,
          lease_token: leaseToken,
          event_type: "error",
          state: "BLOCKED",
          current_url: clip(job.current_url, 1500),
          evidence: { source_kind: "github_ephemeral_readonly", error_code: "host_not_allowlisted", retryable: false },
          next_action: "review_or_retry",
        });
        await gatewayRequest("release_operator_lease", {
          job_id: jobId,
          owner_user_id: ownerUserId,
          worker_id: workerId,
          lease_token: leaseToken,
        });
      }
    }
    return json({ ...result.data, jobs: allowedJobs });
  }

  if (action === "record_event") {
    const safePayload = safeRecordEvent(payload, ownerUserId, workerId);
    if (!safePayload) return json({ ok: false, error: "invalid_readonly_worker_event" }, 400);
    const result = await gatewayRequest("record_event", safePayload);
    return result.ok ? json(result.data) : json(result.data, result.status);
  }

  if (action === "renew_operator_lease" || action === "release_operator_lease") {
    const jobId = clip(payload.job_id, 80);
    const leaseToken = clip(payload.lease_token, 200);
    if (!UUID.test(jobId) || !LEASE_TOKEN.test(leaseToken)) {
      return json({ ok: false, error: "invalid_browser_worker_lease_request" }, 400);
    }
    const result = await gatewayRequest(action, {
      job_id: jobId,
      owner_user_id: ownerUserId,
      worker_id: workerId,
      lease_token: leaseToken,
      ...(action === "renew_operator_lease" ? { lease_seconds: 300 } : {}),
    });
    return result.ok ? json(result.data) : json(result.data, result.status);
  }

  return json({ ok: false, error: "github_worker_action_forbidden" }, 403);
});
