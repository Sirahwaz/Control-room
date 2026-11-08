# Base USDC Monitor — Bounded Catch-up Design

## Purpose

Provide a conservative, resumable scanner for confirmed EVM token-transfer activity. The monitor is designed to make progress without skipping blocks, relaxing finality, or creating duplicate receipt records.

## Safety invariants

- Scan only through the configured finalized block.
- Keep each log query bounded to at most 500 blocks.
- Cap the total scan window per route and invocation at 6,000 finalized blocks.
- Process chunks sequentially; do not increase provider concurrency to accelerate catch-up.
- Advance a route cursor only after the complete requested range has been scanned and receipt persistence has succeeded.
- Keep writes idempotent and preserve the evidence needed for independent payment reconciliation.
- Treat provider timeouts, malformed responses, incomplete ranges, and persistence failures as failed scans; never skip ahead to hide a gap.
- Do not perform wallet signing, transfers, settlement, or payment approval from the scanner.

## Range helper and test coverage

The range helper enforces contiguous, non-overlapping windows, clamps to the finalized height, rejects unsafe limits, and emits no chunks for an empty range.

Focused tests cover:
- bounded 6,000-block progression;
- first-run cursor bootstrap;
- finalized-block clamping;
- empty ranges;
- contiguous 500-block chunk boundaries;
- unsafe-limit rejection;
- exact 12-chunk coverage.

## Operational data boundary

Live function versions, deployment hashes, RPC provider names, wallet/route identifiers, block heights, receipt counts, scan errors, and payment reconciliation state are intentionally excluded from this public document. Keep those details in private operational records. This document describes the design contract, not current production health.
