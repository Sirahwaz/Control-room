---
name: midad-intelligence-force-super
description: >-
  Orchestrates MIDAD's authorized software-intelligence workflow: LeanREA
  technical reverse engineering, Replica clean-room product mapping, Nanobot
  runtime planning, isolated analysis, evidence verification and Factory handoff.
---

# MIDAD Intelligence Force Super

## Purpose

This is the top-level router, not a new model or a claim that tools are installed. It combines specialized workflows while preserving evidence, authorization, bounded retries, and existing project components.

## Fast route selection

1. Identify the artifact and user goal first. Classify it as website/source repo, minified web bundle, Electron/desktop binary, Android APK, native binary, database, traffic capture, firmware, or an ordinary UX/product rebuild.
2. Authorize before technical inspection. For non-public code, APKs, binaries, runtime traces, or authenticated surfaces, require ownership or explicit authorization evidence and record the permitted scope. If absent, limit work to public documentation and give a bounded plan.
3. Pick the narrowest capable skill:
   - Binary internals, package/build metadata, dependencies, imports/exports, disassembly trails, bundle strings, APK internals: use leanrea after checking available CLI tools.
   - Public product behavior, screens, components, user flows, competitor UX or clean-room rebuilding: use replica-recon, then replica-architect / replica-design / replica-build.
   - Authorized security/runtime analysis that requires isolation, a target hash, tool readiness report or strict exclusions: use midad-authorized-app-analysis.
   - Tests and parity: replica-test then replica-diff.
   - Long-running agent UI, private chat channels or API runtime: route through midad-nanobot-runtime. Nanobot is a self-hosted runtime, not an Android-native app or a model provider; it must remain disconnected until host, access controls and smoke tests are verified.
   - Android package production and emulator smoke tests: hand off to Mobile Factory / Factory X using mobile/factory/REPLICA_SKILL_INTEGRATION.md.
4. Do not confuse the tools' roles. LeanREA gives an agent command-selection instructions; it is not itself JADX, Apktool, Frida, Ghidra, a browser, an emulator or a running analysis service. Replica skills generate a workflow; they do not prove a worker ran.
5. Preserve boundaries. Keep the Lab and Mobile Factory separate execution tracks with one shared job contract. Never rebuild a working subsystem just to make a cleaner diagram.

## Intelligence workflow

### A. Evidence-first triage
- Confirm file type/magic bytes, size, hash, source and authorization scope before extracting or executing.
- Run the cheapest inventory first; batch independent harmless probes in one shell invocation.
- Slice large/minified output; do not dump giant files or blindly follow URLs found inside an artifact.
- Label each material conclusion SEEN (with path/symbol/offset/output), INFERRED (state the reasoning), or UNKNOWN (what the available evidence cannot show).
- Distinguish static inspection, local tests, emulator runtime tests, physical-device tests and production behavior. Never substitute one for another.
- Stop when the requested questions are answered; do not repeat an unchanged full audit.

### B. Cross-verification
For important claims, seek a second independent evidence source: for example package metadata plus manifest; symbol/import data plus string/call trail; documented UX plus a manually observed authorized flow; build result plus install/launch smoke result.
If evidence conflicts, preserve the conflict and lower confidence instead of averaging incompatible results. Never invent a benchmark result or extrapolate LeanREA's published benchmark to MIDAD environments.

### C. Tool discovery and safe fallback
- Check exact tool availability and version with command -v and version/help output before using it.
- For missing JADX/Apktool/Frida/Ghidra, record missing or failed_preflight; do not report it installed or working because the skill mentions it.
- Prefer already-available tools; do not auto-install binaries, create accounts or incur paid costs. Recommend a specific install only when needed and authorized.
- For a tool that needs a different host (e.g. macOS utilities on Linux CI), select a valid alternative or mark the subtask blocked.

### D. Bounded execution
- Use the saved job state and prior evidence. No audit/research dump unless the decision requires it.
- Parallelize independent read-only tasks after authorization; cap concurrency to real available capacity.
- Maximum three attempts per incident. After the third failure, open the incident circuit breaker, preserve error evidence and choose a structurally different fallback or report BLOCKED.
- Cache results only by exact target hash + tool version + scope; do not reuse evidence for changed files.

### E. Nanobot runtime handoff
- Use Nanobot only when a persistent agent runtime, private WebUI/chat channel or authenticated API surface is required.
- Keep the runtime behind a MIDAD-owned server-side adapter. Do not expose its general tool API directly to a mobile client.
- Verify host, pinned release, API authentication, workspace confinement, sandbox and negative authorization behavior before the first MIDAD connection.
- Registry presence is planning metadata only; it is not proof Nanobot is installed, deployed, connected or safe.

### F. Build handoff
A Factory handoff includes job_id, scope, authorization evidence reference, target hash, selected skill, required capability, inputs, expected outputs, tests run, attempt count, blocker state, and artifact/report hashes.
The Factory independently performs product preflight, build, tests, artifact-integrity verification and available runtime smoke checks. Never label a handoff as executed unless an execution result came back from a verified adapter.

## Non-negotiable boundaries
- Only work on owned/authorized targets. Public UX research must obey applicable terms.
- For clean-room recreation, rebuild behavior using fresh code, text and assets; do not copy proprietary source, brand, content, private APIs, or protected datasets.
- Preserve original artifacts read-only. Use disposable isolated environments for authorized runtime tests; no personal accounts or production secrets.
- Redact secrets and personal data. Never reuse discovered credentials or bypass authentication.
- No unauthorized exploitation, persistence, credential theft, exfiltration or unrelated-target testing.
- No live payments, purchases/refunds, wallet signing, transfers or withdrawals. No production publication or irreversible external action without a separate verified gate.
- No merge of unverified changes. A green skill test does not prove APK tooling, Nanobot installation or runtime/API connectivity.

## Required output
Return a compact report:
- Status: VERIFIED / PARTIAL / BLOCKED.
- Route: selected skill(s) and why.
- Evidence: what was actually checked and seen/inferred/unknown.
- Tools: available-and-tested / missing / failed-preflight.
- Attempts: number used and circuit-breaker state.
- Handoff: artifact/report hashes, test results and exact next blocker.

Prefer a bounded result over a new broad audit. Never state ready from a capability registry entry alone.
