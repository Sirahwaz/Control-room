# MIDAD Browser Execution Fabric

Status: **architecture accepted for implementation; worker integration and live deployment are pending**.

This document defines MIDAD Browser as a first-class, agent-callable execution service, not merely an Android WebView or a read-only research screen.

## Product contract

A natural-language request such as "open the project settings, update the callback URL, and verify it" should resolve through one MIDAD interface. The caller must not need to choose a browser vendor or re-enter the same account details for each task.

The runtime supports:
- Ordinary interactive browsing in the Android application.
- Scoped browser automation: inspect, navigate, search, click, fill, select, upload, download, create and update.
- Typed multi-step missions with resumable state, evidence, retries, and a human handoff.
- Explicitly authorized high-impact operations such as deletion, publication, sending, deployment, permissions changes, and financial actions.
- Isolated site/account profiles and persistent login sessions.
- Offline application shell, local bookmarks/history/notes, saved pages, and reconciliation when online.
- A dedicated browser workspace with per-profile themes, fonts, color schemes, page styles, accessibility options, and developer/inspector tools.

"Not read-only" means normal authorized write operations are supported. It does not mean bypassing a site's authentication, authorization, CAPTCHA, MFA, KYC, payment approval, or other access controls.

## Execution architecture

```text
User / ChatGPT / MIDAD Agents
          |
          v
MIDAD Browser Tool Bridge (authenticated, owner-scoped)
          |
          v
Mission Planner -> Policy Decision -> Idempotent Job Queue
          |                              |
          |                              v
          |                     Worker Lease / Claim
          |                              |
          v                              v
Connector Router                 Browser Provider Router
(API first)                       |          |          |
  GitHub                         Local      Playwright  Optional
  Supabase                       WebView    Chromium    Provider
  Notion                         |          |
  ...                            |          v
                                  |     Isolated Site Context
                                  |          |
                                  +------> Evidence Ledger
                                             |
                                  Vault / Profiles / Session Store
                                             |
                                  Human Bridge / Approval Checkpoints
```

### Provider selection

1. Use a first-party connector or official API when it provides the requested operation and reliable evidence.
2. Use the MIDAD Android WebView for local browsing and human-interactive checkpoints.
3. Use the self-hosted Playwright Chromium worker for server-side browser automation.
4. Keep external browser vendors as optional adapters only. TinyFish is not the core and must not be used as the default paid execution dependency.

Every provider implements the same task/session/evidence contract. A provider outage must not erase the mission or force the user to repeat its intent.

## Automation permission model

Each profile has an explicit policy with three modes:

- `read_only`: inspect, read, search, and navigate only.
- `assisted`: normal interactive operations are available, but each write requires an approval checkpoint.
- `scoped_autonomy`: reversible operations are allowed within the configured exact hosts, paths, accounts, and action list without a repetitive prompt.

The scoped policy is the intended operating mode once a user has approved a site/account profile. It can include click, fill, select, upload, download, create, and update.

High-impact actions remain supported but require a one-time approval bound to:
- owner ID and account ID;
- exact platform and hostname;
- exact action and path;
- task/mission ID;
- short expiry and a one-use approval ID.

High-impact categories include deletion, publication, external sending, deployment, permission changes, payment, purchase, transfer, withdrawal, signing, credential rotation, and account closure. A direct, specific user instruction may authorize that exact operation through a trusted gateway-created approval; broad product-level permission is not a blanket approval for unknown future destructive tasks.

The following are never browser-automation objectives: bypassing CAPTCHA, MFA, KYC, anti-bot controls, access restrictions, or impersonating another person. The browser may stop, present the checkpoint to the user, and resume the same mission after a legitimate human action.

The `automation_policy.py` module is the first isolated implementation of this contract. It is not yet wired into the live gateway or worker.

## Credential and session architecture

### Metadata

