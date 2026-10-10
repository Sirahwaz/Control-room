import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const INGEST_KEY = Deno.env.get("MIDAD_INGEST_KEY") || "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-midad-ingest-key,x-midad-autonomy-key"
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const clean = (value: unknown, max = 2000) => String(value ?? "").trim().slice(0, max);
const obj = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const arr = (value: unknown): any[] => Array.isArray(value) ? value : [];

async function authorized(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (SERVICE_KEY && authorization === "Bearer " + SERVICE_KEY) return true;

  const ingest = req.headers.get("x-midad-ingest-key") || "";
  if (INGEST_KEY && ingest && ingest === INGEST_KEY) return true;

  const autonomy = req.headers.get("x-midad-autonomy-key") || "";
  if (autonomy) {
    const { data, error } = await db.rpc("midad_get_autonomy_key");
    if (!error && data && autonomy === String(data)) return true;
  }
  return false;
}

const DEFAULT_PROFILE = {
  brand_name: "MIDAD AI | AHWAZ",
  headline: "AI Automation Engineer | AI Agents, API Integrations & Workflow Engineering",
  overview: "I build practical AI and automation systems through MIDAD AI, focusing on multi-agent workflows, API integrations, data workflows, technical QA, and clear handover documentation. My approach is evidence-first: define the outcome, build the smallest reliable solution, test edge cases, document limitations, and deliver reproducible results. I work on modular systems using tools such as Supabase/PostgreSQL, REST APIs, Telegram integrations, browser-based workflows, and AI-assisted automation. I do not claim unverified client results or capabilities; project scope and acceptance criteria are agreed before delivery.",
  services: [
    "AI agent and workflow automation design",
    "REST API and webhook integration",
    "Data collection and research automation using authorized sources",
    "Automation debugging, QA, retries, and error handling",
    "Technical documentation and reproducible handover"
  ],
  skills: [
    "AI Agents", "Workflow Automation", "REST APIs", "Webhooks",
    "Supabase", "PostgreSQL", "Python", "Technical QA",
    "Data Research", "Automation Documentation"
  ],
  portfolio: [
    {
      title: "MIDAD AI Control Room",
      type: "software_system",
      description: "An evolving control surface for multi-agent orchestration, operational visibility, and opportunity workflows.",
      public_url: "https://github.com/Sirahwaz/Control-room",
      status: "project_in_progress",
      claims: ["public source repository"],
      notes: "Do not describe as a finished commercial deployment unless independently verified."
    },
    {
      title: "MIDAD AI automation ecosystem",
      type: "automation_architecture",
      description: "A modular project integrating AI routing, browser task orchestration, opportunity research, delivery tracking, and payment verification.",
      public_url: "https://sirahwaz.github.io/Control-room",
      status: "project_in_progress",
      claims: ["project and interface exist"],
      notes: "Performance and revenue claims must be backed by current evidence."
    }
  ],
  communication: {
    languages: ["Arabic", "English technical communication"],
    tone: "clear, specific, evidence-based",
    scope_rule: "Confirm inputs, acceptance criteria, constraints, and price before starting paid delivery."
  },
  profile_status: "DRAFT_REQUIRES_OWNER_REVIEW",
  truthfulness_contract: {
    fabricate_identity: false,
    fabricate_employment: false,
    fabricate_client_results: false,
    fabricate_certifications: false,
    claim_unverified_revenue: false,
    publish_without_policy_check: false
  }
};

async function platformRecord(platformKey: string) {
  const { data, error } = await db.from("midad_platform_registry")
    .select("platform_key,name,base_url,category,monetization_models,supported_regions,supported_actions,registration_level,verification_requirements,allowed_automation,forbidden_automation,payout_policy,payout_policy_evidence,identity_policy,policy_checked_at,status,notes")
    .eq("platform_key", platformKey).maybeSingle();
  if (error) throw new Error("platform_lookup_failed:" + error.message);
  if (!data) throw new Error("platform_not_found:" + platformKey);
  return data;
}

