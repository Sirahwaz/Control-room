# Supabase Access-Control & Security Advisor Review — 2026-11-08

Project: `midad-ai` (`froegigfmpmvtecztfbf`)
Database: PostgreSQL 17.11
Read-only audit date: 2026-11-08
Disposition: No grants, policies, extension placement, secrets, or Auth settings were changed.

## Executive result

The Security Advisor returned three classes of findings:

| Finding | Count | Audit disposition |
|---|---:|---|
| RLS enabled, no policy | 34 | Role grants show deny-by-default for `anon` and `authenticated`; no blanket policies were added |
| Extension installed in `public` | 1 | `pg_net` 0.20.4; function/schema exposure requires API-settings verification before remediation |
| Leaked password protection disabled | 1 | Configuration warning; setting not changed |

## RLS / table-grant review

All 34 tables listed below have RLS enabled and no entries in `pg_policies`. For every listed table, the database reports **no SELECT, INSERT, UPDATE, or DELETE table privilege** for either `anon` or `authenticated`.

### Private model schema (4)

- `midad_private.model_catalog`
- `midad_private.model_discovery_runs`
- `midad_private.model_endpoint_catalog`
- `midad_private.model_recommendations`

Additional boundary: `anon` and `authenticated` have no `USAGE` on `midad_private`. `service_role` also has no direct table privileges in this schema; current model discovery/gateway code uses the server-side database connection rather than a public Data API grant.

### Server-managed public tables (30)

The following tables have no table privileges for `anon` or `authenticated`. `service_role` has SELECT/INSERT/UPDATE/DELETE on the normal service-managed set, except for the two stricter browser tables called out below.

- `midad_account_factory_runs`
- `midad_agent_events`
- `midad_agent_fee_allowlist`
- `midad_agent_fee_ledger`
- `midad_agent_fee_policies`
- `midad_agent_fee_requests`
- `midad_agent_fee_wallets`
- `midad_browser_evidence_ledger`
- `midad_browser_smoke_tokens`
- `midad_factory_artifacts`
- `midad_factory_learning`
- `midad_factory_projects`
- `midad_factory_runs`
- `midad_human_bridge_pairings`
- `midad_human_bridge_sessions`
- `midad_income_sources_audit_20261016`
- `midad_meme_assets`
- `midad_meme_paper_trades`
- `midad_meme_price_snapshots`
- `midad_meme_scan_runs`
- `midad_meme_signals`
- `midad_platform_account_events`
- `midad_platform_accounts`
- `midad_revenue_intel_evidence`
- `midad_revenue_intel_opportunities`
- `midad_revenue_intel_runs`
- `midad_revenue_intel_work_queue`
- `midad_speedbot_fulfillments`
- `midad_store_fulfillment_evidence`
- `midad_store_fulfillment_jobs`

Special restrictions:
- `midad_browser_evidence_ledger`: RLS + FORCE RLS; service role has SELECT only, no direct INSERT/UPDATE/DELETE.
- `midad_browser_smoke_tokens`: RLS + FORCE RLS; no table-level SELECT/INSERT/UPDATE/DELETE for `anon`, `authenticated`, or `service_role`.

### Interpretation

These 34 Advisor lints are not evidence of public row exposure by themselves. The actual privilege checks show that `anon` and `authenticated` cannot directly access the tables, while RLS with no policies denies row access by default. The current design appears deliberately service-only/deny-by-default. **Do not add public or broad authenticated policies merely to silence the Advisor.**

The application access path still needs review before any table-level grants or RLS policies are changed. Some privileged code may use direct PostgreSQL connections or narrow SECURITY DEFINER RPCs.

## pg_net extension — pending exposure check

Observed facts:
- Extension: `pg_net` 0.20.4, extension namespace `public`.
- Functions are in schema `net`: `http_get`, `http_post`, `http_delete`, `http_collect_response`.
- `anon` and `authenticated` currently have `USAGE` on schema `net` and `EXECUTE` on those HTTP functions.
- `net` is a custom schema. The database-session settings inspected here did not expose the live PostgREST `db-schemas` list, so this audit cannot confirm whether `net` is included in the project's Exposed Schemas.

Risk classification: **PENDING**. If `net` is exposed through the Data API, the public grants could permit client-triggered outbound HTTP requests. If it is not exposed, the function grants alone do not establish a browser-callable API path.

Required verification before remediation:
1. Inspect Dashboard → Integrations → Data API → Exposed Schemas.
2. Confirm whether `net` is absent. If it is present, remove it from the exposed list unless an explicit client-facing use case exists.
3. Then review/revoke unnecessary `USAGE` and `EXECUTE` from `anon`/`authenticated`, while preserving required service-side `pg_net` jobs and functions.
4. Re-run Security Advisor and verify existing cron/webhook jobs still work.

Do **not** move the extension or revoke function privileges until dependencies, cron jobs, and deployed Edge Functions have been inventoried.

Official references:
- Supabase custom schemas / exposed schemas: https://supabase.com/docs/guides/api/using-custom-schemas
- Securing Supabase data and server-side access: https://supabase.com/docs/guides/database/secure-data

## Auth leaked-password protection

Advisor warning: leaked-password protection is disabled. No Auth setting was changed. Before enabling it, verify whether password-based Supabase Auth is used by any current client or bot flow and confirm plan/feature availability. If enabled, test signup/password-change flows and keep Telegram-native login paths unaffected.

## Verification queries

The audit used read-only catalog checks for:
- `pg_class.relrowsecurity` and `relforcerowsecurity`
- `has_table_privilege` for `anon`, `authenticated`, and `service_role`
- `pg_policies`
- `has_schema_privilege`
- `pg_proc` / `has_function_privilege` for `net.http_*`
- `pg_extension` / extension namespace

No INSERT, UPDATE, DELETE, GRANT, REVOKE, migration, extension move, or Auth configuration change was executed.
