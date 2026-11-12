# MIDAD Continuity Fabric v1

**Status:** P0 planner, P1 SQLite Durable Object ledger, P2 Queue/WebSocket wake-on-work source/configuration, tests and protected deployment workflow are merged to `main`. No Cloudflare deployment, Queue resource, secret, or production connection has been created. P3 worker-v2 and P4 Android participant remain pending.

## Design thesis

MIDAD does not need one process to remain alive forever. It needs its **service contract and task state to survive** while execution processes are replaceable.

The Continuity Fabric separates:

1. **Logical continuity** — a durable task envelope, event history, checkpoints, idempotency key and lease.
2. **Wake-up plane** — an authenticated event starts an available worker only when work exists.
3. **Execution plane** — a short-lived runner or an explicitly enrolled device performs a bounded unit of work.
4. **Recovery plane** — expired leases return only unfinished, safely retryable shards to the queue.

This removes the always-running-daemon requirement for suitable workloads. It does not create compute from nothing: throughput remains bounded by real enrolled CPU/GPU capacity, network bandwidth, storage, and the parallelizable fraction of the workload.

## Execution lanes

| Lane | Best use | Continuity model | Important constraint |
|---|---|---|---|
| GitHub Actions | CI, builds, stateless browser checks, CPU shards | Event-triggered ephemeral runner | This MIDAD repository is public; standard GitHub-hosted runner use is free for public repositories. Each job is limited to 6 hours. Never place customer secrets or private session data in public logs/artifacts. |
| Cloudflare Durable Objects / Queues | Lightweight coordination, wake events, leases, status | Hibernating stateful coordinator plus durable messages | Free limits are finite. Queues consumers run for at most 15 minutes; this is not a Chromium host. |
| Android MIDAD Browser | Interactive browsing and user-owned device capacity | User-started visible session; checkpoint then pause | Android background-service rules prevent hidden guaranteed 24/7 execution. Android 15 also applies time budgets to certain foreground-service types. |
| Owned VPS | Small supervisor, relay and health checks | Persistent lightweight process | Probe actual memory/CPU/disk first. The known 512 MB VPS is not a Chromium or large coding-agent host. |
| Other participant devices | Federated compute for users who explicitly enroll their own machines | Opt-in agent with revocation and signed heartbeat | No silent execution, no use of third-party resources without explicit authorization. |

Official platform constraints are recorded here for design decisions:
- GitHub Actions billing and runner limits: https://docs.github.com/en/actions/concepts/billing-and-usage and https://docs.github.com/en/actions/reference/limits
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Durable Objects limits/pricing: https://developers.cloudflare.com/durable-objects/platform/limits/ and https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare Queues limits: https://developers.cloudflare.com/queues/platform/limits/
- Android foreground-service background-start restrictions and timeouts: https://developer.android.com/develop/background-work/services/foreground-services/fgs/restrictions-bg-start and https://developer.android.com/develop/background-work/services/fgs/timeout

## Workload classes

- **CPU_BATCH:** independent, deterministic chunks. Safe to fan out when the caller explicitly marks the task shardable.
- **WEBGPU_BATCH:** only nodes that report real `webgpu-compute` capability may receive shards. A CPU is not relabelled as a GPU.
- **BROWSER_SESSION:** one stateful browser session stays on one enrolled executor. It requires interactive-browser, persistent-session and encrypted-session-store capabilities. It is never split across browsers.
- **SINGLE:** serial work that cannot safely be decomposed.

The scheduler prefers zero-cost nodes, then uses observed capacity and reliability. A cost ceiling defaults to USD 0. A metered provider is not an automatic fallback.

## Task lifecycle

```text
REQUEST
  -> VALIDATE CONTRACT + POLICY
  -> WRITE DURABLE TASK ENVELOPE
  -> EMIT WAKE EVENT
  -> WORKER AUTHENTICATES + CLAIMS ATOMIC LEASE
  -> RECHECK HEARTBEAT / CAPABILITIES / COST
  -> EXECUTE BOUNDED SHARD
  -> WRITE CHECKPOINT + EVIDENCE
  -> ACK / RELEASE LEASE
  -> NEXT SHARD OR COMPLETED
```

On a worker crash, an unfinished shard is eligible for re-claim only after lease expiry. Delivery is at-least-once, not exactly-once; stable idempotency keys prevent duplicate processing where the operation supports it. If an external side effect has an unknown outcome, the system must reconcile evidence or request human review rather than blindly repeat it. Repair attempts remain capped at three per incident.

## Current planner contract

