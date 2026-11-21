# MIDAD Unified Android Platform — Architecture Contract v1

**Status:** Approved implementation baseline (2026-11-14)  
**Repository:** `Sirahwaz/Control-room`  
**Branch:** `feat/midad-unified-android-node-20261114`  
**Disposition:** Additive integration. Preserve existing Browser, Reverse Engineering Lab, Gateway, Worker, Network Access and Vault adapters.

## 1. Mission

Deliver one Android application that combines:

1. **Autonomous Android Node** — offline-first device workspace, local processing, approved automation and MIDAD connectivity.
2. **Reverse Engineering Lab** — evidence-led static and dynamic analysis of APKs, app components, DEX/Smali, local databases and network behavior in authorized test environments.
3. **Unified Control Surface** — one operator experience with explicit capabilities, evidence, approvals, audit trail and kill switch.

The target is maximum technically available capability **within device-owner consent, explicit authorization, platform security boundaries and applicable law**. Do not weaken these boundaries through stealth, credential theft, unauthorized access, or evasion of third-party controls.

## 2. Preserve and integrate

The following existing Control-room assets remain canonical; do not fork or replace them:

- Reverse Engineering Lab tooling and its APKtool/JADX/Manifest/DEX/Smali workflows.
- Browser Agent Gateway and its authenticated job/evidence boundary.
- Playwright Operator Worker, account registry, host policy and EnvironmentSecretProvider.
- Network Access contract and proxy policy.
- Control Room UI, service-worker cache and existing Android/browser shell.

MIDAD Intelligence remains a read-only research/scanning subsystem. It may consume redacted health/evidence projections but must not become a production executor or credential store.

## 3. Android runtime planes

| Plane | Responsibility | Trust boundary |
|---|---|---|
| Device Core | lifecycle, capability registry, local state, offline queue | Android app sandbox |
| Lab Engine | APK inventory, hashes, manifest/components, DEX/Smali metadata, static findings | User-selected files and isolated workspace |
| Dynamic Test Adapter | authorized test instrumentation, debug builds, emulator/test device sessions | Explicit target allowlist and session consent |
| Network Observer | metadata and traffic inspection for owned/test apps and controlled endpoints | No global interception by default |
| Payload Engine | schema validation, normalization, redaction and local fixtures | Untrusted input boundary |
| Automation Engine | user-approved UI and local workflow actions | Per-action capability and audit |
| MIDAD Gateway | authenticated job exchange and sanitized evidence | No secrets in client-visible payloads |
| Evidence Ledger | hashes, source, timestamps, tool/version, findings and result | Append-only evidence records |

## 4. Capability model

Capabilities are explicit, separately granted and revocable:

- `APK_READ`: read user-selected APKs and calculate cryptographic hashes.
- `STATIC_ANALYSIS`: inspect package metadata, manifest, components, DEX/Smali and resources.
- `DYNAMIC_TEST`: run instrumentation only against a declared owned or authorized test target.
- `NETWORK_OBSERVE`: inspect traffic only for the app/test environment under an explicit session.
- `LOCAL_AUTOMATION`: execute declared local actions through Android-supported APIs.
- `ROOT_DIAGNOSTICS`: optional diagnostic commands after a visible user grant; disabled by default.
- `MIDAD_CONNECT`: exchange signed/ authenticated jobs and redacted evidence with the existing gateway.

Every operation must resolve to: actor, target, capability, scope, policy version, timestamp, result and evidence reference. Missing authorization is a hard deny.

## 5. Root and device privilege boundary

Root is optional, never assumed. Do not include stealth root concealment, root-detection bypass, silent privilege escalation, persistence, or arbitrary remote shell execution.

If a device owner explicitly enables root diagnostics:
- show the exact command and target before execution;
- enforce a local command allowlist and bounded timeout/output;
- reject shell metacharacter composition and untrusted interpolated arguments;
- keep the operation local; never expose a root shell through the Gateway;
- record command identity, approval and result without recording secrets;
- provide an immediate kill switch and revoke the capability on session close.

Prefer Android public APIs, SAF, PackageManager, WorkManager and test-only instrumentation over root.

## 6. Network and protocol analysis

