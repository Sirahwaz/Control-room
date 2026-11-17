# MIDAD Account + Browser Control Plane — Current Contract

This file documents existing live services and avoids creating a parallel account manager or browser queue.

## Existing owners

- Account Factory (midad_account_factory, live Edge Function v17): platform-policy assessment, profile preparation, selected documented agent registration, account/run/event registry, and requests an existing Browser Gateway job.
- Browser Operator (midad_browser_agent_gateway, live Edge Function v16): owner-scoped browser command/session relay and evidence.
- Playwright Worker (tools/midad-browser-runtime/operator_worker.py): consumes the private owner queue and keeps the authenticated Playwright context in RAM while its process remains alive.
- Human Bridge (midad_human_bridge, live Edge Function v10): pairs a device, stores only a token hash, exposes human tasks/browser jobs, and can revoke the paired session.
- Supabase Vault RPCs (midad_store_platform_secret and midad_read_platform_secret): inspected grants permit service_role only, not anon/authenticated.

## Existing data — do not duplicate

midad_platform_accounts; midad_account_factory_jobs; midad_account_factory_runs; midad_platform_account_events; midad_browser_jobs; midad_browser_providers; midad_browser_evidence_ledger; midad_human_bridge_sessions; midad_human_bridge_pairings.

## Verified state on 2026-11-08

- 5 platform-account records exist: 1 REGISTERED_UNVERIFIED, 1 HUMAN_CHECKPOINT, 2 POLICY_REVIEW, 1 BLOCKED.
- 1 account has a credential Vault reference. None has a browser_profile_ref. No secret values are included here.
- The Playwright provider is marked online but last heartbeat is 2026-11-05. The fresh-heartbeat window is 45 seconds; it is OFFLINE for control decisions.
- TinyFish is recorded as ready_pending_profile, but excluded because it is a paid provider.
- midad_human_bridge_sessions currently has 0 sessions.
- Account Factory queue_onboarding requires eligible platform policy, verified registration-automation permission, provider status ready, and a non-empty profile_ref. It creates a Browser Job with prepare-only boundary, stopping before final submission/legal acceptance, and an idempotency key.
- The deployed Account Factory and Human Bridge sources were missing from GitHub at audit time. This PR restores their exact deployed source; it does not deploy or alter either live function.

## Lifecycle boundaries

1. Discover and assess policy before account creation.
2. Prepare profile fields in the existing registry.
3. Reconcile an existing account before creating another.
4. Create a platform identity only through an explicitly supported, owner-approved path.
5. Store provider secrets in Vault and retain references only.
6. Use the existing Browser Gateway and Playwright worker for approved browser steps.
7. Pause for human verification, legal acceptance, CAPTCHA/MFA, or actions outside permitted automation.
8. Verify final account state and evidence, then close/revoke the session.

## Remaining gaps — not implemented by this PR

- The Account Factory is not a generic CRUD account manager for arbitrary websites. It supports profile preparation, limited documented API registration, and queue-based onboarding.
- The Playwright worker keeps authenticated sessions in RAM only. Restart loses them. The separate Profile Vault draft branch stores browser profile files without encryption and is not integrated; do not merge it as-is.
- stop_session closes the Playwright context; it does not perform a verified provider-specific website logout.
- No encrypted local offline browser task queue has been verified. Existing Supabase queues are online control-plane queues, not a durable local SQLite/Android queue.
- Account deletion, credential rotation/recovery, and user-facing account editing are not fully implemented.
- The NeoHeberg free VPS is not yet provisioned or runtime-tested.

## Security boundaries

Only live service source code and non-secret tests/docs are committed. Passwords, API keys, recovery codes, browser cookies, tokens, and session blobs remain outside Git. No account farming, fabricated identity, duplicate registration, CAPTCHA/MFA/KYC bypass, or unapproved legal/financial action is supported.
