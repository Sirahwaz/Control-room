# MIDAD Supabase RLS review — AI Room integration gate

**Review date:** 2026-10-24  
**Project:** `midad-ai` (`froegigfmpmvtecztfbf`)  
**Scope:** 30 tables reported by the Supabase security advisor as `rls_enabled_no_policy`.  
**Status:** Read-only table/RLS review. No policies, GRANT/REVOKE, schema, or table data were changed. AI Room has a standalone Pages preview path and three targeted function deployments: `midad_ai_room_preview` v2 fixed redirect, `midad_ai_room_status` v3 read-only aggregate endpoint, and `telegram_bot` v97 additive `/airoom` command. No finance/wallet automation was added.

## Executive finding

All 30 tables have RLS enabled and no policies. For ordinary `anon`/`authenticated` API roles, that normally means row access is denied by RLS even where table grants exist. This is a **fail-closed access state**, not evidence of an observed data leak. However, several tables grant broad table privileges to `anon` and/or `authenticated`; those grants are unnecessary exposure surface and would become consequential if a permissive policy were added later. `service_role` bypasses RLS and must remain server-side only.

The AI Room UI does not query these 30 tables. Its separate `midad_ai_room_status` v3 endpoint reads only six aggregate counts from other dashboard tables, verifies an active Control Room session, allows only the GitHub Pages origin, and contains no write path. A standalone `ai-room.html` preview is present on Pages; the homepage/PWA entry point is untouched. Broader direct table/agent/financial connectors remain disabled until their own contracts, policy tests, and rollback plans pass.

## Evidence inspected

- Supabase security advisor: 30 `rls_enabled_no_policy` findings, observed 2026-10-23 23:30:47 UTC.
- Read-only catalog inspection: table columns, primary/foreign-key metadata via the project table inventory; table comments where present; `pg_policies`; `information_schema.role_table_grants`; and read-only scans of database function source for references to the candidate table names.
- Grants observed for selected tables are summarized below. No policy SQL was executed or modified.
- Application source check: completed literal-reference/static scan of all 98 deployed Edge Functions, recording `verify_jwt`, table names, `.rpc(...)`, `functions.invoke(...)`, service-role/auth markers, database writes, and outbound `fetch`. No function source retrieval failed. Dynamic SQL, generated identifiers, imported helpers and runtime dispatch remain possible indirect edges and must be traced for any new integration.
- SQL body check: inspected all 10 database routine definitions matching the 30 target table names and inventoried non-internal triggers on the target tables. Zero non-internal triggers attach directly to the 30 target tables. One indirect trigger on `public.midad_store_orders` calls `midad_enqueue_store_fulfillment_after_verified_payment`, which writes fulfillment jobs/evidence only after paid/reconciled intent and unique matching receipt checks.

## Classification and integration disposition

Classification is preliminary and based on table names, comments, columns, grants, and likely data sensitivity. “Internal” means service/RPC-only by default, not “safe for direct browser access.”

### A. Strictly internal / service-only by default

