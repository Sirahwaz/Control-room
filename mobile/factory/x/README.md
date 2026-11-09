# MIDAD Mobile Factory X — Intelligent Parallel App Factory

Factory X is an extension layer over the existing Mobile Factory. It preserves the existing product/build system and adds capability intelligence, provider intelligence, reusable plugins/components, dynamic agent planning, parallel execution, automation recipes, and self-audit.

## Operating contract

NEED → REQUIREMENTS → CAPABILITY DISCOVERY → PROVIDER DISCOVERY → REUSE/ADAPT/BUILD → AGENT PLAN → PARALLEL EXECUTION → AUDIT → BUILD → TEST → VERIFY → RELEASE → LEARN

Factory X never selects a provider merely because it is already connected.

## Registries

- `capabilities.registry.json`: reusable capability catalog.
- `providers.registry.json`: provider/platform/service catalog with alternatives and discovery rules.
- `plugins.registry.json`: reusable plugin/module catalog and compatibility contracts.
- `agents.registry.json`: dynamic agent roles and concurrency policy.
- `automations.registry.json`: reusable automation recipes/pipelines.
- `selection.policy.json`: need-first/provider-second selection policy.
- `factory-x.config.json`: Factory X runtime policy.
- `plan.mjs`: deterministic request → capability/provider/agent/automation plan compiler.
- `preflight.mjs`: fail-closed completeness and reuse audit.

## Provider categories

Factory X tracks more than the currently connected tools. It includes connected/known providers and explicit discovery classes for capabilities that may require a new provider, account, API, SDK, marketplace, storage layer, distribution service, observability service, billing service, or device lab.

Known ecosystem entries include GitHub, Supabase, Dropbox, Figma, Firecrawl, Context7, Hive, Linear, Notion, OpenArt, HeyGen, Railway, Speedbot, TinyFish, Remote Desktop Commander, n8n, Plugin Creator/Plugin Management, and external candidate classes such as mobile CI/CD, crash observability, push notifications, subscription billing, and object storage.

The registry records candidates as options; it does not imply an account connection or licensing.

## Hybrid execution substrates

Factory X treats execution environments as selectable substrates behind one task contract:

- **GitHub Actions** is the stateless CI/build/test runner. It is suitable for repeatable jobs and artifacts, not a persistent agent worker.
- **GitHub Codespaces** is an ephemeral development workspace. It is discovery-only until the connected account's quota, lifecycle controls and cost ceiling are checked; it must not host the always-on queue consumer.
- **MIDAD VPS Control Node** is a candidate for a lightweight persistent supervisor, health monitor and queue relay. Resource probing is mandatory before assigning browser or coding-agent workloads.
- **MIDAD Playwright Worker** is the owned interactive-browser candidate. Dispatch requires a heartbeat no older than 45 seconds, a version/capability handshake, authenticated queue access and sufficient resource headroom.
- **Android MIDAD Browser** remains the local browsing and human-checkpoint surface. It is not a server-side credential broker.

The capability registry separates `ephemeral-dev-workspace`, `stateless-ci-execution`, `persistent-worker-runtime`, `durable-task-dispatch` and `interactive-browser-execution`. The provider registry describes what an environment could do; the adapter registry controls whether it may execute. Codespaces, the VPS control node and the Playwright worker are deliberately registered as discovery/verification candidates. Their adapters remain `PENDING` with `execution: none` until live checks prove readiness.

A database status label such as `online` is insufficient. Readiness must be based on fresh heartbeat, contract version, authenticated queue access, a capability handshake, resource checks and policy. Missing or stale evidence blocks dispatch. Metered browser providers are not automatic fallbacks for the owned interactive-browser capability.

### Signed runtime evidence and plan-only substrate selection

`execution-fabric.mjs` now reads optional runtime evidence only from the protected runner environment:

- `MIDAD_FACTORY_RUNTIME_EVIDENCE`: path to a local JSON envelope (defaults to `.factory-runtime/runtime-evidence.json` when configured by the runner).
- `MIDAD_FACTORY_RUNTIME_EVIDENCE_HMAC_KEY`: minimum 32-character HMAC key injected by the trusted runner environment. Never place it in a repository file, task JSON, registry, or client bundle.

The envelope schema is `midad-runtime-evidence-v1` and contains `issued_at`, a provider-keyed `providers` object and an HMAC-SHA256 `signature` over canonical JSON. The verifier rejects missing keys, altered payloads, invalid provider ids, stale envelopes and future timestamps. Only after verification does it mark the contained snapshots as `trusted_runtime_adapter`.

A verified envelope is still only a readiness snapshot. Each candidate is checked for its own heartbeat age, required capability handshake, authenticated queue, resource probe, browser/session-store availability and budget. The resulting substrate plan is informational: `dispatch_allowed=false` and `execution_performed=false` remain explicit until a separate trusted dispatcher rechecks readiness and acquires an atomic task lease.

No runtime evidence file or HMAC key is committed to Git. The CI tests use test-only keys and synthetic snapshots; they do not create a real Codespace, deploy a worker, or contact a production host.

## Safety boundary

- Server secrets remain server-side.
- Client apps never receive privileged credentials.
- No credential/OTP/2FA/CAPTCHA/KYC bypass.
- No live financial execution is generated by default.
- Irreversible external actions use a human approval gate.
- Provider selection is evidence-weighted and reversible where practical.

## Speed architecture

Factory X is designed around:
- parallelizable agent graphs;
- bounded concurrency;
- cached dependencies;
- incremental builds;
- reusable artifacts/plugins;
- preflight checks before expensive builds;
- parallel static tests;
- repair loops with a bounded retry count;
- artifact reuse across products.

## Learning

Factory decisions and outcomes feed the existing MIDAD control plane when enabled. Secrets and raw credentials are excluded from learning.

## Current phase

Foundation implementation. SignalScan v0.2 remains the known-good baseline and is not rebuilt until Factory X passes its own self-test.


## Neural++ workforce role planning

`plan.mjs` now optionally compiles explicit `workforce_agent_ids` through `workforce-runtime.mjs` and includes the result in `runtime-plan.json`. The wallet, offer and media roles are plan-only: no adapter/provider dispatch, signing, live orders, customer sends or provider spend. Media plans require a verified planner quote, rights confirmation and a separate spend approval before becoming human-review-ready. The plan remains non-executable even after approval.


## MIDAD Continuity Fabric

The Continuity Fabric separates durable task state from short-lived execution processes. It adds a consent-aware planner for CPU/WebGPU shards and stateful browser sessions, with deterministic idempotency keys, checkpoint contracts, lease recovery and strict cost ceilings. See [CONTINUITY_FABRIC.md](./CONTINUITY_FABRIC.md) and `continuity-planner.mjs`. The planner is intentionally plan-only: it does not dispatch jobs or claim a worker is live. Durable queue storage, wake-on-work dispatch and the deployed worker-v2 remain separate gates.


## MIDAD Continuity Fabric — P0/P1

The new `CONTINUITY_FABRIC.md` describes the zero-daemon execution model. P0 planner and P1 Cloudflare SQLite Durable Object ledger sources are in review. The durable ledger is not deployed, and no Queue wake-up or worker-v2 dispatcher is connected. Existing mobile products, browser APK and Supabase gateway remain unchanged until verified cutover.
