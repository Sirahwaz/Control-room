# MIDAD Mobile Factory — Release Certification Protocol

## Objective

A product is not considered deliverable merely because it builds.

The factory must prove:

REQUEST
→ REQUIREMENTS
→ REUSE / ADAPT / BUILD
→ SOURCE CERTIFICATION
→ BUILD
→ ARTIFACT CERTIFICATION
→ RUNTIME VERIFICATION
→ DELIVERY CERTIFICATE
→ CUSTOMER DELIVERY
→ OUTCOME / LEARNING

## Release states

- PLANNED: request accepted but work not started.
- GENERATING: source is being assembled.
- BUILDING: Android/package build is running.
- TESTING: source, contract, artifact, and runtime gates are running.
- VERIFIED: all mandatory technical gates passed.
- RELEASED: a verified artifact was published through the approved release route.
- CUSTOMER_READY: production-signed artifact + required runtime evidence + delivery certificate.
- FAILED: one or more mandatory gates failed.
- BLOCKED: a required capability/evidence/credential/approval is unavailable.

## Mandatory gate families

### 1. Requirements and architecture
Need-first/provider-second, capability plan, reuse plan, agent plan, automation plan, fallback coverage.

### 2. Source integrity
Manifest schema, configured entry/assets, HTML references, DOM/JS contract, JavaScript syntax, hard-coded-secret scan, factory-policy checks.

### 3. Product contract
Product-specific deterministic smoke tests should cover UI ids, providers, localization, explainability, fail-closed/no-data behavior, and prohibited execution surfaces.

### 4. Build
Factory render, dependency install, Android build, version identity, and build report.

### 5. Artifact integrity
APK exists, SHA-256 is recorded, Android signature is valid, package id/version match the manifest, and artifact size/integrity checks pass.

### 6. Runtime verification
When a device/emulator is available, test launch, primary flows, loading/error/empty states, navigation/back, language switching, network failure/degradation, and no unexpected crash.

A runtime test that was not run must never be represented as PASS.

### 7. Production delivery
Customer delivery requires:
- release_channel = production
- production-managed signing
- artifact certification PASS
- runtime evidence PASS
- delivery certificate PASS
- exact APK SHA-256 recorded
- manifest and test reports retained

Debug/internal artifacts are test artifacts, not customer-delivery artifacts.

## Repair policy

Maximum 3 targeted repair attempts per incident.

After the third failed repair:
FAILED or BLOCKED
→ evidence retained
→ escalation

Do not restart the product from scratch.

## Evidence rule

Every important gate produces machine-readable evidence.

Claim mapping:
PASS = directly evidenced
WARN = condition known but non-blocking
PENDING = evidence not yet collected
FAILED = test executed and failed
BLOCKED = test could not be executed because a required dependency/evidence/access path is unavailable

## Customer handoff package

A complete delivery package should contain:

- APK
- SHA-256
- product manifest
- source certification report
- artifact certification report
- runtime smoke report
- build report
- test report
- learning report
- delivery certificate
- release notes / known limitations
- rollback/reference information
