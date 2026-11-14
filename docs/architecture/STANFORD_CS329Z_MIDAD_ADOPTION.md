# Stanford CS329Z → MIDAD Engineering Adoption

**Decision:** Adopt Stanford CS329Z: Engineering AI Agents as an official engineering reference for MIDAD AI.  
**Adopted:** 2026-11-14  
**Reference:** https://cs329z.stanford.edu/  
**Scope:** Incremental improvement of the existing MIDAD ecosystem. This is not a rebuild mandate.

## 1. Non-negotiable adoption rule

Use the sequence:

`AUDIT → PRESERVE → REPAIR → INTEGRATE → UPGRADE → TEST → VERIFY`

- Keep working repositories, interfaces, routes, data contracts, deployed functions, bots, payment controls and user-facing assets unless evidence proves a specific defect or a migration is approved.
- Do not introduce a new framework, database, queue, agent runtime, memory store, provider or paid service when an existing component can satisfy the requirement.
- Prefer connected first-party APIs and existing connectors over browser automation. Browser providers remain adapters, not the control plane.
- Build in small, reviewable increments. Put code changes on a branch, run focused tests, record the commit and evidence, and use a pull request for integration.
- Never infer production readiness from a README, registry row, skill definition, successful unit test or HTTP 200 alone.
- Do not claim a live deployment, worker, integration, payment, receipt or agent capability without current runtime evidence.
- Keep approval gates for financial, irreversible, identity, permission, publication and production-deployment actions.

## 2. Evidence vocabulary

Use these states in every implementation note and Control Room report:

| State | Meaning |
|---|---|
| `SOURCE_PRESENT` | Relevant code or documentation exists in a repository; runtime is not implied. |
| `TESTED_LOCAL` | A named local test or validation command passed against a recorded revision. |
| `RUNTIME_VERIFIED` | A live, authenticated operation passed and its timestamp, environment and evidence are recorded. |
| `PENDING` | A capability or integration is designed or partially implemented but lacks its acceptance evidence. |
| `BLOCKED` | A specific dependency, authorization, infrastructure or safety constraint prevents the next step. |
| `FAILED` | A test or runtime check was executed and failed; retain the failure evidence. |

A status must always include its evidence location and observation time. Do not promote a state on assumption.

## 3. Existing MIDAD assets to preserve

The initial source review found the following relevant assets. These are source-level findings, not a fresh production-health audit.

| CS329Z domain | Existing MIDAD asset | Current evidence-based interpretation |
|---|---|---|
| Agent foundations and orchestration | `.agents/skills/midad-intelligence-force-super/`; `.agents/skills/MIDAD_INTEGRATION.md`; existing Factory / control-plane documentation | `SOURCE_PRESENT`. Preserve the router and specialist workflows; inspect current runtime before expanding authority. |
| Tool use and APIs | Connected GitHub/Supabase/Notion/Dropbox integrations; browser and provider adapter contracts | `SOURCE_PRESENT`. Connector-first is the default. Do not add a parallel tool registry without proving a contract gap. |
| Browser/tool execution | `tools/midad-browser-runtime/` and `docs/architecture/MIDAD_BROWSER_EXECUTION_FABRIC.md` | `SOURCE_PRESENT`; README explicitly says the worker is a library/preview and does not create jobs or activate a queue. Live worker integration remains `PENDING`. |
| Durable state and continuity | `tools/midad-browser-runtime/continuity_ledger_client.py`; existing continuity and mission documentation | `SOURCE_PRESENT`. Verify durable writes, leases, checkpoints and restart recovery before describing the full path as operational. |
| Revenue intelligence and data quality | `Sirahwaz/midad-intelligence` collectors, qualification logic, tests, reports and Vespa package; Control-room Revenue Radar adapter | `SOURCE_PRESENT`. The intelligence repository README explicitly excludes production orchestration and payment execution. |
| Agent memory / RAG | Existing research and Vespa package definitions; research findings and evidence-ledger patterns | Partial foundations only. A production end-to-end RAG pipeline, retrieval quality and freshness are `PENDING` until separately measured. |
| Multi-agent coordination | Revenue Swarm / delegation documentation and specialist skill pack | Design/source exists. Coordinated multi-agent execution, isolation and failure handling need live end-to-end evidence. |
| Evaluation and observability | Focused unit tests, architecture-governance validator/CI, revenue-radar tests and runtime contract tests | `SOURCE_PRESENT`. A shared task-level agent benchmark with environment, stopping criteria and scorer is still `PENDING`. |
| Safety and guardrails | Read-only fail-closed browser worker, action policy, human gates, Nanobot integration security plan | Several controls are documented and tested in source. Nanobot is explicitly documented as `UNDEPLOYED`; no runtime connection may be inferred. |
| Coding agents | Existing MIDAD skills and engineering/repository workflows | Preserve the existing coding-agent path. Add or expand a coding harness only after sandbox, tool permissions, test execution and provenance pass acceptance tests. |
| Optimization | Provider adapter and AI-router architecture, revenue scoring logic | Architecture/source exists. Optimize against measured quality, latency, cost and failure rate; do not select a model or framework from benchmark claims alone. |

