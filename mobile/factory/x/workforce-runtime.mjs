const SENSITIVE_KEY = /(?:secret|token|api[-_]?key|password|credential|authorization|private[-_]?key|mnemonic|seed|bearer)/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]{12,}\b/,
  /\bsk-or-[A-Za-z0-9_-]{12,}\b/,
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];

const ROLE_POLICY = Object.freeze({
  "wallet-behavior-agent": {
    action: "analyze_public_wallet_behavior",
    state: "READY_READ_ONLY_ANALYSIS_PLAN",
    risk: "PUBLIC_CHAIN_READ_ONLY",
    approvals: [],
    executionAllowed: false,
    walletSigningAllowed: false,
    liveOrdersAllowed: false
  },
  "offer-negotiation-agent": {
    action: "prepare_nonbinding_offer",
    state: "READY_NON_BINDING_DRAFT_PLAN",
    risk: "NON_BINDING_COMMERCIAL_DRAFT",
    approvals: ["human_review_before_customer_send_or_binding_terms"],
    executionAllowed: false,
    bindingAuthority: false,
    customerSendAllowed: false,
    humanApprovalRequired: true
  },
  "media-production-agent": {
    action: "prepare_or_produce_media",
    state: "BLOCKED_APPROVAL_GATES",
    risk: "COST_AND_RIGHTS_GATED_MEDIA",
    approvals: ["verified_cost_quote", "rights_confirmed", "spend_approved"]
  }
});

function hasSecretLikeData(value, depth = 0, seen = new WeakSet()) {
  if (depth > 8) return true;
  if (typeof value === "string") return SECRET_VALUE_PATTERNS.some(pattern => pattern.test(value));
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some(item => hasSecretLikeData(item, depth + 1, seen));
  return Object.entries(value).some(([key, child]) =>
    SENSITIVE_KEY.test(key) || hasSecretLikeData(child, depth + 1, seen)
  );
}

function nonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function boundedInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(32, Math.floor(number));
}

function buildWaves(tasks, maxParallel) {
  const waves = [];
  let parallel = [];
  const flush = () => {
    if (parallel.length) waves.push(parallel);
    parallel = [];
  };
  for (const task of tasks) {
    if (!task.parallelSafe) {
      flush();
      waves.push([task.agentId]);
      continue;
    }
    parallel.push(task.agentId);
    if (parallel.length >= maxParallel) flush();
  }
  flush();
  return waves;
}

