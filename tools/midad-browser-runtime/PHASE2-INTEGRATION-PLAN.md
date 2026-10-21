# MIDAD Browser Mesh — Phase 2 integration test plan

## Current environment audit (2026-10-22)
- Supabase project `midad-ai` (`froegigfmpmvtecztfbf`) is ACTIVE_HEALTHY.
- `midad_browser_agent_gateway` is ACTIVE, version 3. Its source exposes `capabilities`, `create_job`, `get_job`, `list_jobs`, `record_event`, `complete_human_gate`, and `block`.
- The existing `midad_browser_gateway_smoke_runner` is deliberately inert (HTTP 410); do not re-enable it for this phase.
- Read-only SQL inspection returned 0 rows in `midad_browser_jobs`, 0 in `midad_browser_evidence_ledger`, and 0 job-linked rows in `midad_agent_events`. No task was created.
- No Remote Desktop Commander device is connected. No persistent Playwright runtime has been established in the current session.
- The repository is public; GitHub-hosted Actions can provide a no-personal-session browser runtime, subject to GitHub's current usage limits. The browser-only smoke test must not require Supabase credentials.

## Important gateway contract
The ledger sanitizer accepts only its explicit evidence schema. Use `navigation_observed` (not an invented event name), `duration_ms`, `bytes_read`, `http_status`, `content_type`, `source_kind`, and a top-level `content_sha256`. Do not send page text, page title, cookies, storage state, credentials, or unrecognized evidence fields to the ledger. A live `record_event` test requires an already-authorized test job ID; do not call `create_job` against production merely to test the worker.

## Stage A — browser-only live smoke (no secrets, no Supabase writes)
Run manually in a disposable GitHub-hosted runner:
1. Install Python and Playwright Chromium.
2. Navigate to `https://example.com/` with an allowlist containing exactly `example.com`.
3. Assert HTTPS, HTTP 200, expected page heading, and non-empty bounded body text.
4. Assert that `http://example.com`, `https://example.com.attacker.test`, a non-default port, embedded URL credentials, private/localhost destinations, and wildcard allowlists are rejected.
5. Use local fake pages/route handlers to prove that a redirect or subresource to a non-allowlisted host is aborted; do not probe internal IPs or metadata services.
6. Exercise navigation timeout and cancellation with a local controlled test fixture, and assert browser/context cleanup.
7. Upload only test summaries, never page content or environment variables.

## Stage B — gateway contract (must remain gated)
Prerequisites:
- Confirm a non-production Supabase project or explicitly isolated disposable test schema.
- Use a short-lived least-privilege test credential stored only as an Actions secret; never echo it.
- Create one uniquely tagged test job only in the isolated environment. If no isolated environment exists, stop rather than create a production job.
- Call `record_event` twice with the same explicit idempotency key and identical payload; verify the second event is idempotent and ledger row count does not increase.
- Verify unsupported event/state, malformed SHA-256, HTTP URL, and invalid host evidence are rejected before persistence.
- Verify `HUMAN_GATE` pauses; `complete_human_gate` resumes only an existing test job and is idempotent on replay.
- Test `FAILED` and `CANCELLED` paths; confirm no `PAID` state can be asserted by the generic browser event endpoint.
- Record baseline counts, run the test, delete/expire only the test-owned job using the approved cleanup mechanism, and verify counts return to baseline. Do not delete unrelated rows.
- Never enable a queue consumer, cron, persistent service, payment path, or external publication as part of these tests.

## Acceptance checklist
- [ ] Live Chromium browser-only smoke passes on a disposable runner.
- [ ] Allowlist, HTTPS, redirects, methods, timeouts, cancellation and cleanup are demonstrated in the real browser.
- [ ] Gateway event payload matches the ledger sanitizer's explicit schema.
- [ ] Idempotency is verified against an isolated gateway database.
- [ ] Human-gate resume is verified against an isolated job.
- [ ] Test-created rows return to baseline.
- [ ] No production job, personal browser session, paid provider, financial action or external publication was used.

## Free phone-only fallback
The user has Android only and no connected remote desktop. Preferred path is a manually dispatched GitHub Actions run in this public repository; it uses a temporary GitHub-hosted Linux runner, not the phone's local Android OS, and requires no paid browser provider for a public-repository test subject to current GitHub limits. Termux can run Python policy/unit tests, but native Android Chromium support for Playwright is not a dependable substitute for the Linux Chromium runtime. Do not ask the user to install random APKs or paste secrets into chat.

## Status
The unit tests run with fakes. A real Chromium run and isolated live Gateway integration have NOT yet been executed. This plan does not claim either has passed.
