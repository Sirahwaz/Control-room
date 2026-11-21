# MIDAD Browser — Integration Closeout Ledger

This is the consolidated acceptance ledger for the three optional subsystems. It separates policy foundations from deployable runtime capabilities.

## Preserved baseline
Native Android WebView remains the default engine. Existing tabs, history/bookmarks vault, appearance/font settings, downloads, default-browser intents and origin-bound Agent Bridge remain preserved.

## Workstream status

| Workstream | Implemented and locally tested | Runtime acceptance still pending |
|---|---|---|
| Network privacy | Profile validation; fail-closed policy; opaque native capability gate; session freshness; tunnel interface/routes/DNS attestation checks; credential redaction | Android VpnService, real packet transport, authenticated endpoint, OS-enforced kill switch, DNS/IPv6 leak tests, signed APK/device acceptance |
| MNN-Pocket | Model registry metadata, capability gate, bounded prompts/tokens, fail-closed missing-runtime behavior | Native MNN Android runtime, verified model assets/checksums, storage/download manager, JNI/native bridge, actual inference and device benchmark |
| Cloudflare Kitesurf | Experimental renderer policy, native default/fallback, per-request remote consent, private-content local-only rules, HTTPS endpoint validation | Worker deployment, authenticated CDP/renderer transport, response validation, quota/cost controls, remote rendering E2E |

## Security and cost invariants
- No free VPN endpoint is fabricated or bundled. A real endpoint and supported transport are prerequisites.
- A proxy is not a VPN. JavaScript policy cannot enforce packet routing or an OS-level kill switch.
- Kitesurf remains disabled by default. Remote execution requires explicit per-request consent and non-sensitive classification.
- The native attestation capability must remain private to the trusted native integration; never expose it to WebView/page scripts.
- MNN inference remains unavailable until the real native runtime is present. Model metadata or a mock bridge is not inference evidence.
- Secrets and endpoint credentials must not be committed or surfaced in logs/status snapshots.

## Verification
- 15 Node contract tests passed locally under Node 22 for the three policy/adapter suites.
- Android CI, release APK build, emulator smoke, and device-level E2E are still pending; no CI success is claimed.
- Each runtime subsystem needs its own end-to-end acceptance test before being labelled functional.

## Closeout decision
The three policy foundations are consolidated for one review. This does not close the runtime feature work: it closes the fragmented PR path and leaves explicit, measurable runtime acceptance gates rather than placeholder UI or version-only changes.
