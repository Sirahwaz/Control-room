/**
 * Evidence-gated runtime readiness and substrate selection for Factory X.
 *
 * This module is deliberately plan-only. It does not launch Codespaces, call a
 * VPS, create a browser session, dispatch a job, or authorize an external action.
 * The caller must obtain and verify runtime evidence through a trusted adapter;
 * public task/request payloads must never be treated as readiness evidence.
 */

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value);

function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Date.parse(value);
}

function decision(ready, reason, evidence = {}) {
  return { ready, reason, ...evidence };
}

function evaluateCost(evidence, requirements) {
  if (!finite(evidence.estimated_cost_usd) || evidence.estimated_cost_usd < 0) {
    return decision(false, "COST_UNVERIFIED");
  }
  if (finite(requirements.max_cost_usd) &&
      evidence.estimated_cost_usd > requirements.max_cost_usd) {
    return decision(false, "COST_CEILING_EXCEEDED", {
      estimated_cost_usd: evidence.estimated_cost_usd,
      max_cost_usd: requirements.max_cost_usd,
    });
  }
  return null;
}

/**
 * Assess one provider from a trusted, already-authenticated runtime snapshot.
 * Signature verification and source authentication happen in the adapter
 * boundary, not in this pure function.
 */
export function assessProviderRuntime(provider, evidence, requirements = {}, now = Date.now()) {
  if (!isObject(provider) || !Array.isArray(provider.capabilities)) {
    return decision(false, "PROVIDER_CONTRACT_INVALID");
  }
  const providerStatus = String(provider.status || "").toUpperCase();
  if (["BLOCKED", "FAILED", "DISABLED", "PENDING"].includes(providerStatus)) {
    return decision(false, "PROVIDER_STATUS_BLOCKED");
  }
  if (!isObject(evidence)) return decision(false, "RUNTIME_EVIDENCE_MISSING");
  if (evidence.source !== "trusted_runtime_adapter" || evidence.signature_verified !== true) {
    return decision(false, "RUNTIME_EVIDENCE_UNVERIFIED");
  }
  if (evidence.state !== "READY") return decision(false, "RUNTIME_NOT_READY");

  const nowMs = toMillis(now);
  const observedMs = toMillis(evidence.observed_at);
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs)) {
    return decision(false, "RUNTIME_TIMESTAMP_INVALID");
  }
  const ageSeconds = (nowMs - observedMs) / 1000;
  if (ageSeconds < 0) return decision(false, "RUNTIME_TIMESTAMP_IN_FUTURE");

  const runtimeClass = String(provider.runtime_class || "");
  const defaultMaxAge = runtimeClass === "ephemeral" || runtimeClass === "stateless_ci" ? 300 : 45;
  const configuredMaxAge = Number(provider.health_requirements?.heartbeat_max_age_seconds);
  const maxAge = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? configuredMaxAge
    : defaultMaxAge;
  if (ageSeconds > maxAge) {
    return decision(false, runtimeClass === "ephemeral" ? "RUNTIME_EVIDENCE_STALE" : "HEARTBEAT_STALE", {
      age_seconds: ageSeconds,
      max_age_seconds: maxAge,
    });
  }

  if (evidence.capability_handshake !== true) {
    return decision(false, "CAPABILITY_HANDSHAKE_REQUIRED");
  }
  const requiredCapability = String(requirements.capability || "").trim();
  if (requiredCapability &&
      (!Array.isArray(evidence.capabilities) || !evidence.capabilities.includes(requiredCapability))) {
    return decision(false, "CAPABILITY_NOT_CONFIRMED");
  }
  if (evidence.authenticated !== true) return decision(false, "RUNTIME_AUTH_REQUIRED");

  const costDecision = evaluateCost(evidence, requirements);
  if (costDecision) return costDecision;

  if (runtimeClass === "ephemeral") {
    if (evidence.lifecycle_control !== true) {
      return decision(false, "CODESPACES_LIFECYCLE_UNVERIFIED");
    }
    if (!finite(evidence.quota_remaining_minutes) || evidence.quota_remaining_minutes < 0) {
      return decision(false, "CODESPACES_QUOTA_UNVERIFIED");
    }
    const duration = finite(requirements.duration_minutes)
      ? Math.max(0, requirements.duration_minutes)
      : 0;
    if (evidence.quota_remaining_minutes < duration) {
      return decision(false, "CODESPACES_QUOTA_INSUFFICIENT", {
        quota_remaining_minutes: evidence.quota_remaining_minutes,
        required_minutes: duration,
      });
    }
  } else if (runtimeClass === "persistent_control") {
    if (evidence.queue_authenticated !== true) {
      return decision(false, "QUEUE_AUTH_REQUIRED");
    }
    if (!isObject(evidence.resource_probe) || evidence.resource_probe.verified !== true) {
      return decision(false, "RESOURCE_PROBE_UNVERIFIED");
    }
    const memory = evidence.resource_probe.available_memory_mb;
    const disk = evidence.resource_probe.available_disk_mb;
    if (!finite(memory) || !finite(disk)) return decision(false, "RESOURCE_PROBE_INCOMPLETE");
    if (memory < (finite(requirements.min_memory_mb) ? requirements.min_memory_mb : 0)) {
      return decision(false, "INSUFFICIENT_MEMORY", { available_memory_mb: memory });
    }
    if (disk < (finite(requirements.min_disk_mb) ? requirements.min_disk_mb : 0)) {
      return decision(false, "INSUFFICIENT_DISK", { available_disk_mb: disk });
    }
  } else if (runtimeClass === "persistent_browser") {
    if (evidence.queue_authenticated !== true) return decision(false, "QUEUE_AUTH_REQUIRED");
    if (evidence.browser_installed !== true) return decision(false, "BROWSER_RUNTIME_MISSING");
    if (evidence.encrypted_session_store !== true) return decision(false, "ENCRYPTED_SESSION_STORE_REQUIRED");
    if (!finite(evidence.available_slots) || evidence.available_slots < 1) {
      return decision(false, "BROWSER_CAPACITY_UNAVAILABLE");
    }
  } else if (runtimeClass === "stateless_ci") {
    if (evidence.workflow_dispatch !== true) return decision(false, "WORKFLOW_DISPATCH_UNVERIFIED");
    if (evidence.included_quota_verified !== true) return decision(false, "CI_QUOTA_UNVERIFIED");
  } else {
    return decision(false, "RUNTIME_CLASS_UNSUPPORTED");
  }

  return decision(true, "RUNTIME_READY", {
    runtime_class: runtimeClass,
    age_seconds: ageSeconds,
    estimated_cost_usd: evidence.estimated_cost_usd,
    dispatch_allowed: false,
  });
}

