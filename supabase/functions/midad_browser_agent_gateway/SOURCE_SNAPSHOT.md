# MIDAD Browser Agent Gateway — production source snapshot

**Last reconciled:** 2026-11-19  
**Canonical production object:** Supabase Edge Function `midad_browser_agent_gateway`  
**Observed deployment:** ACTIVE, version **21**

## Production source parity — VERIFIED on 2026-11-19

A read-only fetch of the live Supabase function was compared byte-for-byte with the repository source:

- `index.ts`
- `origin-policy.ts`
- `auth.mjs`
- `ledger.ts`
- `lease.ts`
- shared `midad-owner-session.mjs`

All six files matched `main` exactly at the time of deployment verification.

## Production database — VERIFIED

Migration `20261119205535_midad_browser_worker_leases_v1` is applied.

- `midad_browser_jobs` contains the four lease fields: owner, SHA-256 token digest, expiry and claim timestamp.
- Atomic operator claim, lease validation, renewal and release RPCs exist.
- `service_role` can execute the claim RPC; `anon` and `authenticated` cannot.
- A live zero-job claim smoke returned zero without mutating a job.
- No production browser job was created for this verification.

## Active production capabilities

- Owner-bound Control Room browser sessions.
- Telegram-independent access-key recovery path.
- Atomic operator-job claims using PostgreSQL `FOR UPDATE SKIP LOCKED`.
- Lease-bound operator result and event writes.
- Bounded lease renewal/release and recovery of expired `RUNNING` jobs.
- Gateway authentication remains server-side; no service-role or ingest secret is exposed to the browser.

## Pending in this branch — NOT YET DEPLOYED

This branch adds a separate GitHub Actions OIDC proxy and a scheduled public read-only worker. Until its PR is merged, the readonly claim migration is applied, and the new Edge Function is deployed, these capabilities are **not active in production**:

- `midad_browser_claim_readonly_jobs_v1`
- `claim_readonly_jobs` gateway action
- `midad_browser_github_worker` OIDC proxy
- GitHub-hosted ephemeral Chromium queue consumer
- bounded public-page text excerpts in the evidence ledger

The OIDC worker is deliberately restricted to public read-only jobs. It cannot claim operator jobs, submit forms, use account credentials, bypass CAPTCHA/KYC/2FA, or perform financial actions.

## Runtime and deployment limits

- The persistent `operator_worker.py` is not currently running on a host. Gateway v21 being healthy does not imply a live worker.
- The operator worker can restore authenticated storage state only when its host has a persistent session directory and a valid `MIDAD_SESSION_ENCRYPTION_KEY`. Without that key it remains memory-only.
- The proposed GitHub Actions worker is ephemeral: it can process public read-only jobs but does not preserve live tabs or authenticated sessions between runs.
- Current production browser-job count was zero at the last verification.
- The browser gateway smoke runner remains disabled; do not reactivate it for routine testing.

## Deployment guardrails

- Never deploy a repository mirror automatically.
- Before enabling a new worker path: apply its additive migration, deploy the exact reviewed Edge Function source, verify source parity, verify service-role-only RPC grants, and run an authenticated end-to-end job with non-sensitive public content.
- No private account credentials, payment actions, wallet signatures, withdrawals, or destructive operations are part of the public read-only worker path.
