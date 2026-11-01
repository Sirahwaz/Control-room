# MIDAD Browser Web UI integration contract

## Implemented in this branch
- `midad-browser.html/css/js`: mobile-first Arabic control surface.
- `supabase/functions/midad_browser_user_api/index.ts`: user-facing bridge.
- `midad_browser_agent_gateway`: private `worker_heartbeat` action.
- `operator_worker.py`: sends an authenticated heartbeat every 15 seconds.
- Control Room station tile opens the Browser page in the same tab so the existing sessionStorage access key remains available.

## Authentication model
The existing Control Room does not use Supabase Auth JWTs in its browser client. It issues opaque session tokens after validating Telegram Mini App initData or the existing Control Room access key. The Browser bridge reuses that established flow:
1. Telegram Mini App: exchange initData through `midad_telegram_auth`.
2. Existing web access: exchange the same-tab `midad_cockpit_key` through `midad_control_room`.
3. Send the opaque session token in the HTTPS request body to `midad_browser_user_api`.
4. The bridge hashes the token, validates an active `control_room_sessions` row and enforces the existing 30-day session age limit.

The bridge resolves the owner from `public.profiles` only when exactly one profile exists. It never accepts an owner UUID from the browser. If the project becomes multi-user, replace this singleton binding with an explicit server-side session-to-user mapping before enabling multiple owners.

## Server-side boundary
The browser bridge is deployed with platform JWT verification disabled because Control Room uses its own opaque session tokens. This is not anonymous access: the handler validates the hashed token against `control_room_sessions` on every request. It then uses server-side service credentials to call the private gateway.

- Service-role and ingest credentials remain server-side.
- CORS is limited to `https://sirahwaz.github.io`.
- Public actions are allowlisted: `capabilities`, `list_sessions`, `command`, `get_result`.
- The browser cannot submit owner IDs or arbitrary gateway actions.
- Commands are bounded and checked for credentials, financial operations and destructive actions before they reach the private gateway.
- Results are allowlisted, bounded and redacted; page content is marked untrusted.
- Worker liveness is true only when a matching owner heartbeat is no older than 45 seconds.

## Worker heartbeat
The persistent operator worker emits a heartbeat through the existing private gateway every 15 seconds. The gateway accepts this action only when the private ingest header matches its server secret and records the timestamp in `midad_browser_providers` under `midad_playwright_worker`. The UI does not enable browser controls without a fresh heartbeat.

## Runtime limits
- One worker instance per owner queue; atomic multi-worker job claiming is not implemented.
- Sessions and cookies remain in memory only; worker restart ends sessions.
- Only exact HTTPS hosts in the private account registry are allowed.
- CAPTCHA, MFA, KYC and anti-bot gates are not bypassed.
- Payments, withdrawals, transfers, wallet signing and destructive actions remain blocked.
- The first UI displays sanitized text previews and job status; live video/screenshot streaming is not yet implemented.