Reuse the existing `midad_platform_accounts` registry for account metadata and references:
- platform key and exact hostname;
- display label and account reference;
- approved login identity reference;
- `credential_vault_ref`;
- browser provider/profile reference;
- allowed automation mode and action scope;
- verification and evidence metadata.

Do not place passwords, API values, cookies, refresh tokens, recovery codes, private keys, or seed phrases in `profile_payload`, `metadata`, browser job JSON, logs, screenshots, or source control.

### Secrets

Supabase Vault already exists in the MIDAD project. The target design is:
- Keep secret values in Vault or another approved server-side secret provider.
- Store only the secret reference and metadata in `midad_platform_accounts`.
- Resolve a secret only inside the trusted server/worker boundary, after matching owner, account, hostname, and purpose.
- Never return plaintext secrets to Android, JavaScript, Telegram, ChatGPT messages, GitHub Actions inputs, or page evidence.
- Support versioning, rotation, revocation, last-used metadata, and audit events.
- Never store cryptocurrency seed phrases or private signing keys in the browser vault. Wallet signing remains a separate non-custodial, user-controlled system.

### Persistent sessions

The current Playwright operator context is RAM-only. The target is an encrypted persistent storage-state provider:
- encrypt per owner/account/profile using an authenticated cipher;
- keep the encryption key outside PostgreSQL and source control, using a host secret or managed key provider;
- bind each stored state to exact host/profile/account and a key version;
- reject plaintext, expired, wrong-owner, or wrong-host state;
- support revocation and forced logout;
- use Android Keystore for device-local secret material;
- never export raw cookies or authorization headers to browser UI or agents.

A restarted worker should recover an authorized session without asking the user to type the same password again, unless the site itself invalidated the login or requires a human checkpoint.

## Always-ready runtime

The Browser Gateway must not report a worker as online based only on a database status string. Readiness requires a fresh heartbeat, expected worker version, queue reachability, and a provider capability handshake.

The current deployed worker record is stale. The existing operator worker is a single-consumer process and the repository notes that the assistant-side trusted bridge and persistent deployment are separate requirements. Production readiness therefore requires:
- an always-on supervised worker service on the approved VPS/runtime;
- automatic restart and health watchdog;
- atomic job claims/leases to prevent duplicate execution;
- idempotency keys and durable mission checkpoints;
- bounded retries (maximum three per incident);
- concurrency and per-account session limits;
- browser/provider fallback and queue recovery;
- sanitized structured logs, evidence hashes, and audit trails;
- a kill switch and owner-scoped revoke-all control.

The current user has not connected a Remote Desktop device for the VPS in this session, so no worker deployment or server-secret installation is claimed.

## ChatGPT and agent invocation

The intended interface is an authenticated MIDAD Browser tool bridge. It must provide typed operations for:
- discover capabilities and readiness;
- list/select approved platform profiles;
- create/resume/cancel a browser mission;
- inspect current tab/session;
- execute scoped typed actions;
- request/consume exact one-time approvals;
- retrieve sanitized results and evidence.

The bridge must derive owner identity from a trusted authenticated session. It must not accept a service-role key, ingest key, or owner UUID from untrusted page content or client JavaScript. The existing public HTML control surface is not itself the privileged assistant bridge.

## Browser workspace and UI

The Browser UI is a separate product workspace, not a Control Room tab with browser labels. It is designed around:

- tab strip and tab groups, address/search bar, back/forward/reload, downloads, bookmarks, and history;
- live browser viewport and session indicator;
- side panel for MIDAD AI commands, page summary, translation, search, and mission status;
- platform/account profile selector with session health and revocation;
- safe permissions and site settings;
- theme studio: system/light/dark, font family and size, line height, contrast, accent color, and per-site user styles;
- reader mode, saved pages, offline collections, and local-first notes;
- accessibility tree, DOM/selector inspector, screenshot capture, sanitized network diagnostics, and developer tools;
- responsive RTL-first phone layout, with tablet/desktop workspace layout.

Site-specific fonts, colors, and user styles must be isolated per profile and must not weaken origin isolation or security controls.

