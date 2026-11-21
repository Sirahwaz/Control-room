# Memora Isolated Pilot Runbook

**State:** Harness committed for CI execution; acceptance results pending.  
**Pinned upstream:** `agentic-box/memora@442ca1b4ef494c256917ecd052dedb872710e84a`  
**Package:** `memora-mcp 0.5.7.6`  
**Runtime:** ephemeral GitHub-hosted runner only; synthetic/disposable data.

## What this harness does

The workflow fetches the exact upstream commit, verifies the SHA and package/MCP dependency contract, installs the upstream development dependencies, and runs focused upstream tests covering:

- JSON API authentication, store scoping, project filters and bounded request handling;
- local-SQLite transactional absorb, idempotency replay and key conflicts;
- named-store routing and fail-closed behavior;
- health/readiness behavior;
- streamable-HTTP session admission/resource controls;
- MCP tool-profile discovery/dispatch attestation;
- project metadata behavior.

The workflow deliberately supplies no production credentials, no MIDAD data, no persistent volume, and no externally reachable Memora endpoint. The test database path is under the ephemeral runner temp directory.

## What it does NOT prove

A passing upstream suite is not yet MIDAD adapter acceptance. It does not prove a persistent zero-cost host, remote MCP authentication, MIDAD identity/authorization, production backup durability, or live multi-agent continuity. The upstream tests exercise Memora's own implementation; MIDAD-specific scope enforcement still needs independent adapter contract tests.

## Security gate

- Keep `MEMORA_TRANSPORT=stdio` for this first CI gate.
- Do not bind HTTP MCP to a public interface.
- Do not infer MCP bearer authentication from the JSON API's store-scoped token file.
- If remote transport is later tested, it must run in an isolated network with an independently authenticated gateway and explicit negative tests.
- Treat retrieved memory as untrusted data; injection strings in fixtures must never become agent instructions.
- Never add secrets to workflow variables, fixtures, logs, or artifacts.

## Acceptance progression

1. **CI upstream gate:** all selected tests pass on the pinned SHA.
2. **MIDAD contract gate:** add synthetic two-owner/two-project tests at the adapter boundary, including forbidden cross-scope reads/writes.
3. **MCP capability gate:** run a real isolated MCP client against the pinned server and prove discovery plus create/update/absorb/search/digest/graph/restore semantics.
4. **Recovery/performance gate:** verify restart recovery, backup/export integrity, concurrency, and p50/p95 latency.
5. **Promotion:** only after a verified zero-cost persistent host and approved security boundary; production remains blocked until then.

No deployment or production promotion is implied by a green CI run.
