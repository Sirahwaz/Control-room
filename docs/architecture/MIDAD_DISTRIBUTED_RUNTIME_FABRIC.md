# MIDAD Distributed Runtime Fabric — P0 Architecture

**Status:** Architecture decision / source integration plan.  
**Scope:** Entire MIDAD AI ecosystem.  
**Baseline:** Preserve existing Control Room, MIDAD Forge, orchestrators, Continuity Ledger, MNCF, Browser Gateway, Revenue Runtime, Telegram clients and existing data stores.  
**Budget:** Zero-budget by default; any paid capacity requires explicit cost disclosure and approval.  
**Runtime status:** Source contracts exist; a production-wide connected fabric is not yet verified.

## 1. Executive decision

Adopt one provider-agnostic **Distributed Runtime Fabric (DRF)** for the complete MIDAD AI ecosystem.

The Fabric is a shared execution and coordination substrate, not a replacement for every product's business logic. It provides:
- authenticated node identity and enrollment;
- capability-based placement and policy evaluation;
- bounded task leases, idempotency and checkpoints;
- execution-provider adapters;
- evidence, health, cost and audit telemetry;
- cancellation, recovery, quarantine and human handoff.

The architecture follows:

`DISCOVER → AUTHORIZE → SCHEDULE → LEASE → EXECUTE → VERIFY → RECORD → RECONCILE`

A node is not trusted merely because it is registered or reports READY. It must authenticate, prove a fresh heartbeat, advertise only owner-approved capabilities, and pass task-specific policy checks.

## 2. Canonical plane model

| Plane | Responsibility | Existing MIDAD anchor |
|---|---|---|
| Command & Experience | User intent, explainability, approvals and notifications | Control Room, Telegram bots, Android UI |
| Intelligence | Model selection, prompt compilation, analysis and agent reasoning | `midad_orchestrator`, AI Router, Omni Agent, model gateway |
| Mission / Business Orchestration | Product, project, revenue and workflow state | MIDAD Forge, existing coordinators, Revenue Runtime |
| Distributed Execution | Node registry, capability matching, leases, retries and wake hints | Continuity Ledger, MNCF |
| Runtime Adapters | Execute a typed task on a specific provider | Linux worker, Browser Gateway, Android WebView, extensions, CI runners |
| Evidence & Observability | Append-only events, evidence hashes, provenance, health and cost | Forge events, Continuity events, existing run/evidence records |
| Trust & Identity | Owner binding, credentials, scoped grants, secrets and revocation | Existing auth, Vault contracts, Android Keystore, plugin grants |
| Settlement Boundary | Payment intents, receipts, wallet signing and delivery confirmation | Existing Revenue / Wallet components; isolated from generic execution |

The Control Room is the human-facing command surface. Telegram bots are clients and notification channels, not independent sources of mission truth.

## 3. State ownership — prevent duplicate queues and orchestrators

This is a mandatory boundary:

1. **The source business system owns the mission.** Forge owns Forge project/run state; Revenue components own their order/payment/delivery state; existing agent/workflow systems retain their own authoritative records.
2. **The Fabric owns execution coordination only.** It owns node enrollment, resource reports, task lease state, attempt identity, checkpoint transport, wake hints and execution telemetry.
3. A Fabric task references its source mission using `source_system`, `source_mission_id`, and a stable `idempotency_key`. It must not silently create a second business mission.
4. A Queue or WebSocket notification is a wake-up hint, never authoritative task data. A worker must authenticate and pull-claim the current lease.
5. Do not add another database, queue, scheduler or orchestrator unless a measured limitation and migration plan demonstrate that existing components cannot meet the requirement.

### Forge and Continuity Ledger boundary

- MIDAD Forge remains authoritative for Forge projects, runs and their business lifecycle.
- Continuity Ledger remains the execution lease and node-coordination substrate for enrolled runtime workers.
- A Forge run dispatched through the Fabric carries the Forge run ID as its source reference. The Fabric records execution attempts and evidence references, not a competing Forge run lifecycle.
- Non-Forge sources may dispatch through an adapter only after their source-of-truth and reconciliation contract is documented.
- Existing `midad_orchestrator` model calls remain the Intelligence plane. A model response is not a completed execution task and must not be represented as one without a separately authorized runtime action and evidence.

## 4. Unified task envelope — target v1

The envelope is a versioned, typed contract. It is not an unrestricted shell command or arbitrary agent prompt.

