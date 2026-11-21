# MIDAD Memory Adapter Contract v1

**Status:** Adapter core, pinned Memora API v1 backend, and trusted gateway boundary implemented in PRs #353–#355; production identity/policy binding and deployment remain pending.  
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

## 9. Implementation status (2026-11-21)

| Layer | State | Evidence / remaining gate |
|---|---|---|
| Upstream Memora pin and isolated CI pilot | VERIFIED | Pinned SHA `442ca1b4ef494c256917ecd052dedb872710e84a`; seven upstream acceptance tests pass |
| Adapter boundary | VERIFIED | PR #353; default-off flag, trusted Principal input, owner/project checks, create/search, SQLite intent ledger, redaction checks |
| Memora API v1 transport | VERIFIED | PR #354; HTTPS-only except loopback tests, server-side owner-to-store routing, bearer token env bindings, health/project checks |
| MIDAD gateway composition | VERIFIED | PR #355; injected principal resolver, sanitized fail-closed behavior |
| Production MIDAD principal resolver | PENDING | Must bind to the existing owner-authentication/session system and authoritative project/capability policy; no caller claims |
| Memora endpoint, owner routes, and credentials | PENDING | No live endpoint, token, or owner/store mapping is configured |
| Transactional writes | CONDITIONAL | Backend permits absorb only when Memora health explicitly reports `writes: transactional`; otherwise writes fail closed |
| Production deployment / feature flag | BLOCKED | No deployment or activation authorized; `MIDAD_MEMORY_ADAPTER_ENABLED=false` remains the default |

The implementation is a tested code path, not a live MIDAD↔Memora integration. The current
Python gateway requires a trusted resolver supplied by the host application. The current
Memora backend requires server-owned owner/store mappings and server-only token environment
bindings. Neither has been connected to a live host.

### Next integration gate

1. Bind the gateway resolver to MIDAD's existing authenticated owner session and policy services.
2. Resolve allowed projects and operation capabilities from a trusted server-side source.
3. Configure one isolated Memora store per authorized owner scope (or an equivalently proven tenant-isolation boundary).
4. Verify the target store's health, contract version, declared projects, and transactional-write capability.
5. Run two-owner/two-project isolation and idempotency tests against disposable Memora SQLite data.
6. Only then request explicit approval for a synthetic internal pilot. Production remains separately gated.

## 10. Authenticated gateway implementation status (2026-11-21)

| Layer | State | Evidence / remaining gate |
|---|---|---|
| Existing owner-bound Control Room session | IMPLEMENTED / PENDING DEPLOYMENT | Reuses `control_room_sessions` and `validateOwnerSessionBinding`; legacy/unbound sessions fail closed |
| Project authorization | IMPLEMENTED / PENDING DEPLOYMENT | Edge Gateway checks `midad_factory_projects.project_key + owner_user_id` |
| Agent operation grants | IMPLEMENTED / PENDING DEPLOYMENT | New empty `midad_memory_agent_grants` table; service-role only; no grants seeded |
| Execution-run binding | IMPLEMENTED / PENDING PRODUCER WIRING | Requires a `RUNNING` `midad_factory_runs` row with matching project and `agent_key`; legacy NULL runs fail closed |
| Metadata-only audit | IMPLEMENTED / PENDING DEPLOYMENT | New `midad_memory_gateway_audit` records request, owner, project, agent, run, operation, outcome and record IDs; no content or credentials |
| Private adapter service | IMPLEMENTED / PENDING HOST | Python HTTP entrypoint accepts only the Edge Gateway service bearer and rejects oversized/invalid envelopes |
| Memora API v1 | IMPLEMENTED / CONDITIONAL | Writes remain blocked unless store health explicitly reports `writes: transactional` |
| Live credentials, route mappings, deployment | NOT CONFIGURED | No endpoint, service key, Memora token, route mapping, or host supplied/configured |
| Feature activation | BLOCKED | Edge and Python feature flags remain default-off |

The Edge Gateway accepts only exact allowed browser origins, validates a hashed Control Room
session token against its explicit owner binding, checks project ownership, checks a
service-managed agent grant for the requested operation, and requires a live run bound to
the same project. It forwards a server-resolved principal to the private Python service;
client-supplied owner/store/capability fields are rejected.

The grant migration creates no grants. It must not be applied until the Supabase write path
is healthy. The private Python service must not be exposed directly to a browser or bot;
deploy it behind private HTTPS ingress and configure its service key only in server-side
secret stores.

### Synthetic pilot gate

1. Restore/verify Supabase migration execution capability.
2. Apply the grant/audit schema migration; verify RLS and service-role-only grants.
3. Provision exactly one synthetic owner/project/agent grant through a reviewed admin path.
4. Deploy the private Python service with a durable ledger path and a private HTTPS endpoint.
5. Configure one synthetic Memora owner/store mapping and server-only bearer token.
6. Verify health, declared project, and transactional-write support.
7. Run cross-owner, cross-project, revoked-grant, stale-session, wrong-run, replay, and audit tests.
8. Keep production data and all financial workflows out of this pilot.

No deployment, migration execution, grant provisioning, secret creation, or feature-flag
activation is authorized or claimed by this implementation PR.

The gateway requires `midad_factory_runs.agent_key` to match the active agent grant.
The migration adds this nullable column without rewriting historical runs. The existing
factory run producer must set it from trusted execution context; until that producer is
updated, legacy and newly created rows without an agent key cannot use memory. This is
an explicit integration blocker, not a reason to weaken the run check.


### Upstream Memora API authentication gate

The pinned upstream API only enforces bearer authentication when its host is configured
with `MEMORA_API_TOKENS_FILE`. A client sending a bearer header does not prove that the
server validates it. A synthetic pilot is blocked until the Memora host has this gate
configured and negative tests prove that missing and invalid tokens are rejected while
the configured token is accepted. Token values must remain server-only and outside Git.

The upstream token file stores SHA-256 token digests mapped to allowed store names, not
raw token values. Provision each owner's token digest for exactly one distinct store and
keep the token file owner-only (the pinned upstream loader rejects group/other-readable
permissions). A token that can address multiple owner stores defeats the intended
per-owner boundary and is not accepted for the synthetic pilot.
