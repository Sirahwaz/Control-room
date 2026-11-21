# MIDAD Collective Memory — Memora Adoption Decision

**Decision date:** 2026-11-21  
**Decision status:** APPROVED FOR ISOLATED PILOT; PRODUCTION ADOPTION PENDING ACCEPTANCE  
**Canonical repository:** `Sirahwaz/Control-room`  
**Upstream candidate:** [agentic-box/memora](https://github.com/agentic-box/memora)  
**Observed upstream package version:** `memora-mcp 0.5.7.6` (source inspected; pin an immutable release/commit before pilot)

## 1. Decision

Adopt Memora as the **candidate shared knowledge-memory engine** for MIDAD agents, subject to an isolated pilot and the acceptance gates in this record.

This is an incremental integration, not a rebuild. Preserve the existing MIDAD Control Room, agent registry, Factory Governor, model/provider routing, Supabase gateways, and Continuity Ledger. Memora must not become a competing orchestrator, job queue, identity provider, or financial authority.

Production adoption is not claimed by this decision. No Memora service has been deployed or connected to a live MIDAD runtime by this change.

## 2. Existing MIDAD components to preserve

Source inspection found these existing foundations:

- `mobile/factory/x/agents.registry.json` declares `dynamic_bounded_parallelism` and `max_parallel_agents: 32`.
- `factory-governor` is already represented in the agent registry/bindings for orchestration and model routing.
- `supabase/functions/midad_omni_agent_gateway/` is an existing agent gateway and must remain the user-facing/control-plane entry.
- `mobile/factory/x/continuity-ledger/` contains a Cloudflare Durable Object worker design for task envelopes, leases, checkpoints, idempotency, and append-only execution evidence. Its README explicitly states that it has not been deployed or connected to a live MIDAD runtime.
- Existing architecture governance requires module ownership, reviewable branches, evidence, and tests.

These are source-level findings. They do not establish live runtime readiness.

## 3. Responsibility boundaries

| Component | Owns | Must not own |
|---|---|---|
| MIDAD MAX Orchestrator / Factory Governor | Planning, bounded parallel dispatch, model routing, cancellation, aggregation, policy | Durable knowledge corpus or financial authority |
| Memora | Shared knowledge, semantic/keyword retrieval, typed relationships, source lineage, supersession and topic digests | Job leases, task execution state, credentials, wallet signing or payments |
| MIDAD Continuity Ledger | Task envelopes, leases, checkpoints, idempotency, worker/node lifecycle, append-only execution events | Semantic knowledge ranking or agent policy |
| Existing MIDAD gateways and policy | Authentication, owner scope, authorization, approval gates, tool access | Bypassing upstream component contracts |

**Core distinction:** Memora is *Knowledge Memory*; the Continuity Ledger is *Execution State*. They complement one another and must not be collapsed into one database or service.

## 4. Memora capabilities and integration constraints observed

The upstream source and documentation inspected for this decision establish:

- Python package `memora-mcp`, Python `>=3.10`, MCP dependency constrained to `mcp>=1.27,<1.28`.
- SQLite-backed storage with optional Cloudflare D1 and S3-compatible/R2 backends.
- MCP tools for memory operations, semantic/keyword/hybrid search, graph links, digests, and memory absorption.
- A plain JSON `/api/v1/{store}` contract for health, search, and absorb.
- The versioned JSON API contract explicitly reports `writes: "unsupported"` in Phase 0; its HTTP absorb route does not provide a production write path yet. Do not build a write integration on that route.
- The upstream container guide's default deployment path uses Apple's container runtime on Apple Silicon/macOS 26. The package also supports a Python process and MCP transports, but a suitable persistent production host and secure remote MCP exposure must be independently validated.
- A D1 primary requires read replication disabled for its documented session read-your-writes behavior; any D1 pilot must test this condition.

The pilot must pin an immutable upstream commit or release and record the exact dependency lock. Do not follow an unpinned moving branch in production.

## 5. Target request path

1. A MIDAD agent asks the MAX Orchestrator to retrieve or store knowledge.
2. The Orchestrator derives an owner/workspace/project scope and a bounded operation.
3. A MIDAD-owned Memory Adapter authenticates the caller, validates the request, applies redaction and scope policy, and invokes the approved Memora interface.
4. Memora returns structured memories with source IDs, lineage and retrieval metadata.
5. The Orchestrator treats retrieved content as untrusted evidence, not executable instructions; it checks freshness, provenance, confidence and policy before using it.
6. Durable task state, leases, retries, checkpoints and execution outcomes remain in the Continuity Ledger. Only a sanitized summary/evidence reference is copied into knowledge memory when useful.
7. The agent's final result links to supporting memory/evidence IDs.

No public browser client or mobile bundle may receive Memora service credentials.

## 6. Memory data contract

Every MIDAD-authored memory record must carry, at minimum:

- `schema_version`
- `owner_scope` and `project`
- `memory_type`: `decision`, `fact`, `evidence`, `lesson`, `task_summary`, or `risk`
- `content` (bounded, normalized, redacted)
- `source_ref` and `source_kind`
- `created_at` and `observed_at`
- `created_by_agent` and `run_id` where applicable
- `confidence` and `verification_state`: `VERIFIED`, `INFERRED`, `PENDING`, `FAILED`, or `BLOCKED`
- `sensitivity` and `retention_class`
- `supersedes` / relation metadata where applicable

Never store passwords, session cookies, OTPs, API keys, private keys, seed/recovery phrases, payment credentials, raw browser storage state, or unredacted personal data. Secrets remain in approved secret stores/Vault and are referenced only by opaque identifiers when strictly needed.

## 7. MAX multi-agent execution policy

The existing registry's configured ceiling of 32 is a ceiling, not a promise that 32 live agents are available or useful on every run.

For `/MAX`:
- Select the largest *useful and available* bounded set under actual tool, model, rate, cost, and runtime limits.
- Split only independent work into parallel lanes; declare inputs, outputs, ownership and merge points.
- Keep one integration/supervisor owner and prevent overlapping writes to shared files or mutable resources.
- Use read-only parallel research and inspection freely within budgets; serialize conflicting mutations.
- Record agent identity, task/run ID, model/provider, timestamps, result status, evidence references, latency and estimated cost.
- Deduplicate and reconcile conflicting findings before persisting canonical memories.
- Apply timeouts, cancellation, bounded retries, per-task budgets and explicit degraded-mode fallbacks.
- Never claim an agent ran unless it was actually dispatched and its result was received.
- Financial, destructive, identity, permission and production-deployment actions retain human approval gates.

## 8. Deployment and cost constraint

MIDAD's zero-budget rule remains in force. No paid host, account, subscription, upgrade, or overage may be created as part of this adoption.

A persistent, secure Python/MCP host has not yet been verified for this integration. GitHub Actions may run bounded, isolated pilot tests but is ephemeral and is not a production memory server. Cloudflare Workers/Durable Objects do not automatically execute this Python MCP server; do not represent the existing Continuity Worker as a Memora host.

Until a persistent host and approved secrets path are verified, the live shared-memory integration is **BLOCKED**. Do not expose an unauthenticated Memora MCP endpoint to the public internet.

## 9. Acceptance gates

### Gate A — isolated reproducible pilot
- Pin upstream release/commit and dependencies.
- Run Memora in an isolated disposable environment with synthetic MIDAD data only.
- Verify startup, health, MCP tool discovery, create/update/absorb, search, digest, graph links, supersession, duplicate handling, and export/restore.
- Explicitly verify the MCP write path; do not infer it from the JSON API's read-only/unsupported-write contract.
- Test owner/project isolation and reject cross-scope reads/writes.
- Test prompt-injection payloads in retrieved memories; they must remain data, never policy.
- Test redaction, secret rejection, request size bounds, concurrency, restart recovery and backup integrity.
- Measure p50/p95 latency, memory/disk use, retrieval relevance, false retrievals and cost.

### Gate B — MIDAD adapter contract
- Define versioned request/response schemas and consistent error envelopes.
- Add authentication, least-privilege service identity, owner/project scoping, idempotency for writes, rate limits, timeouts and audit events.
- Keep the adapter server-side; do not expose credentials to the frontend.
- Add contract tests against a real isolated Memora instance, not only mocks.

### Gate C — controlled runtime integration
- Verify a persistent zero-cost host, uptime/restart policy, encrypted storage, backup/restore, secret injection and network access.
- Verify the chosen backend's write consistency and recovery behavior.
- Integrate first with one non-critical MIDAD agent cohort; keep existing memory/continuity paths as fallback.
- Run shadow retrieval and compare relevance/latency before allowing canonical writes.
- Require owner approval before production deployment or any paid resource.

### Gate D — production promotion
Promote only when Gates A–C pass, security review is clean, rollback is tested, and live health plus cross-session multi-agent read/write is demonstrated with timestamped evidence.

## 10. Rollback

Disable the Memory Adapter feature flag and route agents back to their existing memory/context sources. Do not delete or migrate existing MIDAD data as part of the pilot. Export Memora data and verify restore before any schema or backend migration. The Continuity Ledger and existing MIDAD gateways remain operational and unchanged.

## 11. Current status

| Item | State | Evidence |
|---|---|---|
| Memora source/documentation review | `SOURCE_PRESENT` | Upstream README, `pyproject.toml`, `AGENTS.md`, `memora/server.py`, `memora/storage.py`, and API v1 contract inspected on 2026-11-21 |
| MIDAD agent registry / governor foundations | `SOURCE_PRESENT` | `mobile/factory/x/agents.registry.json`, agent bindings and Omni Agent gateway source inspected |
| Continuity Ledger design | `SOURCE_PRESENT` | `mobile/factory/x/continuity-ledger/README.md` explicitly says not deployed/connected |
| Isolated Memora pilot | `PENDING` | Not run |
| Persistent zero-cost Memora host | `BLOCKED` | No suitable persistent host verified |
| MIDAD Memory Adapter | `PENDING` | No adapter code added |
| Production shared memory | `BLOCKED` | Acceptance gates not passed; no live connection |

## 12. Immediate next engineering actions

1. Finish a narrow upstream security and MCP transport review, including authentication on every remote MCP route and all write-tool semantics.
2. Build a reproducible isolated pilot harness with synthetic fixtures and automated acceptance tests; pin the exact upstream revision.
3. Validate storage choices and backup/restore without touching production MIDAD data.
4. In parallel, inspect the existing Continuity Ledger's current branch/deployment evidence and the current MIDAD agent gateway contract; do not deploy or mutate either.
5. Only after pilot results, implement a versioned MIDAD Memory Adapter behind a feature flag and test it against the real isolated Memora instance.

**Non-goal:** increasing agent count for its own sake. The goal is faster, more reliable, evidence-backed coordinated work with persistent cross-session knowledge and no duplicated or conflicting execution.
