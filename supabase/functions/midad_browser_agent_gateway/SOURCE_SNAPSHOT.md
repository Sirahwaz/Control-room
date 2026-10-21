# MIDAD Browser Agent Gateway — source snapshot

- Source: Supabase Edge Function midad_browser_agent_gateway.
- Deployed version observed: **3**, status **ACTIVE**, checked 2026-10-22.
- The repository files index.ts and ledger.ts matched the deployed implementation byte-for-byte at inspection time.
- This repository work did **not** deploy or alter the Supabase function.

## Verification coverage

- Deno tests exercise URL sanitization, event/state normalization, strict evidence allowlisting, and deterministic idempotency-key generation.
- CI applies the existing browser evidence-ledger and smoke-auth SQL migrations to a disposable PostgreSQL 17 service, then runs the existing SQL contract test against that isolated database.
- The SQL contract test covers evidence persistence, URL redaction, idempotent replay, invalid state transitions, the self-asserted PAID guard, one-shot smoke-token behavior, and exact test-row cleanup.
- CI verifies the disposable database returns to its initial row-count baseline. It does not connect to the live Supabase project and has no production credentials.

## Limitations and deployment guardrails

- This test suite does **not** prove end-to-end HTTP behavior of the deployed Edge Function, production JWT/ingest-key authorization, a live Supabase RPC round trip, or production schema parity.
- The PostgreSQL fixture is deliberately minimal and is a test harness, not a replacement for the full Supabase auth/database environment.
- No real browser job, production row, financial action, or persistent service was created or enabled by these tests.
- Do not deploy this mirror automatically. Before any future deployment, compare both source files against the current live function, review changes, run the suite, and use an isolated Supabase project for gateway HTTP integration tests.
