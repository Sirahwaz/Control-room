# Base USDC Monitor — Bounded Catch-up Acceleration

## Current production snapshot — 2026-11-08 03:40 UTC

- Live function: `midad_base_usdc_monitor` **ACTIVE v23**.
- Deployed source SHA-256: `bfb32966ccff93c02d2ef051d9900ae72fe4f1e3386637d98e50ab1c3752e35a`.
- Both canonical Base USDC receive routes report `VERIFIED`, `scan_caught_up=true`, `payment_reconciliation_ready=true`, and `error_count=0`.
- Latest route monitor snapshots were refreshed at approximately 03:40 UTC.
- No Base receipts were detected and no payment-verifier calls were recorded; route readiness is not evidence of collected revenue.
- Avalanche USDT remains `DEGRADED` with `scan_catchup_incomplete`; Solana USDC/USDT remain `READY_AWAITING_FIRST_TOKEN_ACCOUNT` with zero token accounts. Solana EURC remains non-canonical and excluded.
- No wallet signing, transfer, settlement, cursor skip, or manual readiness override was performed.



## Historical deployment snapshot — 2026-11-07
- Supabase function: `midad_base_usdc_monitor`
- Live version: **21** (ACTIVE)
- Deployment SHA-256: `bfb32966ccff93c02d2ef051d9900ae72fe4f1e3386637d98e50ab1c3752e35a`
- Cron job: `37`, every 5 minutes, unchanged
- RPC endpoints: configured endpoint plus PublicNode and 1RPC fallbacks, unchanged

## Change
- Increased the maximum scan window from 4,000 to **6,000 finalized blocks per route per invocation**.
- Kept each `eth_getLogs` request bounded to **500 blocks** and sequential (12 chunks per route at the new limit).
- Cursor advances only after the entire requested range and receipt persistence complete.
- The range helper enforces contiguous, non-overlapping windows, clamps at the finalized block, rejects unsafe limits, and emits no chunks for an empty range.
- No RPC provider concurrency increase, no cursor skipping, no finality relaxation, no wallet transfer or signing.

## Verification
- Eight focused Node tests pass for 6,000-block progression, first-run bootstrap, finalized-block clamping, empty ranges, 500-block chunk continuity, unsafe-limit rejection, and exact 12-chunk coverage.
- A manual scan was triggered through the existing authenticated cron path after deployment.
- Both active Base USDC receive routes advanced exactly **6,000 finalized blocks** in the observed invocation. Both remained `VERIFIED`, with `error_count=0` and no recorded `last_error`.
- Latest observed cursors after the 01:50 UTC scheduled scan:
  - Speedbot Base USDC: `53,521,826` against finalized block `54,123,682` (lag 601,856).
  - Trust Wallet Base USDC: `53,521,625` against finalized block `54,121,850` (lag 600,225).
- `scan_caught_up=false` and `payment_reconciliation_ready=false` remain correct. No route was marked ready manually.

## Estimated catch-up
At 6,000 blocks per route every five minutes, the observed backlog implies roughly **8.5 hours** to catch up if cadence and RPC throughput remain stable. This is an estimate, not a guarantee.

## Safety gates
Do not mark routes ready or bypass the cursor. After catch-up, require the monitor's `scan_caught_up=true`, strict verifier readiness, exact recipient/token/amount checks, and independent payment reconciliation before exposing the route as ready for settlement.
