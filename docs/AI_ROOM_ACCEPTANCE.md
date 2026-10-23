# MIDAD AI Room — acceptance and live connector contract

## Scope
- Additive standalone UI at `ai-room.html`; existing `index.html`, PWA manifest, service worker, Telegram app entry point, Supabase policies, GRANTs, and unrelated functions remain untouched.
- Local task creation and status changes remain browser-only demo state and reset on reload.
- An optional live connection may be started only by explicit user click from an authenticated Telegram Mini App.
- The client calls the existing `midad_control_room` Telegram-authentication route and the new `midad_ai_room_status` endpoint. No model providers or write-action endpoints are connected.

## Read-only connector controls
- Telegram init data is verified server-side by the existing Control Room; access is gated by `control_room_access`.
- The returned session token exists in JavaScript memory only. Never persist it in localStorage, sessionStorage, cookies, URL parameters, or logs.
- The new status endpoint verifies a SHA-256 hash against an active `control_room_sessions` row, enforces the same 30-day maximum age, and returns aggregate counts only.
- CORS is limited to `https://sirahwaz.github.io`; the function itself also requires a valid Control Room session and never treats CORS as authentication.
- The new function must be deployed with `verify_jwt=false` because it accepts the existing custom Control Room session token, and compensates by validating that token server-side before any data query.
- Status fields are a strict allowlist: signals, opportunities, engine runs, active alerts, pending approvals, and open/acknowledged human tasks.
- No service-role key, secret, wallet address, task detail, evidence payload, queue data, or any of the 30 RLS-review target tables is returned by the new status endpoint.
- No write API is exposed; mutations and financial actions are explicitly reported as disabled.

## Manual acceptance checks
1. Open `ai-room.html` in a mobile Telegram Mini App originating from the approved site; verify Arabic RTL and responsive layout.
2. Open in a regular browser and press connect; verify it explains that Telegram authentication is required and makes no network call.
3. Inside the authorized Telegram Mini App, press “اتصال آمن عبر Telegram”; verify the Control Room login and read-only status request succeed.
4. Verify only aggregate counts update and the UI says “متصل — قراءة فقط”.
5. In browser Network tools, confirm requests are limited to `midad_control_room` for Telegram session issuance and `midad_ai_room_status` for aggregate status.
6. Verify unauthenticated, expired, inactive, or unknown session tokens are rejected; a non-allowlisted Origin is rejected.
7. Verify session tokens are not present in localStorage, sessionStorage, cookies, the DOM, URLs, console output, or event log.
8. Verify refresh re-queries status, and local task state actions never submit writes to Supabase.
9. Verify production `index.html`, manifest, service worker, schema, RLS policies, and GRANTs remain unchanged.

## Security gate before exposing broader integrations
- Keep the 30 target tables classified from `docs/AI_ROOM_RLS_DEPENDENCY_AUDIT_2026-10-24.md`; do not add direct client table access.
- Do not wire agents, model gateways, wallet bridges, revenue workers, payments, checkout, fulfillment, or browser automation into this room until each has a separate reviewed contract, authorization checks, redaction rules, idempotency, cancellation behavior, and evidence tests.
- All live financial actions, signing, transfers, and withdrawals stay disabled.
- No merge or production UI deployment until updated CI passes and manual mobile Telegram acceptance is recorded.

## Current state
The live connector UI is staged in the feature branch only; the read-only backend function is deployed as ACTIVE version 1. CI contract tests and Agentation E2E have passed for the connector code. Direct unauthenticated HTTP rejection could not be verified from this environment because its outbound DNS lookup for the Supabase hostname failed. Mobile Telegram end-to-end authorization and denial still require a real device/session test before the UI is merged or deployed.
