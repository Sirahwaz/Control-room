# MIDAD Desktop Session Lifecycle Contract

**Status:** Implemented as an offline state-machine contract; no host runtime is deployed.

## Purpose

Represent a persistent Cloud PC desktop session independently from bounded MNCF tasks and browser sessions. The contract prevents an interactive desktop session from being treated as a disposable one-shot task.

## Implemented

- `compute/desktop-session/lifecycle.mjs` — pure creation and state-transition functions.
- `tests/desktop-session-lifecycle.test.mjs` — regression tests for lifecycle, admission gates, checkpoints, quarantine, cost approval and explicit destruction.
- Dedicated GitHub Actions contract workflow.

## Lifecycle

`REQUESTED → POLICY_APPROVED → PROVISIONING → READY → ACTIVE`

Additional controlled paths:

- `ACTIVE → SUSPENDED → READY` after a written and verified checkpoint.
- `PROVISIONING / READY / ACTIVE / SUSPENDED → DEGRADED` with a reason.
- Any eligible state may enter `QUARANTINED` with a reason; quarantine can only move to `STOPPED`.
- `STOPPED → DESTROYED` requires explicit destruction approval and retention-policy confirmation.
- `DESTROYED` is terminal.

## Admission gates

- Pinned `sha256` image digest and explicit CPU/RAM/storage ceilings.
- Explicit owner identity, node identity, persistent volume reference and idempotency key.
- Policy approval before provisioning.
- Host admission, node ownership authorization, fresh resource attestation and budget check before provisioning.
- Fresh heartbeat, mounted persistent storage, authenticated gateway and image-digest verification before READY.
- Owner authorization and authenticated gateway before ACTIVE.
- Verified checkpoint before SUSPENDED.
- Process-stopped and volume-preserved evidence before STOPPED.
- Explicit human approval and retention-policy confirmation before DESTROYED.
- Non-zero cost ceiling requires a cost approval reference.

The contract records `CALLER_ASSERTED_NOT_VERIFIED` for transition gates. It does not independently authenticate caller assertions; a future runtime adapter must verify them against signed node attestations, policy decisions and evidence records.

## Safety / non-capabilities

This module does not provision a VM, install a desktop, mount a disk, open a tunnel, start or stop a process, delete a volume, call a provider, or change a production system. It is an offline contract only. A live Cloud PC remains blocked until an owner-controlled host is connected and passes the separate host-admission and pilot gates in `MIDAD_CLOUD_PC_RUNTIME_BLUEPRINT.md`.
