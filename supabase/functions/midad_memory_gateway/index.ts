import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isAllowedBrowserUserOrigin } from "../midad_browser_agent_gateway/origin-policy.ts";
import { stripBearerPrefix } from "../midad_browser_agent_gateway/auth.mjs";
import { validateOwnerSessionBinding } from "../_shared/midad-owner-session.mjs";
import { resolveMemoryPrincipal } from "../_shared/midad-memory-principal.mjs";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "vary": "Origin",
};
const json = (payload: unknown, status = 200, origin: string | null = null) => {
  const headers = new Headers(JSON_HEADERS);
  if (origin && isAllowedBrowserUserOrigin(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST,OPTIONS");
    headers.set("access-control-allow-headers", "content-type,authorization");
    headers.set("access-control-max-age", "86400");
  }
  return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers });
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 64 * 1024;
const FORBIDDEN_SCOPE_FIELDS = new Set([
  "owner_scope", "owner_id", "owner_user_id", "tenant_id", "store_name",
  "database", "db_path", "project_owner_id", "agent_key", "capabilities",
]);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function containsForbiddenScope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenScope);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    FORBIDDEN_SCOPE_FIELDS.has(key.toLowerCase()) || containsForbiddenScope(child)
  );
}

async function resolveSessionOwner(admin: any, authorization: string) {
  const token = stripBearerPrefix(authorization);
  if (token.length < 32 || token.length > 200) return null;
  const tokenHash = await sha256(token);
  const { data: session, error } = await admin.from("control_room_sessions")
    .select("id,active,created_at,owner_user_id")
    .eq("token_hash", tokenHash)
    .eq("active", true)
    .maybeSingle();
  if (error || !session) return null;
  const binding = validateOwnerSessionBinding(session);
  if (!binding.ok) {
    await admin.from("control_room_sessions").update({ active: false }).eq("id", session.id);
    return null;
  }
  await admin.from("control_room_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", session.id);
  return binding.ownerUserId;
}

