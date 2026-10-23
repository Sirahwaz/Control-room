# Production Revenue Mesh runtime drift and safe reconciliation — 2026-10-23

## Finding

The production runtime and the open PR branch have materially different qualification behavior.

### Production runtime observed

- Supabase project: `froegigfmpmvtecztfbf`
- Function: `midad_revenue_intelligence_mesh`
- Status/version: `ACTIVE`, version 14
- Deployed bundle SHA-256: `f4bc30701188564ef5b5b6b0c0a07c85a59c3cd6be3df5cdd3fb9621b8ab8bb6`
- The retrieved live `index.ts` does not import/use `qualifyRevenueCandidate`, the new region/KYC/identity qualification gate, or the shared-pool parser. Its `classify` path promotes a candidate to `READY_FOR_REVIEW` after checking basic deadline/cost/asset and `paymentProof` signals. It does not gate on explicit region eligibility, KYC eligibility, identity eligibility, or recipient-specific split reward.
- Active scheduled job: `midad-revenue-intelligence-15m`, cron `*/15 * * * *`, job id 42.
- Latest run observed at this audit: 2026-10-23 03:45 UTC. It completed 8/8 feeds, observed/upserted 90 candidates, and counted 3 payout-gate passes.

### Production rows exposing the gap

The live database still contained `READY_FOR_REVIEW` rows with unknown region/KYC/identity, including:

| Opportunity | Live state | Evidence concern |
|---|---|---|
| Generative Art Card | `READY_FOR_REVIEW`, estimated net 9.25 USDC | 201 submissions for one winner; region/KYC/identity unknown. Escrow funding proof is not proof that this user is eligible or will win. |
| FlapJax Receipt Relay Q41 | `READY_FOR_REVIEW`, estimated net 0.925 USDC | Listing explicitly splits the $1 USDC pool across up to two answers. 0.925 USDC is the post-platform-fee pool, not the proven individual net. |
| FlapJax public repost bonus | `READY_FOR_REVIEW`, estimated net 0.925 USDC | Task has a previous-submission prerequisite; its description states $0.10 USDC per accepted slot while the feed/escrow amounts differ; off-platform FLAPJAX bonus is unverified. |
| Previously listed Knots, Gable Guardians and Receipt Relay items | Some remained `READY_FOR_REVIEW` after their stored deadlines elapsed | Existing rows are not guaranteed to reappear in a later open-only source feed, so they can retain an old READY state unless expired rows are reconciled. |

These are production observations, not guesses from feed cards. The exact rows were retrieved read-only. No production data was modified in this audit.

## Branch fixes prepared

Branch: `fix/revenue-mesh-source-and-qualification-gates`  
PR: https://github.com/Sirahwaz/Control-room/pull/95

1. The Taskmarket adapter detects explicit shared-pool language; no individual net amount is inferred from a shared pool.
2. Qualification remains fail-closed if region, KYC, identity, individual share or fee schedule is unknown.
3. Added a pure stale-reconciliation decision helper and regression tests. The discovery cycle will mark previously READY rows as `STALE` when a valid deadline is in the past, clear the current estimated net, set priority to zero, and add `deadline_expired` to the gate reasons.
4. The reconciliation helper explicitly protects `PAID`, `CLAIMED`, `IN_PROGRESS`, `DELIVERED`, and `AWAITING_ACCEPTANCE` statuses. The database update is conditional on the row still being READY and expired, so a concurrent state change is not overwritten.
5. The stale reconciliation is bounded to 500 expired rows per discovery cycle and contributes its count to the run summary.

## Why production was not altered

The deployed function is missing the reviewed branch code, while the user-authorized workflow for this phase is to keep PR #95 as a Draft and not merge/deploy it. Updating production rows directly would be temporary and misleading because the active old 15-minute discovery job can rewrite them to READY again. Pausing the full discovery scheduler would also stop revenue discovery across all providers. Neither workaround is safer than first completing review of the code revision.

Accordingly, this report does **not** claim the live issue has been remediated. Production remains on the older bundle until a reviewed deployment is separately authorized.

## Required verification after a future approved deployment

1. Record the new deployed function version and source hash.
2. Execute a read-only `health` check and one controlled discovery run.
3. Verify that open Taskmarket listings with unknown region/KYC/identity are no longer `READY_FOR_REVIEW`.
4. Verify Q41's per-user estimated net is null/blocked until its individual share is explicitly provided.
5. Verify expired READY rows transition to `STALE`; assert paid/in-progress/delivered rows remain unchanged.
6. Confirm source-feed discovery continues and inspect the resulting run summary, error list and opportunity/evidence counts.

## Safety status

- No production DB mutation, source disablement, deployment or merge was performed.
- No account registration, claim, external submission, wallet connection/signature, purchase or financial transaction was performed.
- PR #95 remains open and Draft.
