# MIDAD Browser Agent Gateway — production source snapshot

**Last reconciled:** 2026-11-20  
**Canonical production object:** Supabase Edge Function `midad_browser_agent_gateway`  
**Observed production deployment:** ACTIVE, version **22**, `verify_jwt=false`

## Production verification — 2026-11-20

- The Control Room gateway is active at version 22.
- The existing owner-bound browser session path remains in place.
- The gateway's custom authentication remains server-side; no service-role or ingest secret is exposed to the browser.
- Database transaction mode was observed as read-write and database size was approximately 1.35 GB during pre-deployment checks.
- The three browser worker migrations were applied successfully. The migration runner recorded versions `20261119214545`, `20261119214551`, and `20261119214558`.
- The read-only claim and idempotency indexes now require the exact identity tuple: `agent_key=midad_public_research`, `platform_key=public_read_only`, and `input_data.mode=public_read_only`.
- RPC grants were verified: `anon` and `authenticated` cannot claim; `service_role` can.
- Evidence ledger now accepts a sanitized title (maximum 500 characters) and public excerpt (maximum 2,500 characters), with the original state-transition and privilege rules preserved.
- No production read-only job was created during migration verification.

## Production gateway v22 capabilities

- Owner-bound Control Room browser sessions.
- Telegram-independent access-key recovery.
- Atomic operator-job claims and lease-bound operator writes.
- Owner-scoped public read-only job submission.
- Atomic public read-only claims, restricted to explicitly marked public research jobs.
- Bounded public evidence retrieval through the evidence ledger.
- Separate provider status for persistent operator workers and ephemeral public read-only workers.

## Pending source change — NOT YET DEPLOYED

The merged repository now contains a GitHub Actions OIDC proxy route inside the existing `midad_browser_agent_gateway` function. This was deliberately integrated into the existing function because the Supabase project reached its Edge Function count limit; no existing function was deleted or replaced to create capacity.

The current production version 22 does **not** yet contain this OIDC route. The next deployment must update the existing gateway to version 23, preserving `verify_jwt=false` and the current owner-session behavior.

The OIDC route is designed to:
- Verify GitHub's RS256 signature against the official JWKS.
- Require the exact repository, owner, main ref, workflow path, allowed event, audience, subject and GitHub-hosted runner environment.
- Derive the worker ID and owner server-side.
- Expose only heartbeat, public read-only claim, evidence event, lease renewal and lease release.
- Keep operator jobs, private accounts, credentials, financial actions and destructive actions outside the public worker path.

The scheduled workflow remains disabled until repository variable `MIDAD_BROWSER_EPHEMERAL_ENABLED=true` is explicitly set after deployment and end-to-end verification.

## Runtime and deployment limits

- The persistent `operator_worker.py` is not currently running on a host. Gateway health does not imply a live persistent worker.
- Persistent authenticated sessions still require a persistent host, an account registry and an encrypted session key.
- The GitHub Actions worker is ephemeral and public-read-only. It does not preserve authenticated tabs or cookies between runs.
- No new Edge Function was deployed because the project is at its function-count limit. The existing gateway is the approved integration point.

## Deployment guardrails

- Never delete or overwrite unrelated Edge Functions to create function capacity.
- Apply additive migrations before deploying the corresponding gateway source.
- Preserve the existing gateway's `verify_jwt=false` setting because it performs its own session and OIDC authentication.
- Verify source parity and run one non-sensitive public-page job before enabling the scheduled workflow.
- Do not enable the schedule until the repository variable is explicitly set.
- No private account credentials, wallet signatures, withdrawals, payment execution or destructive operations are part of the public read-only worker path.