Required logical fields:
- `schema_version`: contract version.
- `task_id`: stable execution task identifier.
- `source_system` and `source_mission_id`: authoritative upstream owner.
- `owner_scope`: derived from authenticated identity; never trusted from page content.
- `idempotency_key`: stable key for one intended effect.
- `workload`: bounded workload class.
- `required_capabilities`: explicit capability set.
- `input_ref`: reference to approved input data; avoid embedding secrets or large files.
- `data_class`: public, internal, confidential, or restricted.
- `policy_ref`: policy version and approval requirements.
- `deadline`, `max_attempts`, `max_cost`: explicit resource ceilings.
- `checkpoint_ref`: optional durable progress reference.
- `evidence_requirements`: required result/evidence types.
- `cancellation`: cancellation and reconciliation semantics.

The existing Continuity Ledger currently validates the workload enum `CPU_BATCH`, `WEBGPU_BATCH`, `BROWSER_SESSION`, and `SINGLE`. These are the **verified current workload values**. Do not claim generic Agent, Workflow, Revenue or Data Pipeline workload support until the ledger contract, adapters and tests explicitly add and validate them.

Capability namespaces are additive and least-privilege. Candidate namespaces include `compute.*`, `browser.*`, `agent.invoke.*`, `workflow.invoke.*`, `research.*`, `artifact.*`, and `revenue.read.*`. These are target vocabulary, not currently granted capabilities. Payment, wallet signing, transfers, withdrawals, publication, deletion and credential rotation remain separate high-impact approval domains; no generic node capability grants them.

## 5. Node and adapter model

A node advertises a bounded capability set, runtime version, health, available slots, resource limits, data residency constraints and verified cost. Enrollment and capability grants are owner-scoped and revocable.

| Node / adapter | Intended responsibility | Current evidence |
|---|---|---|
| Android Edge Node | Interactive browser, human handoff, local/offline preparation | Native Browser Mesh source and APK CI; persistent Fabric pairing pending |
| Chrome / Edge / Firefox | User-approved extraction and browser companion actions | Extension packages and CI checks merged; live pairing/execution pending |
| Playwright / Chromium | Server-side browser automation in isolated profiles | Existing browser runtime source; persistent production host not verified |
| GitHub Actions Linux | Ephemeral build/test and bounded batch work | Workflow and worker source/tests exist; never treat CI as always-on |
| MNCF Linux Worker | Bounded CPU/build execution and future specialist adapters | Worker contract/tests exist; persistent node enrollment pending |
| Agent Runtime Adapter | Run a named agent with a versioned policy and bounded tools | Existing orchestrator/agent services; common Fabric adapter pending |
| Workflow Adapter | Invoke approved existing workflow engines such as n8n | Integration is optional; common adapter and live verification pending |
| Model Provider Adapter | Route inference requests through existing AI Router/model gateway | Existing model routing path; do not confuse inference with external action execution |
| Revenue Adapter | Read/qualify opportunities and advance approved workflow transitions | Revenue components exist; Fabric integration pending and payment remains isolated |

Providers are interchangeable behind typed adapter contracts. Prefer existing authenticated connectors/APIs where suitable; browser automation is the fallback for workflows that genuinely require a browser. TinyFish remains optional and is not a core dependency.

## 6. Scheduling, reliability and execution semantics

- **Capability matching:** intersect task requirements with owner-approved enrolled capabilities and live node health.
- **Freshness:** heartbeat age, runtime version, provider handshake and queue reachability are required for READY.
- **Leases:** bounded expiry, owner/task binding, fencing token and stale-lease rejection.
- **Idempotency:** one intent key; duplicate submissions return the existing intent or reject changed payloads.
- **Retry:** at most three attempts per incident by default; only retry tasks whose effects are known to be idempotent.
- **Uncertain external side effects:** quarantine for reconciliation; never blindly replay a browser click, submission, payment or external send.
- **Checkpointing:** persist bounded, sanitized progress; do not place credentials, cookies, tokens, private keys or wallet seeds in payloads/checkpoints.
- **Cancellation:** stop future work, revoke the lease, and reconcile any in-flight external side effect before declaring cancelled.
- **Failover:** move only safe/idempotent work to another eligible node; never clone a live authenticated browser session.
- **Backpressure:** respect node slots, per-owner concurrency, provider quotas, memory/storage limits and zero-budget cost ceilings.

## 7. Security and trust boundaries

- Authenticate every node and derive owner identity from a trusted enrollment/session, not task-supplied fields.
- Use outbound authenticated connections where possible; do not expose browser debugging, VNC, database or worker-control ports publicly.
- Use short-lived scoped grants, origin/task binding, one-time approvals and revocation.
- Verify package integrity and publisher provenance before plugin execution. A manifest declaration or JavaScript iframe is not a sandbox.
- Treat web pages, model output, plugin metadata and third-party workflow inputs as untrusted data, never as policy instructions.
- Keep secrets in the approved vault/host secret provider. Never send plaintext secrets to nodes that do not need them.
- Keep wallet signing keys and seed phrases outside browser/agent execution payloads. Use the existing non-custodial user-controlled signing boundary.
- Require human approval for payments, transfers, withdrawals, purchases, deletion, publication, external sending, deployment, permissions changes and credential rotation.
- Include per-node kill switch, owner-wide revoke, audit events and safe offline behavior.

