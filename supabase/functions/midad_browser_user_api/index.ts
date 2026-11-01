import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://sirahwaz.github.io";
const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": ALLOWED_ORIGIN,
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600",
  "vary": "Origin",
};
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: BASE_HEADERS });
const clip = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const enc = new TextEncoder();

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeCode(value: unknown, fallback = "UNKNOWN") {
  const code = clip(value, 100);
  return code && /^[A-Za-z0-9_.:-]+$/.test(code) ? code : fallback;
}
function safeUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}
function safeResult(raw: any) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const result: Record<string, unknown> = {
    status: safeCode(raw.status),
    action: safeCode(raw.action),
    page_content_is_untrusted: true,
  };
  for (const [key, max] of [["platform_key", 100], ["account_id", 100], ["title", 200], ["text_preview", 1200], ["reason", 400], ["code", 100]] as const) {
    const value = clip(raw[key], max);
    if (value) result[key] = value;
  }
  const url = safeUrl(raw.url);
  if (url) result.url = url;
  if (typeof raw.authenticated === "boolean") result.authenticated = raw.authenticated;
  if (raw.session_storage === "memory_only") result.session_storage = "memory_only";
  if (Number.isInteger(raw.http_status) && raw.http_status >= 100 && raw.http_status <= 599) result.http_status = raw.http_status;
  if (Number.isInteger(raw.text_chars) && raw.text_chars >= 0 && raw.text_chars <= 30000) result.text_chars = raw.text_chars;
  return result;
}
function unsafeCommand(command: string) {
  return /(?:password|passcode|access[_ -]?token|refresh[_ -]?token|secret|api[_ -]?key|private[_ -]?key|seed phrase|recovery phrase)\s*[:=]/i.test(command)
    || /\b(?:pay(?:ment)?|withdraw(?:al)?|transfer|wallet sign(?:ing)?|purchase|checkout|delete|publish|claim|send money)\b/i.test(command)
    || /(سحب|تحويل|دفع|شراء|توقيع|حذف|نشر|إرسال)/i.test(command);
}

async function getSessionOwner(admin: any, token: string) {
  if (token.length < 32 || token.length > 200) return { ok: false as const, status: 401, error: "invalid_session" };
  const tokenHash = await sha256(token);
  const { data: session, error } = await admin.from("control_room_sessions")
    .select("id,active,created_at")
    .eq("token_hash", tokenHash)
    .eq("active", true)
    .maybeSingle();
  if (error || !session) return { ok: false as const, status: 401, error: "session_expired" };
  const ageMs = Date.now() - new Date(session.created_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 30 * 24 * 60 * 60 * 1000) {
    await admin.from("control_room_sessions").update({ active: false }).eq("id", session.id);
    return { ok: false as const, status: 401, error: "session_expired" };
  }
  const profiles = await admin.from("profiles").select("id").limit(2);
  if (profiles.error || !Array.isArray(profiles.data) || profiles.data.length !== 1) {
    return { ok: false as const, status: 503, error: "browser_owner_profile_not_unambiguous" };
  }
  await admin.from("control_room_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", session.id);
  return { ok: true as const, ownerUserId: String(profiles.data[0].id) };
}

