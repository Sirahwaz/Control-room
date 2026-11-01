# MIDAD Browser Web UI integration contract

## Status
The mobile-first UI shell is added in `midad-browser.html`, `midad-browser.css`, and `midad-browser.js`. It is fail-closed: browser controls stay disabled until a secure user API verifies both the authenticated user and a live worker.

## Required server-side adapter
Implement `POST /functions/v1/midad_browser_user_api` as a Supabase Edge Function. It must:
- Validate the Supabase user JWT with `auth.getUser(token)`; never trust a user ID supplied by the client.
- Derive `owner_user_id` only from the verified JWT subject.
- Keep service-role and ingest keys server-side. Never return them or proxy arbitrary gateway actions.
- Expose a strict allowlist: `capabilities`, `list_sessions`, `navigate`, `inspect`, `command`, `stop_session`.
- Enforce owner scoping for every job and result.
- Reject arbitrary URLs unless they pass the runtime exact-host HTTPS policy. No wildcard hosts.
- Reject credential-like command content and all payments, transfers, withdrawals, wallet signing, claims, publication, destructive actions, CAPTCHA/MFA bypass and anti-bot evasion.
- Report `worker_online` only from a fresh server-side heartbeat, not from a successful API response or stale job row.
- Apply rate limits, request-size limits, origin controls, audit logging, and no-store responses.

## Frontend authentication adapter
The page expects `window.MIDAD_BROWSER_AUTH.getAccessToken()` to return the current authenticated Supabase access token. It does not read arbitrary local storage, accept credentials in URL parameters, or contain a service/ingest key. Until the authenticated adapter and server-side function are deployed, the UI remains visibly disconnected and all controls stay disabled.

## Worker/session contract
The current persistent operator worker keeps sessions in memory and must run as one instance per owner queue. Session status must be reported from a fresh worker heartbeat. The UI must not claim a session is live until a real worker result confirms it.