| Table | Reason / required disposition |
|---|---|
| `midad_agent_events` | Internal agent event stream; payload may contain operational details. Keep service/RPC-only. |
| `midad_agent_fee_allowlist` | Financial destination allowlist; owner approval and evidence are sensitive. |
| `midad_agent_fee_ledger` | Financial/transaction ledger; never expose direct client writes. |
| `midad_agent_fee_policies` | Controls auto-payment limits and destinations; privileged configuration only. |
| `midad_agent_fee_requests` | Fee requests, recipients, approvals and transaction hashes; privileged workflow only. |
| `midad_agent_fee_wallets` | Wallet addresses and secret-name references; server-side only. |
| `midad_browser_evidence_ledger` | Append-only browser evidence metadata; keep server-side and preserve integrity. |
| `midad_browser_smoke_tokens` | One-shot smoke-token digests and expiry state; server-side only. |
| `midad_factory_artifacts` | Artifact URIs and verification metadata; use an authenticated, owner-scoped API/view if surfaced. |
| `midad_factory_learning` | Internal learning/reward records with tenant/product scope; do not expose global rows directly. |
| `midad_factory_runs` | Execution inputs, decisions, artifacts and errors; service/RPC-only unless a verified owner scope is added. |
| `midad_income_sources_audit_20261016` | Historical audit/archive snapshot; read-only internal access by default. |
| `midad_meme_paper_trades` | Paper-trading records and trade sizing; no live trading. Keep internal unless ownership is explicitly modeled. |
| `midad_meme_scan_runs` | Scanner run state and operational errors; internal. |
| `midad_platform_account_events` | Onboarding/policy audit trail; internal. |
| `midad_platform_accounts` | External account references, credential-vault references, payout/verification snapshots; highly sensitive. Never expose directly. |
| `midad_revenue_intel_evidence` | Evidence excerpts and research metadata; expose only through reviewed, filtered API/view if required. |
| `midad_revenue_intel_runs` | Research run summaries/errors; internal. |
| `midad_revenue_intel_work_queue` | Instructions and work results; internal worker queue. |
| `midad_speedbot_fulfillments` | Fulfillment inputs/outputs and payment timing; service-side only. |
| `midad_store_fulfillment_evidence` | Order/fulfillment evidence; internal and integrity-sensitive. |
| `midad_store_fulfillment_jobs` | Order/payment intent IDs, input snapshots, delivery output; internal. |

### B. User-scoped only if the product explicitly exposes these capabilities

| Table | Required boundary before any client access |
|---|---|
| `midad_account_factory_runs` | Has account/run identifiers and input/output payloads. Confirm account ownership relation; otherwise service-only. |
| `midad_factory_projects` | Has `owner_user_id` and `tenant_key`; if shown in UI, scope every operation to authenticated `auth.uid()` and validated tenant membership. |
| `midad_human_bridge_pairings` | Has `owner_user_id` and pairing-code hash; prefer RPC-only pairing, short expiry, single-use, and no direct token/hash reads. |
| `midad_human_bridge_sessions` | Has `owner_user_id` and token hash; prefer server-mediated session lifecycle, owner checks and revocation. Never return token hashes. |
| `midad_meme_assets` | Market-data candidate for read-only access through a narrow view/API; no client writes. Confirm data licensing and columns before exposing. |
| `midad_meme_price_snapshots` | Market-data candidate for filtered read-only view/API; no client writes. |
| `midad_meme_signals` | Candidate for filtered read-only signals view/API; do not expose raw internal evidence unless reviewed. |
| `midad_revenue_intel_opportunities` | Potential user-facing opportunity feed, but includes payout proof, region/KYC gates and financial scoring. Use a minimal view/API and explicit eligibility filtering; no direct table writes. |

**Do not add policies automatically** to the tables above. If a user-facing feature is approved, first define its data contract and ownership model, then add the narrowest `SELECT`/mutation policy and test cross-user denial.

## High-priority grant review

Catalog grants showed broad table privileges for `anon` and `authenticated` on these no-policy tables:

- `midad_agent_events`
- `midad_factory_artifacts`
- `midad_factory_learning`
- `midad_factory_projects`
- `midad_factory_runs`
- `midad_human_bridge_pairings`
- `midad_human_bridge_sessions`
- `midad_speedbot_fulfillments`

RLS currently denies ordinary row access because no policies exist, but broad grants are still avoidable risk. Before adding any policies, inspect migrations, RPCs, Edge Functions, triggers and client references; then propose least-privilege `REVOKE` changes and test them in a migration/preview environment. Do not apply grants or revokes in production as part of this read-only review.

Most other listed tables showed service-role-only grants or narrower grants. Service-role access remains privileged and bypasses RLS.

## Thirty-table inventory