function assessPlatform(platform: any) {
  const blockers: Array<{code:string;detail:string}> = [];
  const payout = obj(platform.payout_policy);
  const identity = obj(platform.identity_policy);
  const allowed = obj(platform.allowed_automation);
  const forbidden = obj(platform.forbidden_automation);
  const verification = obj(platform.verification_requirements);
  const evidence = arr(platform.payout_policy_evidence);
  const mode = String(payout.mode || "unknown").toLowerCase();
  const payoutStatus = String(payout.status || "unknown").toLowerCase();
  const identityStatus = String(identity.status || "unknown").toLowerCase();

  if (mode === "fiat_only" || mode === "none") {
    blockers.push({ code: "CRYPTO_PAYOUT_UNAVAILABLE", detail: "Platform does not provide an approved crypto payout route." });
  } else if (!["crypto_only", "crypto_available"].includes(mode) || payoutStatus !== "verified") {
    blockers.push({ code: "PAYOUT_POLICY_UNVERIFIED", detail: "Verify the official crypto payout route, assets, network, fees, thresholds, and any fiat alternatives before onboarding." });
  }
  if (!evidence.some((e:any) => typeof e?.url === "string" && /^https:\/\//i.test(e.url) && e?.official === true)) {
    blockers.push({ code: "PAYOUT_EVIDENCE_MISSING", detail: "An official source URL and verification timestamp are required for the payout policy." });
  }

  const kycRequired = identity.kyc_required;
  const govIdRequired = identity.government_id_required;
  const kycNotRequired = [false, "false", "not_required", "no"].includes(typeof kycRequired === "string" ? kycRequired.toLowerCase() : kycRequired);
  const govIdNotRequired = [false, "false", "not_required", "no"].includes(typeof govIdRequired === "string" ? govIdRequired.toLowerCase() : govIdRequired);
  if (kycRequired === true || ["required", "mandatory"].includes(String(kycRequired).toLowerCase())) {
    blockers.push({ code: "KYC_REQUIRED", detail: "Mandatory KYC is incompatible with the current MIDAD account policy; do not bypass it." });
  } else if (govIdRequired === true || ["required", "mandatory"].includes(String(govIdRequired).toLowerCase())) {
    blockers.push({ code: "GOVERNMENT_ID_REQUIRED", detail: "Government identity-document submission is excluded by the current MIDAD account policy." });
  } else if (identityStatus !== "verified" || !kycNotRequired || !govIdNotRequired) {
    blockers.push({ code: "IDENTITY_POLICY_UNVERIFIED", detail: "Verify official identity/KYC requirements. Unknown or conditional requirements remain blocked until reviewed." });
  }

  const regionValue = identity.region_eligibility;
  const regionStatus = String(regionValue ?? "unknown").toLowerCase();
  const regionAllowed = [true, "true", "verified", "eligible", "supported", "allowed"].includes(regionStatus === "true" ? true : regionStatus);
  const regionDenied = [false, "false", "unsupported", "not_supported", "restricted", "ineligible"].includes(regionStatus === "false" ? false : regionStatus);
  if (regionDenied) {
    blockers.push({ code: "REGION_NOT_SUPPORTED", detail: "Official platform eligibility evidence indicates the owner's region is unsupported or restricted." });
  } else if (!regionAllowed) {
    blockers.push({ code: "REGION_ELIGIBILITY_UNVERIFIED", detail: "Confirm official account and payout availability for the owner's actual region before onboarding." });
  }
  if (verification.captcha === "required" || verification.captcha === true) {
    blockers.push({ code: "HUMAN_CHECKPOINT_REQUIRED", detail: "The platform requires a human verification step. CAPTCHA will not be bypassed." });
  }
  if (forbidden.automated_registration === true || forbidden.registration_automation === true) {
    blockers.push({ code: "AUTOMATION_NOT_ALLOWED", detail: "Platform policy forbids automated registration. Profile preparation may continue, but registration must not be automated." });
  }
  const profilePrepAllowed = allowed.profile_prepare === true || allowed.profile_fill === true || allowed.registration_prepare === true;
  if (!profilePrepAllowed) {
    blockers.push({ code: "PROFILE_AUTOMATION_SCOPE_UNKNOWN", detail: "The platform's allowed automation scope does not explicitly cover profile preparation." });
  }
  const registrationPrepAllowed = allowed.registration_prepare === true || allowed.registration === true;
  if (!registrationPrepAllowed) {
    blockers.push({ code: "REGISTRATION_AUTOMATION_NOT_VERIFIED", detail: "Profile drafting is permitted, but automated registration has not been explicitly verified as allowed for this platform." });
  }
  const hardRejected = blockers.some(b => ["CRYPTO_PAYOUT_UNAVAILABLE", "KYC_REQUIRED", "GOVERNMENT_ID_REQUIRED", "REGION_NOT_SUPPORTED", "AUTOMATION_NOT_ALLOWED"].includes(b.code));
  return {
    status: hardRejected ? "REJECTED" : blockers.length ? "POLICY_REVIEW" : "ELIGIBLE",
    eligible_for_automated_onboarding: !hardRejected && blockers.length === 0,
    blockers,
    checks: {
      payout_mode: mode,
      payout_status: payoutStatus,
      official_payout_evidence: evidence.some((e:any) => e?.official === true && /^https:\/\//i.test(String(e?.url || ""))),
      identity_policy_status: identityStatus,
      kyc_required: kycRequired ?? "unknown",
      government_id_required: govIdRequired ?? "unknown",
      profile_preparation_allowed: profilePrepAllowed,
      policy_checked_at: platform.policy_checked_at || null
    }
  };
}

async function writeEvent(input: {
  event_key?: string; account_id?: string | null; run_id?: string | null;
  platform_key: string; actor_key: string; event_type: string;
  from_state?: string | null; to_state?: string | null;
  evidence?: unknown[]; details?: Record<string, unknown>;
}) {
  const payload = {
    event_key: input.event_key || crypto.randomUUID(),
    account_id: input.account_id || null,
    run_id: input.run_id || null,
    platform_key: input.platform_key,
    actor_key: input.actor_key,
    event_type: input.event_type,
    from_state: input.from_state || null,
    to_state: input.to_state || null,
    evidence: input.evidence || [],
    details: input.details || {}
  };
  const { error } = await db.from("midad_platform_account_events").upsert(payload, { onConflict: "event_key", ignoreDuplicates: true });
  if (error) throw new Error("audit_event_write_failed:" + error.message);
}

async function ensureAccount(platformKey: string, profilePayload: Record<string, any>) {
  const platform = await platformRecord(platformKey);
  const gate = assessPlatform(platform);
  const desiredStatus = gate.status === "REJECTED" ? "REJECTED" : gate.status === "POLICY_REVIEW" ? "POLICY_REVIEW" : "PROFILE_DRAFT";
  const record = {
    platform_key: platformKey,
    owner_scope: "midad",
    brand_key: "midad_ai",
    account_status: desiredStatus,
    profile_payload: profilePayload,
    payout_policy_snapshot: obj(platform.payout_policy),
    verification_snapshot: { ...gate.checks, evaluated_at: new Date().toISOString() },
    evidence: [...arr(platform.payout_policy_evidence)],
    metadata: {
      brand: "MIDAD AI",
      owner_label: "AHWAZ",
      source: "midad_account_factory",
      last_policy_decision: gate.status,
      external_account_status: "UNVERIFIED",
      external_account_created_by_midad: false,
      onboarding_started: false,
      duplicate_creation_allowed: false
    }
  };
  const { data, error } = await db.from("midad_platform_accounts")
    .upsert(record, { onConflict: "platform_key,owner_scope,brand_key" })
    .select("*").single();
  if (error) throw new Error("account_record_upsert_failed:" + error.message);
  return { account: data, platform, gate };
}

async function createRun(input: {
  platformKey: string; accountId: string; taskType: string; state: string;
  inputPayload?: Record<string, any>; outputPayload?: Record<string, any>;
  blockers?: unknown[]; evidence?: unknown[]; nextAction?: string; runKey?: string;
}) {
  const runKey = input.runKey || [input.taskType, input.platformKey, "midad_ai", "v1"].join(":");
  const row = {
    run_key: runKey,
    account_id: input.accountId,
    platform_key: input.platformKey,
    task_type: input.taskType,
    agent_key: "midad_account_factory",
    state: input.state,
    input_payload: input.inputPayload || {},
    output_payload: input.outputPayload || {},
    blockers: input.blockers || [],
    evidence: input.evidence || [],
    next_action: input.nextAction || null,
    attempt_count: 0,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await db.from("midad_account_factory_runs")
    .upsert(row, { onConflict: "run_key" }).select("*").single();
  if (error) throw new Error("account_factory_run_upsert_failed:" + error.message);
  return data;
}

async function main(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!await authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const action = clean(body.action || "capabilities", 80).toLowerCase();

  try {
    if (action === "capabilities") {
      return json({
        ok: true,
        service: "midad_account_factory",
        contract: "midad-platform-account-factory-v1",
        state: "ACTIVE",
        actions: ["capabilities", "list_platforms", "assess_platform", "prepare_profile", "queue_onboarding", "list_accounts", "list_runs"],
        pipeline: ["DISCOVER", "VERIFY_PAYOUT_AND_IDENTITY", "COMPOSE_PROFILE", "PREPARE_ACCOUNT", "AUTHORIZED_BROWSER_ONBOARDING", "QUALIFY_OPPORTUNITY", "DELIVER", "VERIFY_CRYPTO_RECEIPT"],
        hard_blocks: ["fiat_only_payout", "mandatory_kyc", "government_id_required", "bypass_captcha", "bypass_2fa", "impersonation", "false_claims", "duplicate_account_creation", "unapproved_terms_acceptance", "withdrawal_or_transfer"],
        notes: ["Profile preparation is not proof of external account creation.", "Unknown payout or identity requirements block external onboarding.", "Final legal acceptance and mandatory human verification remain human-gated."]
      });
    }

    if (action === "list_platforms") {
      const { data, error } = await db.from("midad_platform_registry")
        .select("platform_key,name,base_url,category,monetization_models,supported_regions,supported_actions,registration_level,verification_requirements,allowed_automation,forbidden_automation,payout_policy,payout_policy_evidence,identity_policy,policy_checked_at,status,notes")
        .order("name");
      if (error) throw new Error(error.message);
      return json({ ok: true, platforms: (data || []).map((p:any) => ({ ...p, eligibility: assessPlatform(p) })) });
    }

    if (action === "assess_platform") {
      const platform = await platformRecord(clean(body.platform_key, 120));
      return json({ ok: true, platform_key: platform.platform_key, eligibility: assessPlatform(platform), platform: {
        name: platform.name, base_url: platform.base_url, payout_policy: platform.payout_policy,
        identity_policy: platform.identity_policy, allowed_automation: platform.allowed_automation
      }});
    }

    if (action === "prepare_profile") {
      const platformKey = clean(body.platform_key, 120);
      if (!platformKey) return json({ ok: false, error: "platform_key_required" }, 400);
      const supplied = obj(body.profile_payload);
      const profilePayload = { ...DEFAULT_PROFILE, ...supplied, prepared_at: new Date().toISOString(), approved_for_external_publish: false };
      const { account, platform, gate } = await ensureAccount(platformKey, profilePayload);
      const state = gate.status === "REJECTED" ? "BLOCKED" : gate.status === "POLICY_REVIEW" ? "POLICY_REVIEW" : "PROFILE_PREPARED";
      const blockers = gate.blockers;
      const run = await createRun({
        platformKey, accountId: account.id, taskType: "profile_prepare", state,
        inputPayload: { source: supplied.source || "default_midad_profile_v1" },
        outputPayload: { profile_fields: Object.keys(profilePayload), profile_status: profilePayload.profile_status, eligibility: gate },
        blockers, evidence: arr(platform.payout_policy_evidence),
        nextAction: gate.status === "ELIGIBLE" ? "owner_review_then_queue_onboarding" : "resolve_policy_blockers",
        runKey: "profile_prepare:" + platformKey + ":midad_ai:v1"
      });
      await writeEvent({
        event_key: "profile_prepare:" + platformKey + ":midad_ai:v1",
        account_id: account.id, run_id: run.id, platform_key: platformKey,
        actor_key: "midad_profile_composer", event_type: "profile_draft_prepared",
        from_state: null, to_state: account.account_status,
        evidence: arr(platform.payout_policy_evidence),
        details: { brand: "MIDAD AI", gate_status: gate.status, blocker_codes: blockers.map((b:any)=>b.code), external_publish: false }
      });
      return json({ ok: true, account_id: account.id, account_status: account.account_status, run_id: run.id, run_state: run.state, platform: { key: platform.platform_key, name: platform.name }, profile_payload: profilePayload, eligibility: gate, next_action: run.next_action });
    }

    if (action === "queue_onboarding") {
      const platformKey = clean(body.platform_key, 120);
      if (!platformKey) return json({ ok: false, error: "platform_key_required" }, 400);
      const { data: account, error: accountError } = await db.from("midad_platform_accounts")
        .select("*").eq("platform_key", platformKey).eq("owner_scope", "midad").eq("brand_key", "midad_ai").maybeSingle();
      if (accountError) throw new Error(accountError.message);
      if (!account) return json({ ok: false, error: "profile_draft_required_first", next_action: "prepare_profile" }, 409);

      const platform = await platformRecord(platformKey);
      const gate = assessPlatform(platform);
      if (gate.status !== "ELIGIBLE") {
        const state = gate.status === "REJECTED" ? "BLOCKED" : "POLICY_REVIEW";
        const updated = await db.from("midad_platform_accounts").update({
          account_status: state === "BLOCKED" ? "REJECTED" : "POLICY_REVIEW",
          verification_snapshot: { ...gate.checks, evaluated_at: new Date().toISOString() },
          last_error_code: gate.blockers[0]?.code || "POLICY_REVIEW",
          last_error_detail: gate.blockers.map((b:any)=>b.detail).join(" ")
        }).eq("id", account.id);
        if (updated.error) throw new Error(updated.error.message);
        const run = await createRun({
          platformKey, accountId: account.id, taskType: "registration_prepare", state,
          inputPayload: { mode: "preflight_only" }, blockers: gate.blockers,
          evidence: arr(platform.payout_policy_evidence), nextAction: "resolve_policy_blockers",
          runKey: "registration_prepare:" + platformKey + ":midad_ai:v1"
        });
        await writeEvent({
          account_id: account.id, run_id: run.id, platform_key: platformKey, actor_key: "midad_platform_policy_verifier",
          event_type: "onboarding_blocked_by_policy", from_state: account.account_status, to_state: state,
          evidence: arr(platform.payout_policy_evidence), details: { blocker_codes: gate.blockers.map((b:any)=>b.code) }
        });
        return json({ ok: false, status: state, account_id: account.id, run_id: run.id, blockers: gate.blockers, next_action: "resolve_policy_blockers" }, 409);
      }

      const automation = obj(platform.allowed_automation);
      const registrationAutomationAllowed = automation.registration_prepare === true || automation.registration === true;
      if (!registrationAutomationAllowed) {
        const blockers = [{ code: "REGISTRATION_AUTOMATION_NOT_VERIFIED", detail: "The platform's registration automation permission has not been verified. Profile preparation can continue, but new-account registration is blocked." }];
        const run = await createRun({
          platformKey, accountId: account.id, taskType: "registration_prepare", state: "BLOCKED",
          inputPayload: { mode: "preflight_passed_registration_policy_unknown" },
          blockers, evidence: arr(platform.payout_policy_evidence),
          nextAction: "verify_official_registration_automation_policy",
          runKey: "registration_prepare:" + platformKey + ":midad_ai:v1"
        });
        await db.from("midad_platform_accounts").update({
          account_status: "POLICY_REVIEW",
          last_error_code: blockers[0].code,
          last_error_detail: blockers[0].detail,
          verification_snapshot: { ...gate.checks, evaluated_at: new Date().toISOString() }
        }).eq("id", account.id);
        await writeEvent({
          account_id: account.id, run_id: run.id, platform_key: platformKey,
          actor_key: "midad_platform_policy_verifier",
          event_type: "onboarding_blocked_automation_policy",
          from_state: account.account_status, to_state: "POLICY_REVIEW",
          evidence: arr(platform.payout_policy_evidence),
          details: { blocker_code: blockers[0].code }
        });
        return json({ ok: false, status: "BLOCKED", account_id: account.id, run_id: run.id, blockers, next_action: "verify_official_registration_automation_policy" }, 409);
      }

      const { data: browserProvider, error: providerError } = await db.from("midad_browser_providers")
        .select("provider_key,provider_name,provider_type,status,capabilities,profile_ref,metadata")
        .eq("status", "ready").limit(1).maybeSingle();
      if (providerError) throw new Error(providerError.message);
      const metadata = obj(browserProvider?.metadata);
      if (!browserProvider || metadata.profile_setup_required === true || !browserProvider.profile_ref) {
        const blockers = [{ code: "BROWSER_PROVIDER_NOT_READY", detail: "No browser provider has a ready persistent profile. Configure and verify the existing authorized session before external onboarding." }];
        const run = await createRun({
          platformKey, accountId: account.id, taskType: "registration_prepare", state: "BLOCKED",
          inputPayload: { mode: "preflight_passed" }, blockers, evidence: arr(platform.payout_policy_evidence),
          nextAction: "complete_browser_provider_profile",
          runKey: "registration_prepare:" + platformKey + ":midad_ai:v1"
        });
        await writeEvent({
          account_id: account.id, run_id: run.id, platform_key: platformKey, actor_key: "midad_account_factory",
          event_type: "onboarding_blocked_browser_not_ready", from_state: account.account_status, to_state: "BLOCKED",
          evidence: [], details: { provider_status: browserProvider?.status || "missing" }
        });
        return json({ ok: false, status: "BLOCKED", account_id: account.id, run_id: run.id, blockers, next_action: "complete_browser_provider_profile" }, 409);
      }

      const { data: profile } = await db.from("profiles").select("id").limit(1).maybeSingle();
      if (!profile?.id) return json({ ok: false, status: "BLOCKED", error: "midad_owner_profile_missing" }, 409);

      const objective = "Audit the authenticated session first to determine whether the MIDAD AI account already exists. Never create a duplicate. If it exists, prepare or update only the existing account; if it does not, prepare registration fields without final submission. Use only the approved profile draft. Stop before accepting legal terms, submitting irreversible declarations, handling identity verification, CAPTCHA, or 2FA. Never bypass platform controls. Record evidence and create a human checkpoint if required.";
      const gatewayUrl = SUPABASE_URL + "/functions/v1/midad_browser_agent_gateway";
      const gatewayResponse = await fetch(gatewayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + SERVICE_KEY, ...(INGEST_KEY ? { "x-midad-ingest-key": INGEST_KEY } : {}) },
        body: JSON.stringify({
          action: "create_job", owner_user_id: profile.id, agent_key: "midad_browser_operator",
          platform_key: platformKey, objective, current_url: platform.base_url,
          input_data: { profile_payload: account.profile_payload, payout_policy: platform.payout_policy, identity_policy: platform.identity_policy, registration_boundary: "prepare_only_stop_before_final_terms_or_submit" },
          idempotency_key: "midad-account:" + platformKey + ":midad_ai:v1"
        })
      });
      const gatewayBody = await gatewayResponse.json().catch(() => ({}));
      if (!gatewayResponse.ok || !gatewayBody.ok || !gatewayBody.job?.id) {
        return json({ ok: false, status: "BLOCKED", error: "browser_gateway_job_create_failed", gateway_status: gatewayResponse.status, detail: gatewayBody.error || null }, 502);
      }

      const run = await createRun({
        platformKey, accountId: account.id, taskType: "registration_prepare", state: "REGISTRATION_QUEUED",
        inputPayload: { mode: "prepare_only", provider_key: browserProvider.provider_key },
        outputPayload: { browser_job_id: gatewayBody.job.id },
        evidence: arr(platform.payout_policy_evidence), nextAction: "browser_worker_prepare_profile",
        runKey: "registration_prepare:" + platformKey + ":midad_ai:v1"
      });
      const updated = await db.from("midad_platform_accounts").update({
        account_status: "REGISTRATION_PENDING", browser_provider_key: browserProvider.provider_key,
        browser_profile_ref: browserProvider.profile_ref, last_error_code: null, last_error_detail: null
      }).eq("id", account.id);
      if (updated.error) throw new Error(updated.error.message);
      await db.from("midad_account_factory_runs").update({ browser_job_id: gatewayBody.job.id, output_payload: { browser_job_id: gatewayBody.job.id } }).eq("id", run.id);
      await writeEvent({
        account_id: account.id, run_id: run.id, platform_key: platformKey, actor_key: "midad_account_factory",
        event_type: "browser_onboarding_job_created", from_state: account.account_status, to_state: "REGISTRATION_PENDING",
        evidence: arr(platform.payout_policy_evidence), details: { browser_job_id: gatewayBody.job.id, provider_key: browserProvider.provider_key }
      });
      return json({ ok: true, status: "REGISTRATION_QUEUED", account_id: account.id, run_id: run.id, browser_job_id: gatewayBody.job.id, next_action: "browser_worker_prepare_profile" });
    }

    if (action === "list_accounts") {
      const platformKey = clean(body.platform_key, 120);
      let query = db.from("midad_platform_accounts").select("id,platform_key,owner_scope,brand_key,platform_account_ref,public_profile_url,account_status,profile_payload,payout_policy_snapshot,verification_snapshot,last_verified_at,last_error_code,last_error_detail,evidence,metadata,created_at,updated_at").eq("owner_scope", "midad").eq("brand_key", "midad_ai").order("updated_at", { ascending: false }).limit(100);
      if (platformKey) query = query.eq("platform_key", platformKey);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return json({ ok: true, accounts: data || [] });
    }

    if (action === "list_runs") {
      const platformKey = clean(body.platform_key, 120);
      let query = db.from("midad_account_factory_runs").select("*").order("updated_at", { ascending: false }).limit(Math.min(100, Math.max(1, Number(body.limit || 25))));
      if (platformKey) query = query.eq("platform_key", platformKey);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return json({ ok: true, runs: data || [] });
    }

    return json({ ok: false, error: "unsupported_action", action }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message.slice(0, 1200) }, 500);
  }
}

Deno.serve(main);
