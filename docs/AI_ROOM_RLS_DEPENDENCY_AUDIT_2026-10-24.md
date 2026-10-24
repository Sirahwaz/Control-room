# MIDAD AI Room — RLS dependency audit (read-only)

**Date:** 2026-10-24  
**Project:** `midad-ai` / `froegigfmpmvtecztfbf`  
**Branch:** `feat/midad-ai-room-neuralpp-20261024`  
**Policy:** No RLS policies, table grants, function grants, schema, data, or production services were changed.

## 1. Confirmed platform state

- Supabase security advisor continues to report 30 public tables with RLS enabled and no policies (latest observed 2026-10-23 23:36:10 UTC).
- For the ordinary `anon` and `authenticated` roles, RLS with no policies is fail-closed for row access. This is not evidence of an observed data leak.
- Catalog review found broad table grants to `anon` and/or `authenticated` on: `midad_agent_events`, `midad_factory_artifacts`, `midad_factory_learning`, `midad_factory_projects`, `midad_factory_runs`, `midad_human_bridge_pairings`, `midad_human_bridge_sessions`, and `midad_speedbot_fulfillments`. These grants are avoidable exposure surface even while RLS denies rows. Do not change them without a full call-site/role-impact check.
- The edge-function inventory lists 98 functions. Targeted source inspection was performed for the relevant control-room, browser, human-bridge, agent-fee, account-factory, meme/research, revenue-intelligence, fulfillment and payment handlers. This is not yet a proof that every one of the 98 functions has been exhaustively scanned; items marked “no caller found” below mean not found in the inspected source set, not unused.
- The AI Room HTML remains demo-only and does not query Supabase. No connector was enabled.

## 2. Table-to-dependency map from inspected source

| RLS table | Confirmed database / Edge Function references | Integration disposition |
|---|---|---|
| `midad_account_factory_runs` | Edge Functions `midad_account_factory`, `midad_autonomy_loop` | Internal run history. Check owner/tenant scoping before any UI read. |
| `midad_agent_events` | Edge Functions `midad_browser_agent_gateway`, `midad_mining_provider_scout`; SQL routine `midad_browser_smoke_cleanup_job_v1` | Internal audit/event stream. No direct browser reads. |
| `midad_agent_fee_allowlist` | SQL routines `midad_agent_fee_reserve_request`, `midad_claim_agent_fee_payment` | Financial destination control; service/RPC only. |
| `midad_agent_fee_ledger` | SQL routine `midad_claim_agent_fee_payment`; Edge Function `midad_agent_fee_wallet` | Financial ledger; no client writes or direct reads. |
| `midad_agent_fee_policies` | SQL routines `midad_agent_fee_reserve_request`, `midad_claim_agent_fee_payment`; Edge Function `midad_agent_fee_wallet` | Privileged policy/configuration; keep internal. |
| `midad_agent_fee_requests` | SQL routines `midad_agent_fee_reserve_request`, `midad_claim_agent_fee_payment`; Edge Function `midad_agent_fee_wallet` | Financial workflow; human approval and server-side controls required. |
| `midad_agent_fee_wallets` | SQL routines `midad_agent_fee_reserve_request`, `midad_claim_agent_fee_payment`; Edge Function `midad_agent_fee_wallet` | Wallet references; internal only. |
| `midad_browser_evidence_ledger` | SQL routines `midad_browser_record_evidence_v1`, `midad_browser_smoke_cleanup_job_v1`; Edge Function `midad_browser_agent_gateway` calls the evidence RPC | Append-only evidence. RPC is the intended write boundary; test actor/job ownership and idempotency. |
| `midad_browser_smoke_tokens` | SQL routines `midad_browser_smoke_authorize_v1`, `midad_browser_smoke_cleanup_token_v1` | One-shot token digests and Vault references; internal only. |
| `midad_factory_artifacts` | No direct caller found in the inspected Edge Function set | Treat as internal until full code/call-graph search identifies its consumers and ownership model. |
| `midad_factory_learning` | Edge Functions `midad_meme_scout`, `midad_neural_evolution` | Internal learning/reward data; no global client reads. |
| `midad_factory_projects` | Edge Function `midad_meme_scout`; schema contains owner/tenant fields | Candidate for owner-scoped UI only after confirming tenant checks and all write paths. |
| `midad_factory_runs` | No direct caller found in the inspected Edge Function set | Treat as internal; not evidence of unused table. |
| `midad_human_bridge_pairings` | Edge Function `midad_human_bridge` | Pairing flow uses hashed code, expiry and owner field. Keep code/hash server-side; validate single-use, owner binding and expiry in all paths. |
| `midad_human_bridge_sessions` | Edge Functions `midad_human_bridge`, `midad_omni_agent_gateway` | Session token hash and owner scope. Keep direct table access internal; use server-mediated lifecycle and revocation. |
| `midad_income_sources_audit_20261016` | No direct caller found in the inspected Edge Function set | Historical audit/archive; read-only internal by default. |
| `midad_meme_assets` | Edge Function `midad_meme_scout` | Market data; only consider a narrow read-only view/API after field review. |
| `midad_meme_paper_trades` | Edge Function `midad_meme_scout` | Paper-trading state; internal; no live trading or client mutation. |
| `midad_meme_price_snapshots` | Edge Function `midad_meme_scout` | Market data; filtered read-only view/API only if required. |
| `midad_meme_scan_runs` | Edge Function `midad_meme_scout` | Internal scanner run state and diagnostics. |
| `midad_meme_signals` | Edge Function `midad_meme_scout` | Candidate for filtered read-only signals, not direct writes or raw internal evidence. |
| `midad_platform_account_events` | Edge Function `midad_account_factory` | Audit trail for external account onboarding; internal. |
| `midad_platform_accounts` | Edge Functions `midad_account_factory`, `midad_autonomy_loop`, `midad_revenue_autopilot`, `midad_money_hunter`, `midad_first_mover_engine` | Highly sensitive external-account/verification/secret-reference data. Never expose directly. |
| `midad_revenue_intel_evidence` | Edge Function `midad_revenue_intelligence_mesh` | Research evidence/excerpts; server-side and filtered before any UI presentation. |
| `midad_revenue_intel_opportunities` | Edge Functions `midad_revenue_intelligence_mesh`, `midad_revenue_intel_work_queue_worker`, `midad_paid_revenue_feed` | Potential user-facing feed, but expose only a minimal eligibility-filtered DTO/view; no direct client writes. |
| `midad_revenue_intel_runs` | Edge Function `midad_revenue_intelligence_mesh` | Internal research run records. |
| `midad_revenue_intel_work_queue` | Edge Functions `midad_revenue_intelligence_mesh`, `midad_revenue_intel_work_queue_worker` | Internal worker queue; never expose queue instructions or result payloads directly. |
| `midad_speedbot_fulfillments` | Edge Functions `midad_speedbot_fulfillment`, `midad_speedbot_target_executor`, `midad_speedbot_poller` | Fulfillment/payment-related state; service-only. |
| `midad_store_fulfillment_evidence` | Edge Function `midad_store_fulfillment`; SQL routines `midad_complete_store_fulfillment`, `midad_enqueue_store_fulfillment_after_verified_payment` | Integrity-sensitive order evidence; RPC/worker path only. |
| `midad_store_fulfillment_jobs` | Edge Functions `midad_store_fulfillment`, `midad_public_checkout`; SQL routines `midad_complete_store_fulfillment`, `midad_enqueue_store_fulfillment_after_verified_payment` | Payment-intent/order-linked worker jobs; internal only. |

