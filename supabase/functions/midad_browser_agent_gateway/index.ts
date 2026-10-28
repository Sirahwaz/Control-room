import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  makeLedgerEventKey,
  normalizeActorKey,
  normalizeLedgerEventType,
  normalizeTargetState,
  safeSourceUrl,
  sanitizeLedgerEvidence,
} from "./ledger.ts";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-midad-ingest-key",
};
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers });

function authorized(req: Request) {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ingestKey = Deno.env.get("MIDAD_INGEST_KEY") || "";
  const bearer = req.headers.get("authorization") || "";
  const ingest = req.headers.get("x-midad-ingest-key") || "";
  return Boolean(
    (serviceKey && bearer === "Bearer " + serviceKey) ||
    (ingestKey && ingest === ingestKey),
  );
}

const clip = (value: unknown, max = 4000) =>
  String(value ?? "").trim().slice(0, max);

function safeOperatorPreview(value: unknown, max = 1400) {
  return clip(value, max)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "[REDACTED]")
    .replace(/(?:password|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|secret)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]")
    .replace(/(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, "[REDACTED]");
}

function sanitizeOperatorResult(raw: unknown) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, any>
    : {};
  const result: Record<string, unknown> = {
    status: safeCode(source.status, "UNKNOWN"),
    action: safeCode(source.action, "UNKNOWN"),
    page_content_is_untrusted: true,
  };
  const platformKey = clip(source.platform_key, 100);
  const accountId = clip(source.account_id, 100);
  const host = clip(source.host, 253).toLowerCase().replace(/\.$/, "");
  const title = safeOperatorPreview(source.title, 200);
  const preview = safeOperatorPreview(source.text_preview, 1400);
  const url = safeSourceUrl(source.url);
  if (platformKey) result.platform_key = platformKey;
  if (accountId) result.account_id = accountId;
  if (host && /^[a-z0-9.-]+$/.test(host) && !host.includes("..") && !host.startsWith(".") && !host.endsWith(".")) result.host = host;
  if (title) result.title = title;
  if (preview) result.text_preview = preview;
  if (url) result.url = url;
  for (const key of ["text_chars", "value_length", "http_status"] as const) {
    const n = Number(source[key]);
    if (Number.isInteger(n) && n >= 0 && n <= (key === "http_status" ? 599 : 30000)) result[key] = n;
  }
  if (typeof source.authenticated === "boolean") result.authenticated = source.authenticated;
  if (source.session_storage === "memory_only") result.session_storage = "memory_only";
  if (typeof source.reason === "string" && source.reason.trim()) result.reason = safeOperatorPreview(source.reason, 500);
  if (typeof source.code === "string" && /^[A-Za-z0-9_.:-]+$/.test(source.code)) result.code = clip(source.code, 100);
  return result;
}

function safeCode(value: unknown, fallback = "BLOCKED_BY_POLICY") {
  const code = clip(value, 100);
  return code && /^[A-Za-z0-9_.:-]+$/.test(code) ? code : fallback;
}

function eventEvidence(body: Record<string, any>, defaultSourceKind: string, eventType: string) {
  const incoming = body.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence)
    ? body.evidence
    : {};
  const combined: Record<string, unknown> = { ...incoming };
  if (!combined.source_kind) combined.source_kind = defaultSourceKind;
  if (eventType === "policy_decision" && body.code !== undefined && combined.policy_code === undefined) {
    combined.policy_code = body.code;
  }
  if (eventType === "error" && body.code !== undefined && combined.error_code === undefined) {
    combined.error_code = body.code;
  }
  if (body.retryable !== undefined && combined.retryable === undefined) combined.retryable = body.retryable;
  if (body.attempt_count !== undefined && combined.attempt === undefined) combined.attempt = body.attempt_count;
  return sanitizeLedgerEvidence(combined);
}

function digestInput(body: Record<string, any>) {
  const raw = body.content_sha256 ?? body.evidence?.content_sha256 ?? null;
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null as string | null };
  if (typeof raw !== "string" || !/^[a-fA-F0-9]{64}$/.test(raw)) {
    return { ok: false, value: null as string | null };
  }
  return { ok: true, value: raw.toLowerCase() };
}

