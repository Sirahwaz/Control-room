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

async function readPlatformSecret(secretId: string) {
  const { data, error } = await db.rpc("midad_read_platform_secret", { secret_id: secretId });
  if (error || !data) throw new Error("platform_secret_vault_read_failed");
  return String(data);
}

async function storePlatformSecret(secretValue: string, secretName: string, description: string) {
  const { data, error } = await db.rpc("midad_store_platform_secret", {
    new_secret: secretValue,
    new_name: secretName,
    new_description: description
  });
  if (error || !data) throw new Error("platform_secret_vault_store_failed");
  return String(data);
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
        actions: ["capabilities", "list_platforms", "assess_platform", "prepare_profile", "register_agent_identity", "list_agent_eligible_listings", "inspect_agent_listing", "queue_onboarding", "list_accounts", "list_runs"],
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

    if (action === "register_agent_identity") {
      const platformKey = clean(body.platform_key || "superteam_fun", 120);
      if (platformKey !== "superteam_fun") {
        return json({ ok: false, error: "official_agent_api_not_supported_for_platform" }, 400);
      }
      if (body.owner_approved !== true) {
        return json({ ok: false, error: "explicit_owner_approval_required", next_action: "owner_approval" }, 403);
      }

      const { data: account, error: accountError } = await db.from("midad_platform_accounts")
        .select("*").eq("platform_key", platformKey).eq("owner_scope", "midad").eq("brand_key", "midad_ai").maybeSingle();
      if (accountError) throw new Error("platform_account_lookup_failed");
      if (!account) return json({ ok: false, error: "profile_draft_required_first", next_action: "prepare_profile" }, 409);

      const existingMeta = obj(account.metadata);
      if (account.platform_account_ref && existingMeta.external_actor_type === "autonomous_agent") {
        return json({
          ok: true, idempotent: true, status: account.account_status,
          account_id: account.id, agent_id: account.platform_account_ref,
          public_profile_url: account.public_profile_url || null,
          claim_status: existingMeta.claim_status || "UNKNOWN",
          next_action: existingMeta.next_action || "inspect_existing_agent_state"
        });
      }
      if (existingMeta.agent_registration_attempted_at) {
        return json({
          ok: false, status: account.account_status, account_id: account.id,
          error: "prior_registration_attempt_requires_reconciliation",
          next_action: "reconcile_superteam_agent_before_retry",
          note: "MIDAD will not blindly repeat an external account-creation request."
        }, 409);
      }

      const platform = await platformRecord(platformKey);
      const automation = obj(platform.allowed_automation);
      const officialAgentSource = arr(platform.payout_policy_evidence).some((item:any) =>
        item?.official === true && String(item?.url || "").startsWith("https://superteam.fun/earn/agents")
      );
      if (automation.agent_api_registration !== true || !officialAgentSource) {
        return json({
          ok: false, status: "POLICY_REVIEW",
          error: "official_agent_api_registration_policy_not_verified",
          next_action: "verify_official_agent_api_contract"
        }, 409);
      }

      const startedAt = new Date().toISOString();
      const metadataStarted = {
        ...existingMeta,
        external_actor_type: "autonomous_agent",
        external_account_status: "REGISTRATION_PENDING",
        agent_registration_attempted: true,
        agent_registration_attempted_at: startedAt,
        agent_registration_source: "official_superteam_agent_api",
        duplicate_creation_allowed: false,
        next_action: "await_agent_registration_result"
      };
      const startedUpdate = await db.from("midad_platform_accounts").update({
        account_status: "REGISTRATION_PENDING",
        metadata: metadataStarted,
        last_error_code: null,
        last_error_detail: null,
        updated_at: startedAt
      }).eq("id", account.id);
      if (startedUpdate.error) throw new Error("registration_attempt_state_write_failed");

      const run = await createRun({
        platformKey,
        accountId: account.id,
        taskType: "register_agent_identity",
        state: "RUNNING",
        inputPayload: {
          registration_mode: "official_agent_api",
          owner_approved: true,
          no_human_profile_or_payout_claim_performed: true
        },
        blockers: [],
        evidence: [{ url: "https://superteam.fun/earn/agents", official: true, claim: "Official agent registration and human payout claim flow" }],
        nextAction: "call_official_agent_registration_api",
        runKey: "superteam_agent_registration:midad_ai:v1"
      });
      await db.from("midad_account_factory_runs").update({ attempt_count: 1, started_at: startedAt }).eq("id", run.id);
      await writeEvent({
        account_id: account.id, run_id: run.id, platform_key: platformKey,
        actor_key: "midad_account_factory", event_type: "agent_registration_started",
        from_state: account.account_status, to_state: "REGISTRATION_PENDING",
        evidence: [{ url: "https://superteam.fun/earn/agents", official: true }],
        details: { owner_approved: true, secret_storage: "supabase_vault", no_submission: true, no_wallet_signature: true }
      });

      let response: Response;
      try {
        response = await fetch("https://superteam.fun/api/agents", {
          method: "POST",
          headers: { "content-type": "application/json", "accept": "application/json" },
          body: JSON.stringify({ name: "MIDAD AI AHWAZ Technical Delivery Agent" })
        });
      } catch (_) {
        const reason = "The official registration endpoint did not return a definite response. Reconcile the provider before any retry.";
        await db.from("midad_platform_accounts").update({
          account_status: "HUMAN_CHECKPOINT",
          last_error_code: "REGISTRATION_RESULT_UNCERTAIN",
          last_error_detail: reason,
          metadata: { ...metadataStarted, external_account_status: "REGISTRATION_RESULT_UNCERTAIN", next_action: "reconcile_superteam_agent_before_retry" },
          updated_at: new Date().toISOString()
        }).eq("id", account.id);
        await db.from("midad_account_factory_runs").update({
          state: "HUMAN_CHECKPOINT",
          blockers: [{ code: "REGISTRATION_RESULT_UNCERTAIN", detail: reason }],
          next_action: "reconcile_superteam_agent_before_retry",
          last_error: "provider_response_uncertain",
          updated_at: new Date().toISOString()
        }).eq("id", run.id);
        return json({ ok: false, status: "HUMAN_CHECKPOINT", account_id: account.id, run_id: run.id, error: "provider_response_uncertain", next_action: "reconcile_superteam_agent_before_retry" }, 502);
      }

      if (!response.ok) {
        const definitiveRejection = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
        const nextState = definitiveRejection ? "BLOCKED" : "HUMAN_CHECKPOINT";
        const code = definitiveRejection ? "PROVIDER_REGISTRATION_REJECTED" : "REGISTRATION_RESULT_UNCERTAIN";
        const detail = definitiveRejection
          ? "The official agent API rejected the registration request. No automatic retry will be attempted."
          : "The official agent API returned a transient or ambiguous status. Reconcile before retrying.";
        await db.from("midad_platform_accounts").update({
          account_status: nextState,
          last_error_code: code,
          last_error_detail: detail,
          metadata: { ...metadataStarted, external_account_status: code, registration_http_status: response.status, next_action: "review_provider_response" },
          updated_at: new Date().toISOString()
        }).eq("id", account.id);
        await db.from("midad_account_factory_runs").update({
          state: nextState,
          blockers: [{ code, detail }],
          next_action: "review_provider_response",
          last_error: "provider_http_" + response.status,
          output_payload: { provider_http_status: response.status },
          updated_at: new Date().toISOString()
        }).eq("id", run.id);
        return json({ ok: false, status: nextState, account_id: account.id, run_id: run.id, error: code, provider_http_status: response.status, next_action: "review_provider_response" }, definitiveRejection ? 409 : 502);
      }

      const registration = await response.json().catch(() => null);
      const agentId = clean(registration?.agentId || registration?.agent_id || registration?.id, 160);
      const apiKey = clean(registration?.apiKey || registration?.api_key, 2000);
      const claimCode = clean(registration?.claimCode || registration?.claim_code, 500);
      const username = clean(registration?.username || registration?.slug, 160);
      if (!agentId || !apiKey || !claimCode || !username) {
        const reason = "The provider returned a successful response but not the documented agent credentials/identity fields. Do not retry registration until reconciled.";
        await db.from("midad_platform_accounts").update({
          account_status: "HUMAN_CHECKPOINT",
          platform_account_ref: agentId || null,
          public_profile_url: username ? "https://superteam.fun/earn/t/" + encodeURIComponent(username) : null,
          last_error_code: "AGENT_REGISTRATION_RESPONSE_INCOMPLETE",
          last_error_detail: reason,
          metadata: {
            ...metadataStarted,
            external_actor_type: "autonomous_agent",
            external_account_created_by_midad: true,
            external_account_status: "REGISTRATION_RESPONSE_INCOMPLETE",
            agent_username: username || null,
            next_action: "reconcile_superteam_agent_before_retry"
          },
          updated_at: new Date().toISOString()
        }).eq("id", account.id);
        await db.from("midad_account_factory_runs").update({
          state: "HUMAN_CHECKPOINT",
          blockers: [{ code: "AGENT_REGISTRATION_RESPONSE_INCOMPLETE", detail: reason }],
          next_action: "reconcile_superteam_agent_before_retry",
          last_error: "provider_response_contract_mismatch",
          output_payload: { http_status: response.status, agent_id_received: Boolean(agentId), username_received: Boolean(username), credential_fields_received: Boolean(apiKey && claimCode) },
          updated_at: new Date().toISOString()
        }).eq("id", run.id);
        return json({ ok: false, status: "HUMAN_CHECKPOINT", account_id: account.id, run_id: run.id, error: "agent_registration_response_incomplete", next_action: "reconcile_superteam_agent_before_retry" }, 502);
      }

      const profileUrl = "https://superteam.fun/earn/t/" + encodeURIComponent(username);
      const registeredAt = new Date().toISOString();
      const providerRegisteredMeta = {
        ...metadataStarted,
        external_actor_type: "autonomous_agent",
        external_account_created_by_midad: true,
        external_account_status: "REGISTERED_SECRET_STORAGE_PENDING",
        agent_id: agentId,
        agent_username: username,
        agent_registration_completed_at: registeredAt,
        claim_status: "UNCLAIMED",
        payout_eligibility: "HUMAN_CLAIM_AND_LISTING_POLICY_REVIEW",
        listing_kyc_policy: "CHECK_EACH_LISTING",
        api_secret_storage_status: "PENDING",
        next_action: "store_agent_credentials_in_vault"
      };
      const registeredUpdate = await db.from("midad_platform_accounts").update({
        platform_account_ref: agentId,
        public_profile_url: profileUrl,
        account_status: "REGISTERED_UNVERIFIED",
        last_verified_at: registeredAt,
        metadata: providerRegisteredMeta,
        last_error_code: null,
        last_error_detail: null,
        updated_at: registeredAt
      }).eq("id", account.id);
      if (registeredUpdate.error) {
        return json({
          ok: false, status: "HUMAN_CHECKPOINT", error: "external_agent_created_but_registry_write_failed",
          agent_id: agentId, public_profile_url: profileUrl,
          next_action: "reconcile_registry_without_recreating_agent"
        }, 502);
      }

      let apiKeyRef: string;
      try {
        apiKeyRef = await storePlatformSecret(
          apiKey,
          "midad:platform:superteam_fun:agent_api_key:" + agentId,
          "MIDAD Superteam Earn agent API key; service-role access only."
        );
      } catch (_) {
        const detail = "Agent exists, but API credential storage failed. Do not create another agent; repair Vault storage for this existing identity.";
        await db.from("midad_platform_accounts").update({
          metadata: { ...providerRegisteredMeta, api_secret_storage_status: "FAILED", next_action: "repair_vault_storage_for_existing_agent" },
          last_error_code: "AGENT_API_KEY_VAULT_STORE_FAILED",
          last_error_detail: detail,
          updated_at: new Date().toISOString()
        }).eq("id", account.id);
        await db.from("midad_account_factory_runs").update({
          state: "BLOCKED",
          blockers: [{ code: "AGENT_API_KEY_VAULT_STORE_FAILED", detail }],
          next_action: "repair_vault_storage_for_existing_agent",
          last_error: "vault_store_failed",
          output_payload: { agent_id: agentId, public_profile_url: profileUrl },
          updated_at: new Date().toISOString()
        }).eq("id", run.id);
        return json({ ok: false, status: "BLOCKED", account_id: account.id, agent_id: agentId, public_profile_url: profileUrl, error: "agent_api_key_vault_store_failed", next_action: "repair_vault_storage_for_existing_agent" }, 502);
      }

      await db.from("midad_platform_accounts").update({
        credential_vault_ref: apiKeyRef,
        metadata: { ...providerRegisteredMeta, agent_api_key_vault_ref: apiKeyRef, api_secret_storage_status: "API_KEY_STORED", next_action: "store_claim_code_in_vault" },
        updated_at: new Date().toISOString()
      }).eq("id", account.id);

      let claimCodeRef: string;
      try {
        claimCodeRef = await storePlatformSecret(
          claimCode,
          "midad:platform:superteam_fun:claim_code:" + agentId,
          "MIDAD Superteam Earn agent claim code; disclose only through an owner-approved claim handoff."
        );
      } catch (_) {
        const detail = "Agent API key is vaulted, but the human-claim code could not be stored. Do not recreate the agent; repair claim-code storage.";
        await db.from("midad_platform_accounts").update({
          metadata: { ...providerRegisteredMeta, agent_api_key_vault_ref: apiKeyRef, api_secret_storage_status: "PARTIAL", next_action: "repair_claim_code_storage" },
          credential_vault_ref: apiKeyRef,
          last_error_code: "AGENT_CLAIM_CODE_VAULT_STORE_FAILED",
          last_error_detail: detail,
          updated_at: new Date().toISOString()
        }).eq("id", account.id);
        await db.from("midad_account_factory_runs").update({
          state: "BLOCKED",
          blockers: [{ code: "AGENT_CLAIM_CODE_VAULT_STORE_FAILED", detail }],
          next_action: "repair_claim_code_storage",
          last_error: "claim_code_vault_store_failed",
          output_payload: { agent_id: agentId, public_profile_url: profileUrl, api_key_vaulted: true },
          updated_at: new Date().toISOString()
        }).eq("id", run.id);
        return json({ ok: false, status: "BLOCKED", account_id: account.id, agent_id: agentId, public_profile_url: profileUrl, api_key_vaulted: true, error: "claim_code_vault_store_failed", next_action: "repair_claim_code_storage" }, 502);
      }

      const completedAt = new Date().toISOString();
      const completedMeta = {
        ...providerRegisteredMeta,
        agent_api_key_vault_ref: apiKeyRef,
        claim_code_vault_ref: claimCodeRef,
        api_secret_storage_status: "VAULTED",
        external_account_status: "REGISTERED_AGENT_UNCLAIMED",
        claim_status: "UNCLAIMED",
        next_action: "discover_agent_eligible_crypto_listings_then_human_claim_before_payout"
      };
      const finalUpdate = await db.from("midad_platform_accounts").update({
        account_status: "REGISTERED_UNVERIFIED",
        credential_vault_ref: apiKeyRef,
        verification_snapshot: {
          ...obj(account.verification_snapshot),
          agent_identity_registration: "VERIFIED",
          human_claim_required_for_payout: true,
          payout_eligibility: "HUMAN_CLAIM_AND_LISTING_POLICY_REVIEW",
          per_listing_kyc_check_required: true,
          evaluated_at: completedAt
        },
        metadata: completedMeta,
        updated_at: completedAt
      }).eq("id", account.id);
      if (finalUpdate.error) throw new Error("agent_registration_finalize_failed");

      await db.from("midad_account_factory_runs").update({
        state: "COMPLETED",
        blockers: [{ code: "HUMAN_CLAIM_REQUIRED_FOR_PAYOUT", detail: "A human must claim the agent before payout. Only pursue listings whose payment flow is compatible with the owner's identity-document policy." }],
        output_payload: {
          agent_id: agentId,
          username,
          public_profile_url: profileUrl,
          agent_api_key_vaulted: true,
          claim_code_vaulted: true,
          raw_credentials_returned: false,
          claim_status: "UNCLAIMED",
          payout_policy: "listing_specific_review"
        },
        next_action: completedMeta.next_action,
        completed_at: completedAt,
        updated_at: completedAt
      }).eq("id", run.id);
      await writeEvent({
        account_id: account.id, run_id: run.id, platform_key: platformKey,
        actor_key: "midad_account_factory", event_type: "agent_identity_registered",
        from_state: "REGISTRATION_PENDING", to_state: "REGISTERED_UNVERIFIED",
        evidence: [{ url: "https://superteam.fun/earn/agents", official: true }],
        details: {
          agent_id: agentId, username, public_profile_url: profileUrl,
          api_key_vaulted: true, claim_code_vaulted: true,
          claim_status: "UNCLAIMED", payout_eligibility: "HUMAN_CLAIM_AND_LISTING_POLICY_REVIEW"
        }
      });
      return json({
        ok: true, status: "REGISTERED_UNVERIFIED", account_id: account.id, run_id: run.id,
        platform: "superteam_fun", agent_id: agentId, username, public_profile_url: profileUrl,
        api_key_vaulted: true, claim_code_vaulted: true, raw_credentials_returned: false,
        claim_status: "UNCLAIMED", human_claim_required_for_payout: true,
        next_action: "discover_agent_eligible_crypto_listings_then_human_claim_before_payout",
        note: "Only agent identity was created. No listing was submitted, no wallet was signed, and no payout or KYC flow was initiated."
      });
    }

    if (action === "list_agent_eligible_listings") {
      const platformKey = clean(body.platform_key || "superteam_fun", 120);
      if (platformKey !== "superteam_fun") {
        return json({ ok: false, error: "agent_listing_api_not_supported_for_platform" }, 400);
      }
      const { data: account, error: accountError } = await db.from("midad_platform_accounts")
        .select("id,platform_key,platform_account_ref,public_profile_url,credential_vault_ref,metadata")
        .eq("platform_key", platformKey).eq("owner_scope", "midad").eq("brand_key", "midad_ai").maybeSingle();
      if (accountError) throw new Error("platform_account_lookup_failed");
      if (!account || !account.platform_account_ref || !account.credential_vault_ref || obj(account.metadata).external_actor_type !== "autonomous_agent") {
        return json({ ok: false, status: "BLOCKED", error: "registered_superteam_agent_and_vault_reference_required" }, 409);
      }

      const apiKey = await readPlatformSecret(String(account.credential_vault_ref));
      const take = Math.min(50, Math.max(1, Number(body.take || 20)));
      const feedTypes = ["bounty", "project", "hackathon"];
      const listingUrls = feedTypes.map(type => "https://superteam.fun/api/agents/listings/live?take=" + take + "&type=" + type);
      const scanStartedAt = new Date().toISOString();
      const run = await createRun({
        platformKey, accountId: account.id, taskType: "discover_agent_eligible_listings", state: "RUNNING",
        inputPayload: { take, feed_types: feedTypes, agent_id: account.platform_account_ref, api_key_vaulted: true },
        blockers: [], evidence: [{ url: "https://superteam.fun/earn/agents", official: true }],
        nextAction: "fetch_agent_eligible_listing_feeds",
        runKey: "superteam_agent_discovery:" + new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
      });

      const feedResults = await Promise.all(listingUrls.map(async (url, index) => {
        try {
          const response = await fetch(url, {
            method: "GET",
            headers: { "accept": "application/json", "authorization": "Bearer " + apiKey },
            signal: AbortSignal.timeout(12000)
          });
          if (!response.ok) return { ok: false, url, type: feedTypes[index], http_status: response.status, items: [] as any[] };
          const feed = await response.json().catch(() => null);
          const items = Array.isArray(feed) ? feed :
            Array.isArray(feed?.listings) ? feed.listings :
            Array.isArray(feed?.data) ? feed.data :
            Array.isArray(feed?.items) ? feed.items : [];
          return { ok: true, url, type: feedTypes[index], http_status: response.status, items };
        } catch (_) {
          return { ok: false, url, type: feedTypes[index], http_status: null, items: [] as any[] };
        }
      }));

      const successfulFeeds = feedResults.filter(feed => feed.ok);
      if (successfulFeeds.length === 0) {
        const statusCodes = feedResults.map(feed => ({ type: feed.type, http_status: feed.http_status }));
        const authFailure = feedResults.some(feed => feed.http_status === 401 || feed.http_status === 403);
        const detail = authFailure
          ? "Superteam rejected the agent API credential. Check Vault reference and rotate credentials if needed."
          : "All official Superteam agent listing feeds failed.";
        const state = authFailure ? "BLOCKED" : "FAILED";
        await db.from("midad_account_factory_runs").update({
          state,
          blockers: [{ code: authFailure ? "AGENT_LISTING_AUTH_FAILED" : "AGENT_LISTING_FEEDS_FAILED", detail }],
          output_payload: { feeds: statusCodes },
          next_action: authFailure ? "repair_agent_api_key" : "retry_listing_discovery",
          last_error: "no_successful_listing_feed",
          updated_at: new Date().toISOString()
        }).eq("id", run.id);
        return json({ ok: false, status: state, run_id: run.id, error: authFailure ? "agent_listing_auth_failed" : "agent_listing_feeds_failed", feeds: statusCodes }, authFailure ? 409 : 502);
      }

      const rawById = new Map<string, any>();
      for (const feed of successfulFeeds) {
        for (const item of feed.items) {
          const identity = clean(item?.id || item?.listingId || item?.listing_id || item?.slug || item?.slugId || item?.slug_id, 180);
          if (!identity) continue;
          if (!rawById.has(identity)) rawById.set(identity, { ...item, _midad_source_url: feed.url, _midad_feed_type: feed.type });
        }
      }
      const rawListings = Array.from(rawById.values());
      const eligible = rawListings.filter((item:any) =>
        ["AGENT_ALLOWED", "AGENT_ONLY"].includes(String(item?.agentAccess || item?.agent_access || "").toUpperCase())
      );
      const { data: ownerProfile } = await db.from("profiles").select("id").limit(1).maybeSingle();
      const summary: any[] = [];
      const counters = {
        received: rawListings.length,
        agent_eligible: eligible.length,
        feeds_queried: feedTypes.length,
        feeds_succeeded: successfulFeeds.length,
        feed_errors: feedResults.filter(feed => !feed.ok).map(feed => ({ type: feed.type, http_status: feed.http_status })),
        saved: 0, crypto_candidates: 0, policy_review: 0, kyc_blocked: 0, errors: 0
      };

      for (const listing of eligible) {
        const externalId = clean(listing.id || listing.listingId || listing.listing_id || listing.slug, 180);
        if (!externalId) { counters.errors++; continue; }
        const slug = clean(listing.slug || listing.slugId || listing.slug_id || externalId, 180);
        const title = clean(listing.title || listing.name || "Superteam agent-eligible listing", 250);
        const description = clean(listing.description || listing.summary || listing.brief || listing.content, 8000);
        const url = clean(listing.url || listing.publicUrl || listing.public_url || listing.link, 1500) ||
          ("https://superteam.fun/earn/listing/" + encodeURIComponent(slug));
        const sponsorObj = obj(listing.sponsor);
        const sponsorName = clean(sponsorObj.name || listing.sponsorName || listing.sponsor_name || listing.organizationName || listing.organization_name, 180);
        const type = clean(listing.type || listing.listingType || listing.listing_type || "unknown", 80);
        const access = String(listing.agentAccess || listing.agent_access || "").toUpperCase();
        const rewardObj = obj(listing.compensation || listing.reward || listing.budget);
        const nestedToken = obj(rewardObj.token);
        const asset = clean(
          listing.paymentAsset || listing.payment_asset || listing.currency ||
          rewardObj.asset || rewardObj.currency || rewardObj.tokenSymbol || nestedToken.symbol || nestedToken.name ||
          listing.rewardToken || listing.reward_token, 40
        ).toUpperCase();
        const amountInput = listing.amount ?? listing.rewardAmount ?? listing.reward_amount ??
          listing.budgetAmount ?? listing.budget_amount ?? rewardObj.amount ?? rewardObj.value ?? 0;
        const amountText = String(amountInput ?? "");
        const amountMatch = amountText.match(/([0-9]+(?:\.[0-9]+)?)/);
        const amount = Number.isFinite(Number(amountInput)) ? Number(amountInput) : (amountMatch ? Number(amountMatch[1]) : 0);
        const stableOrCryptoAsset = /^(USDC|USDG|USDT|SOL|BTC|ETH|POL|BNB|BONK|JTO|JUP)$/i.test(asset);
        const sponsorLower = sponsorName.toLowerCase();
        const listingText = JSON.stringify({
          title, description, sponsor: sponsorName,
          eligibility: listing.eligibility || listing.eligibilityQuestions || listing.eligibility_questions || [],
          payout: listing.payout || listing.payment || rewardObj,
          terms: listing.terms || listing.requirements || listing.notes || ""
        }).toLowerCase();
        const explicitKyc = /\b(kyc required|requires kyc|post kyc|must complete kyc|identity verification required|government[- ]issued id required)\b/.test(listingText);
        const noKycClaim = /\b(no[- ]kyc|kyc not required|without kyc|no identity documents required)\b/.test(listingText);
        const firstPartyKycRisk = /superteam|solana foundation/.test(sponsorLower);
        const globalRegion = String(listing.region || listing.regions || listing.eligibility?.region || "").toLowerCase().includes("global") ||
          String(listing.location || "").toLowerCase().includes("worldwide");
        let payoutGate = "POLICY_REVIEW";
        let payoutGateReason = "Listing-specific payout/KYC/region terms are not proven by the feed. Verify sponsor terms before claiming or submitting.";
        if (firstPartyKycRisk || explicitKyc) {
          payoutGate = "BLOCKED_KYC";
          payoutGateReason = firstPartyKycRisk
            ? "Superteam/Solana-sponsored payouts are documented as requiring KYC; this lane is excluded by the owner identity policy."
            : "The listing text explicitly indicates KYC or identity verification is required.";
        } else if (stableOrCryptoAsset && noKycClaim && globalRegion) {
          payoutGate = "CRYPTO_NO_KYC_CANDIDATE";
          payoutGateReason = "The listing explicitly states no KYC, has a crypto payout asset, and advertises global eligibility; recheck before submission.";
        }
        const numericUsd = /^(USDC|USDG|USDT)$/i.test(asset) && amount > 0 ? amount : null;
        const skills = Array.isArray(listing.skills) ? listing.skills.map((x:any)=>String(x)).slice(0,40) :
          Array.isArray(listing.tags) ? listing.tags.map((x:any)=>String(x)).slice(0,40) : [];
        const evidence = {
          source: "superteam_agent_api",
          source_url: listing._midad_source_url || listingUrls.join(";"),
          official_listing_url: url,
          official_agent_docs: "https://superteam.fun/earn/agents",
          feed_type: listing._midad_feed_type || null,
          checked_at: scanStartedAt,
          external_id: externalId,
          slug,
          agent_access: access,
          listing_type: type,
          sponsor: sponsorName || null,
          compensation: { amount: amount > 0 ? amount : null, asset: asset || null },
          deadline: listing.deadline || listing.deadlineAt || listing.deadline_at || null,
          regions: listing.regions || listing.region || listing.location || null,
          payout_gate: payoutGate,
          payout_gate_reason: payoutGateReason,
          kyc_terms_detection: { explicit_kyc: explicitKyc, explicit_no_kyc: noKycClaim, first_party_sponsor_risk: firstPartyKycRisk },
          raw_evidence_fields: {
            eligibility_questions: listing.eligibilityQuestions || listing.eligibility_questions || listing.eligibility || [],
            payout: listing.payout || listing.payment || rewardObj || null,
            required_skills: skills
          }
        };
        const incomeRow = {
          source_slug: "superteam_agent_api",
          external_id: externalId,
          title,
          url,
          payment_asset: asset || null,
          amount_usd: numericUsd,
          skills,
          status: payoutGate === "CRYPTO_NO_KYC_CANDIDATE" ? "candidate" : "discovered",
          score: Number(listing.score || listing.rank || 0),
          evidence,
          discovered_at: scanStartedAt,
          updated_at: scanStartedAt
        };
        const { error: incomeError } = await db.from("midad_income_discoveries")
          .upsert(incomeRow, { onConflict: "source_slug,external_id" });
        if (incomeError) { counters.errors++; continue; }

        if (ownerProfile?.id) {
          const fingerprint = "superteam_agent:" + externalId;
          const { data: existingOpportunity } = await db.from("opportunities")
            .select("id,status,metadata").eq("fingerprint", fingerprint).maybeSingle();
          const preserved = existingOpportunity && ["submitted_waiting", "technical_blocked", "settled", "paid"].includes(String(existingOpportunity.status));
          const opportunityStatus = preserved ? existingOpportunity.status :
            (payoutGate === "CRYPTO_NO_KYC_CANDIDATE" ? "money_candidate" : "human_review");
          const score = Math.max(0, Math.min(100,
            Number(listing.score || 0) || (numericUsd ? Math.min(90, 35 + Math.log10(Math.max(1, numericUsd)) * 20) : 35)
          ));
          const offer = {
            reward_usd: numericUsd,
            raw_reward_amount: amount > 0 ? amount : null,
            payment_asset: asset || null,
            sponsor: sponsorName || null,
            external_id: externalId,
            deadline: listing.deadline || listing.deadlineAt || listing.deadline_at || null,
            action_url: url,
            agent_access: access
          };
          const payload = {
            user_id: ownerProfile.id,
            source: "superteam_agent_api",
            title,
            description,
            score,
            status: opportunityStatus,
            evidence,
            offer,
            opportunity_type: "paid_work",
            confidence: payoutGate === "CRYPTO_NO_KYC_CANDIDATE" ? 0.65 : 0.5,
            expected_value: numericUsd || 0,
            fingerprint,
            metadata: {
              origin: "midad_account_factory",
              platform: "superteam_fun",
              agent_id: account.platform_account_ref,
              agent_access: access,
              payout_gate: payoutGate,
              payout_gate_reason: payoutGateReason,
              requires_human_claim_before_payout: true,
              external_submission: false,
              no_kyc_verified: payoutGate === "CRYPTO_NO_KYC_CANDIDATE",
              last_verified_at: scanStartedAt
            },
            updated_at: scanStartedAt
          };
          if (existingOpportunity) {
            const { error: oppError } = await db.from("opportunities").update(payload).eq("id", existingOpportunity.id);
            if (oppError) counters.errors++;
          } else {
            const { error: oppError } = await db.from("opportunities").insert(payload);
            if (oppError) counters.errors++;
          }
        }

        counters.saved++;
        if (payoutGate === "CRYPTO_NO_KYC_CANDIDATE") counters.crypto_candidates++;
        else if (payoutGate === "BLOCKED_KYC") counters.kyc_blocked++;
        else counters.policy_review++;
        if (summary.length < 20) summary.push({
          external_id: externalId, title, url, sponsor: sponsorName || null,
          listing_type: type, agent_access: access, amount: amount > 0 ? amount : null,
          asset: asset || null, payout_gate: payoutGate, payout_gate_reason: payoutGateReason
        });
      }

      const completedAt = new Date().toISOString();
      await db.from("midad_account_factory_runs").update({
        state: "COMPLETED",
        output_payload: { ...counters, listings: summary, feed_types: feedTypes, api_key_vaulted: true, raw_api_key_returned: false },
        blockers: counters.policy_review ? [{ code: "LISTING_PAYOUT_POLICY_REVIEW", count: counters.policy_review, detail: "Listing payout/KYC/region eligibility needs official per-listing verification." }] : [],
        next_action: counters.crypto_candidates ? "verify_candidate_listing_details_before_submission" : "scan_other_verified_crypto_income_lanes",
        completed_at: completedAt,
        updated_at: completedAt
      }).eq("id", run.id);
      await writeEvent({
        account_id: account.id, run_id: run.id, platform_key: platformKey,
        actor_key: "midad_platform_scout", event_type: "agent_eligible_listings_discovered",
        from_state: "RUNNING", to_state: "COMPLETED",
        evidence: [...listingUrls.map(url => ({ url, official: true })), { url: "https://superteam.fun/earn/agents", official: true }],
        details: { ...counters, crypto_candidates: counters.crypto_candidates, submissions_sent: 0, wallet_signatures: 0 }
      });
      return json({
        ok: true, status: "COMPLETED", run_id: run.id,
        discovery: counters, listings: summary,
        submissions_sent: 0, wallet_signatures: 0, payouts_claimed: 0,
        next_action: counters.crypto_candidates ? "verify_candidate_listing_details_before_submission" : "scan_other_verified_crypto_income_lanes"
      });
    }

    if (action === "inspect_agent_listing") {
      const platformKey = clean(body.platform_key || "superteam_fun", 120);
      const externalId = clean(body.external_id, 180);
      const slug = clean(body.slug, 180);
      if (platformKey !== "superteam_fun" || !slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
        return json({ ok: false, error: "valid_superteam_listing_slug_required" }, 400);
      }
      const { data: account, error: accountError } = await db.from("midad_platform_accounts")
        .select("id,platform_key,platform_account_ref,credential_vault_ref,metadata")
        .eq("platform_key", platformKey).eq("owner_scope", "midad").eq("brand_key", "midad_ai").maybeSingle();
      if (accountError) throw new Error("platform_account_lookup_failed");
      if (!account?.credential_vault_ref || obj(account.metadata).external_actor_type !== "autonomous_agent") {
        return json({ ok: false, status: "BLOCKED", error: "registered_agent_vault_reference_required" }, 409);
      }

      const apiKey = await readPlatformSecret(String(account.credential_vault_ref));
      const detailUrl = "https://superteam.fun/api/agents/listings/details/" + encodeURIComponent(slug);
      const startedAt = new Date().toISOString();
      const run = await createRun({
        platformKey, accountId: account.id, taskType: "inspect_agent_listing", state: "RUNNING",
        inputPayload: { external_id: externalId || null, slug, api_key_vaulted: true },
        blockers: [], evidence: [{ url: "https://superteam.fun/earn/agents", official: true }],
        nextAction: "read_official_listing_details",
        runKey: "superteam_agent_listing_inspect:" + (externalId || slug) + ":" + startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)
      });

      let response: Response;
      try {
        response = await fetch(detailUrl, {
          method: "GET",
          headers: { "accept": "application/json", "authorization": "Bearer " + apiKey }
        });
      } catch (_) {
        await db.from("midad_account_factory_runs").update({
          state: "FAILED", blockers: [{ code: "AGENT_LISTING_DETAILS_UNREACHABLE", detail: "Official listing details endpoint could not be reached." }],
          next_action: "retry_listing_details_read", last_error: "provider_fetch_failed", updated_at: new Date().toISOString()
        }).eq("id", run.id);
        return json({ ok: false, status: "FAILED", run_id: run.id, error: "listing_details_unreachable" }, 502);
      }
      if (!response.ok) {
        await db.from("midad_account_factory_runs").update({
          state: "FAILED", blockers: [{ code: "AGENT_LISTING_DETAILS_HTTP_ERROR", detail: "Official listing details endpoint returned an HTTP error." }],
          output_payload: { provider_http_status: response.status },
          next_action: "retry_listing_details_read", last_error: "provider_http_" + response.status, updated_at: new Date().toISOString()
        }).eq("id", run.id);
        return json({ ok: false, status: "FAILED", run_id: run.id, provider_http_status: response.status, error: "listing_details_http_error" }, 502);
      }

      const envelope = await response.json().catch(() => null);
      const detail = obj(envelope?.listing || envelope?.data || envelope?.result || envelope);
      const title = clean(detail.title || detail.name || detail.headline || "Superteam listing", 250);
      const description = clean(detail.description || detail.summary || detail.mission || detail.scope || detail.content || "", 12000);
      const requirements = detail.submissionRequirements || detail.submission_requirements || detail.requirements || detail.instructions || [];
      const rewardObj = obj(detail.compensation || detail.reward || detail.budget);
      const tokenObj = obj(rewardObj.token);
      const sponsorObj = obj(detail.sponsor);
      const sponsorName = clean(sponsorObj.name || detail.sponsorName || detail.sponsor_name || detail.organizationName || detail.organization_name, 180);
      const payoutText = JSON.stringify({
        reward: detail.reward || null,
        compensation: detail.compensation || null,
        payout: detail.payout || null,
        payment: detail.payment || null,
        terms: detail.terms || null,
        requirements
      });
      const textToCheck = (title + " " + description + " " + JSON.stringify(requirements) + " " + payoutText).toLowerCase();
      const assetMentions = [...new Set((payoutText + " " + JSON.stringify(detail)).match(/\b(?:USDC|USDG|USDT|SOL|BTC|ETH|POL|BNB)\b/gi) || [])].map((s:string)=>s.toUpperCase());
      const explicitKyc = /\b(kyc (?:is )?required|requires kyc|post kyc|must complete kyc|identity verification required|government[- ]issued id required)\b/.test(textToCheck);
      const explicitNoKyc = /\b(no[- ]kyc|kyc not required|without kyc|no identity documents required)\b/.test(textToCheck);
      const firstPartyKycRisk = /superteam|solana foundation/.test(sponsorName.toLowerCase());
      const isGlobal = JSON.stringify({
        region: detail.region || null, regions: detail.regions || null, location: detail.location || null,
        eligibility: detail.eligibility || null
      }).toLowerCase().includes("global") || textToCheck.includes("worldwide");
      let payoutGate = "POLICY_REVIEW";
      let payoutGateReason = "Official listing details do not explicitly establish a no-KYC crypto payout path. Do not claim or submit until payout terms are confirmed.";
      if (firstPartyKycRisk || explicitKyc) {
        payoutGate = "BLOCKED_KYC";
        payoutGateReason = firstPartyKycRisk
          ? "Official Superteam guidance says Superteam/Solana-sponsored rewards require KYC."
          : "Listing terms explicitly require KYC or identity verification.";
      } else if (assetMentions.some((asset:string)=>/^(USDC|USDG|USDT|SOL|BTC|ETH|POL|BNB)$/.test(asset)) && explicitNoKyc && isGlobal) {
        payoutGate = "CRYPTO_NO_KYC_CANDIDATE";
        payoutGateReason = "Listing explicitly states no KYC, identifies a crypto payout asset, and advertises global eligibility. Reverify these terms before submission.";
      }

      const executionBlockers: Array<{code:string;detail:string}> = [];
      if (/not accept(?:ed)? fully ai.generated|not be fully ai.generated|no fully ai.generated|human contribution|must be original and published|must be published during/.test(textToCheck)) {
        executionBlockers.push({ code: "HUMAN_ORIGINAL_CONTRIBUTION_REQUIRED", detail: "The listing requires original human contribution or content published by the participant; MIDAD must not submit fully AI-generated work as human-created." });
      }
      if (/contenido debe estar en espa[nñ]ol|content must be in spanish|in spanish/.test(textToCheck)) {
        executionBlockers.push({ code: "LANGUAGE_MATCH_REVIEW", detail: "The listing requires Spanish-language deliverables; confirm a capable reviewer and genuine contribution before proceeding." });
      }
      const submissions = Number(detail.submissionsCount || detail.submissions_count || detail.submissionCount || detail.submission_count || detail.submissions || 0) || null;
      const publicUrl = clean(detail.url || detail.publicUrl || detail.public_url || detail.link, 1500) ||
        ("https://superteam.fun/earn/listing/" + encodeURIComponent(slug));

      const { data: discovery, error: discoveryError } = await db.from("midad_income_discoveries")
        .select("id,evidence,status,score,amount_usd,payment_asset,skills,title,url")
        .eq("source_slug", "superteam_agent_api")
        .eq("external_id", externalId || slug)
        .maybeSingle();
      const enrichedEvidence = {
        ...obj(discovery?.evidence),
        detail_checked_at: new Date().toISOString(),
        official_details_source: detailUrl,
        official_listing_url: publicUrl,
        sponsor: sponsorName || obj(discovery?.evidence).sponsor || null,
        submission_count: submissions,
        asset_mentions: assetMentions,
        payout_gate: payoutGate,
        payout_gate_reason: payoutGateReason,
        explicit_kyc_requirement_detected: explicitKyc,
        explicit_no_kyc_claim_detected: explicitNoKyc,
        global_eligibility_detected: isGlobal,
        execution_blockers: executionBlockers,
        human_claim_required_for_payout: true,
        official_detail_fields: {
          title,
          description,
          requirements,
          reward: detail.reward || null,
          compensation: detail.compensation || null,
          payout: detail.payout || null,
          payment: detail.payment || null,
          deadline: detail.deadline || detail.deadlineAt || detail.deadline_at || null
        }
      };
      if (discovery) {
        const { error } = await db.from("midad_income_discoveries").update({
          title, url: publicUrl, status: payoutGate === "CRYPTO_NO_KYC_CANDIDATE" && executionBlockers.length === 0 ? "candidate" : "discovered",
          payment_asset: assetMentions.length === 1 ? assetMentions[0] : (assetMentions.length ? "MULTIPLE:" + assetMentions.join(",") : discovery.payment_asset),
          evidence: enrichedEvidence, updated_at: new Date().toISOString()
        }).eq("id", discovery.id);
        if (error) throw new Error("income_discovery_update_failed");
      } else {
        await db.from("midad_income_discoveries").upsert({
          source_slug: "superteam_agent_api", external_id: externalId || slug, title, url: publicUrl,
          payment_asset: assetMentions.length === 1 ? assetMentions[0] : (assetMentions.length ? "MULTIPLE:" + assetMentions.join(",") : null),
          amount_usd: null, skills: [], status: payoutGate === "CRYPTO_NO_KYC_CANDIDATE" && executionBlockers.length === 0 ? "candidate" : "discovered",
          score: 0, evidence: enrichedEvidence, discovered_at: startedAt, updated_at: new Date().toISOString()
        }, { onConflict: "source_slug,external_id" });
      }

      const fingerprint = "superteam_agent:" + (externalId || slug);
      const { data: opportunity } = await db.from("opportunities").select("id,status,metadata").eq("fingerprint", fingerprint).maybeSingle();
      if (opportunity) {
        const preserved = ["submitted_waiting", "technical_blocked", "settled", "paid"].includes(String(opportunity.status));
        await db.from("opportunities").update({
          title,
          description,
          evidence: enrichedEvidence,
          status: preserved ? opportunity.status : (payoutGate === "CRYPTO_NO_KYC_CANDIDATE" && executionBlockers.length === 0 ? "money_candidate" : "human_review"),
          metadata: {
            ...obj(opportunity.metadata),
            payout_gate: payoutGate,
            payout_gate_reason: payoutGateReason,
            execution_blockers: executionBlockers,
            source_details_verified: true,
            last_verified_at: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        }).eq("id", opportunity.id);
      }

      const completedAt = new Date().toISOString();
      const blockerItems = [...executionBlockers];
      if (payoutGate !== "CRYPTO_NO_KYC_CANDIDATE") {
        blockerItems.push({ code: payoutGate === "BLOCKED_KYC" ? "PAYOUT_KYC_BLOCKED" : "PAYOUT_POLICY_UNVERIFIED", detail: payoutGateReason });
      }
      await db.from("midad_account_factory_runs").update({
        state: "COMPLETED",
        output_payload: {
          external_id: externalId || slug, slug, title, sponsor: sponsorName || null,
          public_url: publicUrl, submissions: submissions, asset_mentions: assetMentions,
          payout_gate: payoutGate, execution_blockers: executionBlockers, raw_api_key_returned: false
        },
        blockers: blockerItems,
        next_action: payoutGate === "CRYPTO_NO_KYC_CANDIDATE" && executionBlockers.length === 0
          ? "prepare_submission_for_owner_review" : "keep_in_review_do_not_submit",
        completed_at: completedAt, updated_at: completedAt
      }).eq("id", run.id);
      await writeEvent({
        account_id: account.id, run_id: run.id, platform_key: platformKey,
        actor_key: "midad_platform_policy_verifier", event_type: "agent_listing_policy_inspected",
        from_state: "RUNNING", to_state: "COMPLETED",
        evidence: [{ url: detailUrl, official: true }, { url: publicUrl, official: true }],
        details: {
          external_id: externalId || slug, payout_gate: payoutGate,
          execution_blocker_codes: executionBlockers.map(b=>b.code),
          submission_count: submissions, asset_mentions: assetMentions, external_submission: false
        }
      });
      return json({
        ok: true, status: "COMPLETED", run_id: run.id, external_id: externalId || slug,
        title, sponsor: sponsorName || null, public_url: publicUrl,
        submissions: submissions, asset_mentions: assetMentions,
        payout_gate: payoutGate, payout_gate_reason: payoutGateReason,
        execution_blockers: executionBlockers, submission_sent: false,
        next_action: payoutGate === "CRYPTO_NO_KYC_CANDIDATE" && executionBlockers.length === 0
          ? "prepare_submission_for_owner_review" : "keep_in_review_do_not_submit"
      });
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
