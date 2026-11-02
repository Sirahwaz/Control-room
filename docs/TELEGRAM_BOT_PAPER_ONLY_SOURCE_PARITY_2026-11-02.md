# Telegram bot and paper-only engine source parity — 2026-11-02

## Deployed source evidence

Read-only retrieval from Supabase project `froegigfmpmvtecztfbf` on 2026-11-02:

| Function | Deployed version | Deployment source SHA | Files |
|---|---:|---|---|
| `telegram_bot` | 101 | `910014ecd7992a51b230696f215d305332a8dc81c401819057dab10f2831a1d2` | `index.ts` |
| `midad_noncopy_trading_engine` | 26 | `cb3983a774f60536b1ff96b596d7fc49f7bb861c535a5389ec931804965ada45` | `index.ts` |

## Verified behavior

- The Telegram `/airoom` command opens the fixed static AI Room preview; the existing main-menu URL remains unchanged. The deployed metadata version is 101, while the function's internal diagnostic payload still reports code version 97; this discrepancy is recorded, not rewritten.
- `/trade` and `/mysun` delegate to `midad_noncopy_trading_engine` with `mode: "run"`.
- The deployed engine explicitly returns and enforces `paper_only: true` and `live_execution: false`.
- The engine writes only to `signal_events` (upsert) and `midad_paper_trades` (insert). It reads market/telemetry, prior outcomes, and feedback; no exchange order placement, withdrawal, transfer, signing, or transaction API path was found.
- This is **not read-only**: invoking `/trade` or `/mysun` can create a paper-trade record. This PR does not invoke either command.
- No hard-coded JWT, Telegram bot token, database URL, or private-key material was found. Runtime credentials are environment-backed.

## Scope and safety

This PR restores the deployed source and adds static contracts only. It does not deploy Edge Functions, invoke Telegram commands, create paper trades, alter finance governors, enable live trading, or change database schema/RLS. Live financial execution remains disabled.
