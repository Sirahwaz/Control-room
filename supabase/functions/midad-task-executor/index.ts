// MIDAD External Scheduler — read-only readiness evaluation; never starts migration.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TASK_KEY = "midad-core-migration-readiness-daily";
const CORE_PROJECT_REF = "btkxsrqjgriaafzsacei";
const SOURCE_PROJECT_REF = "froegigfmpmvtecztfbf";
const cors = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

type Task = {
  id: string;
  task_key: string;
  status: string;
  schedule_cron: string;
  timezone: string;
  execution_target: string;
  notification_policy: string;
  max_attempts: number;
  updated_at: string;
};

type Check = {
  check_id: string;
  status: "passed" | "blocked" | "warning";
  severity: "info" | "warning" | "critical";
  evidence: Record<string, unknown>;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const token = Deno.env.get("MIDAD_SCHEDULER_TOKEN");
  if (!token) return json({ ok: false, error: "executor_not_configured" }, 503);
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${token}`) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: { task_key?: string; scheduled_for?: string; mode?: string; run_id?: string; run_attempt?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (body.task_key !== TASK_KEY) return json({ ok: false, error: "unknown_task" }, 400);
  if (body.mode !== "status") return json({ ok: false, error: "only_status_mode_supported" }, 409);
  if (!body.run_id || !/^\d{1,24}$/.test(body.run_id)) return json({ ok: false, error: "github_run_id_required" }, 400);
  const runAttempt = body.run_attempt && /^\d{1,4}$/.test(body.run_attempt) ? body.run_attempt : "1";

  const coreUrl = Deno.env.get("MIDAD_CORE_URL");
  const serviceKey = Deno.env.get("MIDAD_CORE_SERVICE_ROLE_KEY");
  if (!coreUrl || !serviceKey) return json({ ok: false, error: "registry_credentials_missing" }, 503);

  let coreHost = "";
  try {
    coreHost = new URL(coreUrl).hostname;
  } catch {
    return json({ ok: false, error: "registry_url_invalid" }, 503);
  }
  // Hard boundary: the executor may only contact the new target project.
  if (coreHost !== `${CORE_PROJECT_REF}.supabase.co`) {
    return json({ ok: false, error: "registry_target_mismatch" }, 503);
  }

  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "Accept-Profile": "midad_ops",
  };

  let taskResponse: Response;
  try {
    const taskUrl = new URL("/rest/v1/tasks", coreUrl);
    taskUrl.searchParams.set("task_key", `eq.${TASK_KEY}`);
    taskUrl.searchParams.set("select", "id,task_key,status,schedule_cron,timezone,execution_target,notification_policy,max_attempts,updated_at");
    taskUrl.searchParams.set("limit", "1");
    taskResponse = await fetch(taskUrl, { headers });
  } catch {
    return json({ ok: false, error: "task_registry_unreachable" }, 502);
  }
  if (!taskResponse.ok) return json({ ok: false, error: "task_registry_read_failed", upstream_status: taskResponse.status }, 502);
  const tasks = await taskResponse.json();
  if (!Array.isArray(tasks) || tasks.length !== 1) return json({ ok: false, error: "task_not_found" }, 404);
  const task = tasks[0] as Task;

  const checks: Check[] = [
    {
      check_id: "target_registry",
      status: "passed",
      severity: "info",
      evidence: { project_ref: CORE_PROJECT_REF, registry_read: "success", task_key: task.task_key },
    },
    {
      check_id: "task_configuration",
      status: task.status === "draft" &&
        task.schedule_cron === "0 16 * * *" &&
        task.timezone === "Asia/Tehran" &&
        task.execution_target === "github_actions" &&
        task.notification_policy === "every_run" &&
        task.max_attempts >= 1 && task.max_attempts <= 3 ? "passed" : "blocked",
      severity: "critical",
      evidence: {
        status: task.status,
        expected_status: "draft",
        schedule_cron: task.schedule_cron,
        timezone: task.timezone,
        execution_target: task.execution_target,
        notification_policy: task.notification_policy,
        max_attempts: task.max_attempts,
      },
    },
    {
      check_id: "executor_configuration",
      status: token.length > 0 && serviceKey.length > 0 && coreHost === `${CORE_PROJECT_REF}.supabase.co` ? "passed" : "blocked",
      severity: "critical",
      evidence: { scheduler_token_present: true, service_key_present: true, target_host: coreHost, secret_values_exposed: false },
    },
    {
      check_id: "source_project_boundary",
      status: "passed",
      severity: "info",
      evidence: { source_project_ref: SOURCE_PROJECT_REF, source_project_contacted: false, source_writes_attempted: false },
    },
    {
      check_id: "source_project_health",
      status: "blocked",
      severity: "warning",
      evidence: { source_project_ref: SOURCE_PROJECT_REF, state: "not_checked", reason: "source project health is intentionally not queried by this target-only executor" },
    },
    {
      check_id: "migration_inventory",
      status: "blocked",
      severity: "critical",
      evidence: { state: "not_started", reason: "source schema and data inventory have not yet been imported into the readiness evidence set" },
    },
    {
      check_id: "backup_restore_validation",
      status: "blocked",
      severity: "critical",
      evidence: { state: "not_verified", reason: "no restore rehearsal evidence is registered" },
    },
    {
      check_id: "cutover_approval",
      status: "blocked",
      severity: "critical",
      evidence: { state: "pending", required: "explicit human approval", migration_execution_allowed: false },
    },
  ];

  const blockedChecks = checks.filter((check) => check.status === "blocked").map((check) => check.check_id);
  const result = {
    schema_version: "midad.readiness.v1",
    task_key: TASK_KEY,
    evaluated_at: new Date().toISOString(),
    overall: blockedChecks.length === 0 ? "ready" : "blocked",
    checks,
    blockers: blockedChecks,
    execution: "not_started",
    source_project_ref: SOURCE_PROJECT_REF,
    target_project_ref: CORE_PROJECT_REF,
  };

  const scheduledFor = body.scheduled_for && !Number.isNaN(Date.parse(body.scheduled_for))
    ? new Date(body.scheduled_for).toISOString()
    : new Date().toISOString();
  const idempotencyKey = `github-actions:${body.run_id}:${runAttempt}`;

  let auditResponse: Response;
  try {
    auditResponse = await fetch(new URL("/rest/v1/rpc/record_readiness_run", coreUrl), {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Content-Profile": "midad_ops",
      },
      body: JSON.stringify({
        p_task_id: task.id,
        p_scheduled_for: scheduledFor,
        p_idempotency_key: idempotencyKey,
        p_result: result,
        p_status: "succeeded",
      }),
    });
  } catch {
    return json({ ok: false, state: "audit_write_failed", task_status: task.status, execution: "not_started", checks, blockers: blockedChecks, error: "readiness_audit_unreachable" }, 502);
  }
  if (!auditResponse.ok) {
    return json({ ok: false, state: "audit_write_failed", task_status: task.status, execution: "not_started", checks, blockers: blockedChecks, error: "readiness_audit_write_failed", upstream_status: auditResponse.status }, 502);
  }

  const auditRecordId = await auditResponse.json();
  return json({
    ok: true,
    state: result.overall === "ready" ? "ready" : "blocked",
    task_status: task.status,
    execution: "not_started",
    overall: result.overall,
    checks,
    blockers: blockedChecks,
    audit_record_id: auditRecordId,
    idempotency_key: idempotencyKey,
    reason: "readiness_evaluated_and_audit_recorded; migration_and_cutover_remain_disabled",
  });
});