`midad_account_factory_runs`, `midad_agent_events`, `midad_agent_fee_allowlist`, `midad_agent_fee_ledger`, `midad_agent_fee_policies`, `midad_agent_fee_requests`, `midad_agent_fee_wallets`, `midad_browser_evidence_ledger`, `midad_browser_smoke_tokens`, `midad_factory_artifacts`, `midad_factory_learning`, `midad_factory_projects`, `midad_factory_runs`, `midad_human_bridge_pairings`, `midad_human_bridge_sessions`, `midad_income_sources_audit_20261016`, `midad_meme_assets`, `midad_meme_paper_trades`, `midad_meme_price_snapshots`, `midad_meme_scan_runs`, `midad_meme_signals`, `midad_platform_account_events`, `midad_platform_accounts`, `midad_revenue_intel_evidence`, `midad_revenue_intel_opportunities`, `midad_revenue_intel_runs`, `midad_revenue_intel_work_queue`, `midad_speedbot_fulfillments`, `midad_store_fulfillment_evidence`, `midad_store_fulfillment_jobs`.

## Required gates before AI Room integration

1. Produce an exact call graph for each candidate table: client JS, Edge Functions, SQL/RPC, triggers, scheduled jobs, and worker usage.
2. Confirm role grants and function execution grants; audit every `SECURITY DEFINER` function for fixed `search_path`, explicit authorization, and minimal return data.
3. Choose the access pattern per feature: service-only, narrow RPC/view, or owner-scoped table policy. Do not mix patterns implicitly.
4. Add tests proving authenticated owner A cannot read or mutate owner B's rows; anonymous access is denied; service jobs retain only required privileges; token hashes, wallet/credential references and payment data never reach client payloads.
5. Test rollback in a non-production environment and verify the current application paths remain functional.
6. Keep model providers, browser automation, financial connectors, signing, withdrawals, and live financial actions disabled until all gates pass.

## Other security-advisor findings (not changed)

- `pg_net` extension installed in `public` schema.
- Supabase Auth leaked-password protection disabled.

These are separate follow-ups; neither was changed during this review.


## SQL body-level finding — fee approval routing

The body of `public.midad_agent_fee_reserve_request(jsonb)` contains a confirmed ownership-routing concern when a new destination needs approval: it selects an arbitrary `profiles.id` with `SELECT id INTO v_user_id FROM public.profiles LIMIT 1` and uses that value for the pending `midad_approvals.user_id`. There is no order or relationship check tying that ID to the requesting owner. The function's EXECUTE ACL is restricted to `service_role` (not `anon`/`authenticated`), and this workflow is not used by AI Room, but a privileged caller can still create an approval assigned to the wrong profile. Remediate separately by defining the trusted owner identity source (not by accepting an arbitrary client-supplied UUID), then add multi-profile tests for correct approver routing, cross-user denial, idempotency and disabled auto-execution. No code or data was changed for this finding.

## SQL function and trigger boundary findings

- All 10 inspected SQL routines use fixed `search_path`; the reviewed `SECURITY DEFINER` routines did not grant EXECUTE to `anon` or `authenticated`.
- The agent fee claim path requires the precise pending approval/request match and has caps/guard checks, but it still creates an `EXECUTING` request and `PENDING` fee ledger item. It remains outside AI Room.
- The browser evidence routine restricts state transitions, disallows `PAID`, validates event keys/evidence shape/URLs, and is service-role-only. One-shot smoke tokens are digest/expiry/consumption checked.
- The store fulfillment trigger is on `public.midad_store_orders`, outside the 30 target set. It checks paid/reconciled payment intent and a unique matching receipt before enqueueing, and does not expose a client endpoint.


## Current deployment and release gate
- Preview URL: `https://sirahwaz.github.io/Control-room/ai-room.html` (isolated static route, not linked from the homepage).
- Active targeted deployments: `midad_ai_room_preview` v2, `midad_ai_room_status` v3, `telegram_bot` v97. The Telegram addition leaves the original menu URL unchanged and has a source rollback snapshot for v96.
- Live CI proves the preview route, POST denial, missing/fake session denial and CORS allowlist. It does not prove a valid Telegram session; keep PR #100 Draft until device-based positive login is observed.
