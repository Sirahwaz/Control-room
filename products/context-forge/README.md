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
- A bounded agent-kernel contract with planner injection, explicit tool registry, dry-run default, scoped approval for non-read effects, and audit fail-closed behavior.
- An OpenAI-compatible reasoning adapter that validates structured plans against the caller-provided tool allow-list, uses server-supplied credentials, supports local loopback providers, and requires explicit opt-in before remote context transmission.
- A pre-transmission guard for common API tokens, private-key blocks, bearer credentials, JWT-like values, and named secret assignments; this is defense-in-depth, not a guarantee that every sensitive value can be detected.\n- Provider failures return sanitized messages, request timeouts are bounded, and caller cancellation is forwarded to the provider request.
- Planning retries limited to three; tool failures do not trigger blind action replay.
- Authenticated local loopback runtime with fixed static-asset allow-list, bounded request bodies, context API, and append-only audit JSONL.
- Local append-only memory store for source-tagged user notes, retrieval, cycle summaries, and inferred learning reports; likely secret material is rejected on write.
- A synthetic model-connectivity probe in the local runtime UI/API; it sends no user context and verifies only provider reachability plus the structured-response contract.\n- End-to-end Context → Plan → Verify → Memory → Learn API route. Verification applies only to plan structure/policy; task completion remains PENDING because the cycle runs in dry-run mode.
- Browser controls for the full dry-run cycle, explicit note saving, memory search, and learning-report inspection; no external tool execution endpoint is exposed.
- Deterministic unit and HTTP tests for context compilation, provider configuration, timeout/cancellation, malformed responses, sensitive-context blocking, sanitized failures, and critical tool-policy boundaries.

## Honest capability boundary

This is **not AGI**. No model endpoint or provider key is configured by default. After a provider is explicitly configured in the server environment, the local runtime can request a structured plan; the full cycle remains dry-run and executes no tools. Plan verification means deterministic policy/schema checks only, not proof that a task was completed. The memory store is local and single-user; it is not yet a multi-user or cloud memory service. A lack of detected conflicts is not proof that the context is consistent, and source attribution is not the same as source verification.

The long-term direction is a more general agent system with goal decomposition, model-agnostic reasoning, capability-limited tool use, evidence-linked memory, evaluation, and bounded recovery. See AGENT_RUNTIME_SPEC.md for the architecture contract and release gates. Capabilities are not represented as active until their adapters and runtime tests exist.

## Local run

Requirements: Node.js 22+. The integrated preview server binds to loopback only and requires a random runtime token with at least 32 characters.

~~~bash
export CONTEXT_FORGE_RUNTIME_TOKEN="replace-with-a-random-64-character-token"
npm test --prefix products/context-forge
npm run check --prefix products/context-forge
npm start --prefix products/context-forge
~~~

Open http://127.0.0.1:8787 and paste that runtime token into the local planner field. The browser UI does not save it to persistent storage. The runtime is dry-run only.

To configure a model, set `CONTEXT_FORGE_MODEL_BASE_URL`, `CONTEXT_FORGE_MODEL_API_KEY`, and `CONTEXT_FORGE_MODEL` in the **trusted runtime environment**. These values are read only by `runtime-server.mjs`; the Android/WebView UI does not receive or persist the provider key. Local loopback providers are allowed without remote consent. For example, with a local Ollama server that exposes the OpenAI-compatible API:\n\n~~~bash\nexport CONTEXT_FORGE_MODEL_BASE_URL="http://127.0.0.1:11434/v1"\nexport CONTEXT_FORGE_MODEL_API_KEY="local-placeholder"\nexport CONTEXT_FORGE_MODEL="your-installed-model-id"\nnpm start --prefix products/context-forge\n~~~\n\nUse the model ID actually installed in your local server. Remote providers must use HTTPS and require `CONTEXT_FORGE_ALLOW_REMOTE_CONTEXT=true`; set that flag only after reviewing what context will be transmitted. Never put a provider key in the browser, APK, source control, or exported context. The secret-pattern scanner is best-effort, not a complete guarantee. Provider responses and raw exception details are not returned to the browser.

## Package contract (v0.1)

- Schema: context-forge/0.1
- Claims from user input remain UNVERIFIED.
- Each claim includes input type, line number, and captured timestamp.
- Conflicts are candidates marked PENDING_REVIEW, never silently resolved.
- Execution policy defaults to analysis_only; the agent kernel defaults to dry_run.
- High-impact actions require scoped human approval in the kernel.
- Execute mode requires an audit sink and an independent verifier; high-impact actions additionally require scoped, expiring approval and a trusted one-use approval consumer.
- Local runtime audit events are written to a JSONL file by default. Only explicitly saved notes and sanitized cycle summaries are persisted; raw tool inputs are omitted from cycle memory.

## Roadmap toward a more general agent runtime

### 1. Context correctness
Add source adapters, stable content hashes, expiry/validity metadata, duplicate detection, and explicit evidence links. Separate sourced facts, user claims, model inferences, and unresolved items.

### 2. Model-agnostic reasoning
The OpenAI-compatible adapter is connected to the local dry-run planning path. Next add per-provider usage/cost reporting, budget enforcement, and reviewed fallback behavior. Do not store API keys in context packages; inject credentials only on a trusted server or local runtime through an approved secret store.

### 3. Bounded planning and tool use
Extend the existing contract into a loop of **Observe → Plan → Policy Check → Execute → Verify → Learn**. Every tool must have a capability manifest, typed input/output, idempotency policy, timeout, budget, and audit event. Start in dry-run/read-only mode. Gate payments, publishing, deletion, external messages, and other consequential actions behind scoped human approval.

### 4. Memory with provenance
The local append-only store now supports user notes, relevance-based retrieval, verified plan-policy metadata, and inferred learning summaries. Next add record revocation/deletion semantics, explicit retention, retrieval evaluation, and authenticated multi-user isolation. Never silently promote PENDING or INFERRED records to VERIFIED.

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
- The browser UI uses one local runtime bearer token; there is no multi-user identity, OAuth, or remote-hosting support.
- The local memory is append-only and single-user; record deletion, encrypted storage, semantic contradiction detection, and cross-session model-learning updates are not implemented.
- No APK, production deployment, billing, or revenue collection is part of this preview.