### Repository boundaries

- `Sirahwaz/Control-room` remains the canonical application and control-plane repository.
- `Sirahwaz/midad-intelligence` remains a separate read-only opportunity-intelligence workspace unless an explicit, evidence-backed integration is approved.
- Keep the existing architecture-governance manifest/module ownership rules authoritative. Every new file under a managed root must be assigned to an existing registered module or receive an explicitly reviewed ownership update.
- The fabric registry is a dated snapshot, not a live source of service status. Regenerate or inspect live inventories before relying on its versions or counts.

## 4. Course-to-project implementation map

The current Stanford syllabus covers compound AI systems, context engineering, RAG, tool use/MCP, framework design, agent patterns, memory, multi-agent systems, optimization, data quality, evaluation, safety, coding agents and proactive personal agents.

Apply those topics to MIDAD in this order:

### Track A — Revenue outcome evaluation (P0)

**Why first:** MIDAD's immediate business objective is verified revenue, so agent quality must be measured by validated outcomes rather than the number of agents, scans or generated opportunities.

1. Reuse the existing Fast Cash Radar / Revenue Radar qualification logic and its current test fixtures.
2. Build a small deterministic evaluation set from sanitized, synthetic or already-authorized examples. Include: funded versus unfunded, explicit versus ambiguous payout terms, network/asset mismatch, eligibility failure, expired/stale evidence, upfront fee, duplicate listing and net-reward calculation.
3. Score each case for evidence correctness, payout-confidence classification, duplicate suppression, net-value calculation and safe action gating.
4. Include negative cases where the correct answer is `BLOCKED` or `REVIEW`; measure false-positive readiness, not only successful matches.
5. Keep all evaluation runs read-only. Do not submit claims, contact customers, create financial intents, sign wallets or move funds.
6. Record dataset version, code commit, model/provider, run time, latency, cost, pass rate and failure examples.

**Acceptance:** A repeatable local command runs the evaluation and produces a machine-readable report. A candidate cannot be marked ready for human review unless every mandatory evidence gate passes. This evaluation must not change production qualification thresholds until a separate review accepts the results.

### Track B — Durable agent execution and recovery (P1)

1. Trace the existing mission/job contract through planner, policy, queue, worker and evidence ledger.
2. Reuse current IDs and tables/contracts; do not create a second queue or ledger.
3. Verify atomic claim/lease behavior, idempotency, attempt limits, cancellation, checkpoint persistence and stale-job recovery.
4. Test worker restart after each meaningful checkpoint and prove that a non-idempotent action is not repeated.
5. Keep retries bounded to three attempts per incident, then switch to a safe fallback or escalate.
6. Keep the current Supabase read-only/quota constraint in force: no new database DDL or persistent write-path experiment until a verified, approved storage path is available.

**Acceptance:** A synthetic mission survives a worker restart without duplicate execution, preserves evidence, and reaches a correct terminal state. No production or financial action is part of this test.

### Track C — Context engineering, memory and RAG (P1/P2)

1. Separate working, episodic, semantic and procedural memory rather than putting all history into one prompt.
2. Give every retrieved fact a source reference, timestamp, owner/scope, confidence, freshness and permitted-use label.
3. Retrieve only relevant context; keep current mission state separate from long-lived project memory.
4. Add citation/grounding checks and stale-source tests. An absent source must remain unknown, not be filled by model inference.
5. Benchmark retrieval precision/recall and answer-groundedness against a small approved dataset before changing default routing.
6. Reuse the current research/Vespa/evidence foundations if they pass the checks; do not deploy another vector database by default.

**Acceptance:** A repeatable retrieval evaluation reports precision/recall or a justified task-specific equivalent, stale-fact detection, source coverage and answer-groundedness.

### Track D — Multi-agent coordination (P2)

1. Start with a single orchestrator and narrowly scoped specialist roles.
2. Use explicit typed handoffs: task ID, objective, inputs, output schema, evidence, risk class, deadline, cost ceiling and stop condition.
3. Give each specialist least-privilege tools and isolated working context.
4. Use shared durable task state only through the canonical ledger/queue.
5. Require the orchestrator to reconcile contradictions and verify evidence before publishing a result.
6. Use parallel agents only when subtasks are independent and the expected gain exceeds coordination cost.
7. On partial failure, preserve successful outputs, retry only the failed subtask and prevent duplicate side effects.

**Acceptance:** A synthetic multi-agent task completes with traceable handoffs, bounded cost, no privilege escalation, correct conflict handling and a final evidence-backed result. Compare against a single-agent baseline.

### Track E — Tool use and MCP (P2)

