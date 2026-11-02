import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { summarizeStatusCounts } from "./status-summary.mjs";
import { buildAgentReadiness } from "./agent-readiness.mjs";

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

async function readMetric(name: string, query: () => any) {
  try {
    const result = await query();
    if (result?.error) {
      const code = String(result.error.code || "query_error").slice(0, 40);
      console.warn("[midad_ai_room_status] metric_unavailable", name, code);
      return { error: { code } };
    }
    if (typeof result?.count !== "number") {
      console.warn("[midad_ai_room_status] metric_unavailable", name, "count_missing");
      return { error: { code: "count_missing" } };
    }
    return { count: result.count };
  } catch (error) {
    const nameHint = error && typeof error === "object" && "name" in error
      ? String((error as any).name).slice(0, 40)
      : "query_error";
    console.warn("[midad_ai_room_status] metric_unavailable", name, nameHint);
    return { error: { code: nameHint } };
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: headers(origin) });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(origin, { ok: false, error: "origin_not_allowed" }, 403);
  if (req.method !== "POST") return json(origin, { ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[midad_ai_room_status] service_configuration_missing", {
      supabaseUrlConfigured: Boolean(SUPABASE_URL),
      serviceRoleConfigured: Boolean(SERVICE_ROLE_KEY)
    });
    return json(origin, { ok: false, error: "service_unavailable" }, 503);
  }

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

    const [signals, opportunities, engineRuns, alerts, approvals, tasks, identitiesResult, eventsResult] = await Promise.all([
      // Large tables use estimated counts to reduce the cost of full-table COUNT(*).
      readMetric("signals", () => admin.from("signal_events").select("id", { count: "estimated", head: true })),
      readMetric("opportunities", () => admin.from("opportunities").select("id", { count: "estimated", head: true }).neq("status", "test")),
      readMetric("engine_runs", () => admin.from("engine_runs").select("id", { count: "estimated", head: true })),
      readMetric("active_alerts", () => admin.from("midad_sentinel_alerts").select("id", { count: "exact", head: true }).eq("status", "active")),
      readMetric("pending_approvals", () => admin.from("midad_approvals").select("id", { count: "exact", head: true }).eq("status", "pending")),
      readMetric("pending_human_tasks", () => admin.from("midad_human_tasks").select("id", { count: "exact", head: true }).in("status", ["OPEN", "ACKNOWLEDGED"])),
      admin.from("midad_agent_identities").select("agent_key,status").order("updated_at", { ascending: false }).limit(200),
      admin.from("midad_agent_events").select("agent_key,event_type,state,created_at").order("created_at", { ascending: false }).limit(50)
    ]);

    const summary = summarizeStatusCounts({
      signals,
      opportunities,
      engine_runs: engineRuns,
      active_alerts: alerts,
      pending_approvals: approvals,
      pending_human_tasks: tasks
    });
    if (summary.partial) {
      console.warn("[midad_ai_room_status] partial_read_model", summary.unavailable_metrics.join(","));
    }
    if (identitiesResult.error) console.warn("[midad_ai_room_status] agent_registry_unavailable", String(identitiesResult.error.code || "query_error").slice(0, 40));
    if (eventsResult.error) console.warn("[midad_ai_room_status] agent_events_unavailable", String(eventsResult.error.code || "query_error").slice(0, 40));
    const agentMesh = buildAgentReadiness({
      metrics: summary.counts,
      unavailableMetrics: summary.unavailable_metrics,
      identities: identitiesResult.error ? null : identitiesResult.data,
      events: eventsResult.error ? null : eventsResult.data,
      generatedAt: new Date().toISOString()
    });

    return json(origin, {
      ok: true,
      source: "midad_ai_room_status",
      generated_at: new Date().toISOString(),
      scope: "read_only_aggregate",
      read_only: true,
      partial: summary.partial,
      unavailable_metrics: summary.unavailable_metrics,
      count_accuracy: {
        signals: "estimated_for_large_sets",
        opportunities: "estimated_for_large_sets",
        engine_runs: "estimated_for_large_sets",
        active_alerts: "exact",
        pending_approvals: "exact",
        pending_human_tasks: "exact"
      },
      counts: summary.counts,
      agent_mesh: agentMesh,
      guards: { mutations: false, financial_actions: false, model_calls: false }
    });
  } catch (error) {
    const errorName = error && typeof error === "object" && "name" in error
      ? String((error as any).name).slice(0, 40)
      : "unknown";
    console.error("[midad_ai_room_status] status_unavailable", errorName);
    return json(origin, { ok: false, error: "status_unavailable" }, 503);
  }
});