`continuity-planner.mjs` compiles a deterministic plan from a task envelope and node snapshots. It checks:
- explicit enrollment, consent and authentication;
- node state and fresh heartbeat;
- declared capabilities, memory, CPU and free slots;
- estimated cost against the task ceiling;
- workload-specific sharding constraints;
- stable shard idempotency keys and checkpoint keys;
- bounded lease TTL and recovery policy.

The planner always returns `dispatch_allowed: false` and `execution_performed: false`. It is not a dispatcher, queue, browser worker or proof that a node is online. The trusted dispatcher must independently authenticate the node, verify fresh signed runtime evidence and atomically claim the durable lease immediately before execution.

## Phased implementation

1. **P0 — Planner core:** pure scheduler, consent/capability/cost checks, deterministic sharding and tests. Merged to `main`.
2. **P1 — Durable ledger adapter:** SQLite-backed Durable Object ledger source and local contract tests are merged to `main`; not deployed. Keep Supabase as a compatible adapter only after its write path is healthy. Do not migrate or mutate production automatically.
3. **P2 — Wake-on-work transport:** the ledger writes a Queue outbox row in the same SQLite transaction as a new task; a Durable Object alarm publishes a payload-free wake envelope; the Queue consumer authenticates to the ledger and fans out an owner-scoped WebSocket hint. Workers still use pull-claim for the lease. Queue delivery is at-least-once; duplicates are harmless hints. Wrangler preview, Queue resource creation, secrets and live handshake are still required before this is operational. GitHub Actions remains the stateless CI/build runner, not the stateful queue consumer.
4. **P3 — Stateful browser node:** deploy `operator_worker_v2` to a resource-qualified, explicitly enrolled host; encrypted session storage, authenticated queue, atomic leases, <=45-second heartbeat.
5. **P4 — Android participant:** visible user-started browser/worker mode, pause/resume and revocation. Background execution remains best-effort under Android policy.
6. **P5 — Federated scale:** admit additional owner-operated devices only after signed enrollment, capability attestation, quotas, isolation and revocation tests.

## Verified blockers at design time

- The production Supabase provider row labelled `online` has stale metadata: last heartbeat 2026-11-05 and version `operator_worker_v1`; it is not a live worker.
- The deployed browser gateway exists, but the current worker lease migration and worker-v2 deployment have not been applied.
- The smoke runner function is intentionally disabled after its prior one-shot test.
- The 512 MB VPS is not accepted for Chromium until a fresh resource probe proves otherwise.
- No Codespace or paid compute is assumed or created.

## P2 — Wake-on-work contract (source merged to main, not deployed)

- New tasks and their wake-outbox records are inserted in one Durable Object SQLite transaction.
- The Durable Object alarm publishes up to 50 pending outbox rows per pass. A row is marked published only after Queue accepts the message; failed sends stay pending and are rescheduled.
- Queue consumers validate the event contract and call the ledger through an internal endpoint protected by a separate `MIDAD_WAKE_INTERNAL_KEY` secret. Before fanout, the ledger binds the event, task and owner IDs to the persisted outbox record.
- The ledger broadcasts only `TASK_AVAILABLE` identifiers to authenticated WebSockets tagged to the same owner. Node revocation closes that node's WebSocket.
- WebSocket messages never contain the task payload, session state, API keys or lease token. A wake is not authorization and does not claim a task.
- The node must call authenticated `POST /v1/tasks/claim`; existing owner, fresh-heartbeat, capability, resource, cost and lease checks remain authoritative.
- Queue delivery is at-least-once. A crash after Queue acceptance but before outbox acknowledgement can duplicate the wake; clients deduplicate by `event_id`. The task is not duplicated because the ledger remains the source of truth.
- If the Queue binding is absent, the ledger health response reports pull-claim fallback. The implementation is not live until the two Queue resources exist, both secrets are set, Wrangler preview passes, and an enrolled node completes a real WebSocket → pull-claim smoke test.

## Non-goals and safety

No stealth mining, hidden resource use, unauthorized third-party compute, CAPTCHA/KYC/2FA bypass, credential harvesting, browser-policy evasion or unapproved financial actions. Every device owner can revoke enrollment. Secrets stay in server-side secret stores; task payloads and public artifacts contain identifiers and evidence, not credentials.

## Performance reality

The Fabric can outperform a single small VPS on **embarrassingly parallel** work when enough real nodes are available. It cannot guarantee supercomputer-class performance, low latency, GPU throughput or availability with no enrolled resources. A serial browser session remains serial; GPU work requires actual GPUs/WebGPU nodes. The innovation is continuity, admission control, resumability and elastic aggregation—not a claim that software abolishes hardware limits.


