# MIDAD Security Assessment & Penetration Testing Track
## Architecture proposal and capability-gap baseline — 2026-11-08

**Status:** Architecture proposal committed on an isolated feature branch. No scanner was installed, no active target scan was run, and no production setting was changed in this change.
**Canonical owner:** `Sirahwaz/Control-room`
**Existing capability owner:** `tools/midad-re-lab/`
**Operating principle:** Audit → Preserve → Extend → Verify. This track extends the existing MIDAD Reverse Engineering Lab; it does not create a parallel lab or replace the Control Plane, Forge, Browser Gateway, MNCF or Evidence contracts.

---

## 1. Executive decision

Establish **MIDAD Security Assessment & Validation (MSAV)** as a capability track inside the existing Reverse Engineering Lab.

The target is not to imitate a vendor's marketing page or accumulate scanners. The target is a repeatable security-assessment service with:

1. Explicit authorization and target scope.
2. Evidence-backed discovery and reproducible tests.
3. Static, dependency, configuration and dynamic testing selected for the asset.
4. Manual/agent-assisted reasoning for authentication, authorization, workflow and business-logic issues.
5. Severity, likelihood, asset impact and confidence kept distinct.
6. Clear remediation recommendations and owner approval.
7. Independent review and controlled retesting.
8. A traceable record in MIDAD's existing evidence/control architecture.

**Important capability boundary:** having tools does not make MIDAD equivalent to an accredited human penetration-testing consultancy. Professional manual assessments, regulated/critical-infrastructure engagements and claims of certification require appropriately qualified and accountable human testers, formal rules of engagement, insurance/legal review where applicable, and independent sign-off. MIDAD can become particularly differentiated in continuous assessment, API/agent security and evidence-to-repair automation, without claiming human qualifications it does not possess.

## 2. Comparison baseline: Yekta service model

The Yekta page describes a service model covering web, mobile, APIs, networks, cloud, identity environments, Wi-Fi, OSINT, AI/LLM systems and red-team-style exercises. It combines black/grey/white-box approaches, manual tester activity, documented and reproducible findings, risk classification, a final report, review and optional retesting.

That gives MIDAD a useful acceptance benchmark:

| Capability dimension | Yekta-described service model | MIDAD evidence today | MIDAD target |
|---|---|---|---|
| Scope and authorization | Defined engagement, test mode and third-party approvals | Existing RE Lab case contract requires authorization, target identity and exclusions | Machine-validated engagement policy and signed scope record |
| Web assessment | Web app tests aligned to OWASP methods | Existing bounded HTTPS observer; GET/HEAD, same public host, no login/forms | Passive DAST first; staged active tests only after explicit approval |
| Mobile | Android/iOS assessment | APK hashing, manifest, components, permissions, DEX/Smali and embedded bundle analysis | Add repeatable mobile security checks and optional isolated dynamic analysis |
| APIs | REST/GraphQL authentication and business logic | No dedicated API security test suite verified in this audit | API inventory, authorization matrix, schema checks and controlled API tests |
| Cloud / identity | Cloud and enterprise identity environments | Supabase advisor and read-only privilege audit are connected; broader cloud posture not verified | Provider-specific posture checks and identity review under explicit scope |
| Network | External/internal network and service assessment | No dedicated network scanner execution path verified in connected tools | Scoped, low-rate network discovery later; isolated lab first |
| AI / LLM | Prompt injection and unintended behavior are mentioned | MIDAD has agent, browser and model-routing architecture; no complete AI-security assessment suite verified | Make AI/agent security a differentiating first-class test domain |
| Manual business-logic testing | Human-led tester analysis | Existing case/evidence workflow can capture reasoning, but no certified tester team evidenced | Human-led review for high-impact findings and business-logic tests |
| Reporting | Reproducible evidence, severity and prioritized advice | RE Lab README specifies fields; no single versioned MSAV finding/report schema verified | Versioned report contract, evidence hashes, peer review and customer-ready output |
| Retest | Optional retest after remediation | No end-to-end retest workflow evidenced | Regression test + independent retest + closure evidence |

**Strategic position:** Yekta currently describes a broader established consulting service with qualified human testers and manual engagement experience. MIDAD's potential advantage is a connected engineering loop across code, APKs, APIs, browser agents, LLMs, evidence, Forge and CI. That advantage remains a target until execution and report quality are verified.

## 3. Existing MIDAD assets to preserve

### 3.1 Reverse Engineering Lab

Preserve and extend `tools/midad-re-lab/`:

- `analyze_apk.py`: APK validation and hashing; APKtool/JADX analysis; manifest, components, permissions, DEX and packaged-asset inventory. Static analysis only; it does not install or run an APK.
- `dex_intelligence.py`: bounded DEX structure, classes/methods, string indicators and Smali inventory.
- `web_bundle_intelligence.py`: archive-only inspection of HTML/CSS/JS, local references, Capacitor/plugin bridges and endpoint/API indicators. It does not execute JavaScript or make network requests.
- `analyze_web.py`: bounded public HTTPS observation using a headless browser; validates public addresses, same-host navigation and GET/HEAD-only requests; blocks cross-host redirects and disallowed methods; does not log in or submit forms.
- Existing policy, resilience, DEX and web-bundle tests.
- Existing CI and manually dispatched RE Lab workflows, including static review of selected existing MIDAD APK artifacts and bounded public-web observation.

These capabilities are **source-reviewed**. This audit did not establish that a fresh workflow run has completed, that all historical APK artifacts remain available, or that reports are currently ingested into the live Evidence Ledger.

### 3.2 Existing architecture and controls

Reuse, do not replace:

- Control Room as the operator interface.
- Existing MIDAD Forge and coordinator for approved engineering work.
- Existing Browser Gateway and browser runtime for authorized browser work.
- Existing MNCF worker contract for bounded execution.
- Existing evidence/event contracts and browser evidence ledger where the integration is verified.
- Existing GitHub Actions for ephemeral build/test/analysis workloads.
- Existing architecture governance for module ownership, path safety, secret-pattern checks and provenance.

Do not create a second orchestration queue, a new privileged database path or a parallel browser stack merely for this track.

## 4. Tool capability plan

Tools below are **candidate additions**, not claims that they are already installed or operational. Pin versions, review licenses, record tool output, and test against controlled fixtures before using them on real targets.

| Layer | Candidate | Purpose | Initial operating mode | Deployment decision |
|---|---|---|---|---|
| SAST | Semgrep Community Edition | Code patterns and security rules in Python/JS/TS and supported languages | CI on owned repositories; reviewed rules | Candidate P1 |
| Secrets | Gitleaks | Detect credentials accidentally committed to Git | CI on owned repositories; redact all values | Candidate P1 |
| SCA / SBOM | OSV-Scanner | Identify known vulnerable dependencies from manifests/lockfiles | CI, lockfile-driven; no exploit attempts | Candidate P1 |
| FS / IaC / container | Trivy | Dependency vulnerabilities, configuration, secret checks and SBOM | Filesystem/config scan first; container-image scans only where images exist | Candidate P1 |
| Web DAST | OWASP ZAP | Passive baseline and later controlled active checks | Baseline/passive first on owned staging; active scan requires per-case approval | Candidate P2 |
| Template-based web checks | Nuclei | Curated checks for known web exposure/misconfiguration | Disabled by default; strict templates, host allowlist, low request rate | Candidate P2/P3 |
| Network discovery | Nmap | Ports and service inventory | Isolated lab or explicitly authorized narrow target ranges only | Candidate P4 |
| Mobile analysis | MobSF | Additional static and optional dynamic Android/iOS analysis | Disposable CI runner or dedicated lab host; no constrained production VPS | Candidate P3 |
| TLS / HTTP posture | testssl.sh and targeted HTTP-header checks | TLS protocol/certificate and web-header review | Read-only against approved endpoints | Candidate P2 |
| Manual API tests | OWASP WSTG / API Security Top 10 test cases | AuthN/AuthZ, object-level access, function-level access, rate limits and business logic | Human-approved test matrix and test accounts on staging | Candidate P2 |
| AI / agent security | OWASP GenAI Top 10 + custom MIDAD fixtures | Prompt injection, excessive agency, data leakage, retrieval isolation and tool misuse | Offline synthetic fixtures; isolated model/tool sandboxes | Candidate P1/P2 |
| Cloud posture | Provider-native read-only advisors and configuration inventory | IAM, exposed services, storage, logs, secrets, network rules | Read-only inventory; no automatic policy edits | Candidate P3/P4 |

### Resource placement

- Use GitHub Actions hosted runners for short-lived scanners and report artifacts while available and within included limits.
- Keep heavy tools (MobSF, full browser stacks, Docker, OpenVAS/Greenbone, QEMU) off the reported small NeoHeberg VPS until its real CPU, RAM, disk and OS state are re-measured.
- The VPS is a constrained candidate, not a verified security scanning host. It may later relay small reports or run a lightweight scheduler if measurements and hardening support that role.
- Do not introduce a paid dependency or paid service without first stating the exact cost and obtaining approval.
- Do not send private source, APKs, secrets or customer evidence to a third-party scanner unless the data-processing location, retention, access and user authorization have been reviewed.

## 5. Assessment methodology and report contract

Every security assessment is a case with a closed scope. The case must record:

- Case ID, requester, asset owner, authorization evidence and approval timestamp.
- Exact targets (URLs, domains, IPs, app identifiers, API base paths, versions/build hashes).
- In-scope and out-of-scope assets, allowed test windows, test accounts and excluded techniques.
- Test mode: `PASSIVE`, `ACTIVE_STAGING`, or `ISOLATED_LAB`.
- Tool name/version, rule-pack version, configuration, run timestamps and limits.
- Input hashes and report hashes; preserve original acquisitions read-only.
- Observations separated from hypotheses; affected asset/component; evidence reference.
- Reproduction steps and expected versus observed result.
- CWE/CVE where applicable; CVSS v4.0 vector where suitable; EPSS as a separate population-level exploitation signal where a CVE exists.
- Asset criticality, exposure and business impact evaluated separately from generic CVSS/EPSS values.
- Finding confidence, severity, limitations and false-positive disposition.
- Remediation owner, due date, approval state, regression test and retest result.
- Independent reviewer and final acceptance.

Suggested machine states:

`DRAFT → AUTHORIZATION_PENDING → READY → RUNNING → REVIEW_REQUIRED → CONFIRMED / FALSE_POSITIVE → REMEDIATION_APPROVED → RETEST_PENDING → CLOSED`

Terminal or exceptional states: `BLOCKED`, `PARTIAL`, `FAILED`, `CANCELLED`.

A report must never turn a timeout, scanner error or partial run into a clean bill of health. Findings need confidence and limitations; an absence of findings is not proof of security.

## 6. Coverage model

### A. Web applications

Use OWASP ASVS as a verification requirements catalogue and OWASP WSTG as a test methodology. Include authentication, session management, access control, input handling, cryptography, business logic, client-side behavior, configuration and security headers. Automated scanning is triage, not the final assessment.

### B. APIs

Build an endpoint inventory and per-role authorization matrix. Test object-level and function-level authorization, tenant isolation, mass assignment, schema validation, rate limiting, error disclosure, replay/idempotency and business workflows. Include REST and GraphQL where present. Never assume authentication implies authorization.

### C. Mobile applications

Combine existing APK/DEX/Smali and embedded-web analysis with MASVS/MASTG-derived checks for local storage, transport security, platform permissions, cryptographic handling, WebView/bridge boundaries, deep links, exported components and authentication. Dynamic testing must use a disposable emulator/device and synthetic accounts.

### D. Cloud, database and identity

Start with read-only inventory and provider security advisors. Review public exposure, IAM boundaries, service credentials, database grants, RLS, exposed schemas, storage access, audit logs, webhook authentication and secret rotation. Do not change grants or policies as a scanner side effect.

### E. AI, LLM and agent systems — MIDAD differentiator

Create reproducible synthetic test fixtures for:

- Direct and indirect prompt injection.
- Instructions embedded in web pages, documents, email, source files and retrieved content.
- Excessive agency: unauthorized tool calls, external messages, purchases, deployments or data mutations.
- Cross-user/cross-tenant memory and retrieval isolation.
- Secret, credential, personal-data and hidden-context disclosure.
- Unsafe browser navigation, SSRF-style target confusion and private-address access.
- Tool output treated as instructions rather than untrusted data.
- Improper output handling, generated code/config injection and unsafe deserialization boundaries.
- Model/tool supply-chain drift and unbounded resource/token consumption.
- Failure behavior, approval enforcement, kill switches and audit-trail completeness.

Tests must verify the control boundary, not merely ask a model whether it is safe. Use synthetic secrets and data, no real customer or production credentials.

### F. Network and red-team work

Only after the earlier tracks are established: narrowly scoped service discovery, TLS/configuration assessment and approved internal-lab exercises. Active internal network testing, directory enumeration, lateral movement, phishing, social engineering, denial-of-service and physical tests are separate engagement classes requiring explicit written scope and human-led rules of engagement. They are not enabled by default and are not inferred from general authorization to review a website or repository.

## 7. Security and execution policy

1. No scan without a case ID, target owner, explicit authorization and allowlist.
2. Default to passive/static. Active testing only against owned staging or a specifically authorized target and time window.
3. No brute force, password spraying, credential harvesting, persistence, destructive payloads, DoS, evasion, stealth or lateral movement under this baseline.
4. No scanning localhost, private IP ranges, cloud metadata endpoints, internal DNS or adjacent tenants unless a separate lab scope explicitly authorizes them.
5. Apply DNS/IP validation at connection time, redirect validation, host allowlists, request/time/response-size ceilings and rate limits. Resolve DNS rebinding and redirect edge cases in tests.
6. Keep secrets out of logs and reports. Redact tokens, cookies, authorization headers, private keys, wallet material and sensitive query parameters.
7. Isolate untrusted samples and dynamic execution in disposable, resource-bounded, network-restricted environments with snapshot/teardown.
8. Findings do not authorize changes. Remediation, production deployment, account actions and any financial/irreversible operation require their existing approval gates.
9. Critical findings must be escalated promptly to the authorized owner, with minimum evidence needed to reproduce safely.
10. Stop a run if scope is ambiguous, unexpected sensitive data appears, production stability is affected, or the target owner requests stop.