function targetStateInput(body: Record<string, any>) {
  if (body.state === undefined || body.state === null || clip(body.state, 40) === "") {
    return { ok: true, value: null as string | null };
  }
  const state = normalizeTargetState(body.state);
  return state
    ? { ok: true, value: state }
    : { ok: false, value: null as string | null };
}

function attemptCountInput(body: Record<string, any>) {
  if (body.attempt_count === undefined || body.attempt_count === null) {
    return { ok: true, value: null as number | null };
  }
  const value = Number(body.attempt_count);
  return Number.isInteger(value) && value >= 0 && value <= 3
    ? { ok: true, value }
    : { ok: false, value: null as number | null };
}

function ledgerFailure(error: any) {
  const message = clip(error?.message || error || "ledger_rpc_failed", 1000);
  const normalized = message.toLowerCase();
  if (normalized.includes("paid state requires") || normalized.includes("general_transition_rpc_allowed_paid_state")) {
    return json({
      ok: false,
      error: "payment_requires_verified_receipt",
      detail: "PAID cannot be asserted by the general browser event API.",
    }, 409);
  }
  if (
    normalized.includes("invalid_browser_state_transition") ||
    normalized.includes("invalid_browser_job_state") ||
    normalized.includes("browser_retry_limit_exceeded") ||
    normalized.includes("browser_attempt_limit_exceeded")
  ) {
    return json({ ok: false, error: "browser_state_transition_rejected", detail: message }, 409);
  }
  return json({ ok: false, error: "browser_ledger_write_failed", detail: message }, 500);
}

async function recordLedger(
  sb: any,
  input: {
    jobId: string;
    eventKey?: string | null;
    eventType: string;
    actorKey: string;
    targetState?: string | null;
    sourceUrl?: string | null;
    contentSha256?: string | null;
    evidence?: Record<string, string | number | boolean>;
    nextAction?: string | null;
    blockerCode?: string | null;
    attemptCount?: number | null;
  },
) {
  const normalizedType = normalizeLedgerEventType(input.eventType);
  const evidence = sanitizeLedgerEvidence(input.evidence || {});
  const eventKey = await makeLedgerEventKey({
    jobId: input.jobId,
    eventType: normalizedType,
    targetState: input.targetState ?? null,
    sourceUrl: input.sourceUrl ?? null,
    nextAction: input.nextAction ?? null,
    blockerCode: input.blockerCode ?? null,
    attemptCount: input.attemptCount ?? null,
    evidence,
  }, input.eventKey);

  const { data, error } = await sb.rpc("midad_browser_record_evidence_v1", {
    p_job_id: input.jobId,
    p_event_key: eventKey,
    p_event_type: normalizedType,
    p_actor_key: normalizeActorKey(input.actorKey),
    p_to_state: input.targetState ?? null,
    p_source_url: safeSourceUrl(input.sourceUrl),
    p_content_sha256: input.contentSha256 ?? null,
    p_evidence: evidence,
    p_next_action: input.nextAction ?? null,
    p_blocker_code: input.blockerCode ?? null,
    p_attempt_count: input.attemptCount ?? null,
  });

  if (error) return { ok: false, error, eventKey, data: null };
  const row = Array.isArray(data) ? data[0] ?? null : data;
  return { ok: true, error: null, eventKey, data: row };
}

async function profileSnapshot(sb: any, userId: string) {
  const [profile, brandResult, integrationsResult, walletsResult] = await Promise.all([
    sb.from("profiles").select("full_name,business_name,avatar_url,plan").eq("id", userId).maybeSingle(),
    sb.from("brand_kits").select("business_name,logo_url,colors,description,target_audience,dialect,tone,products,contact_info").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("integrations").select("provider,status,scopes,metadata").eq("user_id", userId).order("updated_at", { ascending: false }).limit(50),
    sb.from("midad_native_signer_accounts").select("label,chain,address,status,purpose").eq("status", "ACTIVE"),
  ]);
  const brand = brandResult.data || {};
  return {
    profile: {
      full_name: profile.data?.full_name || null,
      business_name: profile.data?.business_name || brand.business_name || null,
      avatar_url: profile.data?.avatar_url || brand.logo_url || null,
    },
    brand: {
      description: brand.description || null,
      target_audience: brand.target_audience || null,
      dialect: brand.dialect || null,
      tone: brand.tone || null,
      products: brand.products || [],
      contact_info: brand.contact_info || {},
    },
    connected_accounts: (integrationsResult.data || []).map((item: any) => ({
      provider: item.provider,
      status: item.status,
      scopes: item.scopes || [],
      metadata: item.metadata || {},
    })),
    public_receiving_addresses: (walletsResult.data || []).map((item: any) => ({
      label: item.label,
      chain: item.chain,
      address: item.address,
      purpose: item.purpose,
    })),
  };
}