## P1 — Durable ledger adapter (implemented, not deployed)

The companion `continuity-ledger/` directory contains a Cloudflare SQLite-backed Durable Object Worker and Wrangler v1 migration. It persists task state/events and provides authenticated owner-approved node enrollment, heartbeats, atomic claims, lease renewal, checkpoints, completion, failure and revocation. The ledger is a coordinator, not a compute provider.

- Node credentials are issued once and stored only as SHA-256 digests.
- Each heartbeat is constrained by the owner-approved enrollment capability set.
- Each task is owner-scoped and has an explicit verified cost ceiling.
- Browser jobs require encrypted session storage and a runtime version; they are forced to human reconciliation after ambiguous loss.
- Current transport is authenticated pull-claim. No Cloudflare Queue binding or GitHub wake dispatch is enabled yet.
- Local SQLite contract tests: 13 cases. Actual Wrangler preview and live Cloudflare deployment remain separate verification gates.

## Zero-daemon online target — MNCF v2

**Target operating model:** always-on logically, ephemeral physically. A persistent Linux/VPS host is not required for baseline online availability.

- Cloudflare Worker + SQLite Durable Object + Queue provide the intended durable coordination path. Their source is merged, but production deployment and health are not verified.
- GitHub-hosted Linux Actions runners provide disposable compute for bounded builds, tests and browser smoke. The existing Forge runner is retained; its current task intake still uses the existing Supabase Forge OIDC path.
- The Cloudflare-to-GitHub runner dispatch adapter remains **PENDING**. Until it is implemented and live-tested, do not describe Cloudflare as dispatching GitHub compute.
- GitHub Playwright smoke is intended to run on pull requests with read-only permissions and no secrets. Browser Run is a separate quota-limited candidate adapter; it is not the general-purpose compute layer.
- Persistent Linux/Playwright nodes and VPS are optional specialist workers only, selected when a verified workload requires persistent local state, specialised egress or resource headroom.
- Preserve the existing Forge/Continuity ledgers during migration. No parallel queue, replacement orchestrator or Supabase cutover is authorized by this design note.

**Acceptance gate:** prove task intake → durable lease → ephemeral GitHub runner → checkpoint/result → independent verification → Control Room receipt with no VPS; then inject duplicate delivery, runner loss and expired leases. Production Cloudflare activation and any cutover remain separate approvals.


## P2a — GitHub-hosted Continuity node (source implemented; activation pending)

A new optional, disposable GitHub Actions node polls the Cloudflare Continuity Ledger every five minutes. It does not use a persistent Linux/VPS host and does not create a second task queue.

- Workflow: `.github/workflows/midad-continuity-github-ephemeral-node.yml`
- Runtime: `compute/mncf/runtime/continuity-github-runner.mjs`
- Contract tests: `tests/midad-continuity-github-runner.test.mjs`
- Authentication: owner-approved enrolled node token, stored only as the GitHub Actions secret `MIDAD_CONTINUITY_NODE_TOKEN`. Identity values are GitHub Actions variables: `MIDAD_CONTINUITY_LEDGER_URL`, `MIDAD_CONTINUITY_NODE_ID`, `MIDAD_CONTINUITY_OWNER_ID`.
- Capabilities: `generic-execution` and `midad.public-read-only-probe`.
- Task contract: `SINGLE` workload with exact payload `{schema: "midad-public-probe-v1", operation: "GET_EXAMPLE_DOMAIN"}`.
- Permitted effect: one fixed HTTPS GET to `https://example.com/`, with redirects rejected and the response capped at 64 KiB. The runner returns status, byte count, content type and SHA-256 only; it never returns page content.
- One task per ephemeral run, 120-second lease, idempotent retry semantics, 3-attempt maximum, no Shell command execution, no arbitrary task URL, no user credentials, no Supabase/business-table writes, and no financial capabilities. The only persistent writes are the task, heartbeat, lease, checkpoint and evidence records in the Continuity Ledger.
- The scheduled poll is a **pull/claim integration**. Cloudflare does not yet push-trigger GitHub Actions; the source for a push-triggered GitHub App bridge remains a separate future adapter.
- If the ledger variables or node token are absent, the workflow exits as `MIDAD_CONTINUITY_NODE_NOT_ENROLLED` without claiming work.

