# MIDAD AI Room — isolated prototype contract

## Scope
- Additive, standalone UI at `ai-room.html`; does not modify `index.html`, existing JS/CSS, PWA manifest, service worker, Supabase schema, or Telegram authentication.
- No network calls, API keys, provider SDKs, persistent browser storage, or financial operations.
- All tasks and status changes are in-memory demo state and reset on reload.

## Manual acceptance checks
1. Open `ai-room.html` on mobile and desktop; verify responsive layout and Arabic RTL.
2. Add a task; verify task count increases and task appears.
3. Filter to review/done/all; verify task list and review counter are consistent.
4. Change a task status and reopen it; verify counters and labels update.
5. Refresh view; verify no external requests and the prototype stays usable.
6. Reload page; verify demo tasks reset (no persistence).
7. Inspect browser Network panel: no requests to Supabase, Telegram, or model providers.
8. Confirm production entry point, PWA manifest and service worker remain unchanged.

## Security gate before live integration
- Inventory RLS policies for all candidate tables; do not expose service-role credentials or rely on UI-only authorization.
- Confirm Telegram Mini App init data is validated server-side.
- Define authenticated user-scoped read/write policies and least-privilege RPC/Edge Function contracts.
- Use provider adapters and server-side secret storage; redact sensitive data from logs.
- Require idempotency, cancellation tests, human approval for high-impact actions, and a kill switch.
- Keep all financial live actions disabled.

## Status
UI implementation is a prototype only. Automated browser testing and live integration have not been run in this environment.