## 3. SQL/RPC execution boundary

Catalog inspection found these relevant `SECURITY DEFINER` routines referencing the 30 tables:

- Agent-fee: `midad_agent_fee_reserve_request`, `midad_claim_agent_fee_payment`
- Browser: `midad_browser_record_evidence_v1`, `midad_browser_smoke_authorize_v1`, `midad_browser_smoke_cleanup_token_v1`, `midad_browser_smoke_cleanup_job_v1`
- Store fulfillment: `midad_complete_store_fulfillment`, `midad_enqueue_store_fulfillment_after_verified_payment`

For these inspected routines, catalog ACLs showed execution granted to `postgres` and `service_role`, not `anon` or `authenticated`. Each inspected function has a fixed `search_path` in `proconfig`. This reduces risk from untrusted client invocation and search-path substitution, but is not a substitute for reviewing function body authorization, input validation, side effects, and least-privilege grants. The fee and fulfillment routines can affect payment/fulfillment state, so they remain out of the AI Room client contract.

## 4. Edge Function authentication findings

- Several relevant functions report `verify_jwt=false`. This alone does not prove they are unauthenticated; some use custom ingress keys, autonomy keys, or hashed `control_room_sessions` tokens. Each must be checked for a required credential before any privileged action.
- Confirmed custom gate patterns in inspected source include: `midad_human_bridge` checking service-role/ingest credentials for internal paths and hashed session tokens for control-room paths; `midad_agent_fee_wallet` checking hashed active `control_room_sessions`; `midad_browser_agent_gateway` checking a service/ingest credential and calling a restricted evidence RPC; and worker functions using autonomy/ingest-key gates.
- Do not pass service-role keys, ingress/autonomy keys, session tokens, token hashes, Vault secret IDs, wallet references, payment evidence, or raw worker queue payloads into `ai-room.html`.
- Completed a source retrieval/static scan of all 98 deployed Edge Functions. The scan recorded each function's version and `verify_jwt` setting, literal references to the 30 target tables, literal `.rpc(...)` and `functions.invoke(...)` names, credential/authentication markers, service-role usage, write calls, and outbound `fetch` calls. No function source retrieval failed. The resulting map records confirmed references only; generated table names, dynamic SQL, wrappers, and runtime-dependent dispatch can still create indirect dependencies, so this remains a static source/call-graph review rather than proof of runtime non-use.

