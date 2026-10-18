# Context Forge — Developer Preview

**Status:** MVP foundation in progress · **Version:** 0.1.0  
**Location:** products/context-forge/ on branch context-forge-mvp

Context Forge is an independent Context Engineering workbench for developers building AI agents. It turns user-provided notes into a structured, provenance-aware context package and explicitly keeps unsupported claims unverified.

## What works in this preview

- Local-only import and analysis of Markdown, text, and JSON.
- Deterministic context compilation into goals, constraints, decisions, open questions, and claims.
- Line-level source metadata and explicit UNVERIFIED status for user-provided claims.
- Heuristic detection of a narrow class of explicit positive/negative conflicts.
- JSON export and versionable schema.
- A standalone HTML/CSS/ES-module frontend with no third-party runtime dependencies.
- Testable engine behavior using Node's built-in test runner.

## Honest capability boundary

This is **not AGI** and it does not make model calls or autonomous external actions. The current engine uses deterministic rules. A lack of detected conflicts is not proof that the context is consistent, and source attribution is not the same as source verification.

The product is designed as a foundation for increasingly general, bounded agents: goal decomposition, model-agnostic reasoning adapters, capability-limited tool use, evidence-linked memory, evaluation, and bounded recovery. Those capabilities are not represented as active until their adapters and runtime tests exist.

## Local run

Requirements: Node.js 22+ and a static HTTP server (ES modules are generally blocked when opened directly via file://).

~~~bash
npm test --prefix products/context-forge
npm run check --prefix products/context-forge
python3 -m http.server 8080
~~~

Then open http://localhost:8080/products/context-forge/ from the repository root.

## Package contract (v0.1)

- Schema: context-forge/0.1
- Claims from user input remain UNVERIFIED.
- Each claim includes input type, line number, and captured timestamp.
- Conflicts are candidates marked PENDING_REVIEW, never silently resolved.
- Execution policy defaults to analysis_only; high-impact actions require explicit human approval.
- This preview does not persist context to a server or browser storage.

## Roadmap toward a more general agent runtime

### 1. Context correctness
Add source adapters, stable content hashes, expiry/validity metadata, duplicate detection, and explicit evidence links. Separate sourced facts, user claims, model inferences, and unresolved items.

### 2. Model-agnostic reasoning
Define an adapter contract for model providers, structured output validation, token/cost budgets, timeouts, and provider fallbacks. Do not store API keys in context packages; inject credentials only on a trusted server or local runtime through an approved secret store.

### 3. Bounded planning and tool use
Use a loop of **Observe → Plan → Policy Check → Execute → Verify → Learn**. Every tool has a capability manifest, typed input/output, idempotency policy, timeout, budget, and audit event. Start in dry-run/read-only mode. Gate payments, publishing, deletion, external messages, and other consequential actions behind human approval.

### 4. Memory with provenance
Use a versioned store with tenant isolation, source lineage, timestamps, confidence/status labels, deletion controls, and retrieval evaluation. Memory updates should be append/version based and reversible; no silent overwrites of prior decisions.

### 5. Evaluation and bounded self-repair
Build golden tasks and adversarial tests. Measure context precision/recall, groundedness, task success, latency, and cost. Allow at most three bounded repair attempts per incident before escalation. Never define success as merely producing an answer.

### 6. Portable deployment
Keep the core independent from MIDAD, n8n, any specific model vendor, and any particular database. Supply browser UI, Android companion, REST API, and a self-hostable runtime from the same documented contracts. Preserve working Mobile Factory templates and share them only through stable interfaces.

## Architecture guardrails

- Audit → Preserve → Repair → Integrate → Upgrade.
- No secrets in source control or exported context.
- No fabricated verification status, external tool access, or completed actions.
- Read-only/local analysis first; least privilege by default.
- Model and storage providers are replaceable adapters.
- Versioned schemas and deterministic tests gate changes.

## Known limitations

- Heuristics support only a narrow subset of natural-language patterns.
- Semantic contradictions, temporal reasoning, cross-file provenance, retrieval, and model-based evaluation are not implemented yet.
- No live model connection, login, multi-user service, persistent backend, APK, or hosted deployment is part of this initial commit.