/**
 * Produce a deterministic plan from provider records and trusted health snapshots.
 * Selection is only a plan: a separate authenticated dispatcher must re-check
 * readiness and acquire an atomic task lease immediately before execution.
 */
export function selectExecutionSubstrate(task, providers, healthEvidence = {}, now = Date.now()) {
  const capability = String(task?.capability || "").trim();
  if (!capability) {
    return { ok: false, status: "BLOCKED", reason: "CAPABILITY_REQUIRED",
      selected_provider: null, candidates: [], dispatch_allowed: false };
  }
  if (!Array.isArray(providers)) {
    return { ok: false, status: "BLOCKED", reason: "PROVIDER_REGISTRY_INVALID",
      selected_provider: null, candidates: [], dispatch_allowed: false };
  }

  const matches = providers.filter(provider =>
    Array.isArray(provider.capabilities) && provider.capabilities.includes(capability)
  );
  const candidates = matches.map(provider => {
    const snapshot = healthEvidence instanceof Map
      ? healthEvidence.get(provider.id)
      : healthEvidence?.[provider.id];
    const assessed = assessProviderRuntime(provider, snapshot, task, now);
    return {
      provider_id: provider.id,
      runtime_class: provider.runtime_class || null,
      ...assessed,
    };
  });

  const ready = candidates.filter(candidate => candidate.ready).sort((a, b) =>
    a.estimated_cost_usd - b.estimated_cost_usd ||
    String(a.provider_id).localeCompare(String(b.provider_id))
  );
  const selected = ready[0] || null;

  return {
    ok: Boolean(selected),
    status: selected ? "READY_TO_DISPATCH" : "BLOCKED",
    reason: selected ? "LOWEST_COST_QUALIFIED_PROVIDER" :
      (matches.length ? "NO_PROVIDER_PASSED_LIVE_READINESS" : "NO_CAPABLE_PROVIDER"),
    selected_provider: selected?.provider_id || null,
    candidates,
    fallback_providers: ready.slice(1).map(candidate => candidate.provider_id),
    dispatch_allowed: false,
    plan_only: true,
  };
}
