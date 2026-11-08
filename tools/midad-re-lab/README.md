# MIDAD Reverse Engineering Lab

**Status:** Existing analysis toolkit; capability expansion is gated and evidence-driven.  
**Ownership:** `tools/midad-re-lab/`  
**Operating rule:** Authorized scope → acquire and hash → analyze → record evidence and limitations → reproduce → repair through the appropriate MIDAD engineering path → verify.

## Mission in the HakiOS / MIDAD architecture

The Reverse Engineering Lab is a **first-class Engineering Intelligence Plane**, not a one-off utility and not a production browser worker. It establishes how an existing system behaves before MIDAD changes, integrates, ports, replaces, or extends it.

It is the upstream evidence and discovery path for work involving:
- Android APKs, manifests, DEX, Smali, native library inventory and packaged web assets.
- Web applications and public HTTPS surfaces, within the read-only target policy.
- HakiOS source, boot configuration, firmware/loader/kernel artifacts and QEMU diagnostics, as the HakiOS-specific adapters and parsers are added and verified.
- Existing MIDAD components and third-party systems that MIDAD owns or is explicitly authorized to inspect.

The lab does **not** replace:
- `tools/midad-browser-runtime/`: authorized browser job execution and operator-session runtime.
- `compute/mncf/`: bounded Linux compute and future persistent worker execution.
- HakiOS/QEMU workflows: isolated boot and guest-system verification.
- Existing MIDAD Control Plane, Forge, Gateway, or evidence/event contracts.

## Existing capabilities — source-reviewed

| Component | Current responsibility | Boundary |
|---|---|---|
| `analyze_apk.py` | Validate and hash APK input; run APKtool and JADX; inventory manifest, components, permissions, DEX and packaged assets; parse APK-derived XML with `defusedxml` and a 2 MiB Manifest limit; emit JSON reports | Static analysis; it does not install or launch the APK |
| `dex_intelligence.py` | Parse DEX entries, summarize classes/methods and bounded string indicators, inventory Smali structure | Static parsing; does not execute app code |
| `web_bundle_intelligence.py` | Inspect APK-embedded HTML/CSS/JS assets, declared/missing files, local references, Capacitor bridge/plugin metadata, endpoint and API indicators | Archive-only analysis; JavaScript is not executed and this analyzer makes no network requests |
| `analyze_web.py` | Inspect an authorized public HTTPS site using bounded HTTP and headless browser observation | Same-host and public-address checks; GET/HEAD only; cross-host redirects and disallowed requests are blocked; no login, form submission, CAPTCHA bypass or evasion |
| `test_*.py` | Policy, resilience, DEX and web-bundle regression tests | Tests use controlled fixtures and mocks; a passing unit suite does not prove a live target was inspected |

**Untrusted APK XML boundary:** APK-derived `AndroidManifest.xml` is parsed with `defusedxml`, with DTD/entity/external entity processing disabled and a 2 MiB size ceiling. The parser rejects malformed, DTD-bearing or oversized manifests with explicit error states. The Mobile Factory helper that parses the repository's own checked-in Manifest is a separate trusted-source path; it is narrowly documented in the source and is not used for arbitrary APK input.


### Existing automation

- `.github/workflows/midad-re-lab-ci.yml` compiles the analyzers and runs policy/resilience/DEX/web-bundle tests.
- `.github/workflows/midad-re-lab.yml` supports read-only web-surface analysis, static analysis of existing MIDAD APK build artifacts, and optional analysis of an APK supplied through HTTPS.
- The web workflow records reports as GitHub Actions artifacts with a 14-day retention setting in the workflow.
- The workflow definitions are present in source control. Their presence alone does not prove that a current target run, artifact download, evidence-ledger ingestion or production integration has completed.

## Required case contract

Every future investigation should have a case record, even when a workflow_dispatch input starts it. At minimum, record:

1. **Authorization:** owner/authorized party, permitted target, purpose, and explicit exclusions.
2. **Target identity:** target name, version/build, source/reference, acquisition time and acquisition method.
3. **Integrity:** SHA-256 of each acquired APK/archive/image/log/source snapshot; preserve originals read-only.
4. **Method:** exact analyzer/tool versions, commands, environment, limits and whether any target code ran.
5. **Findings:** observations separated from hypotheses; affected component/path; severity and confidence.
6. **Evidence:** report path, source hash, relevant log excerpts, dependency/API maps and reproducible test fixture.
7. **Limitations:** skipped/unsupported formats, truncated results, parser failures, unavailable symbols and unverified assumptions.
8. **Disposition:** preserve, repair, integrate, defer or reject; owner and approval state for any action.

Never store raw secrets, passwords, access tokens, cookies, private keys, wallet keys or sensitive session material in a report. Redact query parameters and secret-like strings. Do not publish decompiled proprietary source or user data as a default artifact.

## Standard engineering loop