## Existing components to preserve

- `midad-browser.html/js/css`: current remote browser control surface.
- `BrowserActivity.java`: native Android WebView shell, default-browser intent, Safe Browsing, and TLS error handling.
- `midad-browser-agent-gateway`: deployed Supabase gateway (currently version 16).
- `midad_browser_jobs`: durable browser task queue.
- `midad_browser_evidence_ledger`: append-only evidence metadata.
- `midad_browser_providers`: provider registry.
- `midad_platform_accounts`: account/profile references.
- `vault.secrets`: existing server-side encrypted secret storage.
- `tools/midad-browser-runtime/operator_worker.py`: persistent Playwright operator worker source.
- `tools/midad-browser-runtime/account_registry.py` and `secret_provider.py`: profile/secret-reference separation.

Do not create a parallel account registry, secrets table, or browser job queue until a schema gap is proven.

## Current verified state

- MIDAD Browser v0.1.1 Android APK built and signed successfully.
- Emulator smoke test passed, including loading the packaged MIDAD home while Wi-Fi and mobile data were disabled.
- The PR is still separate from `main`; the successful APK artifact belongs to that draft PR run.
- The worker heartbeat in `midad_browser_providers` is from 2026-11-05 and is not a live readiness signal.
- The deployed gateway source supports the operator queue, result retrieval, worker heartbeat, and basic capability/list-session commands.
- The current browser UI still says `READ-ONLY DEFAULT`; its control bridge exposes only a narrow set of operator subactions.
- The worker source supports inspect/navigation/click/fill/submit, but high-impact paths are currently blocked, sessions are memory-only, and a trusted assistant-side bridge is not yet installed.

## Hybrid execution substrate and provider fusion

MIDAD uses one control plane with multiple execution substrates. These are not separate products and must not create separate queues, account registries, policy engines, or evidence stores.

### Control plane

MIDAD Factory X remains the single planner and provider-selection authority. It resolves the mission, reuses connected connectors first, evaluates capability fit and runtime readiness, applies policy and budget limits, dispatches a typed task envelope, and records evidence and outcomes.

The control plane is provider-neutral. A task may move between execution substrates only at a durable checkpoint; the task identity, idempotency key, authorization scope, and evidence chain remain stable.

### Execution substrates

| Substrate | Primary role | Use it for | Do not use it for |
| --- | --- | --- | --- |
| Native connected APIs | Deterministic connector execution | GitHub, Supabase, Notion, Dropbox and other structured operations | UI-only behavior that has no supported API |
| GitHub Actions | Ephemeral CI and build runners | Tests, APK/AAB builds, lint, static analysis, reproducible jobs and artifact creation | Interactive browsing or a persistent worker |
| GitHub Codespaces | Temporary interactive development workspace | Repository inspection, dependency experiments, isolated debugging, reproducing failures and short-lived tools | An always-on daemon, a production queue consumer, or a permanent browser profile |
| MIDAD VPS control node | Persistent lightweight coordination | Worker supervision, health checks, secure outbound queue consumption, watchdogs and relay functions when resource checks pass | Chromium/large agent workloads on the currently known 512 MB instance |
| Dedicated Playwright runner | Browser execution | Authorized site workflows, isolated browser contexts, screenshots and page evidence | General-purpose shell access or unbounded coding-agent execution |
| Android MIDAD Browser | Local and human-interactive surface | Phone browsing, human verification checkpoints, approvals, offline shell and session handoff | A trusted server-side credential broker |
| ACP/coding-agent sandbox | Isolated repository work | Bounded code analysis and edits in a disposable worktree/container after isolation and provider readiness are proven | An unisolated shell with inherited MIDAD credentials |

Codespaces availability, included compute/storage quota, and any overage must be checked against the actual GitHub account before a workspace is started. A Codespace is a temporary workspace and may stop or suspend; it is not the worker's persistence layer. The current connected GitHub integration does not expose a verified Codespaces lifecycle operation, so this adapter stays discovery-only until control and cost checks are actually available.