## 5. Recommended access pattern by class

1. **Internal/service-only:** financial controls and ledgers, browser evidence/tokens, factory execution internals, external platform accounts/events, research runs/evidence/work queue, speedbot and store fulfillment state. Use server-side workers or tightly scoped RPCs.
2. **Owner-scoped candidate:** `midad_factory_projects`, selected `midad_account_factory_runs`, and human-bridge lifecycle records only if a product feature requires them. Prove `auth.uid()`/tenant membership and test cross-user denial first; do not expose token hashes.
3. **Read-only data candidates:** `midad_meme_assets`, `midad_meme_price_snapshots`, `midad_meme_signals`, and a minimal view over `midad_revenue_intel_opportunities`. Apply column minimization, eligibility filters, data licensing review, and server-generated DTOs.
4. **Archive:** `midad_income_sources_audit_20261016` remains internal and read-only unless a specific audit UI is approved.

## 6. Gates still required

- The all-98 source sweep is complete at the literal-reference/static-analysis layer. Remaining: trace dynamic SQL, imported/shared helper behavior, SQL tagged-template queries and runtime RPC indirection in any path selected for live integration.
- Body-level review completed for all 10 matching SQL routines, including revenue-ops status/dispatch, agent-fee reservation/claim, browser evidence/smoke token routines, and store fulfillment completion/enqueue. All inspected routines have a fixed `search_path`; service-role financial/browser/fulfillment routines are not executable by `anon` or `authenticated`.
- A separate approval-routing concern was found in `midad_agent_fee_reserve_request`: it selects `user_id` with `SELECT id FROM public.profiles LIMIT 1` when creating a pending destination approval. This does not bind the approval to the requesting owner and is nondeterministic if multiple profiles exist. Keep the fee flow out of AI Room; repair requires a reviewed owner identity contract and targeted tests.
- No user triggers are attached directly to the 30 target tables. One indirect trigger was found on `public.midad_store_orders`: `trg_midad_enqueue_store_fulfillment` runs after status/paid_at changes, verifies a paid/reconciled intent and a unique matching wallet receipt, and uses `ON CONFLICT (order_id) DO NOTHING` before writing fulfillment jobs/evidence. The trigger and fulfillment RPCs remain outside the AI Room contract.
- Trace all client-facing functions with `verify_jwt=false` to the exact custom auth gate and test missing, expired, revoked, wrong-owner and replayed credentials.
- In a non-production environment, add negative tests for anonymous access, user A reading/writing user B data, queue/secret redaction, idempotent retries, and allowed service-worker operations.
- Only after that propose narrow grants/policies in a separate migration with rollback instructions. No changes were made in this audit.
- Keep model providers, browser automation connectors, signing, withdrawals and live financial actions disabled until every gate passes.

## 7. Explicitly unchanged

No `CREATE POLICY`, `ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY`, `GRANT`, `REVOKE`, schema change, or table-data mutation was performed. PR #100 is still Draft and unmerged. An isolated `ai-room.html` preview file was added to `main` as a direct Pages route; `index.html` SHA `5c2413d82408dd1e4a64693f197efd81727edcb4`, manifest, service worker, and main navigation were not changed. The targeted AI Room deployment consists of new `midad_ai_room_preview` v2 (GET-only 302 to Pages), `midad_ai_room_status` v3 (the original read-only endpoint with a Pages-only CORS allowlist), and `telegram_bot` v97 (additive `/airoom` command; existing menu URL unchanged).

## 8. Live connector decision after the source scan

- Fresh catalog results confirm all 30 listed tables have RLS enabled and zero policies. RLS-enabled/no-policy tables deny ordinary client row access, but this is not a suitable design for an AI Room feature; direct client table access remains prohibited.
- Current `anon`/`authenticated` table grants are broader than needed on `midad_agent_events`, `midad_factory_artifacts`, `midad_factory_learning`, `midad_factory_projects`, `midad_factory_runs`, `midad_human_bridge_pairings`, `midad_human_bridge_sessions`, and `midad_speedbot_fulfillments`. No grant was changed. These grants should be reviewed separately after exact downstream dependencies are reconciled.
- Relevant `SECURITY DEFINER` routines inspected in the catalog fixed `search_path` and had `EXECUTE` for `service_role`/owner, not `anon` or `authenticated`. No RPC from this class is included in the AI Room contract.
- `midad_ai_room_status` is ACTIVE v3 (`verify_jwt=false`, custom Control Room session authentication). It checks the SHA-256 hash and age of an active Control Room session and returns six aggregate counts from standard dashboard tables. Its source has no mutation path and does not query any of the 30 RLS-review target tables. CORS is restricted to `https://sirahwaz.github.io` only. The endpoint does not accept requests without a valid session.
- The published static preview at `https://sirahwaz.github.io/Control-room/ai-room.html` requests a session only after explicit click and only when Telegram Mini App init data exists. No session token is persisted. This direct preview URL was added on its own; `index.html`, PWA manifest and service worker remain unchanged. PR #100 stays Draft because the valid Telegram success path still requires the user's device/session acceptance.

