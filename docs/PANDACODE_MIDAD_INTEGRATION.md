# PandaCode → MIDAD Agent Fabric Integration

**Status:** AUDIT COMPLETE · INTEGRATION CONTRACT PROPOSED · RUNTIME ADAPTER NOT CONNECTED

**Reference:** https://github.com/aicodeking/pandacode  
**MIDAD target:** `Sirahwaz/Control-room` → `mobile/factory/x/`

## Decision

Adopt selected architectural patterns from PandaCode inside the existing MIDAD Factory X. Do not fork, vendor, or replace PandaCode; do not rebuild the MIDAD orchestrator, Factory X, Mobile Factory, or Control Room.

MIDAD remains the system of record for task identity, authorization, policy, approvals, evidence, provider selection, and outcome reporting. Coding-agent runtimes are replaceable execution adapters.

## Verified source comparison

### PandaCode patterns observed in upstream documentation/source

- A normalized provider/harness boundary across multiple coding CLIs and protocols, including ACP and provider-specific session protocols.
- Architect-led teams with up to three workers and mixed harness/model choices.
- Persistent task threads, queued/steered messages, and task-board states.
- Per-task Git worktrees, diff review, staging, and explicit merge into the main checkout.
- Approval prompts and provider-native permission modes.
- Local and cloud sandbox execution, with Android emulator/iOS simulator tooling.
- Local SQLite persistence and bounded transcript/output handling.

PandaCode is a native Tauri 2 + Rust + TypeScript desktop application. Its desktop process model is not itself a deployable MIDAD server-side API.

### Existing MIDAD components confirmed on `main`

- Factory X registries: 38 agent roles, 38 bindings, and 8 adapter types.
- Bounded execution configuration: up to 32 agents and 64 tasks; repair attempts capped at 3.
- Existing deterministic planner, execution engine, and `MIDAD-FX-1` execution-fabric planner.
- Existing local, host-connector, serverless, external-API, CI, browser, approval, and blocked adapter lanes.
- Existing Mobile Factory and Android build/runtime-smoke workflows.
- Existing Replica Lab → Factory handoff contract, including authorization scope, artifact hashes, tool versions, and explicit BLOCKED states.
- Existing Control Room / AI Room read-only agent readiness surface.

### Gaps that remain unverified or absent from the current main-branch contract

- No verified ACP client/runtime adapter that launches and manages coding-agent processes.
- No normalized coding-harness lifecycle contract for start, stream, resume, cancel, exit status, and usage metadata.
- No verified per-task Git worktree manager in Factory X's adapter registry.
- No runtime proof that Factory X dispatches its planned coding tasks to a live worker. A generated dispatch plan is not execution evidence.
- No verified MIDAD-owned server-side bridge from Telegram/Control Room to a persistent coding-agent worker.

These are integration gaps, not reasons to replace the existing execution fabric.

## Target architecture

```
Control Room / Telegram / API
          |
MIDAD task identity + policy + approval
          |
Factory X planner + MIDAD-FX-1 envelope
          |
CodingAgentAdapter (new, server/worker side)
          |
  +-------+---------+-----------+
  |                 |           |
ACP harnesses   Native CLI   Future runtimes
  |                 |           |
isolated task worktree + bounded output/session state
          |
diff + tests + evidence bundle
          |
MIDAD verifier + human approval for merge/release
```

## Proposed adapter contract

The first implementation should be a narrow, provider-neutral contract. It must not expose provider credentials or arbitrary shell execution to the browser or Telegram client.

Required request fields:

- `protocol_version`, `task_id`, `run_id`, `provider_id`, `model_id`
- `repository`, immutable `base_commit`, isolated `worktree_id`
- `prompt_ref` or bounded prompt payload, allowed paths, timeout, output budget
- `permission_profile`, `approval_policy`, cancellation token reference

Required lifecycle operations:

- `capabilities()` — report supported protocols/features; no claim of connection until probed.
- `start(request)` — start one bounded task in its isolated worktree.
- `stream(run_id)` — emit normalized text, tool activity, approval requests, and usage events.
- `resume(run_id, provider_session_ref)` — resume only the same authorized task/session.
- `cancel(run_id)` — terminate the process group and release resources.
- `inspect(run_id)` — return state, exit code, changed files, test evidence, and redacted diagnostics.

Normalized terminal states: `PENDING`, `RUNNING`, `WAITING_APPROVAL`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `BLOCKED`.

## Integration sequence

1. **Preserve:** keep current Factory X registries, execution fabric, Mobile Factory and AI Room intact.
2. **Contract:** add schema/tests for the adapter envelope and lifecycle; unsupported fields fail closed.
3. **Worktree isolation:** implement a worker-side Git worktree adapter with immutable base commit, path validation, cleanup, and no automatic merge.
4. **One harness pilot:** add one provider only after its exact CLI/protocol, authentication ownership, process cleanup, and sandbox behavior are verified.
5. **Team orchestration:** implement Architect + at most three Workers as a bounded DAG using existing Factory X role/binding registries; verifier remains a separate gate.
6. **Review:** return diffs, test output, hashes, and approval requests to MIDAD. Merge/release stays human-gated.
7. **Expand:** add further ACP/native harnesses only after the first adapter passes the same contract suite.

## Security and operational invariants

- Provider credentials stay in the worker's secret store/environment and never enter client bundles, prompts, logs, manifests, or Git.
- A task can access only its authorized repository/worktree and allowlisted paths.
- Provider output, tool arguments, and repository content are untrusted data.
- No arbitrary remote shell or browser command is exposed through the adapter.
- No direct access to production Supabase secrets, wallet keys, payment signing, transfers, withdrawals, or live trading.
- Default permission mode is read-only or narrowly scoped edits; elevated actions require a task-level approval.
- Output, wall time, concurrency, and retries are bounded. Maximum 3 repair attempts per incident.
- A failed worker cannot block independent tasks; a failed safety gate blocks the affected task.
- Worktree merge, production deployment, publishing, and irreversible actions are separate human-approved operations.

## License and reuse boundary

PandaCode's repository uses a modified MIT license with an attribution condition for forks and derivative works used commercially or released publicly. This integration plan uses architectural observations and does not copy PandaCode source code, assets, or UI. Any future code reuse, fork, or derivative distribution requires a separate license review and compliance with the upstream attribution condition.

## Acceptance criteria before marking runtime VERIFIED

- Adapter contract tests cover valid/invalid envelopes, unsupported capabilities, authorization scope, and fail-closed defaults.
- Process tests cover start, stream, resume, cancel, timeout, non-zero exit, and process-tree cleanup.
- Worktree tests cover concurrent tasks, path traversal, dirty base checkout protection, cleanup, and merge refusal without approval.
- Secret-redaction tests prove provider credentials never appear in events or diagnostics.
- Approval tests prove that denied/unapproved tool actions and merges have no side effect.
- Integration smoke test uses a synthetic repository and harmless prompt; no production data or external account.
- CI reports the exact provider/runtime version, test results, artifact hashes, and remaining limitations.

**Current result:** architecture and gap analysis are verified from repository sources. No coding-agent runtime has been installed, launched, authenticated, or connected to MIDAD by this change.
