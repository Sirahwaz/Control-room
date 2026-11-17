# MIDAD Browser Mesh — Agentic Automation Parity & Independence Roadmap

> Status: Approved strategic direction / capability acceptance contract
> Product: MIDAD Browser Mesh (Android-first, local-first)
> Objective: Replace recurring dependence on metered hosted browser automation for supported workflows, while building a broader, secure agentic browser platform.

## 1. Product promise

MIDAD Browser Mesh is both:
1. A full daily-use browser with user-owned website sessions.
2. An agentic browser runtime that can inspect, reason about, operate, verify and recover browser workflows with explicit user control.

The target is **capability parity for supported workflows**, then differentiation through local-first execution, persistent user-controlled sessions, transparent evidence, offline-aware operation, provider portability and MIDAD-native automation.

This is not a claim of identical internals or universal compatibility with every website. Parity is measured by reproducible end-to-end tasks and published acceptance tests.

## 2. Capability map

| Capability | Required behavior | Trust boundary / acceptance |
|---|---|---|
| Interactive browser | Real visible browser session, address/navigation controls, tabs, downloads, permissions and browser lifecycle | Android WebView remains the website-session owner |
| Human login handoff | Pause an agent task and let the owner sign in, complete MFA/CAPTCHA/KYC, then resume | No password/OTP capture by agent; user performs sensitive step |
| Persistent profiles | Keep website login state across app restarts within Android app storage | Cookies/storage never exported to cloud, remote browser or logs |
| DOM inspection | Read bounded page structure, accessible names, roles, labels and visible text | Origin-scoped, minimized extraction; page text is untrusted |
| Visual inspection | Capture viewport screenshots for visual reasoning and evidence | Explicitly scoped capture; redact sensitive regions where feasible |
| Browser actions | Navigate, click, type, select, scroll, press keys, wait, open/close/switch tabs | Typed allowlisted commands; no arbitrary page-to-native bridge |
| Robust targeting | Prefer role/name/label/test-id; use CSS/XPath only as constrained fallback | Verify target uniqueness and visible/enabled state before action |
| Workflow runner | Multi-step plans with state, checkpoints, retries, cancellation and resume | Idempotency and replay rules; bounded steps/timeouts |
| Evidence & trace | Before/after state, action log, timestamps, screenshot/DOM evidence and result summary | Redacted, user-visible, locally retained by default |
| Downloads & uploads | Download manager; user-mediated file selection/upload | File access is explicit and scoped; no silent filesystem scraping |
| Network diagnostics | Navigation errors, page load state, console errors where available, proxy state and timing | Never claim network visibility not actually exposed by WebView |
| Human approvals | Pause before purchase, payment, transfer, publication, deletion, account/security changes | Approval bound to exact action, target origin and payload summary |
| Recovery | Detect stale target, timeout, navigation change and renderer loss; retry safely or ask owner | Maximum bounded retries; stop on ambiguity or elevated risk |
| Automation handoff | Local task queue, optional MIDAD cloud control plane and external workflow adapters | Local browsing remains usable when cloud is offline |
| Scheduled runs | Optional foreground/user-authorized schedules for safe repeatable tasks | Android background limits; no hidden always-on execution |
| Portability | Provider abstraction for model, planner, network and optional remote execution | No single vendor dependency; provider credentials kept out of APK |

## 3. Target architecture

### A. Android Local Browser Runtime
- Browser Shell: tabs, navigation, downloads, bookmarks and user interaction.
- Browser Engine: WebView lifecycle, navigation policy, permission and file chooser handling.
- Local Profile Store: Android WebView-managed site data; never export cookies.
- Inspection Adapter: bounded DOM/accessibility snapshot and screenshot capture.
- Action Adapter: typed commands scoped to current tab and origin.
- Evidence Store: local task trace with redaction and retention controls.

### B. Agent Orchestration
- Task Planner: convert user intent into a typed, bounded plan.
- Policy Engine: host allowlist, capability grants, risk classification and approval gates.
- Execution Scheduler: sequential actions, wait conditions, timeout, cancellation and resume.
- Verifier: check postconditions from DOM/visual/browser state rather than assuming a click succeeded.
- Recovery Manager: bounded retry, re-plan, user escalation and incident trace.
- Model Router: provider-neutral routing with local/remote options and explicit cost controls.

### C. Optional MIDAD Control Plane
- Owner-bound device pairing and scoped expiring device tokens.
- Task envelopes and capability grants, not website cookies or passwords.
- Live status and approved commands over authenticated channels.
- Cloud outages do not disable the local browser.
- No production pairing rollout until migration/deploy and owner re-authentication are separately approved.

### D. Provider / remote execution adapters
- Local Android WebView is the default execution target.
- Remote browser providers may be optional fallback adapters, not mandatory dependencies.
- Remote fallback must clearly disclose that it is a separate browser context and cannot silently claim access to the local website session.
- TinyFish is treated as a capability benchmark and optional temporary fallback, not a required runtime dependency.