## 9. Live endpoint denial evidence

- Latest workflow `MIDAD AI Room live endpoint denial tests`, run `40052607679`, completed successfully after preview routing was corrected.
- The workflow verified: preview GET → fixed 302 redirect and final `text/html` body containing the Arabic RTL page and connect button; preview POST → `405`; POST to the status endpoint with no token → `401 missing_session`; POST with a fake token → `401 session_expired`; allowed Pages Origin preflight → `204`; unapproved Origin preflight → `403` and no allow-origin header.
- Supabase `function_edge_logs` independently recorded the HTTP results, including preview GET `302`, preview POST `405`, status POST `401`, allowed preflight `204`, and unapproved preflight `403` for status function ID `ea3035a7-0d5e-4f97-a214-a8d6728fbe6f`.
- These tests prove the denial paths and preview route, not a valid Telegram login. The real authorized session success test is still open.

## 10. SQL body and trigger review — follow-up before broader integrations

- The database review covered 10 matching SQL routine definitions and their catalog ACLs/search paths. No routine in this set is called by `ai-room.html` or the new aggregate status endpoint.
- `midad_agent_fee_reserve_request` creates a pending approval using `SELECT id INTO v_user_id FROM public.profiles LIMIT 1`. This does not establish that the approval is assigned to the requesting or intended owner. Treat as a separate approval-routing defect; do not use this financial workflow from AI Room and do not patch it without defining the owner identity source first.
- `midad_claim_agent_fee_payment` checks the exact approval/request link, pending owner approval, Base/USDC restrictions, fee-wallet guard, disabled automatic execution policy, all-in caps and daily/weekly/per-job caps; it then moves the request to `EXECUTING` and records a `PENDING` ledger entry. It remains excluded from the room and live financial actions remain disabled.
- `midad_browser_record_evidence_v1` validates event/state transitions, enforces a bounded retry count, disallows `PAID` state, restricts evidence keys/size/URLs, uses row locking and an event key, and is service-role-only. Smoke token authorization uses SHA-256, expiry and one-shot consumption; cleanup routines are service-role-only, with job cleanup additionally requiring a marked test identity.
- `midad_complete_store_fulfillment` verifies output hash, paid order/payment reconciliation and one unique matching wallet receipt; it is idempotent for an identical already-delivered output hash. `midad_enqueue_store_fulfillment_after_verified_payment` is attached to `midad_store_orders` (outside the 30-table list) and independently verifies paid/reconciled intent + matching receipt before enqueueing; duplicate order enqueue is idempotent.
- `midad_ops.dispatch_revenue_operation` restricts target/action combinations and retrieves its autonomy key server-side from Vault. Catalog ACLs do not grant `anon`, `authenticated`, or `service_role` direct EXECUTE; `midad_ops.revenue_scheduler_status` similarly has no direct EXECUTE grants to these roles. Do not infer they are callable from the frontend.
- Trigger inventory: zero non-internal triggers are attached directly to the 30 target tables. The one indirect trigger found from the reviewed functions is `public.trg_midad_enqueue_store_fulfillment` after updates to `public.midad_store_orders`.


## 11. Isolated preview deployment verification

- GitHub Pages now has the standalone `ai-room.html` file at `/Control-room/ai-room.html`, with exactly the same HTML bytes as the reviewed feature branch. This is an isolated preview path; the main `index.html`, manifest and service worker were verified unchanged.
- Supabase default host does not serve this HTML directly as HTML; its function response was verified to become `text/plain`. The preview function v2 has therefore been reduced to a fixed GET-only 302 redirect with no database client, secret access, or write path.
- Telegram bot v97 adds the `/airoom` command and a web-app button to that Pages URL. Its existing main-menu button still points to the established Control Room URL. Source v96 rollback copy is stored in the branch recovery folder.
- All five CI gates on branch head `ed316c3e4814fe1df7a9c0a11cc43392bff1e9bf` passed. This is not the final release gate: test `/airoom` with an actual Telegram user account and record whether `midad_control_room` issues an authorized session and `midad_ai_room_status` returns the six aggregate counts.