async function createHumanGate(sb: any, job: any, reason: string) {
  const base = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ingestKey = Deno.env.get("MIDAD_INGEST_KEY") || "";
  const actionUrl = safeSourceUrl(job.current_url);
  const response = await fetch(base + "/functions/v1/midad_human_task_router", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + serviceKey,
      "x-midad-ingest-key": ingestKey,
    },
    body: JSON.stringify({
      action: "create",
      type: "HUMAN_INPUT",
      priority: 95,
      risk_class: reason.toLowerCase().includes("captcha") ? "medium" : "high",
      blocking: true,
      title: "MIDAD Browser Agent — Human checkpoint",
      instruction: "Complete only the platform's own human verification step in the existing browser session. Do not provide secrets to the chat. After completion, return to the session and allow the agent to continue.",
      reason,
      requested_by_agent: job.agent_key,
      action_url: actionUrl,
      evidence: {
        browser_job_id: job.id,
        platform_key: job.platform_key || null,
        current_url: actionUrl,
        state: "HUMAN_GATE",
      },
      idempotency_key: "browser-job:" + job.id + ":human-gate",
    }),
  });
  return await response.json().catch(() => ({}));
}

async function getJob(sb: any, id: string) {
  const { data, error } = await sb.from("midad_browser_jobs").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error };
  return { data: data || null, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({})) as Record<string, any>;
  const action = clip(body.action || "capabilities", 60).toLowerCase();

  try {
    if (action === "capabilities") {
      return json({
        ok: true,
        service: "midad_browser_agent_gateway",
        contract: "browser-agent-v1",
        capabilities: [
          "prepare_truthful_profile",
          "create_browser_job",
          "resume_browser_job",
          "record_navigation_and_evidence",
          "record_evidence_ledger",
          "human_checkpoint",
          "payment_detection_handoff",
        ],
        hard_blocks: [
          "bypass_captcha",
          "bypass_kyc",
          "bypass_2fa",
          "impersonate",
          "fake_identity",
          "credential_theft",
          "unauthorized_access",
          "live_withdrawal",
          "live_transfer",
          "unverified_paid_state",
        ],
      });
    }

    if (action === "create_job") {
      const ownerUserId = clip(body.owner_user_id, 80);
      const agentKey = normalizeActorKey(body.agent_key || "midad_browser_operator");
      const objective = clip(body.objective, 3000);
      if (!ownerUserId || !objective) {
        return json({ ok: false, error: "owner_user_id_and_objective_required" }, 400);
      }

      const idempotencyKey = clip(body.idempotency_key, 240) || ("browser:" + crypto.randomUUID());
      const old = await sb.from("midad_browser_jobs").select("*")
        .eq("owner_user_id", ownerUserId).eq("session_ref", idempotencyKey).maybeSingle();

      if (old.error) return json({ ok: false, error: "job_lookup_failed" }, 500);
      if (old.data) {
        const ledger = await recordLedger(sb, {
          jobId: old.data.id,
          eventKey: "job-created:" + old.data.id,
          eventType: "job_created",
          actorKey: agentKey,
          targetState: null,
          sourceUrl: old.data.current_url,
          evidence: { source_kind: "gateway_create_job" },
          nextAction: old.data.next_action || null,
        });
        if (!ledger.ok) return ledgerFailure(ledger.error);
        const refreshed = await getJob(sb, old.data.id);
        if (refreshed.error || !refreshed.data) return json({ ok: false, error: "job_read_after_ledger_failed" }, 500);
        return json({ ok: true, idempotent: true, job: refreshed.data });
      }

      const snap = await profileSnapshot(sb, ownerUserId);
      const hasInitialUrl = body.current_url !== undefined && body.current_url !== null && clip(body.current_url, 1500) !== "";
      const initialUrl = hasInitialUrl ? safeSourceUrl(body.current_url) : null;
      if (hasInitialUrl && !initialUrl) {
        return json({ ok: false, error: "invalid_current_url", detail: "Only public HTTPS URLs without credentials or IP literals can be recorded." }, 400);
      }
      const insert = {
        owner_user_id: ownerUserId,
        agent_key: agentKey,
        platform_key: clip(body.platform_key, 120) || null,
        objective,
        state: "PREPARING",
        session_ref: idempotencyKey,
        current_url: initialUrl,
        input_data: (body.input_data && typeof body.input_data === "object" && !Array.isArray(body.input_data))
          ? body.input_data
          : {},
        profile_snapshot: snap,
        human_gate: { required: false, status: "none" },
        blocker: {},
        evidence: {},
        next_action: "prepare_profile_and_navigate",
        attempt_count: 0,
      };
      const inserted = await sb.from("midad_browser_jobs").insert(insert).select("*").single();
      if (inserted.error) {
        return json({ ok: false, error: "job_insert_failed", detail: inserted.error.message }, 500);
      }

      const ledger = await recordLedger(sb, {
        jobId: inserted.data.id,
        eventKey: "job-created:" + inserted.data.id,
        eventType: "job_created",
        actorKey: agentKey,
        targetState: "PREPARING",
        sourceUrl: initialUrl,
        evidence: { source_kind: "gateway_create_job" },
        nextAction: "prepare_profile_and_navigate",
        attemptCount: 0,
      });
      if (!ledger.ok) {
        return json({
          ok: false,
          error: "job_created_but_evidence_recording_failed",
          job_id: inserted.data.id,
          detail: clip(ledger.error?.message || "ledger rpc failed", 500),
        }, 500);
      }

      await sb.from("midad_agent_events").insert({
        job_id: inserted.data.id,
        agent_key: agentKey,
        event_type: "job_created",
        state: "PREPARING",
        payload: { platform_key: insert.platform_key, objective },
      });

      return json({ ok: true, job: inserted.data, profile_snapshot: snap });
    }

    if (action === "queue_operator_hint") {
      const ownerUserId = clip(body.owner_user_id, 80);
      const hint = clip(body.operator_hint ?? body.platform_hint, 500);
      if (!ownerUserId || !hint) {
        return json({ ok: false, error: "owner_user_id_and_operator_hint_required" }, 400);
      }
      // This endpoint is authenticated with the private ingest/service key only.
      // A platform hint is data, not executable code; the worker resolves it against
      // its private exact-host account registry and applies the action policy.
      const idempotencyKey = clip(body.idempotency_key, 240) || ("operator-hint:" + crypto.randomUUID());
      const old = await sb.from("midad_browser_jobs").select("*")
        .eq("owner_user_id", ownerUserId).eq("session_ref", idempotencyKey).maybeSingle();
      if (old.error) return json({ ok: false, error: "operator_job_lookup_failed" }, 500);
      if (old.data) return json({ ok: true, idempotent: true, job_id: old.data.id, state: old.data.state });

      const snap = await profileSnapshot(sb, ownerUserId);
      const inserted = await sb.from("midad_browser_jobs").insert({
        owner_user_id: ownerUserId,
        agent_key: normalizeActorKey(body.agent_key || "midad_operator_command_router"),
        platform_key: "operator_router",
        objective: "Resolve approved platform hint and start or route the requested operator action",
        state: "PREPARING",
        session_ref: idempotencyKey,
        current_url: null,
        input_data: { operator_hint: hint },
        profile_snapshot: snap,
        human_gate: { required: false, status: "none" },
        blocker: {},
        evidence: {},
        next_action: "resolve_platform_hint_and_execute",
        attempt_count: 0,
      }).select("*").single();
      if (inserted.error) return json({ ok: false, error: "operator_job_insert_failed" }, 500);

      const ledger = await recordLedger(sb, {
        jobId: inserted.data.id,
        eventKey: "job-created:" + inserted.data.id,
        eventType: "job_created",
        actorKey: "midad_operator_command_router",
        targetState: "PREPARING",
        sourceUrl: null,
        evidence: { source_kind: "operator_hint_queue" },
        nextAction: "resolve_platform_hint_and_execute",
        attemptCount: 0,
      });
      if (!ledger.ok) return ledgerFailure(ledger.error);
      await sb.from("midad_agent_events").insert({
        job_id: inserted.data.id,
        agent_key: "midad_operator_command_router",
        event_type: "operator_hint_queued",
        state: "PREPARING",
        payload: { hint_length: hint.length, hint_preview: safeOperatorPreview(hint, 120) },
      });
      return json({
        ok: true,
        job_id: inserted.data.id,
        state: "PREPARING",
        next_action: "resolve_platform_hint_and_execute",
      }, 202);
    }

    if (action === "record_command_result") {
      const id = clip(body.job_id, 80);
      if (!id || !body.result || typeof body.result !== "object" || Array.isArray(body.result)) {
        return json({ ok: false, error: "job_id_and_result_object_required" }, 400);
      }
      const found = await getJob(sb, id);
      if (found.error) return json({ ok: false, error: "job_lookup_failed" }, 500);
      if (!found.data) return json({ ok: false, error: "not_found" }, 404);
      const inputData = found.data.input_data && typeof found.data.input_data === "object" && !Array.isArray(found.data.input_data)
        ? found.data.input_data
        : {};
      if (!(inputData.operator_command && typeof inputData.operator_command === "object") && !(typeof inputData.operator_hint === "string" && inputData.operator_hint.trim())) {
        return json({ ok: false, error: "not_an_operator_command_job" }, 409);
      }
      const result = sanitizeOperatorResult(body.result);
      const currentEvidence = found.data.evidence && typeof found.data.evidence === "object" && !Array.isArray(found.data.evidence)
        ? found.data.evidence
        : {};
      const updated = await sb.from("midad_browser_jobs").update({
        evidence: { ...currentEvidence, operator_result: result },
      }).eq("id", id).select("*").single();
      if (updated.error) return json({ ok: false, error: "operator_result_write_failed" }, 500);
      await sb.from("midad_agent_events").insert({
        job_id: id,
        agent_key: "midad_operator_worker",
        event_type: "operator_command_result",
        state: updated.data.state,
        payload: { result },
      });
      return json({ ok: true, job_id: id, state: updated.data.state, result });
    }

    if (action === "get_job") {
      const id = clip(body.job_id, 80);
      if (!id) return json({ ok: false, error: "job_id_required" }, 400);
      const found = await getJob(sb, id);
      if (found.error) return json({ ok: false, error: "job_lookup_failed" }, 500);
      if (!found.data) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, job: found.data });
    }

    if (action === "list_jobs") {
      const owner = clip(body.owner_user_id, 80);
      let query = sb.from("midad_browser_jobs").select("*").order("updated_at", { ascending: false })
        .limit(Math.min(100, Math.max(1, Number(body.limit || 25))));
      if (owner) query = query.eq("owner_user_id", owner);
      if (Array.isArray(body.states) && body.states.length) {
        const states = body.states.map((value: unknown) => normalizeTargetState(value)).filter(Boolean);
        if (states.length !== body.states.length) return json({ ok: false, error: "invalid_job_state_filter" }, 400);
        query = query.in("state", states);
      }
      const { data, error } = await query;
      if (error) return json({ ok: false, error: "job_list_failed" }, 500);
      return json({ ok: true, jobs: data || [] });
    }

    if (action === "record_event") {
      const id = clip(body.job_id, 80);
      const originalEventType = clip(body.event_type, 120);
      if (!id || !originalEventType) {
        return json({ ok: false, error: "job_id_and_event_type_required" }, 400);
      }
      const found = await getJob(sb, id);
      if (found.error) return json({ ok: false, error: "job_lookup_failed" }, 500);
      if (!found.data) return json({ ok: false, error: "not_found" }, 404);
      const job = found.data;

      const stateInput = targetStateInput(body);
      if (!stateInput.ok) return json({ ok: false, error: "invalid_target_state" }, 400);
      const attemptInput = attemptCountInput(body);
      if (!attemptInput.ok) return json({ ok: false, error: "invalid_attempt_count" }, 400);
      const digest = digestInput(body);
      if (!digest.ok) return json({ ok: false, error: "invalid_content_sha256" }, 400);

      const hasCurrentUrl = body.current_url !== undefined && body.current_url !== null && clip(body.current_url, 1500) !== "";
      const sourceUrl = hasCurrentUrl ? safeSourceUrl(body.current_url) : safeSourceUrl(job.current_url);
      if (hasCurrentUrl && !sourceUrl) {
        return json({ ok: false, error: "invalid_current_url", detail: "Only public HTTPS URLs without credentials or IP literals can be recorded." }, 400);
      }
      const eventType = normalizeLedgerEventType(originalEventType);
      const evidence = eventEvidence(body, "gateway_record_event", eventType);
      const actorKey = normalizeActorKey(body.agent_key || job.agent_key || "midad_browser_operator");
      const nextAction = body.next_action === undefined ? null : clip(body.next_action, 300) || null;
      const hasBlockerUpdate = body.blocker !== undefined || stateInput.value === "BLOCKED";
      const rawBlockerCode = body.blocker?.code ?? (stateInput.value === "BLOCKED" ? body.code : null);
      const blockerCode = hasBlockerUpdate
        ? safeCode(rawBlockerCode, stateInput.value === "BLOCKED" ? "BLOCKED_BY_POLICY" : "POLICY_EVENT")
        : null;
      const ledger = await recordLedger(sb, {
        jobId: id,
        eventKey: await makeLedgerEventKey({
          jobId: id,
          eventType,
          targetState: stateInput.value,
          sourceUrl,
          nextAction,
          blockerCode,
          attemptCount: attemptInput.value,
          evidence,
          contentSha256: digest.value,
        }, body.event_key ?? body.idempotency_key),
        eventType,
        actorKey,
        targetState: stateInput.value,
        sourceUrl,
        contentSha256: digest.value,
        evidence,
        nextAction,
        blockerCode,
        attemptCount: attemptInput.value,
      });
      if (!ledger.ok) return ledgerFailure(ledger.error);

      const latest = await getJob(sb, id);
      if (latest.error || !latest.data) return json({ ok: false, error: "job_read_after_ledger_failed" }, 500);
      let data = latest.data;

      const auxiliaryPatch: Record<string, unknown> = {};
      if (body.blocker !== undefined || stateInput.value === "BLOCKED") {
        const incomingBlocker = body.blocker && typeof body.blocker === "object" && !Array.isArray(body.blocker)
          ? body.blocker
          : {};
        auxiliaryPatch.blocker = {
          reason: clip(incomingBlocker.reason || body.reason || "blocked", 1500),
          code: blockerCode || "BLOCKED_BY_POLICY",
        };
      }
      if (body.last_error !== undefined) auxiliaryPatch.last_error = clip(body.last_error, 1500) || null;
      if (Object.keys(auxiliaryPatch).length) {
        const updated = await sb.from("midad_browser_jobs").update(auxiliaryPatch).eq("id", id).select("*").single();
        if (updated.error) return json({ ok: false, error: "job_auxiliary_update_failed" }, 500);
        data = updated.data;
      }

      await sb.from("midad_agent_events").insert({
        job_id: id,
        agent_key: actorKey,
        event_type: originalEventType,
        state: data.state,
        payload: {
          current_url: safeSourceUrl(data.current_url),
          next_action: data.next_action,
          blocker: sanitizeLedgerEvidence(data.blocker),
          evidence: sanitizeLedgerEvidence(data.evidence),
          details: sanitizeLedgerEvidence(body.details),
          ledger_event_key: ledger.eventKey,
          idempotent: Boolean(ledger.data?.idempotent),
        },
      });

      if (data.state === "HUMAN_GATE" && !data.human_gate?.task_id) {
        const reason = clip(body.reason || data.blocker?.reason || "human verification required", 1000);
        const task = await createHumanGate(sb, data, reason);
        const humanGate = {
          required: true,
          status: "OPEN",
          task_id: task.task?.id || task.id || null,
          reason,
        };
        const gateUpdate = await sb.from("midad_browser_jobs").update({
          human_gate: humanGate,
          next_action: "wait_for_human_gate",
        }).eq("id", id).select("*").single();
        if (gateUpdate.error) return json({ ok: false, error: "human_gate_record_failed" }, 500);
        return json({ ok: true, job_id: id, state: "HUMAN_GATE", human_gate: humanGate });
      }

      return json({ ok: true, job: data, evidence: ledger.data, idempotent: Boolean(ledger.data?.idempotent) });
    }

    if (action === "complete_human_gate") {
      const id = clip(body.job_id, 80);
      if (!id) return json({ ok: false, error: "job_id_required" }, 400);
      const found = await getJob(sb, id);
      if (found.error) return json({ ok: false, error: "job_lookup_failed" }, 500);
      if (!found.data) return json({ ok: false, error: "not_found" }, 404);
      const job = found.data;

      if (job.state === "RUNNING" && job.human_gate?.status === "COMPLETED") {
        return json({ ok: true, idempotent: true, job });
      }
      const recoveringGateUpdate = job.state === "RUNNING" && job.human_gate?.status === "OPEN";
      if (job.state !== "HUMAN_GATE" && !recoveringGateUpdate) {
        return json({ ok: false, error: "human_gate_not_open", state: job.state }, 409);
      }

      const responseData = sanitizeLedgerEvidence(body.response_data);
      const gate = {
        ...(job.human_gate || {}),
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
        response_data: responseData,
      };
      const ledger = await recordLedger(sb, {
        jobId: id,
        eventKey: "human-gate-resume:" + id,
        eventType: "human_gate_resumed",
        actorKey: "midad_human_gate",
        targetState: "RUNNING",
        sourceUrl: safeSourceUrl(job.current_url),
        evidence: { source_kind: "human_gate_resume" },
        nextAction: "resume_browser_session",
      });
      if (!ledger.ok) return ledgerFailure(ledger.error);

      const { data, error } = await sb.from("midad_browser_jobs").update({
        human_gate: gate,
        next_action: "resume_browser_session",
        last_error: null,
      }).eq("id", id).select("*").single();
      if (error) return json({ ok: false, error: "human_gate_auxiliary_update_failed" }, 500);

      await sb.from("midad_agent_events").insert({
        job_id: id,
        agent_key: "midad_human_gate",
        event_type: "human_gate_completed",
        state: "RUNNING",
        payload: { response_data: responseData, ledger_event_key: ledger.eventKey },
      });
      return json({ ok: true, job: data, evidence: ledger.data });
    }

    if (action === "block") {
      const id = clip(body.job_id, 80);
      const reason = clip(body.reason, 1500) || "blocked";
      if (!id) return json({ ok: false, error: "job_id_required" }, 400);
      const found = await getJob(sb, id);
      if (found.error) return json({ ok: false, error: "job_lookup_failed" }, 500);
      if (!found.data) return json({ ok: false, error: "not_found" }, 404);

      const code = safeCode(body.code, "BLOCKED_BY_POLICY");
      const ledger = await recordLedger(sb, {
        jobId: id,
        eventKey: await makeLedgerEventKey({
          jobId: id,
          eventType: "policy_decision",
          targetState: "BLOCKED",
          sourceUrl: safeSourceUrl(found.data.current_url),
          blockerCode: code,
          evidence: { policy_code: code, policy_status: "BLOCK" },
        }, body.event_key ?? body.idempotency_key),
        eventType: "policy_decision",
        actorKey: "midad_policy_engine",
        targetState: "BLOCKED",
        sourceUrl: safeSourceUrl(found.data.current_url),
        evidence: { source_kind: "policy_gate", policy_code: code, policy_status: "BLOCK" },
        nextAction: "find_alternative_or_escalate",
        blockerCode: code,
      });
      if (!ledger.ok) return ledgerFailure(ledger.error);

      const auxiliary = await sb.from("midad_browser_jobs").update({
        blocker: { reason, code },
        last_error: code,
        next_action: "find_alternative_or_escalate",
      }).eq("id", id).select("*").single();
      if (auxiliary.error) return json({ ok: false, error: "job_auxiliary_update_failed" }, 500);

      await sb.from("midad_agent_events").insert({
        job_id: id,
        agent_key: "midad_policy_engine",
        event_type: "hard_block",
        state: "BLOCKED",
        payload: {
          reason,
          code,
          ledger_event_key: ledger.eventKey,
          idempotent: Boolean(ledger.data?.idempotent),
        },
      });
      return json({ ok: true, job: auxiliary.data, evidence: ledger.data });
    }

    return json({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    return json({ ok: false, error: clip(error, 1500) }, 500);
  }
});
