import test from "node:test";
import assert from "node:assert/strict";
import {
  createDesktopSession,
  transitionDesktopSession
} from "../compute/desktop-session/lifecycle.mjs";

const validInput = () => ({
  sessionId: "sess-001",
  ownerId: "owner-001",
  nodeId: "node-001",
  runtimeProfile: "linux-xfce-small",
  imageDigest: `sha256:${"a".repeat(64)}`,
  storageVolumeRef: "volume-001",
  idempotencyKey: "desktop-session:create:sess-001",
  cpuLimit: 2,
  memoryMiB: 2048,
  storageQuotaGiB: 20,
  costCeilingUsd: 0
});

const pass = {
  policyApproved: true,
  policyApprovalRef: "approval-001",
  hostAdmitted: true,
  nodeOwnerAuthorized: true,
  resourceAttestationFresh: true,
  budgetWithinCeiling: true,
  heartbeatFresh: true,
  storageMounted: true,
  gatewayAuthenticated: true,
  imageDigestVerified: true,
  ownerAuthorized: true,
  checkpointWritten: true,
  checkpointVerified: true,
  hostProcessStopped: true,
  volumePreserved: true,
  explicitDestroyApproved: true,
  retentionPolicySatisfied: true
};

test("creates a requested session with pinned image and explicit resource limits", () => {
  const session = createDesktopSession(validInput(), "2026-11-20T12:00:00.000Z");
  assert.equal(session.state, "REQUESTED");
  assert.equal(session.imageDigest, `sha256:${"a".repeat(64)}`);
  assert.equal(session.memoryMiB, 2048);
  assert.deepEqual(session.transitionHistory, []);
});

test("rejects unpinned images and missing resource limits", () => {
  assert.throws(
    () => createDesktopSession({...validInput(), imageDigest: "latest"}),
    /imageDigest/
  );
  assert.throws(
    () => createDesktopSession({...validInput(), memoryMiB: 0}),
    /memoryMiB/
  );
});

test("requires a policy approval before provisioning", () => {
  const session = createDesktopSession(validInput());
  assert.throws(
    () => transitionDesktopSession(session, "PROVISIONING", pass),
    /INVALID_TRANSITION/
  );
});

test("requires every host admission gate before provisioning", () => {
  let session = createDesktopSession(validInput());
  session = transitionDesktopSession(session, "POLICY_APPROVED", pass);
  assert.throws(
    () => transitionDesktopSession(session, "PROVISIONING", {...pass, hostAdmitted: false}),
    /HOST_ADMISSION_REQUIRED/
  );
  const readyToProvision = transitionDesktopSession(session, "PROVISIONING", pass);
  assert.equal(readyToProvision.state, "PROVISIONING");
});

test("requires fresh heartbeat, mounted storage, authenticated gateway and verified image before READY", () => {
  let session = createDesktopSession(validInput());
  session = transitionDesktopSession(session, "POLICY_APPROVED", pass);
  session = transitionDesktopSession(session, "PROVISIONING", pass);
  assert.throws(
    () => transitionDesktopSession(session, "READY", {...pass, gatewayAuthenticated: false}),
    /READY_GATES_REQUIRED/
  );
  session = transitionDesktopSession(session, "READY", pass);
  assert.equal(session.state, "READY");
});

test("requires owner authorization and secure access before ACTIVE", () => {
  let session = createDesktopSession(validInput());
  session = transitionDesktopSession(session, "POLICY_APPROVED", pass);
  session = transitionDesktopSession(session, "PROVISIONING", pass);
  session = transitionDesktopSession(session, "READY", pass);
  assert.throws(
    () => transitionDesktopSession(session, "ACTIVE", {...pass, ownerAuthorized: false}),
    /ACTIVE_GATES_REQUIRED/
  );
  session = transitionDesktopSession(session, "ACTIVE", pass);
  assert.equal(session.state, "ACTIVE");
});

test("requires a verified checkpoint before SUSPENDED", () => {
  let session = createDesktopSession(validInput());
  session = transitionDesktopSession(session, "POLICY_APPROVED", pass);
  session = transitionDesktopSession(session, "PROVISIONING", pass);
  session = transitionDesktopSession(session, "READY", pass);
  session = transitionDesktopSession(session, "ACTIVE", pass);
  assert.throws(
    () => transitionDesktopSession(session, "SUSPENDED", {...pass, checkpointVerified: false}),
    /CHECKPOINT_REQUIRED/
  );
  session = transitionDesktopSession(session, "SUSPENDED", pass);
  assert.equal(session.state, "SUSPENDED");
});

test("quarantine can only move to STOPPED and cannot resume", () => {
  let session = createDesktopSession(validInput());
  session = transitionDesktopSession(session, "QUARANTINED", {...pass, reason: "host integrity failure"});
  assert.throws(
    () => transitionDesktopSession(session, "READY", pass),
    /INVALID_TRANSITION/
  );
  session = transitionDesktopSession(session, "STOPPED", pass);
  assert.equal(session.state, "STOPPED");
});

test("requires explicit destruction approval and retention confirmation", () => {
  let session = createDesktopSession(validInput());
  session = transitionDesktopSession(session, "STOPPED", pass);
  assert.throws(
    () => transitionDesktopSession(session, "DESTROYED", {...pass, explicitDestroyApproved: false}),
    /DESTROY_APPROVAL_REQUIRED/
  );
  session = transitionDesktopSession(session, "DESTROYED", pass);
  assert.equal(session.state, "DESTROYED");
});

test("requires a cost approval reference when the cost ceiling is non-zero", () => {
  assert.throws(
    () => createDesktopSession({...validInput(), costCeilingUsd: 5}),
    /costApprovalRef/
  );
});

test("records caller-asserted gate evidence without claiming independent verification", () => {
  let session = createDesktopSession(validInput());
  session = transitionDesktopSession(session, "POLICY_APPROVED", pass);
  assert.equal(session.transitionHistory[0].gateStatus, "CALLER_ASSERTED_NOT_VERIFIED");
});