- Do not globally intercept other applications' traffic.
- Use a controlled debug build, test CA, local fixture, emulator or explicitly configured test proxy for authorized inspection.
- Do not impersonate third-party clients, harvest session cookies/tokens, defeat access controls, or silently replay authenticated requests.
- Do not disable TLS verification in production.
- Treat certificate pinning and platform protections as security boundaries; use source-level debug configuration or a purpose-built test build for validation.
- Normalize observed requests/responses into redacted evidence; remove Authorization, Cookie, Set-Cookie, API keys, personal data and secrets before storage or display.
- Exact-host allowlists, route scope and fail-closed behavior remain aligned with `MIDAD_NETWORK_ACCESS_V1.md`.

## 7. Data contract

All extracted records use a versioned envelope:

```json
{
  "schema": "midad.android-evidence/v1",
  "evidenceId": "uuid",
  "source": {
    "kind": "APK|MANIFEST|DEX|NETWORK_FIXTURE|TEST_SESSION",
    "sha256": "hex",
    "tool": "tool-name",
    "toolVersion": "version"
  },
  "target": {
    "packageName": "optional",
    "authorizationRef": "local-policy-reference"
  },
  "observedAt": "RFC3339 timestamp",
  "classification": "PUBLIC|INTERNAL|SENSITIVE_REDACTED",
  "findings": [],
  "redactions": [],
  "status": "VERIFIED|INFERRED|PENDING|FAILED|BLOCKED"
}
```

Never place credentials, raw cookies, OTPs, recovery material, private customer data or wallet signing material in evidence envelopes or CI artifacts. Preserve source hashes and provenance so results are reproducible.

## 8. Module boundaries

Suggested additive package boundaries (final paths must follow the existing Android module layout discovered during implementation):

- `core/capabilities` — capability registry and policy decisions.
- `core/evidence` — evidence envelope, hashing, redaction and local ledger.
- `lab/apk` — APK intake and static-analysis adapters.
- `lab/dynamic` — test-only instrumentation adapter.
- `network/observer` — controlled network observation and fixture replay.
- `automation/local` — Android-supported local automation.
- `gateway/client` — authenticated, least-privilege Gateway adapter.
- `ui/control` — operator status, approvals, evidence and kill switch.

These are logical ownership boundaries, not permission to create a duplicate app or move existing files. Reuse existing libraries and adapters where present.

## 9. Delivery phases and acceptance gates

### Phase 0 — source inventory and preservation
- Identify the existing Android module, build files, package IDs, entry points, manifest, CI workflows and current APK artifact path.
- Record baseline commit and existing tests.
- No mass refactor, no service deployment, no secrets migration.

### Phase 1 — device foundation
- App starts offline.
- Capability registry defaults to deny.
- Local evidence envelope and SHA-256 hashing are tested.
- SAF APK import works without broad storage permission.
- Existing browser shell and routes remain intact.

### Phase 2 — Reverse Engineering Lab integration
- Static APK metadata/manifest analysis produces reproducible evidence.
- DEX/Smali tooling runs through an adapter with bounded resource use.
- Unsupported/corrupt APKs fail safely with actionable diagnostics.
- No automatic upload of APKs or findings.

### Phase 3 — controlled dynamic and network testing
- Requires explicit target authorization and session approval.
- Test-only instrumentation and proxy configuration are isolated from production.
- Redaction tests prove secrets do not enter logs or evidence.
- Session close revokes test capabilities and clears transient state.

### Phase 4 — MIDAD Gateway integration
- Reuse the existing authenticated Gateway and job protocol.
- Device receives only scoped jobs and sends redacted evidence.
- No client-side vault values or privileged proxy credentials.
- Offline queue is idempotent and bounded.

### Phase 5 — release hardening
- Unit, integration and Android instrumentation tests pass.
- Dependency, manifest, exported-component and permission review passes.
- Release build is signed through the existing secure CI path.
- APK artifact hash, version, build run and test evidence are recorded.

## 10. Non-goals

- Unauthorized access to third-party systems or accounts.
- Credential/session theft, token replay or covert collection.
- Global interception of unrelated apps.
- Stealth, persistence or evasion of security controls.
- Arbitrary remote root shell or destructive commands.
- Automatic live financial actions, wallet signing or payments.

## 11. Completion reporting

Every milestone reports:
- **VERIFIED:** backed by a test, artifact, hash or runtime observation.
- **INFERRED:** plausible but not directly proven.
- **PENDING:** not yet executed.
- **FAILED:** attempted and failed, with evidence.
- **BLOCKED:** external permission, dependency or infrastructure prevents progress.

A source change, passing CI, APK build, installation and live runtime operation are distinct states and must never be conflated.
