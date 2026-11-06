# MIDAD Neural Compute Fabric (MNCF)

**Status:** foundation contract committed to an isolated feature branch; no production deployment has occurred.  
**Scope:** Hybrid compute · zero budget · Linux-first production · HakiOS research guest.

## 1. Verified baseline (2026-11-07)

### Existing assets to preserve
- GitHub source/control repository: `Sirahwaz/Control-room`.
- Existing MIDAD control-plane functions observed in Supabase: `midad_orchestrator`, `midad_forge`, `midad_forge_coordinator`, and `midad_bot_fabric`.
- The Control Room repository already contains `MIDAD_FABRIC_REGISTRY.md` and `MIDAD_PROVIDER_ADAPTER_CONTRACT.md`.
- The latest observed Control Room GitHub Actions run on 2026-11-06 completed successfully.
- Supabase project metadata reports `ACTIVE_HEALTHY`; the Health Advisor returned no lints.

### Constraints and unresolved risks
- Railway connector returned no accessible projects across the linked accounts.
- Supabase Security Advisor reports 30 public tables with RLS enabled but no policies, `pg_net` installed in `public`, and leaked-password protection disabled. These are recorded findings, not permission to mutate database security.
- Supabase Performance Advisor reports 126 unused-index findings. They are not deletion instructions.
- Supabase project metadata and a clean Health Advisor do not prove that database writes are safe. The prior disk/read-only incident remains a reason not to use Supabase as a new compute queue or state store until a separately authorized write-path check is performed.
- No persistent, free Linux host has been verified through the currently connected hosting accounts.

## 2. Target architecture

| Layer | Responsibility | Baseline |
|---|---|---|
| MIDAD Control Plane | Policy, orchestration, agent governance, command surfaces | Preserve existing functions and APIs |
| Linux Compute | Production workers, containers, builds and long-running services | Not provisioned; requires a verified free host |
| Job integration | Dispatch, leases, retries, heartbeats, idempotency and result manifests | Integrate through existing interfaces after their contracts are inspected; do not create a competing queue yet |
| HakiOS Lab | XNU build/boot experiments under QEMU | Isolated research guest only |
| Artifact layer | Versioned build outputs and evidence | GitHub artifacts for CI proofs; no secrets or customer data |

Linux remains the production compute OS. HakiOS is not a Linux replacement, a general-purpose server kernel, or a production kernel for MIDAD.

## 3. Zero-budget execution model

1. Use GitHub-hosted Linux Actions runners only for bounded CI tasks. They are ephemeral and must never be represented as persistent server capacity.
2. Keep a self-hosted Linux provider disabled until ownership, free quota, CPU/RAM/disk, uptime, outbound networking, secure administration, and acceptable terms are independently verified.
3. Keep Supabase as an existing control-plane integration only; do not add compute queue tables or write-heavy telemetry until its write path and capacity are verified.
4. Do not create a new paid resource, subscription, cloud instance, or external account.
5. If no persistent free host is found, the online long-running compute objective remains blocked; CI can still validate code and build artifacts.

## 3.1 Provider screening (2026-11-07)

| Candidate | Verified property | Decision |
|---|---|---|
| GitHub Actions | Public-repository CI minutes are free; runner is ephemeral | Adopt for bounded builds/tests only |
| GitHub Codespaces | Personal Free quota is 120 core-hours and 15 GB-month storage; idle codespaces stop automatically | Development fallback, not an always-on worker |
| Openworld VPS | No-card community VPS; free instance renews every 7 days and can be suspended; its terms do not guarantee uninterrupted availability | Not trusted for production; at most a disposable, secret-free lab after independent trust review |
| ZenDevz | Official site states early alpha, Bangladesh-only, and not for production; peer-node operators host workload data | Exclude from MIDAD |
| Oracle Cloud Always Free | Persistent compute exists, but signup requires card verification | Excluded from the zero-budget/no-card execution path |
| Cloudflare Workers | Free plan is a serverless JS/Wasm runtime with strict per-invocation limits, not a Linux VM; Containers are not free | Potential edge/API layer only, not the Linux compute node |

Provider evidence:
- GitHub plan allowances: https://github.com/pricing and https://docs.github.com/en/billing/concepts/product-billing/github-codespaces
- Openworld free VPS FAQ and terms: https://openworld.eu.org/faq and https://openworld.eu.org/tos
- ZenDevz production and region limitations: https://www.zendevz.com/
- Oracle signup verification: https://www.oracle.com/cloud/free/faq/
- Cloudflare Workers limits and Containers pricing: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/containers/platform/pricing/

## 4. HakiOS boundary

- Upstream: `https://github.com/oosexgang/hakios-xnu-kernel`.
- First candidate: `make qemu-open`, the Apple-payload-free open-kernel QEMU path. The initial CI smoke uses the upstream prebuilt kernel/loader/hello artifacts pinned to commit `63fc2b4633bac3af8e57dadab9f5a8d4cb940438`; it is explicitly not a source rebuild.
- Do not start with phone flashing, firmware extraction, persistent disk writes, or a full Darwin guest.
- QEMU guest networking and remote display remain disabled by default.
- HakiOS output is research evidence, not production service capacity.

## 5. Security and reliability contract

- No credentials in Git, manifests, logs, artifacts, or client code.
- No public SSH/VNC ports in the baseline.
- Remote administration requires an authenticated private overlay and least-privilege identities.
- Workers must use bounded concurrency, timeouts, idempotency keys, health heartbeats, and a maximum of three repair attempts per incident.
- Worker jobs are untrusted workloads: isolate filesystem, network, process and resource limits.
- Human approval remains mandatory for destructive operations, financial actions, signing, withdrawals, and production cutovers.
- Every job must produce an auditable result: job ID, provider ID, image/runtime version, start/end timestamps, exit status, artifact digest, and bounded logs.

## 6. Build and verification sequence

- [x] Audit connected GitHub, Supabase and Railway resources.
- [x] Preserve existing MIDAD control-plane integrations and production branch.
- [x] Add a machine-readable zero-budget topology contract on a feature branch.
- [ ] Pass the MNCF contract test in GitHub Actions.
- [ ] Validate an isolated prebuilt `qemu-open` boot smoke on an available ephemeral Linux runner.
- [ ] Validate a full source rebuild separately; it requires the HakiOS Linux toolchain and SDK setup.
- [ ] Identify and verify a persistent free Linux host; do not infer one from CI.
- [ ] Implement a provider adapter and worker registration only after the host and existing queue/API contracts are verified.
- [ ] Run isolated worker smoke tests, resource-limit tests, restart/recovery tests and artifact-integrity checks.
- [ ] Consider production integration only after evidence and a separate approval gate.

## 7. Current state

**VERIFIED:** GitHub source access; current branch baseline; existing MIDAD control-plane functions; Supabase project metadata; no Railway projects returned; HakiOS Makefile exposes `qemu-open`.

**PENDING:** HakiOS prebuilt QEMU boot smoke; full source rebuild feasibility; persistent free Linux host discovery; provider adapter contract against a real host.

**BLOCKED:** Always-on online compute and remote administration until a persistent free host is verified. No production deployment has been performed.