The existing VPS is a resource-constrained node. Keep it in the design as a candidate supervisor/control node, but do not assume it can host Chromium, multiple browser contexts, or coding-agent containers. A resource probe must establish RAM, CPU, storage, swap, process limits, and available disk before assigning those workloads. Heavy or bursty jobs use GitHub Actions or a separately verified temporary workspace instead.

### Unified task envelope

Every dispatchable task carries:
- `mission_id`, `task_id`, and a stable `idempotency_key`;
- required capabilities and accepted provider/adapter contract versions;
- owner, account, exact host/path and data-sensitivity scope;
- risk class, allowed action set, and optional one-use approval reference;
- resource constraints: CPU/RAM class, duration, network policy, region and maximum cost;
- checkpoint, lease owner, attempt count and cancellation state;
- result contract and evidence references/hashes.

Secrets are never copied into this envelope. An adapter receives only a secret reference that it is authorized to resolve inside its own trusted server boundary.

### Runtime selection and failover

1. Normalize the requested outcome and derive capability, resource, privacy, durability and risk requirements.
2. Reuse a connected first-party API/connector when it can complete the operation and return authoritative evidence.
3. Filter candidate adapters by contract compatibility, explicit activation state, live health, capacity, budget and policy.
4. Choose the lowest-cost qualified substrate that meets the durability and isolation requirements; do not select merely because a provider exists in a registry.
5. Acquire an atomic lease and idempotency claim before dispatch. Reject duplicate active claims.
6. Execute with bounded timeouts and at most three attempts per incident. A retry or fallback must not duplicate a non-idempotent external side effect.
7. Persist checkpoints and sanitized evidence. Verify postconditions before declaring success.
8. On failure, move to a compatible fallback only when the task can safely resume from the last durable checkpoint; otherwise stop and request a human handoff.
9. Record actual duration, cost, failure mode and evidence quality to improve future provider selection.

### Readiness is live, not declarative

A registry state such as `online` or `known_available` is not sufficient. A persistent worker is READY only when all of the following are true:
- heartbeat age is within the configured 45-second threshold;
- worker version and adapter contract match the expected version;
- queue authentication and atomic claim are successful;
- the worker responds to a capability handshake;
- required browser binaries, storage encryption and profile bindings are available;
- resource headroom and budget pass the task-specific preflight.

Missing or stale signals produce `PENDING` or `BLOCKED`, never optimistic readiness.

### Current integration boundary

Factory X already supplies the need-first provider registries, bounded parallel planning, cache/reuse policy, and execution-fabric task waves. The Browser Gateway already supplies the browser job/evidence boundary. The remaining integration work is to connect those contracts through live adapter readiness, durable leases/checkpoints, the worker-side scoped policy, a server-trusted assistant invocation bridge, and deployment verification.

Codespaces, VPS, and ACP are candidates/adapters until their exact lifecycle, isolation, credential path, and health contracts are verified. No new paid resource, workspace, VPS, external account, or provider subscription is created by this architecture change.

## Implementation sequence

1. Integrate and test scoped action policy; replace the global read-only default with owner-configured autonomy modes.
2. Extend the typed command/job contract to multi-step browser missions and exact one-time high-impact approvals.
3. Add per-site account/session profiles and a Vault-backed secret resolver; encrypt persistent storage state.
4. Add authenticated ChatGPT/MIDAD-agent invocation bridge and capability/readiness endpoint.
5. Deploy the worker as a supervised always-on service and verify real heartbeats, session reuse, and restart recovery.
6. Build the dedicated tabbed browser workspace, theme/font studio, reader/offline collection, and developer tools.
7. Run end-to-end tests on authorized test accounts before enabling production profiles.

No database DDL is included in this phase. MIDAD's current Supabase storage/read-only incident must be resolved or bypassed through an approved storage/runtime path before schema changes or new persistent records are attempted.
