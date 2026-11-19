# MIDAD Browser Agent Gateway — production source snapshot

**Last reconciled:** 2026-11-20  
**Canonical production object:** Supabase Edge Function `midad_browser_agent_gateway`  
**Observed production deployment:** ACTIVE, version **23**, `verify_jwt=false`

## Production verification — 2026-11-20

- The Control Room gateway is active at version 23.
- All seven deployed source files were compared byte-for-byte with the merged repository source, including the shared owner-session and GitHub OIDC modules.
- The existing owner-bound browser session path remains in place.
- The gateway's custom authentication remains server-side; no service-role or ingest secret is exposed to the browser.
- Database transaction mode was observed as read-write and database size was approximately 1.35 GB during pre-deployment checks.
- The four browser worker migrations were applied successfully. The migration runner recorded versions `20261119214545`, `20261119214551`, `20261119214558`, and `20261119215821`.
- The read-only claim and idempotency indexes require the exact identity tuple: `agent_key=midad_public_research`, `platform_key=public_read_only`, and `input_data.mode=public_read_only`.
- RPC grants were verified: `anon` and `authenticated` cannot claim; `service_role` can.
- Evidence ledger accepts a sanitized title (maximum 500 characters) and public excerpt (maximum 2,500 characters), with the original state-transition and privilege rules preserved.
- A non-sensitive public-page smoke job was queued after deployment; its completion is being verified separately.

## Production gateway v23 capabilities

- Owner-bound Control Room browser sessions and Telegram-independent access-key recovery.
- Atomic operator-job claims and lease-bound operator writes.
- Owner-scoped public read-only job submission.
- Atomic public read-only claims restricted to explicitly marked public research jobs.
- Bounded public evidence retrieval through the evidence ledger.
- Separate provider status for persistent operator workers and ephemeral public read-only workers.
- GitHub Actions OIDC proxy hosted inside this existing gateway; no additional Supabase Edge Function slot is consumed.

## GitHub Actions public read-only worker — ENABLED

The scheduled workflow `.github/workflows/midad-browser-ephemeral-worker.yml` runs from `main` every five minutes. It uses the GitHub OIDC token endpoint with audience `midad-browser-worker`; no static MIDAD ingest key or Supabase service-role key is stored in GitHub.

The gateway verifies the RS256 signature against GitHub JWKS and requires the exact repository, owner, main ref, workflow path, allowed event, audience, subject and GitHub-hosted runner environment. It derives the worker ID and owner server-side and exposes only heartbeat, public read-only claim, evidence event, lease renewal and lease release.

The worker is restricted to exact allowlisted public HTTPS hosts. It cannot claim operator jobs, log in, enter credentials, submit forms, bypass CAPTCHA/KYC/2FA, perform financial actions, sign wallets or execute destructive operations.

Each run processes at most one job, has a four-minute runtime cap, and exits after twenty seconds without work. Browser contexts are ephemeral; no cookies, storage state or authenticated tabs persist between runs.

## Remaining limits

- The persistent `operator_worker.py` is not currently running on a host. Gateway health does not imply a live persistent worker.
- Persistent authenticated sessions still require a persistent host, an account registry and an encrypted session key.
- This GitHub Actions worker is a low-cost replacement for public read-only research browsing, not a replacement for authenticated TinyFish-style sessions or a full persistent Cloud PC.

## Deployment guardrails

- Never delete or overwrite unrelated Edge Functions to create function capacity.
- Preserve the existing gateway's `verify_jwt=false` setting because it performs its own session and OIDC authentication.
- Keep the GitHub Actions workflow and gateway hostname allowlists synchronized.
- Verify deployed source parity and inspect public evidence before expanding the host allowlist.
- No private account credentials, wallet signatures, withdrawals, payment execution or destructive operations are part of the public read-only worker path.
