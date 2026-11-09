# MIDAD Continuity Fabric v1

**Status:** planner core and Cloudflare SQLite Durable Object ledger adapter are implemented on the PR branch; no Cloudflare deployment or production connection has been performed. Queue wake-up, trusted external dispatcher and worker-v2 deployment remain pending.

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

1. **P0 — Planner core:** pure scheduler, consent/capability/cost checks, deterministic sharding and tests. This PR.
2. **P1 — Durable ledger adapter:** add a small storage abstraction. Keep Supabase as a compatible adapter only after its write path is healthy; evaluate Cloudflare SQLite-backed Durable Objects / Queues as an optional zero-cost control plane. Do not migrate or mutate production automatically.
3. **P2 — Wake-on-work runner:** event-triggered GitHub Actions for stateless work and short-lived Playwright smoke jobs. Use only public-safe artifacts; never expose auth state.
4. **P3 — Stateful browser node:** deploy `operator_worker_v2` to a resource-qualified, explicitly enrolled host; encrypted session storage, authenticated queue, atomic leases, <=45-second heartbeat.
5. **P4 — Android participant:** visible user-started browser/worker mode, pause/resume and revocation. Background execution remains best-effort under Android policy.
6. **P5 — Federated scale:** admit additional owner-operated devices only after signed enrollment, capability attestation, quotas, isolation and revocation tests.

## Verified blockers at design time

- The production Supabase provider row labelled `online` has stale metadata: last heartbeat 2026-11-05 and version `operator_worker_v1`; it is not a live worker.
- The deployed browser gateway exists, but the current worker lease migration and worker-v2 deployment have not been applied.
- The smoke runner function is intentionally disabled after its prior one-shot test.
- The 512 MB VPS is not accepted for Chromium until a fresh resource probe proves otherwise.
- No Codespace or paid compute is assumed or created.

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