1. Inventory existing connected APIs and their supported operations before adding another adapter.
2. Normalize tool metadata: capability, input/output schema, authentication mode, owner scope, idempotency, read/write risk, rate limits, timeout and evidence contract.
3. Use typed function calls and validate tool outputs before downstream use.
4. Treat web pages, files, tool outputs and retrieved content as untrusted data; never treat them as executable instructions.
5. Add negative tests for wrong owner, wrong account, invalid parameters, missing permission, stale approval and secret exposure.
6. Keep secrets server-side and out of prompts, task payloads, source control, client code and logs.

**Acceptance:** Contract tests prove allowed operations work and unauthorized or malformed operations fail closed.

### Track F — Evaluation, security and optimization (continuous)

- Use the Stanford evaluation framing: request, environment, stopping criteria and scorer.
- Maintain task-specific regression suites for revenue research, agent coding, browser execution and Control Room operations.
- Record success rate, false-positive rate, recovery rate, latency, token/provider cost and evidence completeness.
- Use deterministic tests before model-judge evaluation. Calibrate any LLM judge against human-labelled examples and document bias/variance.
- Run prompt-injection, indirect-injection, tool-abuse, path traversal, cross-account access and secret-leakage tests in isolated environments.
- Optimize prompts, retrieval, model routing or weights only after a baseline exists and the change improves task quality without weakening security or increasing unit economics beyond the approved ceiling.

## 5. Immediate execution sequence

| Order | Action | Existing surface to reuse | Exit evidence |
|---:|---|---|---|
| 1 | Keep this adoption map as the cross-chat engineering reference | This document + architecture governance | Branch commit and reviewed ownership |
| 2 | Build the revenue-agent evaluation harness around existing qualification code | Revenue Radar and `midad-intelligence` tests | Deterministic report from synthetic fixtures |
| 3 | Exercise one synthetic mission through existing job/ledger contracts | Existing Browser Gateway/ledger contracts | Restart/idempotency/recovery test report |
| 4 | Measure retrieval and source freshness | Existing research/Vespa foundation | Retrieval benchmark and stale-source report |
| 5 | Run multi-agent and security acceptance tests | Existing Force Super and policy boundaries | Traceable run report, denial tests and cost |
| 6 | Enable only verified improvements behind existing feature/policy gates | Existing Control Room and deployment workflows | CI pass, runtime smoke evidence and rollback note |

Do not start Tracks 2–6 merely by creating more documentation. Implement one smallest end-to-end increment at a time, test it, then integrate it.

## 6. Current constraints and explicit non-actions

- The VPS/Remote Desktop path is deferred because of the known connectivity/proxy blocker. Do not retry it unless reopened.
- Supabase has a known storage/quota/read-only incident. Do not assume writes or migrations are available; do not repeat failed write-path attempts.
- Prefer zero/low-budget execution. Show and verify cost before enabling paid or metered infrastructure.
- Do not attach a second polling gateway to a production Telegram bot.
- Keep live trading, wallet signing, transfers, withdrawals and irreversible financial actions disabled unless the exact action is separately approved.
- No service, schema, secret, wallet, bot, hosting plan or external account is created or changed by this reference document.

## 7. Continuity record

When MIDAD work resumes in any conversation, load this decision and continue from the latest verified implementation record:

- **Official engineering reference:** Stanford CS329Z — Engineering AI Agents, Fall 2026.
- **Canonical application repository:** `Sirahwaz/Control-room`.
- **Intelligence repository:** `Sirahwaz/midad-intelligence` (read-only discovery/qualification scope).
- **Preservation rule:** extend existing components; do not rebuild by default.
- **Immediate highest-value engineering action:** implement the P0 revenue-agent evaluation harness against existing qualification code and synthetic fixtures, then run it.
- **Open proof gaps:** live Browser worker/queue integration, full durable execution and restart recovery, production RAG quality, cross-agent benchmark and live deployment status must be tested separately.
- **Source review baseline:** Control-room main commit `33e09c3faba103505fe298ffcf1a0fc76c94482f` (2026-11-14). This baseline identifies reviewed source; it is not a deployment claim.

## 8. Primary reference

- Stanford CS329Z course site and schedule: https://cs329z.stanford.edu/
- MIDAD integration map: `.agents/skills/MIDAD_INTEGRATION.md`
- MIDAD Nanobot runtime gate: `.agents/skills/midad-nanobot-runtime/SKILL.md`
- Browser runtime README: `tools/midad-browser-runtime/README.md`
- Architecture governance: `docs/architecture/ARCHITECTURE_GOVERNANCE.md`
- Control Room module ownership: `docs/architecture/CONTROL_ROOM_MODULE_MAP.md`
- Browser execution architecture: `docs/architecture/MIDAD_BROWSER_EXECUTION_FABRIC.md`
- Revenue runtime boundaries: `docs/architecture/REVENUE_RUNTIME_COMPONENTS.md`
- Read-only intelligence workspace: `Sirahwaz/midad-intelligence/README.md`