```text
SCOPE & AUTHORIZATION
        ↓
ACQUIRE READ-ONLY + SHA-256
        ↓
STATIC STRUCTURE / POLICY ANALYSIS
        ↓
BOUNDED OBSERVATION IN AN ISOLATED RUNNER (ONLY WHEN AUTHORIZED)
        ↓
EVIDENCE + FINDINGS + CONFIDENCE + LIMITATIONS
        ↓
REPRODUCIBLE TEST / REGRESSION CONTRACT
        ↓
MIDAD FORGE + MNCF EXECUTION (APPROVED WORK ONLY)
        ↓
HakiOS QEMU / Android / Browser Runtime VERIFICATION
        ↓
HUMAN REVIEW + PROMOTION DECISION
```

**Non-negotiable separation:** analysis does not authorize modification. Findings do not automatically become jobs. Jobs do not automatically gain permission to change an external target. Production deployment and irreversible or financial actions remain separately approved.

## HakiOS-specific workstream

The existing QEMU workflow and boot artifacts should become first-class RE Lab evidence inputs. The next adapters should be incremental and read-only:

1. Verify artifact checksums and retain exact source revisions.
2. Normalize QEMU/U-Boot/UEFI/XNULOADER boot logs and classify the failure stage (firmware, loader, kernel, userspace, restart).
3. Compare boot-path configurations and memory maps; trace fixed payload addresses, firmware pairing and boot arguments to the corresponding source/config lines.
4. Inventory kernel, ramdisk, device-tree, partition and firmware metadata without executing unknown payloads.
5. Add format-specific parsers only after license, provenance, size, decompression and sandbox limits are reviewed.
6. Turn each confirmed defect into a minimal reproducible test before changing HakiOS or MIDAD integration code.

The existing HakiOS evidence must retain its exact classification: U-Boot reached a one-shot userland message and returned to the loader; that did not prove a stable OS session. UEFI-ESP and loader-device failures must remain separate until their own evidence changes.

## Execution and isolation policy

- Analyze only assets owned by MIDAD or explicitly authorized for analysis.
- Default to static analysis. Unknown executables, APKs, firmware and disk images must never be run on the persistent MIDAD VPS.
- Run any necessary target execution only in a disposable, resource-bounded, network-restricted environment with a known snapshot and teardown path.
- Do not scan private IPs, internal DNS, localhost, cloud metadata endpoints, or targets outside the approved scope.
- Do not bypass authentication, MFA, CAPTCHA, paywalls, DRM, anti-bot controls, or access controls. Do not harvest credentials or session cookies.
- The web observer is not an active scanner: keep it read-only and bounded.
- Preserve the current analyzer limits and failure reporting. A partial parser result must stay `partial`, not be promoted to `completed`.
- Use GitHub Actions as the current disposable analysis runner where appropriate; do not turn the small persistent VPS into an untrusted sample execution host.
- Any new analyzer must have unit tests for malformed input, oversized files, path traversal, secret redaction, partial failure and resource limits.

## Integration boundaries

| Consumer | What it may consume from the lab | What it must not infer |
|---|---|---|
| MIDAD Control Room / Forge | Reviewed case status, hashes, findings, test requirements, report references | That a finding is authorization to act |
| MNCF Linux runtime | A bounded, reviewed build/test/analysis manifest | Permission to execute arbitrary samples |
| HakiOS QEMU lab | Versioned boot artifacts, configuration diffs, boot logs and reproducible regression tests | That a one-shot boot equals a production OS |
| Android Factory | APK metadata, manifest/DEX/web bundle reports, regression checks | That static inspection proves runtime behavior |
| Browser Runtime | Approved target metadata and policy constraints | That analysis reports grant login/session or mutation permissions |
| Evidence ledger | Future sanitized report references and provenance through an explicit adapter | That the current RE workflows already write to the live ledger |

No new queue, Edge Function, database table, orchestrator, or persistent browser stack is introduced by this charter.

## Next implementation gates

| Gate | Work | Acceptance evidence |
|---|---|---|
| RE-0 — Baseline | Run existing unit/CI tests; inventory workflows and current MIDAD APK artifacts | Green tests, exact source and report hashes |
| RE-1 — Case/evidence contract | Define a versioned case/report envelope and sanitized artifact manifest | Schema tests; no secret values; explicit partial/failed states |
| RE-2 — HakiOS adapters | Parse QEMU/U-Boot/UEFI logs and boot configurations | Fixtures derived from retained logs; reproducible classifications |
| RE-3 — Safe orchestration | Connect reviewed findings to Forge/MNCF through existing contracts | Authorization, idempotency, provenance and no duplicate queue tests |
| RE-4 — Isolated dynamic testing | Add only the needed disposable guest/device tests | Network isolation, snapshot rollback, resource caps and evidence |
| RE-5 — Control Room visibility | Show case status, evidence references, confidence, blockers and next action | Read-only UI contract and auditable state transitions |

A gate is `VERIFIED` only when its acceptance evidence exists. Otherwise report `PENDING`, `PARTIAL`, `FAILED` or `BLOCKED` accurately.
