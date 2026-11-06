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

## 1.1 Existing Linux worker discovered

The repository already contains `.github/workflows/midad-forge.yml` (**MIDAD Forge Worker**):
- Scheduled every five minutes and also manually dispatchable.
- Runs on `ubuntu-latest`; uses GitHub OIDC with audience `https://midad-ai`.
- Claims work from the existing `midad_forge_runs` queue and records events in `midad_forge_events`.
- Generates a constrained file manifest, builds/tests it in an isolated workspace, uploads artifacts, and publishes a branch/PR after success.
- This is a bounded **ephemeral Linux worker**, not a persistent server and not yet a general-purpose compute queue.

The last observed scheduled run was `42290607691` on 2026-11-06 20:42 UTC. It completed successfully, but its `prepare`, `build`, and `finalize` jobs were skipped because no run was claimed. A read-only query of `midad_forge_runs` returned one `BUILT` row, zero queued/active rows, and a latest update of 2026-10-15. The workflow definition says every five minutes; continuous schedule activity is not verified by the recent run history and remains a monitoring item.

The existing `MIDAD_FABRIC_REGISTRY.md` is a 2026-09-30 inventory snapshot and its function versions are stale relative to the live Supabase inventory. The live function list and current function source were used for this audit. `MIDAD_PROVIDER_ADAPTER_CONTRACT.md` describes financial venues (exchange/wallet/payment/chain/mining), not compute providers; it must not be repurposed as a compute contract.

**Integration decision:** preserve the Forge worker and its OIDC boundary. MNCF may add a separate compute-job contract and worker type later, but only after the persistent host and current queue/API contracts are verified. Do not change the existing Forge queue schema or worker workflow as part of this foundation.

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
| ZenDevz | Official site states early alpha, Bangladesh-only, and not for production; peer-node operators host workload data | Exclude from MIDAD |
| Oracle Cloud Always Free | Persistent compute exists, but signup requires card verification | Excluded from the zero-budget/no-card execution path |
| Cloudflare Workers | Free plan is a serverless JS/Wasm runtime with strict per-invocation limits, not a Linux VM; Containers are not free | Potential edge/API layer only, not the Linux compute node |

Provider evidence:
- GitHub plan allowances: https://github.com/pricing and https://docs.github.com/en/billing/concepts/product-billing/github-codespaces
- ZenDevz production and region limitations: https://www.zendevz.com/
- Oracle signup verification: https://www.oracle.com/cloud/free/faq/
- Cloudflare Workers limits and Containers pricing: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/containers/platform/pricing/

## 3.2 External technology review (2026-11-07)

The four user-proposed resources were inspected at source/documentation level. They are not interchangeable; each belongs to a different layer.

