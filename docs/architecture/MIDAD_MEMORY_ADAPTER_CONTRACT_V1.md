# MIDAD Memory Adapter Contract v1

**Status:** Contract specification only — implementation intentionally gated on Memora pilot acceptance.  
**Depends on:** `MIDAD_COLLECTIVE_MEMORY_MEMORA_ADOPTION.md`, `MEMORA_UPSTREAM_SECURITY_REVIEW_2026-11-21.md`, `MEMORA_PILOT_RUNBOOK.md`.  
**Upstream candidate:** `agentic-box/memora@442ca1b4ef494c256917ecd052dedb872710e84a`.

## 1. Boundary and non-goals

The adapter is a server-side boundary between authenticated MIDAD services/agents and a Memora store. It is not a browser/mobile SDK, identity provider, agent orchestrator, task queue, policy authority, or financial execution component.

- Factory Governor remains responsible for planning and bounded agent coordination.
- Continuity Ledger remains authoritative for run/task state, leases, checkpoints and idempotency of execution.
- Memora stores durable knowledge and evidence references; it does not grant permissions.
- Existing MIDAD authentication and approval policies remain authoritative.
- No agent may select an arbitrary Memora database/store or override its owner/project scope.

The adapter is **not implemented or enabled** by this document.

## 2. Trust model

The adapter derives identity and authorization exclusively from a verified server-side MIDAD principal. Caller-supplied `owner_id`, `tenant_id`, `store_name`, `project_id`, role, or scope claims are never trusted as authorization inputs.

After authentication, the policy layer resolves:

- `principal_id`: immutable authenticated subject;
- `owner_scope`: server-resolved tenant/user boundary;
- `allowed_projects`: server-resolved project membership;
- `agent_id` and `run_id`: validated service execution context;
- `capabilities`: explicit operation grants, not inferred from agent name.

A request is rejected by default if any identity, project membership, or capability lookup is missing, stale, ambiguous, or unavailable. No fallback to a default/global store is permitted.

## 3. Versioned operation contract

All calls are internal service-to-service calls over an authenticated channel. The adapter owns the Memora store mapping and injects scope metadata after validating the principal.

### Request envelope

```json
{
  "contract_version": "midad-memory/v1",
  "request_id": "uuid",
  "operation": "search",
  "project_id": "server-authorized-project",
  "agent_id": "registered-agent-id",
  "run_id": "execution-run-id",
  "payload": {}
}
```

`owner_scope`, Memora database/store identifiers, credentials, and authorization decisions are deliberately absent from caller-controlled payloads.

### Required operations

| Operation | Purpose | Required controls |
|---|---|---|
| `create` | Add a knowledge record | Scope injection, source reference, provenance, sensitivity, size limit |
| `update` | Supersede/correct a record | Owner/project check, expected version, append-only supersession link |
| `search` | Retrieve relevant knowledge | Scope filter before ranking; bounded result count; untrusted-content marking |
| `absorb` | Process a bounded evidence batch | Stable idempotency key, payload hash, transactional backend capability |
| `digest` | Summarize authorized project memory | Scope filter before aggregation; provenance retained |
| `graph` | Retrieve authorized relationships | Both endpoints must be in caller scope |
| `export` | Export an authorized scope | Explicit export capability, bounded output, audit event |
| `restore` | Restore a verified backup | Operator-only capability, isolated target, integrity check, human approval |

Operations unsupported by the tested Memora backend must return a structured `CAPABILITY_UNAVAILABLE`; they must not silently fall back to a different backend or weaker semantics.

## 4. Memory record metadata

Every adapter-created record must include server-generated metadata:

- `owner_scope` and `project_id`;
- `memory_type` and `source_ref`;
- `created_at` and `observed_at` (UTC);
- `created_by_agent` and `run_id`;
- `confidence` and `verification_state`;
- `sensitivity` and `retention_class`;
- `schema_version`;
- `supersedes` and `relations` where applicable.

Required values are validated at the adapter boundary. The adapter must not silently invent provenance or convert an unknown verification state into VERIFIED.

## 5. Response and error contract

Success response:

```json
{
  "contract_version": "midad-memory/v1",
  "request_id": "uuid",
  "status": "OK",
  "data": {},
  "evidence": {
    "backend": "verified-backend-capability",
    "record_ids": []
  }
}
```

Errors use one stable envelope:

```json
{
  "contract_version": "midad-memory/v1",
  "request_id": "uuid",
  "status": "ERROR",
  "error": {
    "code": "FORBIDDEN",
    "message": "Operation is not authorized",
    "retryable": false
  }
}
```

Stable codes: `UNAUTHENTICATED`, `FORBIDDEN`, `SCOPE_NOT_FOUND`, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `CAPABILITY_UNAVAILABLE`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `INTEGRITY_FAILURE`.

Internal exception text, database paths, token state, SQL, and cross-tenant existence signals must not be returned to callers.

## 6. Mandatory isolation and abuse tests

The contract is not accepted until automated tests prove all of the following against a real isolated Memora instance or a faithful test backend:

1. Owner A / Project A can create, search and update its own records.
2. Owner A cannot read, update, digest, graph, export or restore Owner B data.
3. Project A cannot read or mutate Project B data under the same owner unless explicit project grants exist.
4. A forged `owner_scope`, `store_name`, or project identifier in the request body is ignored or rejected; it never changes the resolved scope.
5. Search filtering occurs before ranking and result truncation, preventing cross-scope records from influencing results.
6. Graph traversal cannot leak a relation whose other endpoint is outside scope.
7. Unknown agents, revoked grants, expired principals and policy-service failures fail closed.
8. A repeated absorb idempotency key with the same payload safely replays; the same key with a different payload returns `IDEMPOTENCY_CONFLICT`; concurrent duplicates cannot create duplicate records.
9. Prompt-injection strings are returned as quoted/untrusted memory data and never alter system/developer policy.
10. Secret-like values are rejected or redacted before persistence and absent from logs, errors and exports.
11. Oversized payloads, excessive result counts, concurrency spikes and timeouts are bounded.
12. Export/restore preserves scope and integrity; restore is never agent-callable by default.
13. Audit events record principal, agent, run, operation, project, outcome, record IDs and correlation ID without storing secrets or full sensitive content.

## 7. Idempotency

For mutating operations, the caller supplies a stable intent key that survives retries. The adapter binds it to the authenticated principal, project, operation and canonical payload hash. A new attempt must not mint a new key for the same intent.

- Same key + same canonical payload: return the original completed result.
- Same key + different payload: `409 CONFLICT / IDEMPOTENCY_CONFLICT`.
- Concurrent in-flight duplicate: bounded wait or explicit retryable conflict; never execute twice.
- Unknown outcome after timeout: preserve an unresolved intent record and reconcile; never assume failure and blindly repeat.

Memora's own transactional absorb support is not a substitute for the adapter's authorization/idempotency boundary.

## 8. Rollout gates

1. Memora upstream CI pilot passes on the immutable SHA.
2. MCP operation semantics and backend capability are exercised against an isolated local SQLite instance.
3. Adapter implementation is added behind `MIDAD_MEMORY_ADAPTER_ENABLED=false` by default.
4. Contract tests pass for two owners and at least two projects.
5. Security review covers auth, scope resolution, injection-as-data, redaction, logs, quotas, backups and rollback.
6. Feature flag is enabled only for a synthetic internal pilot with explicit operator approval.
7. Production promotion requires a verified persistent host, tested backup/restore, monitoring, rollback, and explicit approval.

No production connection, data migration, public endpoint, or paid hosting is authorized by this contract.
