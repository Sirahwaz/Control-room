---
name: midad-authorized-app-analysis
description: >-
  Plans and performs a bounded isolated static or dynamic analysis of APK or
  website assets only when owned by the operator or expressly authorized.
---

# MIDAD Authorized App Analysis

## Authorization preflight

Do not start testing until the target, ownership/authorization evidence, scope and excluded systems are recorded. For an unknown third-party target, use public documentation only. The presence of a tool name or a skill is not proof of readiness.

## Isolation

- Preserve the original file read-only and calculate SHA-256.
- Use a disposable emulator, container or workstation only if it is actually available. Keep network access disabled unless the authorization explicitly includes bounded network testing.
- Do not load production credentials, personal accounts, wallet apps, service-role keys, OAuth refresh tokens or live payment keys.
- Do not test external endpoints merely because an app refers to them.

## Static analysis

1. Validate input type and size; hash the artifact.
2. Inventory package, version, manifest, permissions, exported components, URL schemes and bundled dependencies using verified tools.
3. Review insecure storage, embedded secrets, cleartext transport settings, excessive permissions, unsafe deep links and dependency risks.
4. Treat any candidate credential as sensitive: redact it, report only its location/type and recommend rotation. Never authenticate with or reuse it.
5. Tie each finding to a path, tool version, evidence, confidence and impact.

For web assets, map routes/forms from authorized source or public docs, run local tests and inspect authorization boundaries. Do not probe unrelated production systems.

## Dynamic analysis

Require explicit scope. Start with harmless launch/navigation smoke tests. If network observation is authorized, use a controlled destination and synthetic data. Do not intercept unrelated traffic or bypass authentication/certificate pinning. Do not perform persistence, credential theft, hidden collection, payment, wallet signing or real-account actions.

## Tool readiness

For JADX, Apktool, Frida, Android SDK/emulator or Playwright, record exact executable/package and version, harmless-fixture test, command/exit status and limitations. Allowed states are available_and_tested, missing, failed_preflight or not_authorized. If no executable/runtime is reachable, block that stage.

## Stop and report

Maximum three attempts per incident. Break the circuit after repeated identical failures and switch approach or stop. Report target hash, authorization scope, tools actually run, reproducible evidence, impact/confidence and limitations. Never claim Frida/JADX/Apktool or end-to-end APK readiness without practical evidence.