| Resource | What it actually provides | MNCF decision |
|---|---|---|
| [Weaver](https://github.com/KeoneSomers/Weaver) | Native Zig/libgit2 desktop Git client for Windows/macOS/Linux. MIT licensed. Has JSON-lines local executable extensions, but declared permissions are not an OS sandbox. | Keep as an optional developer workstation tool only. It is not a headless server, remote worker, orchestration engine or replacement for GitHub Actions. Do not install on the Linux server. |
| [Tiny11 Builder](https://github.com/ntdevlabs/tiny11builder) | WinUI/.NET tool to customize Windows 11 client installation media using DISM/Windows tooling. Requires Windows host and administrator approval. Windows Server is unsupported. Tiny11 Core removes servicing/recovery and disables Defender; upstream explicitly recommends isolated VM testing. | Exclude from Linux production compute. Consider only if a separate Windows 11 disposable VM image-lab becomes a real requirement. Do not use Core as a server image. Upstream NOTICE states no standalone license is assigned to the upstream material; do not redistribute or bundle without resolving permissions. |
| [Fuchsia](https://fuchsia.googlesource.com/fuchsia/+/refs/heads/main) | A separate modular OS built around Zircon microkernel and a capability-based component model; drivers and other services run in isolated user-space components. | Research reference for least-privilege component boundaries, lifecycle management, capability-based service access and modular updates. Do not replace Linux with Fuchsia or port production MIDAD services to Zircon at this stage. |
| [Appwrite](https://appwrite.io/) | Open-source backend platform: Auth, database, storage, functions, messaging, realtime and hosting; supports cloud and Docker self-hosting. | Retain as a future optional backend adapter, not a current deployment and not a Supabase replacement. Self-hosting needs at least 2 CPU, 4 GB RAM, 2 GB swap and Docker Compose; current default stack is 16 containers. Appwrite Cloud Free pauses inactive projects after 7 days, so it is not an always-on compute host. |

### Integration implications

- **Weaver:** no action for the production plane. If the user later has a desktop Linux/Windows workstation, it may provide a convenient Git UI. Its external extension process executes with the user's normal OS permissions; the declared extension permissions are for review, not sandbox enforcement. This is not an agent isolation boundary.
- **Tiny11:** no action. It does not produce Linux images and does not support Windows Server. A future Windows desktop test lab would be a separate optional project.
- **Fuchsia:** borrow architecture principles only: capability-based access, isolated components, user-space services, independent updates and explicit lifecycle management. MNCF's actual production worker remains Linux containers.
- **Appwrite:** do not create a second backend now. Existing MIDAD already has Supabase functions, auth/data integrations and queues; migration would create data duplication and operational cost. Revisit only with a verified host, migration plan, schema/API parity, export/restore test and a concrete Supabase blocker.

Official references:
- Weaver extension model and security: https://github.com/KeoneSomers/Weaver/blob/main/docs/extensions.md
- Tiny11 requirements, limitations and attribution: https://github.com/ntdevlabs/tiny11builder/blob/winui-preview/docs/usage.md and https://github.com/ntdevlabs/tiny11builder/blob/winui-preview/NOTICE.md
- Fuchsia architecture: https://fuchsia.dev/fuchsia-src/get-started/learn/intro/architecture
- Appwrite self-hosting requirements: https://appwrite.io/docs/advanced/self-hosting/installation
- Appwrite free-plan inactivity policy: https://appwrite.io/changelog/entry/2026-02-20-1
- Appwrite Cloud pricing/limits: https://appwrite.io/pricing

## 4. HakiOS boundary

- Upstream: `https://github.com/oosexgang/hakios-xnu-kernel`.
- First candidate: `make qemu-open`, the Apple-payload-free open-kernel QEMU path. The initial CI smoke uses the upstream prebuilt kernel/loader/hello artifacts pinned to commit `63fc2b4633bac3af8e57dadab9f5a8d4cb940438`; it is explicitly not a source rebuild.
- Boot diagnosis now runs two independent paths in parallel: `loader-device` (payload injected at `0xF0000000`) and `uefi-esp` (`QEMU_ESP=1`, payload read from `\\EFI\\hakios\\payload.bin` without a QEMU loader device). The upstream [UEFI boot notes](https://github.com/oosexgang/hakios-xnu-kernel/blob/63fc2b4633bac3af8e57dadab9f5a8d4cb940438/docs/uefi-boot.md) document and report testing both handoff methods; CI captures serial output plus bounded `guest_errors,cpu_reset` diagnostics for each lane.
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
- [x] Pass the MNCF contract test in GitHub Actions on the current PR head.
- [ ] Complete the parallel `loader-device` vs `uefi-esp` QEMU smoke and verify both `XNULOADER v3` and the kernel banner.
- [ ] Validate a full source rebuild separately; it requires the HakiOS Linux toolchain and SDK setup.
- [ ] Identify and verify a persistent free Linux host; do not infer one from CI.
- [ ] Implement a provider adapter and worker registration only after the host and existing queue/API contracts are verified.
- [ ] Run isolated worker smoke tests, resource-limit tests, restart/recovery tests and artifact-integrity checks.
- [ ] Consider production integration only after evidence and a separate approval gate.

## 7. Current state

**VERIFIED:** GitHub source access; current branch baseline; MNCF contract, MIDAD FIX Contract and Control Room Verify passed on PR head `74102ad`; existing MIDAD control-plane functions; Supabase project metadata; no Railway projects returned; HakiOS Makefile exposes `qemu-open`.

**FAILED / INVESTIGATING:** The initial `loader-device` smoke reached AArch64 UEFI, started `UEFI Misc Device`, then raised `Synchronous Exception at 0x00000000A10021A8` before `XNULOADER v3`. This localizes the failure before the kernel banner, but does not prove a kernel fault. The new parallel `loader-device`/`uefi-esp` differential run is pending; do not report HakiOS as booted until a lane emits both loader and kernel banners.

**PENDING:** full source rebuild feasibility; persistent free Linux host discovery; provider adapter contract against a real host.

**BLOCKED:** Always-on online compute and remote administration until a persistent free host is verified. No production deployment has been performed.
