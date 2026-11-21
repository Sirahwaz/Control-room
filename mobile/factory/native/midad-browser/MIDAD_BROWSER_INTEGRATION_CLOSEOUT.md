# MIDAD Browser — Integration Closeout Ledger

This document is the single acceptance ledger for the three optional subsystems. It distinguishes implemented policy contracts from deployable runtime capabilities.

## Baseline preserved
Native Android WebView remains the default browser engine. Existing tabs, history/bookmarks vault, appearance/font settings, downloads, default-browser intents and origin-bound Agent Bridge remain the baseline; these tracks do not replace them.

## Workstream status

| Workstream | Implemented in this change set | Not yet delivered / acceptance blocker |
|---|---|---|
| Network privacy | Validated HTTP/HTTPS/SOCKS5 profile metadata; fail-closed JS policy; native tunnel attestation contract; session freshness; credential redaction; tests | Android VpnService, real packet transport, actual authenticated endpoint, enforced OS-level kill switch, DNS/IPv6 leak tests, signed APK/device acceptance |
| MNN-Pocket | Model registry metadata, capability gate, prompt/token bounds, tests | Native MNN Android runtime, verified model assets/checksums, storage/download manager, JNI/native bridge, real inference and device benchmark |
| Cloudflare Kitesurf | Experimental renderer policy, native default/fallback, per-request remote consent, private-content local-only rules, endpoint validation, tests | Worker deployment, authenticated CDP/renderer transport, response validation, quotas/cost controls, remote rendering E2E |

## Security and cost invariants
- No fake/free VPN endpoint is bundled. A real endpoint and a documented transport protocol are required.
- A proxy profile is not a VPN. The policy module cannot enforce packet routing or an OS kill switch.
- Kitesurf remains disabled by default. Remote execution is only permitted for explicitly consented, non-sensitive requests.
- MNN inference reports unavailable until a real native runtime is present. Metadata or a mock bridge is not evidence of inference.
- Secrets and endpoint credentials must not be committed to the repository or surfaced in logs/UI snapshots.

## Release acceptance gates
1. Node contract tests for all three policy/adapter modules pass in CI.
2. Android build and emulator smoke test pass against the integrated branch.
3. Each runtime subsystem has an independent end-to-end acceptance test before its status can be upgraded to functional.
4. No subsystem is described as complete solely because its policy tests pass.

## Closeout decision
The policy/integration foundation can be reviewed as one coherent change set. The three runtime implementations remain explicitly pending; closing this ledger requires their respective end-to-end evidence, not more placeholder UI or renamed versions.
