// MIDAD External Scheduler executor — fail closed, no source-project writes.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const token = Deno.env.get("MIDAD_SCHEDULER_TOKEN");
  if (!token) return json({ ok: false, error: "executor_not_configured" }, 503);
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${token}`) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { task_key?: string; scheduled_for?: string; mode?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  if (body.task_key !== "midad-core-migration-readiness-daily") return json({ ok: false, error: "unknown_task" }, 400);
  if (body.mode !== "status") return json({ ok: false, error: "only_status_mode_supported_until_readiness_checks_are_implemented" }, 409);

  const url = Deno.env.get("MIDAD_CORE_URL");
  const key = Deno.env.get("MIDAD_CORE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "registry_credentials_missing" }, 503);

  const headers = { apikey: key, authorization: `Bearer ${key}` };
  const taskUrl = new URL("/rest/v1/tasks", url);
  taskUrl.searchParams.set("task_key", "eq.midad-core-migration-readiness-daily");
  taskUrl.searchParams.set("select", "id,status,schedule_cron,timezone,updated_at");
  taskUrl.searchParams.set("limit", "1");
  const taskResponse = await fetch(taskUrl, { headers });
  if (!taskResponse.ok) return json({ ok: false, error: "task_registry_read_failed" }, 502);
  const tasks = await taskResponse.json();
  if (!Array.isArray(tasks) || tasks.length !== 1) return json({ ok: false, error: "task_not_found" }, 404);
  const task = tasks[0];
  // Deliberately fail closed: draft/paused tasks never create run records or execute.
  if (task.status !== "active") return json({ ok: true, state: "gated", task_status: task.status, execution: "not_started", reason: "task_must_be_active_and_readiness_executor_verified" });
  return json({ ok: true, state: "blocked", task_status: "active", execution: "not_started", reason: "readiness_checks_not_yet_implemented; fail_closed" }, 409);
});
