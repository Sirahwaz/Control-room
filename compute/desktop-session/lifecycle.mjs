/**
 * MIDAD Desktop Session Lifecycle Contract
 *
 * Pure state-transition policy only. This module does not provision hosts,
 * start desktop processes, mount volumes, create tunnels or delete data.
 * Gate evidence is asserted by the caller and must be verified by the
 * runtime adapter before this contract is used for a real session.
 */

const STATES = new Set([
  "REQUESTED", "POLICY_APPROVED", "PROVISIONING", "READY", "ACTIVE",
  "SUSPENDED", "DEGRADED", "QUARANTINED", "STOPPED", "DESTROYED"
]);

const TRANSITIONS = {
  REQUESTED: ["POLICY_APPROVED", "STOPPED", "QUARANTINED"],
  POLICY_APPROVED: ["PROVISIONING", "STOPPED", "QUARANTINED"],
  PROVISIONING: ["READY", "DEGRADED", "QUARANTINED", "STOPPED"],
  READY: ["ACTIVE", "SUSPENDED", "DEGRADED", "QUARANTINED", "STOPPED"],
  ACTIVE: ["SUSPENDED", "DEGRADED", "QUARANTINED", "STOPPED"],
  SUSPENDED: ["READY", "DEGRADED", "QUARANTINED", "STOPPED"],
  DEGRADED: ["READY", "QUARANTINED", "STOPPED"],
  QUARANTINED: ["STOPPED"],
  STOPPED: ["DESTROYED"],
  DESTROYED: []
};

function fail(code, detail = "") {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) fail("INVALID_SESSION_INPUT", field);
  return value.trim();
}

function finitePositive(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail("INVALID_SESSION_INPUT", field);
  }
  return value;
}

function finiteNonNegative(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("INVALID_SESSION_INPUT", field);
  }
  return value;
}

function requireTrue(context, field, code) {
  if (context?.[field] !== true) fail(code, field);
}

function requireReason(context) {
  if (typeof context?.reason !== "string" || !context.reason.trim()) {
    fail("TRANSITION_REASON_REQUIRED", "reason");
  }
}

export function createDesktopSession(input = {}, now = new Date()) {
  const sessionId = requiredText(input.sessionId, "sessionId");
  const ownerId = requiredText(input.ownerId, "ownerId");
  const nodeId = requiredText(input.nodeId, "nodeId");
  const runtimeProfile = requiredText(input.runtimeProfile, "runtimeProfile");
  const imageDigest = requiredText(input.imageDigest, "imageDigest");
  const storageVolumeRef = requiredText(input.storageVolumeRef, "storageVolumeRef");
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");

  if (!/^sha256:[a-f0-9]{64}$/i.test(imageDigest)) {
    fail("INVALID_SESSION_INPUT", "imageDigest must be a pinned sha256 digest");
  }

  const cpuLimit = finitePositive(input.cpuLimit, "cpuLimit");
  const memoryMiB = finitePositive(input.memoryMiB, "memoryMiB");
  const storageQuotaGiB = finitePositive(input.storageQuotaGiB, "storageQuotaGiB");
  const costCeilingUsd = finiteNonNegative(input.costCeilingUsd ?? 0, "costCeilingUsd");
  const costApprovalRef = input.costApprovalRef == null
    ? null
    : requiredText(input.costApprovalRef, "costApprovalRef");

  if (costCeilingUsd > 0 && !costApprovalRef) {
    fail("COST_APPROVAL_REQUIRED", "costApprovalRef");
  }

  const createdAt = new Date(now).toISOString();

  return {
    schemaVersion: "midad.desktop-session.v1",
    sessionId,
    ownerId,
    nodeId,
    runtimeProfile,
    imageDigest,
    storageVolumeRef,
    idempotencyKey,
    cpuLimit,
    memoryMiB,
    storageQuotaGiB,
    costCeilingUsd,
    costApprovalRef,
    state: "REQUESTED",
    createdAt,
    updatedAt: createdAt,
    transitionHistory: []
  };
}

export function transitionDesktopSession(session, nextState, context = {}, now = new Date()) {
  if (!session || session.schemaVersion !== "midad.desktop-session.v1" || !STATES.has(session.state)) {
    fail("INVALID_SESSION_RECORD");
  }
  if (!STATES.has(nextState)) fail("INVALID_TARGET_STATE", String(nextState));

  const allowed = TRANSITIONS[session.state] || [];
  if (!allowed.includes(nextState)) {
    fail("INVALID_TRANSITION", `${session.state} -> ${nextState}`);
  }

  switch (nextState) {
    case "POLICY_APPROVED":
      requireTrue(context, "policyApproved", "POLICY_APPROVAL_REQUIRED");
      requiredText(context.policyApprovalRef, "policyApprovalRef");
      break;
    case "PROVISIONING":
      requireTrue(context, "hostAdmitted", "HOST_ADMISSION_REQUIRED");
      requireTrue(context, "nodeOwnerAuthorized", "HOST_ADMISSION_REQUIRED");
      requireTrue(context, "resourceAttestationFresh", "HOST_ADMISSION_REQUIRED");
      requireTrue(context, "budgetWithinCeiling", "HOST_ADMISSION_REQUIRED");
      break;
    case "READY":
      requireTrue(context, "heartbeatFresh", "READY_GATES_REQUIRED");
      requireTrue(context, "storageMounted", "READY_GATES_REQUIRED");
      requireTrue(context, "gatewayAuthenticated", "READY_GATES_REQUIRED");
      requireTrue(context, "imageDigestVerified", "READY_GATES_REQUIRED");
      break;
    case "ACTIVE":
      requireTrue(context, "ownerAuthorized", "ACTIVE_GATES_REQUIRED");
      requireTrue(context, "gatewayAuthenticated", "ACTIVE_GATES_REQUIRED");
      requireTrue(context, "storageMounted", "ACTIVE_GATES_REQUIRED");
      break;
    case "SUSPENDED":
      requireTrue(context, "checkpointWritten", "CHECKPOINT_REQUIRED");
      requireTrue(context, "checkpointVerified", "CHECKPOINT_REQUIRED");
      break;
    case "DEGRADED":
    case "QUARANTINED":
      requireReason(context);
      break;
    case "STOPPED":
      requireTrue(context, "hostProcessStopped", "SAFE_STOP_REQUIRED");
      requireTrue(context, "volumePreserved", "SAFE_STOP_REQUIRED");
      break;
    case "DESTROYED":
      requireTrue(context, "explicitDestroyApproved", "DESTROY_APPROVAL_REQUIRED");
      requireTrue(context, "retentionPolicySatisfied", "DESTROY_APPROVAL_REQUIRED");
      break;
  }

  const at = new Date(now).toISOString();
  const event = {
    from: session.state,
    to: nextState,
    at,
    gateStatus: "CALLER_ASSERTED_NOT_VERIFIED",
    evidenceRefs: Array.isArray(context.evidenceRefs)
      ? context.evidenceRefs.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
      : []
  };

  return {
    ...session,
    state: nextState,
    updatedAt: at,
    transitionHistory: [...session.transitionHistory, event]
  };
}
