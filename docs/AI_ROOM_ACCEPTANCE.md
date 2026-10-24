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
9. Verify production `index.html`, manifest, service worker, schema, RLS policies, and GRANTs remain unchanged. The isolated `ai-room.html` preview is intentionally a direct URL and is not linked into the home page.

## Security gate before exposing broader integrations
- Keep the 30 target tables classified from `docs/AI_ROOM_RLS_DEPENDENCY_AUDIT_2026-10-24.md`; do not add direct client table access.
- Do not wire agents, model gateways, wallet bridges, revenue workers, payments, checkout, fulfillment, or browser automation into this room until each has a separate reviewed contract, authorization checks, redaction rules, idempotency, cancellation behavior, and evidence tests.
- All live financial actions, signing, transfers, and withdrawals stay disabled.
- Keep PR #100 in Draft. Do not merge the broader UI or wire it into the main Control Room navigation until updated CI passes and manual mobile Telegram acceptance is recorded.

## Current state
The isolated `ai-room.html` preview is now available at `https://sirahwaz.github.io/Control-room/ai-room.html`; it was added as a standalone Pages path only. Production `index.html` (SHA `5c2413d82408dd1e4a64693f197efd81727edcb4`), manifest, and service worker remain unchanged. Supabase `midad_ai_room_preview` is ACTIVE v2 and provides a GET-only 302 redirect to that static page (default Supabase Edge hostname serves HTML as `text/plain`, so it must not host HTML directly). `midad_ai_room_status` is ACTIVE v3; only the Pages origin is allowed and a live status request requires a valid Control Room session. `telegram_bot` is ACTIVE v97 with an additive `/airoom` command; its existing main-menu URL remains unchanged. The current branch head `ed316c3e4814fe1df7a9c0a11cc43392bff1e9bf` passed all five CI gates: Agentation E2E, static contract tests, live HTTP denial, MIDAD FIX Contract, and Control Room Verify. HTTP tests prove missing/fake sessions are rejected and only the allowed origin passes CORS. A valid Telegram user session has not yet been exercised on the user’s phone; that is the remaining acceptance gate.


## Live HTTP denial test evidence
- CI run `40042661289` passed against the deployed endpoint.
- No session was rejected with `401 missing_session`; a fake session was rejected with `401 session_expired`; preflight from an unapproved Origin was rejected with `403`.
- These tests use no valid token and do not mutate data. A valid Telegram session test is still required before release.


## Additional SQL dependency gate
- A body-level SQL audit found that `midad_agent_fee_reserve_request` assigns a destination approval via an arbitrary `SELECT id FROM public.profiles LIMIT 1`. This privileged finance workflow is not connected to AI Room and must remain excluded until its owner-routing contract is repaired and tested.
- No triggers were found directly on the 30 RLS-review tables. The related store-fulfillment trigger is on `midad_store_orders` and is still excluded from AI Room.


## Isolated preview route and deployment record
- Static preview URL: `https://sirahwaz.github.io/Control-room/ai-room.html`; added to `main` as one file only. It is a direct preview route, not a change to the homepage or PWA navigation.
- The Supabase project hostname transforms `text/html` responses into `text/plain`; `midad_ai_room_preview` therefore serves only a fixed 302 redirect. Browser final response comes from GitHub Pages and has `text/html`.
- `telegram_bot` v97 adds `/airoom` and the preview button; the default menu button still uses the previous Control Room URL. Rollback source for v96 is stored in `docs/recovery/telegram_bot-v96-before-airoom-20261024.ts.txt`.
- Latest end-to-end HTTP denial workflow: run `40052607679` success — preview GET/redirect/html verified, preview POST `405`, missing/fake session `401`, allowed Pages preflight `204`, unapproved Origin `403`.
- Still required: send `/airoom` to the MIDAD bot from the user's Telegram account, open the button, press “اتصال آمن عبر Telegram”, and verify “متصل — قراءة فقط” with aggregate counts. Do not share a session token or any other secret in chat.
