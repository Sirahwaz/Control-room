# MIDAD Browser Agent Gateway — production source snapshot

**Last reconciled:** 2026-11-20  
**Canonical production object:** Supabase Edge Function `midad_browser_agent_gateway`  
**Observed production deployment:** ACTIVE, version **24**, `verify_jwt=false`

## Production verification — 2026-11-20

- The Control Room gateway is active at version 24; all seven deployed source files were compared against GitHub main and matched byte-for-byte.
- All seven deployed source files were compared with GitHub `main`; each file matched byte-for-byte.
- The existing owner-bound browser session and Telegram-independent access-key recovery paths are preserved.
- The gateway's custom authentication remains server-side; no service-role or ingest secret is exposed to the browser or GitHub Actions worker.
- The three browser worker migrations were applied successfully. The migration runner recorded versions `20261119214545`, `20261119214551`, and `20261119214558`.
- The read-only claim and idempotency indexes require the exact identity tuple: `agent_key=midad_public_research`, `platform_key=public_read_only`, and `input_data.mode=public_read_only`.
- RPC grants were verified: `anon` and `authenticated` cannot claim; `service_role` can.
- Evidence ledger accepts a sanitized title (maximum 500 characters) and public excerpt (maximum 2,500 characters), with state-transition and privilege rules preserved.
- No production read-only job was created during migration or deployment verification.

## Production gateway v23 capabilities

- Owner-bound Control Room browser sessions.
- Telegram-independent access-key recovery.
- Atomic operator-job claims and lease-bound operator writes.
- Owner-scoped public read-only job submission.
- Atomic public read-only claims, restricted to explicitly marked public research jobs.
- Bounded public evidence retrieval through the evidence ledger.
- Separate provider status for persistent operator workers and ephemeral public read-only workers.
- GitHub Actions OIDC verification hosted inside the existing gateway, avoiding a new Edge Function slot.

## GitHub Actions OIDC integration — deployed

The repository's `github_oidc_proxy` route is deployed in the existing `midad_browser_agent_gateway` version 23.

The route:
- Verifies GitHub's RS256 signature against the official JWKS.
- Requires the exact repository, owner, main ref, workflow path, audience, subject and GitHub-hosted runner environment.
- Accepts only the `schedule` and `workflow_dispatch` event claims.
- Derives the worker ID and owner server-side.
- Exposes only heartbeat, public read-only claim, evidence event, lease renewal and lease release.
- Keeps operator jobs, private accounts, credentials, financial actions and destructive operations outside the public worker path.

## Ephemeral worker activation guard

The GitHub Actions workflow has a five-minute schedule and manual dispatch, but its job runs only when all conditions hold:
- Ref is `refs/heads/main`.
- Repository variable `MIDAD_BROWSER_EPHEMERAL_ENABLED` is exactly `true`.
- Event is `schedule` or `workflow_dispatch`.

Push and `workflow_run` triggers were removed so workflow events cannot invoke a token type that the OIDC verifier does not allow. No repository variable was created or enabled as part of this work. The worker therefore remains opt-in and is not considered end-to-end validated yet.

The workflow contract and OIDC source tests passed in GitHub Actions; PR #316 was merged. This verifies CI contracts, not a live worker execution.

## Runtime and deployment limits

- The persistent `operator_worker.py` is not currently running on a host. Gateway health does not imply a live persistent worker.
- Persistent authenticated sessions still require a persistent host, an account registry and an encrypted session key.
- The GitHub Actions worker is ephemeral and public-read-only. It does not preserve authenticated tabs or cookies between runs.
- No additional Edge Function was created; the existing gateway is the integration point.

## Deployment and activation guardrails

- Never delete or overwrite unrelated Edge Functions to create function capacity.
- Apply additive migrations before deploying the corresponding gateway source.
- Preserve the existing gateway's `verify_jwt=false` setting because it performs its own session and OIDC authentication.
- Do not set `MIDAD_BROWSER_EPHEMERAL_ENABLED=true` until a non-sensitive public-page job has passed end-to-end verification and the user has reviewed the result.
- No private account credentials, wallet signatures, withdrawals, payment execution or destructive operations are part of the public read-only worker path.