export function compileWorkforcePlan({
  agentIds,
  agents,
  bindings,
  adapters,
  payloads = {},
  approvals = {},
  maxParallelAgents = 1
} = {}) {
  const blockers = [];
  const tasks = [];
  if (!Array.isArray(agentIds) || agentIds.length === 0) {
    return {
      ok: false,
      state: "BLOCKED",
      blockers: [{ agent: null, reason: "explicit_agent_ids_required" }],
      tasks: [],
      waves: [],
      dispatchAllowed: false,
      executionMode: "PLAN_ONLY_NO_DISPATCH"
    };
  }
  if (!Array.isArray(agents) || !Array.isArray(bindings) || !Array.isArray(adapters)) {
    return {
      ok: false,
      state: "BLOCKED",
      blockers: [{ agent: null, reason: "registry_contract_missing" }],
      tasks: [],
      waves: [],
      dispatchAllowed: false,
      executionMode: "PLAN_ONLY_NO_DISPATCH"
    };
  }

  const agentMap = new Map(agents.map(agent => [agent.id, agent]));
  const bindingMap = new Map(bindings.map(binding => [binding.agent, binding]));
  const adapterMap = new Map(adapters.map(adapter => [adapter.id, adapter]));
  const maxParallel = boundedInteger(maxParallelAgents, 1);
  const seen = new Set();

  for (const requestedId of agentIds) {
    const agentId = String(requestedId ?? "");
    if (!agentId || seen.has(agentId)) {
      blockers.push({ agent: agentId || null, reason: "duplicate_or_empty_agent_id" });
      continue;
    }
    seen.add(agentId);

    const agent = agentMap.get(agentId);
    const binding = bindingMap.get(agentId);
    if (!agent) {
      blockers.push({ agent: agentId, reason: "unknown_agent" });
      continue;
    }
    if (!binding) {
      blockers.push({ agent: agentId, reason: "missing_binding" });
      continue;
    }
    const adapter = adapterMap.get(binding.adapter);
    if (!adapter) {
      blockers.push({ agent: agentId, reason: "missing_adapter" });
      continue;
    }
    const policy = ROLE_POLICY[agentId];
    if (!policy || binding.action !== policy.action) {
      blockers.push({ agent: agentId, reason: "role_runtime_contract_not_approved" });
      continue;
    }

    const payload = payloads && typeof payloads === "object" ? payloads[agentId] : null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      tasks.push({
        agentId,
        action: policy.action,
        state: "BLOCKED_MISSING_INPUTS",
        missingInputs: Array.isArray(agent.inputs) ? [...agent.inputs] : [],
        providedInputNames: [],
        requiredApprovals: [...policy.approvals],
        adapter: binding.adapter,
        adapterInvoked: false,
        providerInvoked: false,
        dispatchAllowed: false,
        executionAllowed: false
      });
      blockers.push({ agent: agentId, reason: "missing_required_inputs" });
      continue;
    }

    if (hasSecretLikeData(payload)) {
      tasks.push({
        agentId,
        action: policy.action,
        state: "BLOCKED_SENSITIVE_INPUT",
        missingInputs: [],
        providedInputNames: Object.keys(payload).filter(key => !SENSITIVE_KEY.test(key)).sort(),
        requiredApprovals: [...policy.approvals],
        adapter: binding.adapter,
        adapterInvoked: false,
        providerInvoked: false,
        dispatchAllowed: false,
        executionAllowed: false
      });
      blockers.push({ agent: agentId, reason: "sensitive_input_blocked" });
      continue;
    }

    const inputNames = Array.isArray(agent.inputs) ? agent.inputs : [];
    const missingInputs = inputNames.filter(name => !nonEmpty(payload[name]));
    if (missingInputs.length) {
      tasks.push({
        agentId,
        action: policy.action,
        state: "BLOCKED_MISSING_INPUTS",
        missingInputs,
        providedInputNames: Object.keys(payload).sort(),
        requiredApprovals: [...policy.approvals],
        adapter: binding.adapter,
        adapterInvoked: false,
        providerInvoked: false,
        dispatchAllowed: false,
        executionAllowed: false
      });
      blockers.push({ agent: agentId, reason: "missing_required_inputs", missingInputs });
      continue;
    }

    let state = policy.state;
    let requiredApprovals = [...policy.approvals];
    if (agentId === "media-production-agent") {
      const approval = approvals?.[agentId] || {};
      const mediaPlan = approval.mediaPlan;
      const validStatus = mediaPlan?.status === "PENDING_SPEND_APPROVAL" || mediaPlan?.status === "READY_PENDING_EXECUTION";
      const validImageOrVideoQuote = ["image", "video"].includes(mediaPlan?.mediaType)
        && mediaPlan?.provider === "openart"
        && mediaPlan?.selected?.provider === "openart"
        && mediaPlan?.selected?.affordable === true
        && typeof mediaPlan?.selected?.creditsRequired === "number"
        && Number.isFinite(mediaPlan.selected.creditsRequired)
        && mediaPlan.selected.creditsRequired >= 0
        && typeof mediaPlan?.spendLimit === "number"
        && Number.isFinite(mediaPlan.spendLimit)
        && mediaPlan.spendLimit >= 0
        && mediaPlan.selected.creditsRequired <= mediaPlan.spendLimit
        && mediaPlan?.rightsConfirmed === true;
      const audioQuote = mediaPlan?.mediaType === "audio" ? mediaPlan?.verifiedQuote : null;
      const validAudioQuote = mediaPlan?.mediaType === "audio"
        && mediaPlan?.provider === "heygen"
        && audioQuote?.verified === true
        && typeof audioQuote?.unit === "string"
        && audioQuote.unit.trim().length > 0
        && typeof audioQuote?.amount === "number"
        && Number.isFinite(audioQuote.amount)
        && audioQuote.amount >= 0
        && typeof audioQuote?.availableUnits === "number"
        && Number.isFinite(audioQuote.availableUnits)
        && audioQuote.availableUnits >= audioQuote.amount
        && approval.rights_confirmed === true;
      const verifiedCostQuote = mediaPlan?.executionAllowed === false
        && validStatus
        && (validImageOrVideoQuote || validAudioQuote);
      const rightsConfirmed = validImageOrVideoQuote || (validAudioQuote && approval.rights_confirmed === true);
      requiredApprovals = [];
      if (!verifiedCostQuote) requiredApprovals.push("verified_cost_quote");
      if (!rightsConfirmed) requiredApprovals.push("rights_confirmed");
      if (approval.spend_approved !== true) requiredApprovals.push("spend_approved");
      state = !verifiedCostQuote || !rightsConfirmed
        ? "BLOCKED_APPROVAL_GATES"
        : approval.spend_approved === true
          ? "READY_FOR_HUMAN_REVIEW"
          : "PENDING_SPEND_APPROVAL";
    }

    tasks.push({
      agentId,
      domain: agent.domain,
      action: policy.action,
      state,
      risk: policy.risk,
      missingInputs: [],
      providedInputNames: inputNames.slice().sort(),
      requiredApprovals,
      adapter: binding.adapter,
      provider: agentId === "media-production-agent"
        ? {
            primary: approvals?.[agentId]?.mediaPlan?.provider
              ?? approvals?.[agentId]?.mediaPlan?.selected?.provider
              ?? null,
            fallback: null
          }
        : {
            primary: binding.primary,
            fallback: binding.fallback ?? null
          },
      adapterInvoked: false,
      providerInvoked: false,
      dispatchAllowed: false,
      executionAllowed: false,
      parallelSafe: agent.parallel_safe === true,
      ...(policy.walletSigningAllowed === false ? { walletSigningAllowed: false } : {}),
      ...(policy.liveOrdersAllowed === false ? { liveOrdersAllowed: false } : {}),
      ...(policy.bindingAuthority === false ? { bindingAuthority: false } : {}),
      ...(policy.customerSendAllowed === false ? { customerSendAllowed: false } : {}),
      ...(policy.humanApprovalRequired === true ? { humanApprovalRequired: true } : {})
    });
  }

  const waves = buildWaves(tasks, maxParallel);
  return {
    ok: blockers.length === 0,
    state: blockers.length ? "BLOCKED" : "PLAN_COMPILED",
    executionMode: "PLAN_ONLY_NO_DISPATCH",
    dispatchAllowed: false,
    counts: {
      requested: agentIds.length,
      accepted: tasks.length,
      blockers: blockers.length,
      waves: waves.length
    },
    parallelism: {
      configuredMaxAgents: maxParallel,
      maxConcurrentPlans: Math.min(maxParallel, tasks.filter(task => task.parallelSafe).length || 1)
    },
    blockers,
    tasks,
    waves
  };
}