## 8. Phased implementation gates

| Gate | Work | Acceptance evidence | Initial status |
|---|---|---|---|
| MSAV-0 — Baseline | Preserve RE Lab; inventory tools, CI, target assets and report paths | Source hash, tests, workflow and asset inventory | PARTIAL — source reviewed; fresh run not yet evidenced |
| MSAV-1 — Repo supply-chain | Add Semgrep, Gitleaks, OSV-Scanner and Trivy to a non-blocking CI branch | Pinned versions, test fixtures, SARIF/JSON, redaction tests, no secrets uploaded | PENDING |
| MSAV-2 — Case/report contract | Define versioned case, finding, evidence and retest schemas | Schema validation; state and failure semantics; artifact hashes | PENDING |
| MSAV-3 — Web/API passive | ZAP Baseline + endpoint inventory + API contract/auth matrix | Owned staging target, allowlist proof, passive report and reviewed findings | PENDING |
| MSAV-4 — Mobile | Extend static checks; test MobSF in disposable runner | APK hash, MASVS mapping, emulator/network isolation proof | PENDING |
| MSAV-5 — AI/agent | Add synthetic prompt/tool/RAG isolation test corpus | Reproducible tests, approval/kill-switch and leakage checks | PENDING |
| MSAV-6 — Cloud/network | Read-only posture inventory, then narrowly scoped network tests | Explicit scope, rate-limited output, no unapproved changes | PENDING |
| MSAV-7 — Evidence/retest | Integrate reviewed reports through existing evidence contracts; add retest status | End-to-end case with report hash, reviewer, remediation and verified retest | PENDING |
| MSAV-8 — Service readiness | Human review, reporting templates, pricing/scope boundaries and operating handbook | Sample engagement on a lab target; independent quality review; limitations stated | PENDING |

A gate is VERIFIED only when its acceptance evidence exists. Do not promote a documentation plan or a green unit-test run into proof that a live asset has been assessed.

## 9. Current live security baseline — 2026-11-08

Supabase Security Advisor was queried read-only for project `midad-ai`:

| Advisor finding | Live result | Correct interpretation / next action |
|---|---|---|
| RLS enabled, no policy | 34 tables (INFO) | A separate read-only privilege review found no direct table SELECT/INSERT/UPDATE/DELETE privileges for `anon` or `authenticated` on those tables. This is not, by itself, evidence of public row exposure. Do not add broad policies to silence the lint. |
| Extension in public schema | 1 warning: `pg_net` | Extension is in `public`; HTTP functions reside in `net`. `anon` and `authenticated` have schema usage/function execute grants. Whether `net` is exposed via PostgREST is still PENDING. Verify Dashboard → Integrations → Data API → Exposed Schemas before changing grants or extension placement. |
| Leaked password protection disabled | 1 warning | Review actual password-based Auth flows and plan/feature availability; no setting has been changed. |

The existing review is recorded in [SUPABASE_ACCESS_CONTROL_REVIEW_20261108.md](./SUPABASE_ACCESS_CONTROL_REVIEW_20261108.md). No database policy, grant, extension, secret or Auth setting was changed during this architecture work.

## 10. External standards and tool references

Use current versions at implementation time and record the exact version used in each case:

- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- OWASP WSTG: https://owasp.org/www-project-web-security-testing-guide/
- OWASP API Security Top 10: https://owasp.org/www-project-api-security/
- OWASP MAS / MASVS / MASTG: https://mas.owasp.org/
- OWASP GenAI Security Project: https://genai.owasp.org/
- NIST SP 800-115: https://csrc.nist.gov/pubs/sp/800/115/final
- CVSS v4.0: https://www.first.org/cvss/v4.0/
- EPSS: https://www.first.org/epss/
- Semgrep: https://semgrep.dev/docs/
- Gitleaks: https://github.com/gitleaks/gitleaks
- OSV-Scanner: https://google.github.io/osv-scanner/
- Trivy: https://trivy.dev/latest/
- OWASP ZAP Automation Framework: https://www.zaproxy.org/docs/automate/automation-framework/
- Nuclei: https://docs.projectdiscovery.io/tools/nuclei/overview
- Nmap: https://nmap.org/book/man.html
- MobSF: https://github.com/MobSF/Mobile-Security-Framework-MobSF

---

## Decision requested at the next review

Proceed with **MSAV-1 (repository supply-chain scanning)** first, in a separate feature branch and non-blocking CI mode. Preserve the existing RE Lab and keep all scanner outputs as short-lived, redacted artifacts. Do not deploy scanners to the VPS or run active tests against public production targets in this phase.
