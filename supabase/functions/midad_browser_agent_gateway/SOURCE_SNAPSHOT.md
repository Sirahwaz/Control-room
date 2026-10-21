# MIDAD Browser Agent Gateway — source snapshot

- Source: Supabase Edge Function midad_browser_agent_gateway.
- Deployed version observed: **3**, status **ACTIVE**, checked 2026-10-22.
- The repository files index.ts and ledger.ts match the currently deployed version byte-for-byte at the time of inspection.
- This snapshot did **not** deploy or modify the Supabase function.

## Scope and limitations

- Offline Deno tests exercise the pure ledger helper functions: URL sanitization, event/state normalization, evidence allowlisting, and deterministic event-key generation.
- These tests do not prove database RPC behavior, endpoint authorization against live Supabase, idempotent persistence, human-gate resume, or row cleanup.
- Tests do not use credentials, request headers, page content, cookies, storage state, or a live Supabase connection.
- Do not deploy this mirror automatically. Before a future deployment, compare both files against the current live function, review changes, run the suite, and use an isolated project for integration tests.
