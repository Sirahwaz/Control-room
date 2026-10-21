# MIDAD Browser Agent Gateway — source snapshot

- Source: Supabase Edge Function midad_browser_agent_gateway.
- Deployed version observed: **3**, status **ACTIVE**, checked 2026-10-22.
- The repository files index.ts and ledger.ts matched the deployed implementation byte-for-byte at inspection time.
- Read-only comparison of the four live browser ledger/smoke-auth RPC function bodies matched the repository migration source exactly.
- This repository work did **not** deploy or alter the Supabase function or database schema.

## Verification coverage

- Deno tests cover URL sanitization, event/state normalization, strict evidence allowlisting, and deterministic idempotency-key generation.
- CI applies the existing browser evidence-ledger and smoke-auth SQL migrations to a disposable PostgreSQL 17 service, then runs the SQL contract test against that isolated database.
- The SQL contract test covers evidence persistence, URL redaction, idempotent replay, invalid state transitions, the self-asserted PAID guard, one-shot smoke-token behavior, and exact test-row cleanup.
- CI verifies the disposable database returns to its initial row-count baseline.
- CI also sends one unauthenticated POST to the live gateway using only { action: capabilities } and expects HTTP 401 with an unauthorized response. No credentials or production data are sent; the gateway's auth guard should reject the request before client initialization or any action.

## Limitations and deployment guardrails

- These checks do **not** prove an authorized end-to-end HTTP request, valid ingest-key/JWT authorization, a live Supabase REST/RPC round trip, or production schema parity beyond the read-only function-body comparison.
- The PostgreSQL fixture is deliberately minimal and is a test harness, not a replacement for the full Supabase auth/database environment.
- No browser job, persistent production row, financial action, or persistent service was created or enabled by these tests.
- Do not deploy this mirror automatically. Before any future deployment, compare both source files against the current live function, review changes, run the suite, and use an isolated Supabase project for authorized gateway HTTP integration tests.
