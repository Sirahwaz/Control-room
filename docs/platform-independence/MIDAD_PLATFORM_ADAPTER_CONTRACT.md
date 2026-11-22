# MIDAD Platform Adapter Contract

**Status:** P1 design baseline — not wired to production.  
**Rule:** Preserve current Supabase implementation behind adapters; add an alternative implementation only after parity tests. No provider lock-in and no paid dependency.

## 1. Core principles

- Existing production behavior remains the reference implementation.
- Provider-specific SDKs and URLs must not leak into domain services or clients.
- Adapter methods must expose typed, stable contracts and structured errors.
- Every mutating operation carries a request ID / idempotency key where applicable.
- Timeouts and retries are bounded. Retry only operations known to be safe.
- Fail closed for authorization, payment verification, signing and other high-impact operations.
- Secrets are resolved at runtime from a least-privilege secret provider; never stored in source, logs or client bundles.
- Observability is provider-neutral: trace ID, request ID, latency, result state and safe error code.

## 2. Required interfaces

### DatabaseAdapter
- query / execute with parameter binding
- transaction (begin, commit, rollback)
- health and capability discovery
- schema version and migration status
- backup / restore hooks
- advisory locks or equivalent distributed coordination
- change stream only if a real consumer is identified

### AuthAdapter
- verify access token and issuer/audience
- resolve canonical user and service identity
- expose claims and permission context
- create / refresh / revoke sessions
- MFA and recovery capability discovery
- never return password hashes, refresh tokens or provider internals to domain code

### ServiceRuntimeAdapter
- register HTTP handlers and health/readiness endpoints
- enforce request size, timeout and concurrency limits
- expose deployment version and runtime metadata
- graceful shutdown and bounded background work
- separate public, user-authenticated and service-authenticated routes

### SchedulerAdapter
- create / update / pause / resume schedules
- record each execution with run ID, start/end, outcome and safe error
- prevent overlapping runs where required
- use a single authoritative scheduler per job during migration
- support manual dry-run without mutating production state

### QueueAdapter
- enqueue / claim / acknowledge / retry / dead-letter
- at-least-once delivery with idempotent consumers unless stronger semantics are proven
- visibility timeout / lease expiry
- replay by event ID with audit trail
- bounded retry count and poison-message quarantine

### ObjectStorageAdapter
- put / get / head / delete with metadata and checksum
- private-by-default access and short-lived signed URLs
- lifecycle / retention policy
- streaming for large objects
- disabled until code inventory proves a real Storage dependency

### SecretProvider
- resolve by logical key and environment
- support rotation/versioning and access audit
- no list-all or secret-dump capability in application runtime
- no secret values in database dumps, source-control artifacts or telemetry

## 3. Canonical result envelope

Every adapter returns a consistent result:
- state: VERIFIED | PENDING | FAILED | BLOCKED
- request_id
- provider_id
- operation
- data (typed, optional)
- error_code (safe, optional)
- retryable (boolean)
- observed_at (UTC timestamp)

## 4. Migration sequence

1. Wrap current Supabase calls without changing behavior.
2. Add contract tests against the current implementation.
3. Add a test-only alternative adapter.
4. Run read-only parity tests and compare normalized results.
5. Test backup/restore, auth claims, scheduler ownership and idempotency.
6. Enable a canary read path only after explicit readiness gates.
7. Consider writes only after consistency, rollback and payment-safety tests pass.

## 5. Explicit exclusions

This contract does not authorise:
- new paid resources or non-zero monthly spend
- production database writes for migration testing
- secret export or credential rotation
- auth provider replacement
- duplicate cron execution or dual-write
- production DNS or client endpoint changes
- payment, wallet, trading or withdrawal operations

## 6. Current implementation notes

The current web UI directly references Supabase Edge Function URLs in midad-control-v2.js and midad-browser.js. The first adapter seam is therefore the client-facing MIDAD Gateway. Keep the current Supabase endpoints as the initial provider implementation until an alternative passes the same contract tests.