## 8. Evidence and observability

Every execution attempt should produce:
- source mission reference and idempotency key;
- selected node, adapter and runtime version;
- policy decision and granted capabilities;
- lease/attempt identifiers and timestamps;
- sanitized logs and bounded checkpoint references;
- result schema and evidence hashes;
- cost estimate versus verified actual cost;
- final state: `VERIFIED`, `INFERRED`, `PENDING`, `FAILED`, or `BLOCKED`.

A node reporting success is not sufficient. The source mission owner must reconcile the result and required evidence before the business mission is marked complete.

## 9. Implementation sequence

### P0 — Architecture and source-of-truth boundaries
- This document records the whole-ecosystem architecture and ownership rules.
- Inventory the existing task producers, source mission stores, worker adapters and evidence destinations.
- No database migration, production deployment or paid resource is included.

### P1 — Contract alignment
- Compare Continuity Ledger, MNCF, Forge and agent/workflow contracts.
- Define a versioned task envelope and adapter interface without replacing source mission schemas.
- Add contract tests for source references, idempotency, owner isolation, workload/capability allowlists and approval boundaries.
- Resolve any disagreement between the Forge queue and Continuity task table before connecting producers.

### P2 — First safe vertical slice
- Select one harmless, zero-cost, read-only workload from an existing producer.
- Dispatch it through the Fabric to one enrolled ephemeral or local test node.
- Verify claim, heartbeat, lease fencing, checkpoint, result evidence and source-mission reconciliation.
- Keep live production systems unchanged until explicit deployment approval.

### P3 — Adapter expansion
- Add agent, workflow, browser, research and build adapters incrementally.
- Each adapter has its own typed input/output schema, capability map, test suite and failure semantics.
- Keep provider-specific behavior behind the adapter boundary.

### P4 — Secure node pairing and runtime operations
- Pair Android and desktop extensions using owner-bound device identities.
- Add persistent Linux only after host, capacity, network and cost are verified.
- Add watchdog, health probes, revoke, kill switch and observability.

### P5 — Revenue and high-impact workflows
- Integrate revenue discovery, offer and delivery stages through source-system references.
- Payment and wallet actions remain isolated and require exact human approval.
- Verify first real receipt end-to-end before counting revenue.

### P6 — Controlled autonomy
- Add multi-agent delegation, parallel execution, policy evaluation, bounded retries and learning from verified evidence.
- Autonomy must not expand permissions or cost ceilings by itself.

## 10. Current verified status and non-claims

| Component | Status |
|---|---|
| Control Room, Forge, orchestrator and revenue source components | VERIFIED as repository source; live end-to-end Fabric linkage not established by this document |
| Continuity Ledger node/task/lease implementation and tests | VERIFIED in source/tests; deployment and live node handshake pending |
| MNCF bounded Linux worker and manifest | VERIFIED in source/tests; persistent Linux node not enrolled |
| GitHub Actions ephemeral adapter | Source/workflow exists; ephemeral only |
| Browser extension packages | Merged source and CI artifacts; desktop pairing and live execution pending |
| Browser plugin P3 contract | PR #294; not a plugin sandbox or live plugin execution host |
| Cloudflare Queues / Durable Object deployment | PENDING; no production deployment is claimed |
| Unified Agent / Workflow / Revenue adapters | PENDING |
| Whole-ecosystem distributed runtime | NOT YET VERIFIED |

## 11. Acceptance criteria

The Fabric is not production-ready until all are true:
1. A single source mission can be dispatched without creating a duplicate business mission.
2. An enrolled node can claim only owner-authorized tasks matching its approved capabilities.
3. Duplicate submissions are idempotent; stale leases and replayed approvals are rejected.
4. Node loss and retry do not duplicate external side effects.
5. Result evidence is reconciled by the authoritative source system.
6. Revocation and kill switches prevent new work and terminate/reconcile active work safely.
7. Costs, quotas, resource limits and provider readiness are enforced before dispatch.
8. Tests cover hostile payloads, cross-owner access, expired grants, provider failure, offline behavior and uncertain side effects.
9. A harmless end-to-end task succeeds on a live enrolled node with verifiable evidence.
10. No secrets, raw browser sessions, wallet keys or unrestricted credentials enter task payloads, logs or artifacts.
