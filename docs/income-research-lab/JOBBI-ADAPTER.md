# MIDAD Wide Income Discovery — Jobbi index adapter

**State:** staged source + tests; not deployed to Supabase.
**Baseline:** exact live `midad_revenue_intelligence_mesh` v26 source and helper files retrieved from project `froegigfmpmvtecztfbf` before editing.
**Goal:** expand source coverage without treating an aggregator as a payer.

## Why this source
Jobbi publishes a free, unauthenticated JSON Feed of open agent gigs, refreshed hourly, with stable IDs, original board URLs, reward currency/rail, payment state, payout grade, expiry and source board metadata. Its current index snapshot reported 703 open gigs across 12 boards on 3 November 2026. This is a discovery index, not a payer; many listings are fiat-only and must be filtered out.

## Adapter contract
- Read only `https://jobbi.org/gigs.json?lane=agent&currency=USDC&limit=50`.
- Preserve original board URL and stable external ID.
- Normalize USDC/USDT only as numeric stablecoin reward amounts; other crypto assets remain native-unit evidence and fiat currencies are not classified as crypto.
- Require HTTPS external links and reject private/internal hosts, unsafe protocols, missing IDs and expired/closed tasks.
- Preserve `payment_state`, `payout_grade`, board and reward rail as index metadata.
- Always set `paymentProof=false`, `payoutProofStatus=unverified`, `escrowFunded=null`, and zero payout confidence. Only the original board plus independent task-level escrow/receipt verification can pass the existing gate.
- No registration, claim, bid, submission, wallet action, spend or external contact.

## Verification
Deno tests cover stablecoin normalization, fiat exclusion, closed/expired filtering, unsafe URL rejection, and the rule that aggregator metadata cannot become task-level payment proof. CI is scoped to this function folder. Production registry activation and deployment are intentionally not part of this PR.
