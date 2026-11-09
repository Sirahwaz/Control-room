import { assessProviderRuntime } from "./runtime-readiness.mjs";
import { verifyRuntimeEvidenceEnvelope } from "./runtime-evidence.mjs";

const providerScore = provider => {
  const status = provider.status === "known_available" ? 0.70 :
    provider.status === "optional" ? 0.48 :
    provider.status === "discover_on_need" ? 0.42 : 0.30;
  const fallback = Array.isArray(provider.fallbacks) && provider.fallbacks.length ? 0.12 : 0;
  const account = provider.account_action === "none_by_default" ? 0.10 :
    provider.account_action === "evaluate_per_task" ? 0.06 : 0.02;
  const integration = ["backend_control_plane", "source_ci", "research_web"].includes(provider.kind) ? 0.08 : 0.04;
  return Number(Math.min(1, status + fallback + account + integration).toFixed(3));
};

/**
 * Selects a provider for a capability. Any capability marked in
 * provider.runtime_capabilities requires a fresh, signed evidence envelope.
 * This is a planning decision only; dispatch must re-check readiness and acquire
 * a task lease immediately before external execution.
 */
export function selectProviderForCapability({
  capability,
  providers,
  evidenceEnvelope = null,
  signingKey = "",
  requirements = {},
  now = Date.now(),
  discoveryMode = false,
}) {
  const required = String(capability || "").trim();
  if (!required || !Array.isArray(providers)) {
    return {
      capability: required,
      primary: null,
      fallback: null,
      candidates: [],
      discovery_required: true,
      reason: "INVALID_SELECTION_INPUT",
      dispatch_allowed: false,
    };
  }

  const verified = evidenceEnvelope
    ? verifyRuntimeEvidenceEnvelope(evidenceEnvelope, signingKey, { now })
    : { ok: false, reason: signingKey ? "RUNTIME_EVIDENCE_MISSING" : "RUNTIME_EVIDENCE_SIGNING_KEY_MISSING", providers: {} };

  const registered = providers.filter(provider =>
    Array.isArray(provider.capabilities) && provider.capabilities.includes(required)
  );

  const candidates = registered.map(provider => {
    const runtimeGated = Array.isArray(provider.runtime_capabilities) &&
      provider.runtime_capabilities.includes(required);
    if (!runtimeGated) {
      return {
        id: provider.id, name: provider.name, status: provider.status,
        score: providerScore(provider), ready: true, reason: "REGISTERED_NATIVE_PROVIDER",
        runtime_gated: false,
      };
    }

    if (!verified.ok) {
      return {
        id: provider.id, name: provider.name, status: provider.status,
        score: 0, ready: false, reason: verified.reason, runtime_gated: true,
      };
    }

    const snapshot = verified.providers[provider.id];
    const assessed = assessProviderRuntime(
      provider, snapshot, { ...requirements, capability: required }, now
    );
    return {
      id: provider.id, name: provider.name, status: provider.status,
      score: assessed.ready ? providerScore(provider) : 0,
      ready: assessed.ready, reason: assessed.reason, runtime_gated: true,
      ...(assessed.age_seconds === undefined ? {} : { age_seconds: assessed.age_seconds }),
      ...(assessed.estimated_cost_usd === undefined ? {} : { estimated_cost_usd: assessed.estimated_cost_usd }),
    };
  }).sort((a, b) => Number(b.ready) - Number(a.ready) || b.score - a.score || a.id.localeCompare(b.id));

  const eligible = candidates.filter(candidate => candidate.ready);
  const primary = eligible[0] || null;
  const fallback = eligible.find(candidate => candidate.id !== primary?.id) || null;
  const broad = discoveryMode === "broad" || discoveryMode === "competitive";

  return {
    capability: required,
    primary: primary?.id || null,
    fallback: fallback?.id || null,
    candidates,
    discovery_required: broad || !primary || primary.status !== "known_available",
    reason: !registered.length ? "NO_REGISTERED_CANDIDATE" :
      !primary ? "NO_PROVIDER_PASSED_RUNTIME_READINESS" :
      broad ? "REQUESTED_BROAD_DISCOVERY" : "PROVIDER_PASSED_SELECTION_POLICY",
    readiness_verified: Boolean(primary && primary.runtime_gated),
    dispatch_allowed: false,
    plan_only: true,
  };
}