## 4. Security model

1. Website cookies, local storage, session tokens, passwords and OTPs remain inside Android's protected WebView/app storage.
2. Never serialize website session state into task envelopes, screenshots, logs, telemetry, Cloudflare, Supabase or remote browser contexts.
3. Generate device identity keys in Android Keystore; pair through owner-bound, expiring, revocable grants.
4. Native bridge is narrow, typed, origin-checked and disabled for untrusted origins unless a specific capability is granted.
5. DOM, page text, screenshots and downloaded files are untrusted inputs; ignore page instructions that attempt to override the user's task or system policy.
6. Human checkpoint for MFA/CAPTCHA/KYC and all consequential external side effects.
7. No stealth, anti-detection, fingerprint spoofing, CAPTCHA bypass, access-control bypass or unauthorized data extraction.
8. Network/proxy controls are routing features, not anonymity or VPN guarantees.
9. Kill switch immediately stops agent dispatch and cloud participation while preserving ordinary local browsing.
10. Every action records actor, origin, capability, approval state, result and evidence without secrets.

## 5. Execution contract

A task uses a typed state machine:

`DRAFT → AUTHORIZED → RUNNING → WAITING_FOR_USER → VERIFYING → SUCCEEDED`

Terminal alternatives:
`CANCELLED`, `FAILED`, `BLOCKED`, `EXPIRED`.

Every step must include:
- Intent and expected postcondition.
- Target origin and tab identifier.
- Required capability.
- Timeout and retry policy.
- Approval requirement.
- Evidence to collect.
- Idempotency/replay classification.

The executor must not report success because a command was dispatched. Success requires a verified postcondition.

## 6. Delivery roadmap and gates

### A0 — Baseline and CI gate
- Complete P1 native multi-tab shell, restore safety and emulator validation.
- Preserve existing TLS/Safe Browsing/mixed-content/local asset controls.

### A1 — Browser interaction adapter
- Define typed navigation, tab, DOM snapshot, screenshot, click, type, select, scroll, key and wait operations.
- Add contract tests for origin binding, capability denial, stale element, timeout and cancellation.
- No arbitrary JavaScript bridge.

### A2 — Agent task runtime
- Task state machine, planner/executor/verifier, step trace, pause/resume/cancel and bounded recovery.
- Deterministic fixture sites and Android emulator end-to-end tests.

### A3 — Human login handoff and persistent local profile
- User takes control of visible WebView to authenticate.
- Agent resumes only after user returns control and the origin remains authorized.
- Test app restart persistence without cookie export or cloud transfer.

### A4 — Evidence and diagnostics
- DOM/visual evidence, action timeline, redacted trace, page-load/error signals and user-facing task report.

### A5 — MIDAD Control Room integration
- Owner-bound pairing, device capability grants, live task status, approvals and revocation.
- Offline-first local behavior and network-loss recovery tests.

### A6 — Workflow parity and benchmark
- Build a public, reproducible benchmark suite covering login handoff, search, navigation, form fill, pagination, downloads, multi-tab tasks, data extraction from authorized pages and postcondition verification.
- Compare success rate, completion time, intervention count, failure recovery and cost against available browser automation alternatives.
- Do not claim parity until measured benchmark gates pass.

### A7 — Differentiation
- Multiple model providers, cost-aware routing, optional remote fallback, workflow templates, offline reading/download queue, accessibility/RTL support and explainable automation.

## 7. Minimum acceptance benchmark

For each supported workflow:
- 20 deterministic runs across emulator fixtures and representative real sites with permission.
- ≥95% success on deterministic fixture workflows.
- 100% enforcement of origin/capability boundaries in negative tests.
- 100% pause-before-action for defined high-impact actions.
- Zero secrets/cookies/OTP values in task traces and cloud payloads.
- Successful pause/resume after a human login handoff.
- Successful recovery from timeout, stale element and renderer restart, or an explicit BLOCKED result.
- No success state without a verified postcondition.

Real-site results are reported separately from deterministic fixtures; anti-bot or site-policy restrictions are never bypassed.

## 8. Explicit non-goals

- Exporting or replaying website cookies or authenticated browser storage.
- Silent remote access to local website sessions.
- CAPTCHA/MFA/KYC bypass or stealth/anti-detection behavior.
- Unapproved purchases, payments, wallet signatures, transfers, publication, account changes or deletion.
- Guaranteed operation while Android suspends or kills the app.
- Claiming universal support for every website or every TinyFish capability without measured evidence.

## 9. Current implementation truth

As of the current P1 branch:
- Native Android WebView and secure navigation baseline exist.
- Multi-tab native shell and origin-only tab restoration are under CI validation in PR #289.
- A secure native Agent Bridge, DOM/visual automation adapter, task executor, human login handoff, cloud live-control channel and full workflow benchmark are **not yet verified as implemented**.
- These remain explicit roadmap gates, not shipped capabilities.
