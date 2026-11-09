# MIDAD Browser Agent Gateway — source snapshot

**Last reconciled:** 2026-11-09  
**Canonical production object:** Supabase Edge Function `midad_browser_agent_gateway`  
**Observed deployment:** ACTIVE, version **16**

## Source parity — VERIFIED on 2026-11-09

A read-only fetch of the deployed Supabase Edge Function showed:

- Deployed `index.ts` was not byte-identical to the repository's prior `index.ts` mirror.
- Deployed `ledger.ts` was byte-identical to the repository's `ledger.ts`.
- This branch replaces only the repository mirror of `index.ts` with the source fetched from deployed version 16. The ledger helper is preserved unchanged.
- The fetched deployed `index.ts` and both repository files were read back and compared byte-for-byte after the source update; both comparisons returned exact equality.
- A high-confidence static scan of the fetched gateway source found no private-key, GitHub-token, OpenAI-key, Supabase-secret, or literal Bearer-token pattern. This is a heuristic source scan, not a general secret-free guarantee.

This is **source reconciliation only**. It does not deploy, restart, reconfigure, or otherwise modify the live Supabase Edge Function.

## Gateway contract and verification coverage

- The deployed v16 gateway exposes the owner-scoped browser bridge operations: capabilities, list sessions, queue a bounded command, and retrieve a sanitized result. It also exposes a JSON-RPC/MCP bridge for the same bounded capabilities.
- The gateway resolves the user's session token server-side and enforces owner scoping. Browser work is accepted only through the authenticated user bridge; private ingest/service credentials remain server-side.
- Deno tests cover URL sanitization, event/state normalization, strict evidence allowlisting, and deterministic idempotency-key generation.
- CI applies the browser evidence-ledger and smoke-authorization migrations to a disposable PostgreSQL 17 database, runs the SQL contract test, and verifies cleanup to the fixture baseline.
- CI sends one unauthenticated request to the live gateway and expects HTTP 401. That test demonstrates rejection of an unauthenticated request; it does not verify an authenticated production request or a live browser session.

## Runtime and deployment limits

- The existing `midad_browser_gateway_smoke_runner` is intentionally disabled after its previous one-shot integration test. Do not reactivate it for routine testing.
- The Python Playwright Operator Worker remains a separate runtime process. A healthy gateway does not imply a live worker, fresh heartbeat, authenticated browser session, or successful external task.
- The current worker/provider heartbeat must be checked independently against the 45-second freshness threshold.
- The repository copy of `index.ts` and `ledger.ts` now mirrors the deployed v16 source as of the date above. Recheck parity before any future deployment because production may advance independently.
- These checks do not prove complete production database-schema parity, successful authorized browser execution, persistent encrypted session storage, a deployed Proxy, or a complete Vault.

## Deployment guardrails

- Do not deploy a repository mirror automatically.
- Before a future production deployment: reconcile the exact deployed source, review the complete diff, run the Deno and disposable PostgreSQL suites, validate required schema/RPC compatibility in an isolated project, and prepare a rollback.
- No Supabase function deployment, database migration, production job creation, browser session, financial action, or credential change is included in this source-parity repair.
