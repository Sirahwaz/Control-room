# Context Forge — Practical General-Purpose Agent Runtime Specification

**Status:** Architecture contract for staged implementation  
**Scope:** Independent developer product built through MIDAD Mobile Factory  
**Non-goal:** Claiming that current software has achieved human-level Artificial General Intelligence (AGI).

## 1. Product definition

Context Forge is a Context Engineering platform with a model-agnostic, bounded agent runtime. Its purpose is to help developers construct agents that can take a goal, assemble evidence-linked context, create a plan, use explicitly registered tools, inspect results, evaluate success, and recover from failures without silently exceeding their authority.

"Realistic AGI" is treated as a long-term engineering direction toward broader generality, not a product label or a capability assumed to exist. The system must disclose which capabilities are implemented, simulated, unavailable, or awaiting integration.

## 2. Runtime architecture

1. **Context Store and Compiler** — transforms user-approved inputs into versioned packages, preserves provenance, flags conflicts, and distinguishes claims from verified evidence.
2. **Reasoner Adapter** — a replaceable interface to a local or hosted model. It must return validated structured plans and support timeout, token/cost budgets, cancellation, and provider fallback. No provider is enabled until configured and tested.
3. **Planner** — decomposes goals into typed steps with expected outputs, dependencies, preconditions, and completion tests.
4. **Capability Registry** — explicit tool manifests define name, effect, permissions, input/output contract, timeout, idempotency support, and whether human approval is mandatory.
5. **Policy Gate** — checks identity, requested effect, execution mode, budgets, approval scope, and risk. Unknown tools and unknown effects fail closed.
6. **Executor** — runs one authorized action at a time, returns structured results, and must honor abort signals and idempotency contracts.
7. **Observer and Evaluator** — compares actual results to acceptance criteria using evidence. A model's self-assertion is not sufficient proof of completion.
8. **Memory and Learning** — stores versioned task outcomes, corrections, and evidence lineage. New memories remain attributed and reversible; conflicting memories are not silently merged.
9. **Audit and Control Surface** — records state transitions, tool decisions, outcomes, and errors without storing secrets or unnecessary payloads.

## 3. Agent control loop

~~~text
GOAL
  -> OBSERVE approved context
  -> PLAN typed steps and completion criteria
  -> VALIDATE plan structure and budget
  -> POLICY CHECK each tool against registry and risk
  -> HUMAN APPROVAL where required
  -> EXECUTE one step
  -> OBSERVE result
  -> VERIFY against evidence and acceptance tests
  -> UPDATE versioned memory if permitted
  -> COMPLETE | REPLAN | BLOCK | ESCALATE
~~~

Do not retry a completed side effect just because the response or audit write failed. Reconcile state first. Every external action must be idempotent where possible or require an explicit preflight.

## 4. State model

Use these durable states across the UI, API, memory, and audit stream:

- **VERIFIED** — backed by evidence that meets a defined verification procedure.
- **INFERRED** — derived from evidence, but not directly confirmed.
- **PENDING** — awaiting evidence, a tool result, or human review.
- **FAILED** — an attempted operation failed and its result is known.
- **BLOCKED** — policy, missing authority, a risk limit, or a required dependency prevents execution.

User-provided text must not be promoted to VERIFIED merely because a model repeats it. Keep source, capture time, validity interval, and verification method.

## 5. Tool risk model

- **read** — permitted only through an explicitly registered read adapter; default system mode remains dry-run.
- **write** — requires explicit, scoped approval in the MVP policy.
- **external_message / publish / delete / destructive / financial** — require scoped human approval, a preflight summary, and an audit event before and after action.
- **unknown or disabled** — always denied.
- **audit unavailable** — do not begin a consequential action.
- **repair** — maximum three planning attempts; execution errors do not trigger automatic replay of side-effecting steps.

Approval must identify the exact tool, effect, user, intended scope, and expiry; a generic "agent is allowed" flag is not sufficient.

## 6. Memory contract

Memory is not a raw dump of conversation history. Store typed records with:
- content or a controlled reference to content;
- source URI or source class and content hash where practical;
- observed_at, recorded_at, and optional valid_until;
- status, confidence rationale, sensitivity classification, and tenant owner;
- links to decisions/tasks that depend on the record;
- revision, supersedes, and reversible deletion metadata.

Retrieval must be task-specific, respect least privilege, and surface conflicting records instead of arbitrarily selecting one. Secret material should be excluded from normal context and retrieved only through an approved secret-management interface when strictly required.

## 7. Evaluation gates

Before an adapter can be enabled:
1. unit tests for its contract and failure modes;
2. authentication, tenancy, permission and prompt-injection boundary tests;
3. golden-task evaluation for groundedness, context precision/recall and task success;
4. measured latency and cost under a declared budget;
5. failure behavior verified for timeout, quota exhaustion, malformed model output and network outage;
6. audit completeness and explicit operator-visible error states.

Suggested release thresholds are product decisions, not assumptions: establish a baseline first, then agree a minimum task success rate and maximum cost per successful task for each use case.

## 8. Stage gates

- **P0 — Local deterministic core:** context compiler, provenance status, basic conflict candidates, bounded planner/tool kernel, tests. No network or model calls.
- **P1 — Reasoning adapter:** one provider first, optional local adapter later; secrets remain outside the app bundle. Dry-run by default.
- **P2 — Read-only tool adapters:** explicit allow-list, typed schemas, timeout, audit, replay-safe tests.
- **P3 — Durable context memory:** local database plus optional hosted adapter, tenant isolation, retention and deletion controls.
- **P4 — Controlled write tools:** scoped approval UI, preflight and post-action verification. Never enable by default.
- **P5 — Learning and evaluation:** golden tasks, error taxonomy, regression tests and bounded repair. No hidden self-modification or unreviewed production code changes.

P0 source code can be tested without external API credentials. P1 and later remain BLOCKED until the provider, credentials mechanism, runtime environment, and budget are explicitly configured and verified.

## 9. Current implementation boundary

Implemented in this branch:
- deterministic context compiler;
- source-line metadata and UNVERIFIED status for user inputs;
- narrow positive/negative contradiction candidate detection;
- OpenAI-compatible reasoning adapter with structured-plan validation, bounded request timeout, local loopback support, explicit remote-transmission opt-in, and basic secret-pattern blocking;
- sanitized capability manifests passed to the planner; returned plans must use the provided tool allow-list;
- bounded planner retries (maximum three);
- explicit tool registry and dry-run default;
- scoped approval for non-read effects;
- audit-before-execution and fail-closed behavior when audit is unavailable;
- unit tests for context compilation and critical policy boundaries.

Not yet implemented:
- configured/live language-model connection (adapter is source-complete but has not been invoked against a real provider);
- real external tool adapters;
- authenticated multi-user backend or durable memory;
- mobile package, production signing, public deployment, billing, or revenue collection;
- broad semantic reasoning or human-level AGI.

Do not mark these pending capabilities as completed until code, credentials/configuration, runtime checks, and evidence are all available.
