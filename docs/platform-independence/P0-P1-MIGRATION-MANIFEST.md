# MIDAD Platform Independence — P0 Inventory & P1 Preparation

**Date:** 2026-11-03  
**Hosting:** Hybrid  
**Budget ceiling:** Zero (free resources only)  
**Production safety:** Supabase remains the active production backend. No pause, deletion, DNS change, traffic cutover, paid resource, new database, or secret export is authorised by this document.

## Executive result

P0 was performed against Supabase project midad-ai (froegigfmpmvtecztfbf) and GitHub repository Sirahwaz/Control-room.

| Area | Verified live inventory |
|---|---:|
| Supabase project | ACTIVE_HEALTHY |
| PostgreSQL | 17.11 |
| Public tables | 152 |
| Auth tables | 27 |
| Database routines (all non-system schemas) | 160 |
| Public routines | 38 |
| Views | 5 |
| Public triggers | 11 |
| Supabase Edge Functions | 100 ACTIVE |
| Applied DB migrations | 141 |
| Cron jobs | 27 (19 active / 8 inactive) |
| Installed extensions | 7 |
| Storage buckets / objects | 0 / 0 |
| Realtime publication tables | 0 |
| Auth users | 1 (count only; no user data exported) |
| Vault secret records | 12 (count only; values not read or exported) |
| RLS-enabled public tables with no policy rows | 30 |

Installed extensions: pg_cron, pg_net, pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp.

### Important interpretation

- The 30 RLS-enabled tables without policies are treated as possible intentional deny-by-default controls until grants, owners, callers and access paths are reviewed. Do not add policies or grants as part of portability work.
- Zero Storage buckets and zero Realtime publication tables reduce those migration lanes, but do not prove application code has no Storage or Realtime SDK references. Code-level search remains required.
- Vault contains 12 secret records. Their names/values are not included here. Never copy secrets into Git, issue comments, migration artifacts or client-side code.
- The project is healthy now; migration is not a reason to interrupt it.

## P0 — repository parity and portability risks

The repository already contains a provider adapter contract (MIDAD_PROVIDER_ADAPTER_CONTRACT.md) and a function registry (MIDAD_FABRIC_REGISTRY.md). Preserve and extend these rather than creating a parallel architecture.

Live-vs-repository parity gaps found:
- Live database reports 141 applied migrations; the repository's supabase/migrations directory currently lists 11 SQL files. This is a material migration-history drift risk. The 11 repository files are not a complete replacement for the live migration history.
- Live Supabase has 100 ACTIVE Edge Functions; supabase/functions currently lists 24 top-level entries (including shared/test directories). This is not a complete source-parity guarantee.
- The existing MIDAD_FABRIC_REGISTRY.md is dated 2026-09-30 and is stale relative to the live 2026-11-03 inventory.
- The frontend is static/mobile-first and directly embeds Supabase function endpoints in at least midad-control-v2.js and midad-browser.js. Those endpoint references are migration seams to centralise behind a MIDAD Gateway, not to replace in one pass.

## P1 — target architecture (zero-cost preparation only)

    Web / Android / Telegram clients
                 |
           MIDAD API Gateway
                 |
       +---------+----------+----------------+
       |                    |                |
    PostgreSQL adapter   Auth adapter   Service/worker adapter
       |                    |                |
    PostgreSQL DB       Independent IdP   Portable containers
       |                                     |
       +----------- Event / Queue adapter ---+
                           |
                   Scheduler adapter
                           |
              S3-compatible storage adapter

Keep interfaces provider-neutral:
1. Database/repository: transactions, migrations, health, backup/restore, idempotency.
2. Auth: user identity, JWT validation, claims, session lifecycle, MFA and service identity.
3. Functions/services: HTTP contracts, request IDs, timeouts, bounded retries, health checks.
4. Scheduler: durable schedules, execution history, retry policy and pause/resume.
5. Queue/events: idempotency keys, delivery semantics, dead-letter handling and replay.
6. Secrets: external secret provider, least privilege, rotation and audit; no secret values in app config.
7. Storage: object metadata, signed URL semantics, lifecycle and checksum verification.

### Candidate deployment shape

- Database: managed PostgreSQL free tier only if current quota, expiry, backups and connection limits are acceptable; otherwise defer provisioning.
- API/workers: portable Docker services on an already available free host, only after checking its actual project/instance allowance.
- Auth: retain Supabase Auth during early database portability work; extract behind an adapter before selecting an independent IdP.
- Storage: no replacement required until P0 code search proves an object-storage dependency.
- Queue/scheduler: do not introduce Redis or another paid service. First classify current pg_cron + pg_net workloads and test a Postgres-backed/worker alternative.
- MIDAD Gateway: the first code seam to introduce, while existing Supabase URLs remain the configured provider.

No provider is provisioned or selected as a production destination in this phase.

## P1 execution sequence

1. **P1.1 Source parity:** export a safe inventory of all 100 deployed function slugs, versions, JWT modes and source hashes; compare with the repository. Retrieve source through authenticated project tooling only. No secret values.
2. **P1.2 Migration parity:** reconcile all 141 applied migration versions with the 11 repository SQL files. Obtain a schema-only baseline from the live catalog; preserve function definitions, triggers, indexes, constraints, policies, grants and ownership separately. Do not replay migrations against production.
3. **P1.3 Dependency map:** search all frontend, mobile, Edge Function and SQL sources for Supabase URL/SDK use, Auth, Storage, Realtime, Vault, pg_cron, pg_net, RPC and service-role assumptions.
4. **P1.4 Reproducible baseline:** prepare a schema-only export and checksums locally/in a controlled artifact; exclude auth credentials, vault data, user data and private records unless separately approved and protected.
5. **P1.5 Free-tier cost gate:** compare current vendor free limits and expiry/backup policies. No resource creation until the complete monthly cost is demonstrably zero.
6. **P1.6 Shadow target:** only after a zero-cost target is confirmed, create a disposable schema/test environment; restore schema first, then run parity tests. No production writes or dual-write yet.

## Migration acceptance gates

A migration lane is not eligible for cutover until:
- Schema object counts and definitions match.
- Primary/foreign keys, indexes, constraints, grants and RLS semantics are verified.
- Function contracts and auth claims pass regression tests.
- Scheduler jobs have one owner only; no duplicate execution.
- Payment verification, webhook idempotency and fulfillment are tested in dry-run mode.
- Row counts/checksums reconcile for approved datasets.
- Backup and restore are tested, and rollback is rehearsed.
- Canary reads pass before any writes or user traffic move.

## Explicit non-actions

- Supabase was not paused, modified or deleted.
- No database, branch, hosting project, storage bucket, queue or paid resource was created.
- No DNS, frontend endpoint, production secret or environment variable was changed.
- No production data or secret value was exported.
- No live payment, wallet signing, transfer, withdrawal or trading action was performed.

## Current state

- **P0 live inventory:** VERIFIED.
- **Repository parity:** PARTIALLY VERIFIED; material migration/function source gaps exist.
- **P1 architecture and gates:** PREPARED.
- **Zero-cost target provisioning:** PENDING; no suitable new destination has yet been verified as available at zero cost.
- **Production cutover:** BLOCKED by design until all acceptance gates pass.