async function readBoundedBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function dispatch(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && !isAllowedBrowserUserOrigin(origin)) return json({ ok: false, error: "origin_forbidden" }, 403);
  if (req.method === "OPTIONS") return json({ ok: true }, 204, origin);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  if ((Deno.env.get("MIDAD_MEMORY_ADAPTER_ENABLED") || "").toLowerCase() !== "true") {
    return json({ ok: false, error: "memory_gateway_disabled" }, 404, origin);
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "request_too_large" }, 413, origin);
  }
  const raw = await readBoundedBody(req);
  if (raw === null) return json({ ok: false, error: "request_too_large" }, 413, origin);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, origin);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "invalid_request" }, 400, origin);
  }

  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const projectKey = typeof body.project_id === "string" ? body.project_id.trim() : "";
  const agentKey = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
  const runId = typeof body.run_id === "string" ? body.run_id : "";
  const operation = body.operation;
  const payload = body.payload;
  const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
  if (!UUID.test(requestId) || !/^[A-Za-z0-9._:-]{1,100}$/.test(projectKey) ||
      !/^[A-Za-z0-9_.:-]{2,100}$/.test(agentKey) || !UUID.test(runId) ||
      !["create", "search"].includes(String(operation)) ||
      !payload || typeof payload !== "object" || Array.isArray(payload) ||
      containsForbiddenScope(payload) ||
      (operation === "create" && (!idempotencyKey || idempotencyKey.length > 128))) {
    return json({ ok: false, error: "invalid_request_envelope" }, 400, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl.startsWith("https://") || !serviceRoleKey) {
    return json({ ok: false, error: "identity_backend_unavailable" }, 503, origin);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerUserId = await resolveSessionOwner(admin, req.headers.get("authorization") || "");
  if (!ownerUserId) return json({ ok: false, error: "session_invalid_or_unbound" }, 401, origin);

  const [projectResult] = await Promise.all([
    admin.from("midad_factory_projects")
      .select("id,project_key,owner_user_id")
      .eq("project_key", projectKey)
      .eq("owner_user_id", ownerUserId)
      .maybeSingle(),
  ]);
  if (projectResult.error) return json({ ok: false, error: "project_policy_unavailable" }, 503, origin);
  if (!projectResult.data) return json({ ok: false, error: "project_access_denied" }, 403, origin);
  const project = projectResult.data;

  const [grantResult, runResult] = await Promise.all([
    admin.from("midad_memory_agent_grants")
      .select("owner_user_id,project_id,agent_key,capabilities,active")
      .eq("owner_user_id", ownerUserId)
      .eq("project_id", project.id)
      .eq("agent_key", agentKey)
      .eq("active", true)
      .maybeSingle(),
    admin.from("midad_factory_runs")
      .select("id,project_id,project_key,state")
      .eq("id", runId)
      .eq("project_id", project.id)
      .eq("project_key", project.project_key)
      .eq("state", "RUNNING")
      .maybeSingle(),
  ]);
  if (grantResult.error || runResult.error) {
    return json({ ok: false, error: "memory_policy_lookup_unavailable" }, 503, origin);
  }
  const resolved = resolveMemoryPrincipal({
    ownerUserId,
    project,
    grant: grantResult.data,
    run: runResult.data,
    agentKey,
    operation,
  });
  if (!resolved.ok) return json({ ok: false, error: resolved.error }, 403, origin);

  const adapterUrl = Deno.env.get("MIDAD_MEMORY_ADAPTER_URL") || "";
  const adapterServiceKey = Deno.env.get("MIDAD_MEMORY_ADAPTER_SERVICE_KEY") || "";
  let parsedAdapterUrl: URL;
  try {
    parsedAdapterUrl = new URL(adapterUrl);
  } catch {
    return json({ ok: false, error: "memory_backend_not_configured" }, 503, origin);
  }
  if (parsedAdapterUrl.protocol !== "https:" || parsedAdapterUrl.pathname !== "/" ||
      parsedAdapterUrl.username || parsedAdapterUrl.password || parsedAdapterUrl.search ||
      parsedAdapterUrl.hash || adapterServiceKey.length < 32) {
    return json({ ok: false, error: "memory_backend_not_configured" }, 503, origin);
  }

  const auditInput = {
    request_id: requestId,
    owner_user_id: ownerUserId,
    project_id: project.id,
    agent_key: agentKey,
    run_id: runId,
    operation,
    outcome: "STARTED",
    idempotency_key_sha256: idempotencyKey ? await sha256(idempotencyKey) : null,
  };
  const { data: audit, error: auditError } = await admin.from("midad_memory_gateway_audit")
    .insert(auditInput).select("id").single();
  if (auditError || !audit?.id) {
    return json({ ok: false, error: "memory_audit_unavailable" }, 503, origin);
  }

  let upstream: Response;
  try {
    upstream = await fetch(new URL("/v1/memory/execute", parsedAdapterUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + adapterServiceKey,
        "x-midad-request-id": requestId,
      },
      body: JSON.stringify({
        principal: resolved.principal,
        request: {
          request_id: requestId,
          operation,
          project_id: project.project_key,
          payload,
          idempotency_key: idempotencyKey,
        },
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    await admin.from("midad_memory_gateway_audit").update({
      outcome: "FAILED", error_code: "UPSTREAM_UNAVAILABLE", completed_at: new Date().toISOString(),
    }).eq("id", audit.id);
    return json({ ok: false, error: "memory_backend_unavailable", retryable: true }, 502, origin);
  }

  let result: Record<string, unknown>;
  try {
    result = await upstream.json();
  } catch {
    result = {};
  }
  const success = upstream.ok && result?.status === "OK";
  const evidence = result?.evidence && typeof result.evidence === "object"
    ? result.evidence as Record<string, unknown>
    : {};
  const data = result?.data && typeof result.data === "object"
    ? result.data as Record<string, unknown>
    : {};
  const rawIds = Array.isArray(evidence.record_ids) ? evidence.record_ids
    : (typeof data.record_id === "string" ? [data.record_id] : []);
  const recordIds = rawIds.filter((value): value is string =>
    typeof value === "string" && value.length <= 100
  ).slice(0, 20);
  const safeError = typeof (result as any)?.error?.code === "string" &&
    /^[A-Z0-9_:-]{1,80}$/.test((result as any).error.code)
    ? (result as any).error.code
    : (!success ? "UPSTREAM_REJECTED" : null);
  await admin.from("midad_memory_gateway_audit").update({
    outcome: success ? "SUCCEEDED" : "FAILED",
    error_code: safeError,
    record_ids: recordIds,
    completed_at: new Date().toISOString(),
  }).eq("id", audit.id);

  if (!upstream.ok) return json({ ok: false, error: safeError || "memory_backend_rejected" }, upstream.status >= 500 ? 502 : upstream.status, origin);
  if (!success) return json({ ok: false, error: "memory_backend_invalid_response" }, 502, origin);
  return json({ ok: true, result }, 200, origin);
}

Deno.serve(dispatch);
