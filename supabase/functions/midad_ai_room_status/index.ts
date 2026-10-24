import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED_ORIGINS = new Set(["https://sirahwaz.github.io"]);
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function headers(origin: string) {
  const h: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": "Origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
  if (ALLOWED_ORIGINS.has(origin)) h["access-control-allow-origin"] = origin;
  return h;
}
function json(origin: string, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: headers(origin) });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(origin, { ok: false, error: "origin_not_allowed" }, 403);
  if (req.method !== "POST") return json(origin, { ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(origin, { ok: false, error: "service_unavailable" }, 503);

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token.trim().slice(0, 256) : "";
  if (!token) return json(origin, { ok: false, error: "missing_session" }, 401);

  try {
    const tokenHash = await sha256(token);
    const { data: session, error: sessionError } = await admin
      .from("control_room_sessions")
      .select("id,active,created_at")
      .eq("token_hash", tokenHash)
      .eq("active", true)
      .maybeSingle();
    if (sessionError || !session) return json(origin, { ok: false, error: "session_expired" }, 401);

    const age = Date.now() - new Date(session.created_at).getTime();
    if (!Number.isFinite(age) || age < 0 || age > 30 * 24 * 60 * 60 * 1000) {
      return json(origin, { ok: false, error: "session_expired" }, 401);
    }

    const [signals, opportunities, engineRuns, alerts, approvals, tasks] = await Promise.all([
      admin.from("signal_events").select("id", { count: "exact", head: true }),
      admin.from("opportunities").select("id", { count: "exact", head: true }).neq("status", "test"),
      admin.from("engine_runs").select("id", { count: "exact", head: true }),
      admin.from("midad_sentinel_alerts").select("id", { count: "exact", head: true }).eq("status", "active"),
      admin.from("midad_approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("midad_human_tasks").select("id", { count: "exact", head: true }).in("status", ["OPEN", "ACKNOWLEDGED"])
    ]);
    if ([signals, opportunities, engineRuns, alerts, approvals, tasks].some(r => r.error)) {
      return json(origin, { ok: false, error: "status_unavailable" }, 503);
    }
    return json(origin, {
      ok: true,
      source: "midad_ai_room_status",
      generated_at: new Date().toISOString(),
      scope: "read_only_aggregate",
      read_only: true,
      counts: {
        signals: signals.count ?? 0,
        opportunities: opportunities.count ?? 0,
        engine_runs: engineRuns.count ?? 0,
        active_alerts: alerts.count ?? 0,
        pending_approvals: approvals.count ?? 0,
        pending_human_tasks: tasks.count ?? 0
      },
      guards: { mutations: false, financial_actions: false }
    });
  } catch {
    return json(origin, { ok: false, error: "status_unavailable" }, 503);
  }
});
