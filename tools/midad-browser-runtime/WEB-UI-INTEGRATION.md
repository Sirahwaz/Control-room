# MIDAD Browser Web UI integration contract

## Implemented
- `midad-browser.html/css/js`: mobile-first Arabic control surface.
- The user-facing actions are integrated into the existing `midad_browser_agent_gateway`; no additional Edge Function slot is required.
- The gateway exposes only four browser UI actions to a verified Control Room session: `ui_capabilities`, `ui_list_sessions`, `ui_command`, `ui_get_result`.
- The same gateway retains its private ingest/service-role contract for worker operations.
- `operator_worker.py` emits an ingest-key-authenticated heartbeat every 15 seconds.
- The Control Room station tile opens the Browser page in the same tab so the existing sessionStorage access key remains available.

## Authentication model
Control Room uses opaque session tokens issued after validating Telegram Mini App initData or the existing web access key. The Browser UI reuses that established flow:
1. Telegram Mini App: exchange initData through `midad_telegram_auth`.
2. Existing web access: exchange the same-tab `midad_cockpit_key` through `midad_control_room`.
3. Send the opaque session token as `session_token` to the existing browser gateway.
4. The gateway hashes the token, validates an active `control_room_sessions` row and enforces the existing 30-day session age limit.

The gateway resolves the owner from `public.profiles` only when exactly one profile exists. It never accepts an owner UUID from the browser. If the project becomes multi-user, replace this singleton binding with an explicit server-side session-to-user mapping before enabling multiple owners.

## Server-side boundary
The existing gateway remains `verify_jwt=false` because it already uses a private ingest/service credential for worker calls and now additionally validates the opaque Control Room session for the four UI actions. This is not anonymous access.

- Service-role and ingest credentials remain server-side.
- Browser UI actions reject origins other than `https://sirahwaz.github.io`.
- UI request bodies are bounded to 4 KB.
- Browser callers cannot submit owner IDs or arbitrary gateway actions.
- The private worker actions still require the existing ingest or service-role credential.
- Commands are bounded and checked for credentials, financial operations and destructive actions before they reach the private queue.
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