### Activation gate
1. Deploy the existing Cloudflare Continuity Worker and Queues under the separate protected production approval gate; verify `GET /health`.
2. With owner consent, enroll node `midad-github-hosted-runner` for the correct owner and exactly the two capabilities above. The returned token is one-time; retain it privately.
3. Add the three identity values as GitHub Actions Variables and the one-time enrollment token as the GitHub Actions Secret. Never put token material in task envelopes, repository content, issue comments, logs or chat.
4. Enqueue one harmless task with workload `SINGLE`, required capability `midad.public-read-only-probe`, retry mode `AT_LEAST_ONCE_IDEMPOTENT`, `units=1`, `estimated_seconds_per_unit=15` and `max_cost_usd=0`.
5. Verify node heartbeat, atomic claim, checkpoint, completion evidence and final task state in the ledger. Then test duplicate delivery, runner loss and lease expiry.

**Current status:** source and unit/contract tests are in a draft PR; the Cloudflare Worker is not deployed, no GitHub node is enrolled, no Actions variables/secrets have been configured, and no live end-to-end claim has been performed. The existing Forge/Supabase OIDC queue remains unchanged and authoritative for Forge jobs.


## MNCF ephemeral CPU dispatch — source integrated, activation pending

- Cloudflare Continuity remains the task/lease/checkpoint authority. Its Queue consumer can dispatch only eligible `CPU_BATCH` wake events to the fixed `.github/workflows/midad-mncf-ephemeral-runner.yml` workflow.
- GitHub authentication is a repository-scoped App installation token with `Actions: write` only. Workflow inputs contain only event, task and owner identifiers.
- The runner uses a separately enrolled owner-bound token, claims the exact task ID, and accepts only `RUNNER_SMOKE`, `SUM_INTEGERS`, and `HASH_TEXT`. Arbitrary shell/code and Browser Session tasks are excluded.
- Browser Run remains a separate Browser-capable service. GitHub CPU runners do not host persistent browser sessions.
- Source integration does not imply live service: Cloudflare deployment, GitHub App secrets, runner node enrollment, and an end-to-end claim/complete smoke remain pending.


## MNCF Elastic Runtime v2 — event fast path + scheduled recovery path

The CPU_BATCH execution lane now has two independent wake mechanisms over the same durable task/lease authority:

1. **Fast path:** Cloudflare Queue validates the persisted wake event and invokes the allowlisted GitHub Actions workflow through the repository-scoped GitHub App with Actions: write only.
2. **Fallback path:** if the optional GitHub App integration is entirely absent, the Queue acknowledges the already validated/broadcast wake instead of retrying it into the DLQ. The GitHub-hosted CPU runner polls the same ledger on a five-minute schedule and claims at most one eligible task for its enrolled owner.

The runner uses the existing github-actions-cpu-batch identity, owner-bound enrollment token, cpu-batch capability, task allowlist, atomic lease, checkpoint and evidence path in both modes. Event-triggered runs claim the exact task ID; scheduled runs omit the task filter and rely on the ledger's authenticated node owner scope and capability/resource/cost checks. A scheduled invocation without owner variables or an enrollment token exits without claiming work.

This is logical continuity with replaceable ephemeral runners, not an always-open process. Scheduled triggers are best-effort and can be delayed by GitHub; the fallback does not guarantee a task starts at an exact five-minute boundary. It does not execute Browser Session or WebGPU tasks, run arbitrary shell/code, create a second queue, start a VPS, or enable paid services. A partially configured GitHub App remains fail-closed and is surfaced as a retryable dispatch failure rather than silently falling back.

**Source status:** implemented in PR #248; production Cloudflare resources/secrets, the GitHub App integration, the enrolled CPU node token and a live task completion remain unverified/pending.


### CPU ephemeral node — activation checklist (source in PR #248)

After the PR is merged and the Continuity Worker is deployed:

1. Confirm the public `/health` response reports the expected Continuity service and schema.
2. Enroll `github-actions-cpu-batch` through the protected admin API with explicit owner consent and only the `cpu-batch` capability.
3. Save the one-time enrollment token as GitHub Actions Secret `MIDAD_CONTINUITY_RUNNER_NODE_TOKEN`.
4. Save the HTTPS Worker origin as repository Variable `MIDAD_CONTINUITY_LEDGER_URL`; save the same `owner_id` used for enrollment as Variable `MIDAD_CONTINUITY_OWNER_ID`.
5. Trigger one harmless allowlisted `CPU_BATCH` task and verify heartbeat → CPU-only claim → checkpoint → completion receipt. Then test duplicate wake delivery and expired lease recovery.

No token or enrollment is included in this repository change. Until this checklist is completed against a deployed Worker, the scheduled fallback is **source-ready / activation-pending**, not live.