async function callGateway(action: string, payload: Record<string, unknown>, ownerUserId: string) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ingestKey = Deno.env.get("MIDAD_INGEST_KEY") || "";
  if (!url || !serviceKey || !ingestKey) throw new Error("browser_gateway_server_secrets_missing");
  const response = await fetch(url + "/functions/v1/midad_browser_agent_gateway", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + serviceKey,
      "x-midad-ingest-key": ingestKey,
    },
    body: JSON.stringify({ action, owner_user_id: ownerUserId, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) throw new Error(safeCode(result?.error, "browser_gateway_request_failed"));
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") || "";
    if (origin && origin !== ALLOWED_ORIGIN) return json({ ok: false, error: "origin_not_allowed" }, 403);
    return new Response(null, { status: 204, headers: BASE_HEADERS });
  }
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const origin = req.headers.get("origin") || "";
  if (origin && origin !== ALLOWED_ORIGIN) return json({ ok: false, error: "origin_not_allowed" }, 403);
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 4096) return json({ ok: false, error: "request_too_large" }, 413);
  const body = await req.json().catch(() => null) as Record<string, any> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid_json_body" }, 400);
  const token = typeof body.token === "string" ? body.token : "";
  const action = clip(body.action, 40).toLowerCase();
  if (!["capabilities", "list_sessions", "command", "get_result"].includes(action)) {
    return json({ ok: false, error: "action_not_allowed" }, 403);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!serviceKey || !supabaseUrl) return json({ ok: false, error: "browser_bridge_not_configured" }, 503);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const auth = await getSessionOwner(admin, token);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const ownerUserId = auth.ownerUserId;

    if (action === "capabilities") {
      const { data, error } = await admin.from("midad_browser_providers")
        .select("status,profile_ref,metadata,updated_at")
        .eq("provider_key", "midad_playwright_worker")
        .eq("profile_ref", ownerUserId)
        .maybeSingle();
      if (error) return json({ ok: false, error: "worker_status_lookup_failed" }, 500);
      const heartbeatAt = typeof data?.metadata?.heartbeat_at === "string" ? data.metadata.heartbeat_at : "";
      const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : 0;
      const workerOnline = data?.status === "online" && Number.isFinite(heartbeatMs) && Date.now() - heartbeatMs >= 0 && Date.now() - heartbeatMs <= 45_000;
      return json({
        ok: true,
        service: "midad_browser_user_api",
        worker_online: workerOnline,
        worker_last_seen: workerOnline ? heartbeatAt : null,
        browser_engine: "Playwright Chromium",
        session_storage: "memory_only",
        allowed_actions: ["start_session", "status", "inspect", "navigate", "wait_for_selector", "click", "fill", "submit_form", "stop_session"],
        hard_blocks: ["password_input", "secret_input", "captcha_bypass", "mfa_bypass", "financial_actions", "destructive_actions"],
      });
    }

    if (action === "list_sessions") {
      const { data, error } = await admin.from("midad_browser_jobs")
        .select("id,state,platform_key,current_url,created_at,updated_at,evidence,next_action")
        .eq("owner_user_id", ownerUserId)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) return json({ ok: false, error: "browser_sessions_lookup_failed" }, 500);
      const sessions = (data || []).map((job: any) => {
        const result = safeResult(job?.evidence?.operator_result);
        return {
          job_id: job.id,
          state: safeCode(job.state),
          platform_key: clip(job.platform_key, 100),
          current_url: safeUrl(job.current_url),
          created_at: job.created_at,
          updated_at: job.updated_at,
          next_action: safeCode(job.next_action),
          result,
        };
      });
      return json({ ok: true, sessions });
    }

    if (action === "command") {
      const command = clip(body.command, 500);
      const requestId = clip(body.request_id, 100);
      if (!command) return json({ ok: false, error: "command_required" }, 400);
      if (!requestId || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) return json({ ok: false, error: "valid_request_id_required" }, 400);
      if (unsafeCommand(command)) return json({ ok: false, error: "command_rejected_by_policy" }, 403);
      const result = await callGateway("queue_operator_hint", {
        operator_hint: command,
        agent_key: "midad_browser_web_ui",
        idempotency_key: "browser-ui:" + ownerUserId + ":" + requestId,
      }, ownerUserId);
      return json({ ok: true, job_id: result.job_id, state: result.state, next_action: result.next_action });
    }

    if (action === "get_result") {
      const jobId = clip(body.job_id, 80);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
        return json({ ok: false, error: "valid_job_id_required" }, 400);
      }
      const result = await callGateway("get_operator_result", { job_id: jobId }, ownerUserId);
      return json({
        ok: true,
        job_id: result.job_id,
        state: result.state,
        ready: result.ready === true,
        result: safeResult(result.result),
      });
    }

    return json({ ok: false, error: "action_not_implemented" }, 400);
  } catch (error) {
    return json({ ok: false, error: safeCode((error as Error)?.message, "browser_bridge_failed") }, 502);
  }
});
