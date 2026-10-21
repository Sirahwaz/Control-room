import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public endpoint by transport configuration only. No operation runs unless a short-lived,
// one-shot token is validated/consumed by a service-role-only RPC and the pre-test DB is empty.
// Never log request headers, plaintext token, password, auth response, or full gateway payload.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-midad-smoke-key",
};
const response = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
const TEST_OBJECTIVE = "MIDAD Browser Gateway Smoke Test (temporary; safe to delete)";
const TEST_AGENT = "midad_gateway_smoke";
const sampleUrl = "https://example.com/midad-browser-smoke";

function safeErrorCode(value: unknown): string {
  const code = String(value ?? "").trim().slice(0, 80);
  return /^[A-Za-z0-9_.:-]+$/.test(code) ? code : "unexpected_test_error";
}

async function countRows(db: any, table: string) {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error("count_failed_" + table);
  return Number(count || 0);
}

async function callGateway(action: string, payload: Record<string, unknown>) {
  const res = await fetch(SUPABASE_URL + "/functions/v1/midad_browser_agent_gateway", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + SERVICE_KEY,
      "apikey": SERVICE_KEY,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const value = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok || value.ok !== true) {
    throw new Error("gateway_" + action + "_" + res.status + "_" + safeErrorCode(value.error));
  }
  return value;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (req.method !== "POST") return response({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return response({ ok: false, error: "test_runner_unconfigured" }, 503);

  const suppliedToken = req.headers.get("x-midad-smoke-key") || "";
  if (suppliedToken.length < 48 || suppliedToken.length > 160) {
    return response({ ok: false, error: "one_shot_test_authorization_required" }, 401);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authorization = await db.rpc("midad_browser_smoke_authorize_v1", { p_token: suppliedToken });
  // Release this reference before any test work. Never echo or log the secret.
  const tokenReference = typeof authorization.data === "string" ? authorization.data : null;
  if (authorization.error || !tokenReference) {
    return response({ ok: false, error: "one_shot_test_authorization_rejected" }, 401);
  }

  const runId = crypto.randomUUID();
  const sessionRef = "midad-browser-smoke:" + runId;
  const email = "midad-browser-smoke-" + runId + "@example.invalid";
  let ownerId: string | null = null;
  let jobDeleted = false;
  let identityDeleted = false;
  let cleanupErrors: string[] = [];
  let result: Record<string, unknown> = {};
  let failureCode: string | null = null;
  let baseline = { jobs: -1, evidence: -1 };
  let finalCounts = { jobs: -1, evidence: -1 };

  try {
    baseline = {
      jobs: await countRows(db, "midad_browser_jobs"),
      evidence: await countRows(db, "midad_browser_evidence_ledger"),
    };
    // Avoid running in a non-empty environment; don't delete or alter unrelated user work.
    if (baseline.jobs !== 0 || baseline.evidence !== 0) {
      throw new Error("baseline_not_empty");
    }

    const created = await db.auth.admin.createUser({
      email,
      password: "MIDAD-smoke-" + crypto.randomUUID(),
      email_confirm: true,
      user_metadata: {
        midad_browser_smoke_identity: "true",
        midad_browser_smoke_run: sessionRef,
      },
    });
    if (created.error || !created.data?.user?.id) throw new Error("temporary_identity_create_failed");
    ownerId = created.data.user.id;

    const create = await callGateway("create_job", {
      owner_user_id: ownerId,
      agent_key: TEST_AGENT,
      platform_key: null,
      objective: TEST_OBJECTIVE,
      idempotency_key: sessionRef,
      current_url: sampleUrl,
      input_data: { smoke_test: true, run_id: runId },
    });
    const jobId = String(create.job?.id || "");
    if (!jobId) throw new Error("gateway_create_job_missing_id");
    if (create.job.state !== "PREPARING") throw new Error("gateway_create_job_wrong_state");

    const createdEvidence = await db.from("midad_browser_evidence_ledger")
      .select("id,event_key,event_type,to_state")
      .eq("job_id", jobId);
    if (createdEvidence.error || !createdEvidence.data?.some((e: any) => e.event_type === "job_created")) {
      throw new Error("create_job_evidence_missing");
    }

    const eventKey = "smoke-event:" + runId;
    const runningInput = {
      job_id: jobId,
      event_type: "navigation",
      state: "RUNNING",
      current_url: sampleUrl,
      next_action: "verify_duplicate_event",
      event_key: eventKey,
      evidence: { source_kind: "smoke_test", http_status: 200, policy_status: "ALLOW" },
    };
    const firstEvent = await callGateway("record_event", runningInput);
    if (firstEvent.job?.state !== "RUNNING" || firstEvent.idempotent === true) {
      throw new Error("record_event_initial_transition_failed");
    }

    const duplicateEvent = await callGateway("record_event", runningInput);
    if (duplicateEvent.job?.state !== "RUNNING" || duplicateEvent.idempotent !== true) {
      throw new Error("record_event_duplicate_not_idempotent");
    }
    const duplicateRows = await db.from("midad_browser_evidence_ledger")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("event_key", eventKey);
    if (duplicateRows.error || duplicateRows.count !== 1) throw new Error("duplicate_event_row_count_not_one");

    // Prevent the gateway from creating an external human-task row: this marker exists only
    // on the disposable browser job and makes the existing HUMAN_GATE handoff idempotent.
    const seededGate = await db.from("midad_browser_jobs").update({
      human_gate: {
        required: true,
        status: "OPEN",
        task_id: "smoke-only-checkpoint:" + runId,
        reason: "Smoke-test checkpoint; no external human task is created.",
      },
    }).eq("id", jobId).eq("owner_user_id", ownerId).select("id").single();
    if (seededGate.error) throw new Error("test_only_human_gate_seed_failed");

    const gate = await callGateway("record_event", {
      job_id: jobId,
      event_type: "human_verification_gate",
      state: "HUMAN_GATE",
      current_url: sampleUrl,
      next_action: "wait_for_human_gate",
      reason: "Smoke-test checkpoint only.",
      evidence: { source_kind: "smoke_test", policy_status: "HUMAN_GATE" },
    });
    const gateState = gate.state ?? gate.job?.state;
    const gateDetails = gate.human_gate ?? gate.job?.human_gate;
    if (gateState !== "HUMAN_GATE" || gateDetails?.status !== "OPEN") {
      throw new Error("human_gate_transition_failed");
    }

    const resumed = await callGateway("complete_human_gate", {
      job_id: jobId,
      response_data: { source_kind: "smoke_test", policy_status: "RESUMED" },
    });
    if (resumed.job?.state !== "RUNNING" || resumed.job?.human_gate?.status !== "COMPLETED") {
      throw new Error("human_gate_resume_failed");
    }

    const finalJob = await db.from("midad_browser_jobs")
      .select("state,human_gate")
      .eq("id", jobId)
      .single();
    if (finalJob.error || finalJob.data?.state !== "RUNNING" || finalJob.data?.human_gate?.status !== "COMPLETED") {
      throw new Error("resume_persisted_state_check_failed");
    }

    const ledger = await db.from("midad_browser_evidence_ledger")
      .select("event_key,event_type,from_state,to_state")
      .eq("job_id", jobId);
    if (ledger.error) throw new Error("ledger_read_failed");
    const rows = ledger.data || [];
    const oneRunEvent = rows.filter((row: any) => row.event_key === eventKey).length === 1;
    const hasResume = rows.some((row: any) => row.event_type === "human_gate_resumed" && row.from_state === "HUMAN_GATE" && row.to_state === "RUNNING");
    const hasGate = rows.some((row: any) => row.event_type === "human_gate_opened" && row.to_state === "HUMAN_GATE");
    if (!oneRunEvent || !hasResume || !hasGate) throw new Error("ledger_transition_assertion_failed");

    result = {
      checks: {
        create_job: true,
        record_event: true,
        duplicate_event_idempotent: true,
        duplicate_ledger_rows: 1,
        human_gate_opened: true,
        human_gate_resumed: true,
        resume_state_persisted: true,
        expected_ledger_event_count_before_cleanup: rows.length,
      },
    };
  } catch (error) {
    failureCode = safeErrorCode(error instanceof Error ? error.message.split("_").slice(0, 6).join("_") : "unexpected_test_error");
  } finally {
    if (ownerId) {
      const cleanupJob = await db.rpc("midad_browser_smoke_cleanup_job_v1", {
        p_owner_user_id: ownerId,
        p_session_ref: sessionRef,
      });
      if (cleanupJob.error) cleanupErrors.push("job_cleanup_failed");
      else jobDeleted = true;

      // A test profile, if a project trigger created one, is safe to remove for this marked user only.
      const profileCleanup = await db.from("profiles").delete().eq("id", ownerId);
      if (profileCleanup.error) cleanupErrors.push("profile_cleanup_failed");

      const authCleanup = await db.auth.admin.deleteUser(ownerId);
      if (authCleanup.error) cleanupErrors.push("identity_cleanup_failed");
      else identityDeleted = true;
    }

    try {
      finalCounts = {
        jobs: await countRows(db, "midad_browser_jobs"),
        evidence: await countRows(db, "midad_browser_evidence_ledger"),
      };
    } catch {
      cleanupErrors.push("final_count_check_failed");
    }
  }

  // The launcher's short-lived Vault token is intentionally retained until the HTTP
  // response is collected. This avoids a race where the async pg_net caller loses its
  // request_id before it can collect the response. The launcher deletes it immediately after.
  const clean = jobDeleted && identityDeleted &&
    finalCounts.jobs === baseline.jobs && finalCounts.evidence === baseline.evidence &&
    cleanupErrors.length === 0;
  return response({
    ok: failureCode === null && clean,
    run_id: runId,
    test_only: true,
    failure_code: failureCode,
    cleanup_errors: cleanupErrors,
    checks: result.checks || {},
    cleanup: {
      temporary_job_deleted: jobDeleted,
      temporary_identity_deleted: identityDeleted,
      one_shot_vault_secret_pending_launcher_cleanup: true,
    },
    baseline_counts: baseline,
    final_counts: finalCounts,
    no_production_task_submitted: true,
  }, failureCode === null && clean ? 200 : 500);
});
