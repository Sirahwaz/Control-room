# MIDAD Distributed Runtime Fabric — Task Envelope P1

This folder contains the first pure contract mapper between source-owned MIDAD missions and the existing Continuity Ledger task shape.

## Contract

`buildContinuityTask(envelope, trustedContext)` validates a strict version-1 envelope and returns a task accepted by the current Ledger contract. It does not authenticate, enqueue, schedule, execute, or reconcile a task.

- `ownerId` is supplied only through trusted adapter context. `owner_id` in the envelope is rejected.
- Task IDs and idempotency keys are namespaced by both source system and source mission.
- Workloads are limited to the Ledger's current values: `CPU_BATCH`, `WEBGPU_BATCH`, `BROWSER_SESSION`, `SINGLE`.
- Payloads are limited to 48 KiB, recursively checked for credential-like keys/values, and cannot supply the reserved `_midad_fabric` metadata field.
- Only `public` and `internal` payload classes are accepted. Confidential/restricted data must move through a separately designed secure-reference adapter, not this payload path.
- Browser sessions always use `HUMAN_RECONCILIATION`; no browser side effect is automatically replayed.
- Idempotent retries require trusted adapter context to assert both `retrySafety: "verified_idempotent"` and `idempotencyVerified: true`.
- Positive cost ceilings require trusted context containing a verified approval reference. The mapper does not itself verify an approval.
- Attempts are capped at three; resource, unit, capability and evidence fields are bounded.

Source metadata is carried under `payload._midad_fabric` because the current Continuity Ledger schema has no dedicated source-reference columns. Runtime adapters must treat this key as control metadata and must not pass it to a domain executor as user input.

## Current boundary

The mapper intentionally supports only sources already observed in MIDAD's active service inventory. It is not yet wired to any production Edge Function, database, Cloudflare Durable Object, Queue, Android app, or browser extension. No production migration or deployment is included.

## Test

`node --test mobile/factory/x/runtime-fabric/task-envelope.test.mjs`
