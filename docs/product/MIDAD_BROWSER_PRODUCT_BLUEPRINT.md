# MIDAD Browser — Product Blueprint
> Status: Approved product direction / implementation contract
> Baseline: MIDAD Browser Mesh v0.2.2
> Visual direction: Neural Dark, with Clean Glass light theme and Agent Command surfaces
> Platform priority: Android phone first; responsive tablet/desktop surfaces second

## 1. Product outcome

MIDAD Browser is a local-first Android browser and agent workspace. It must remain useful when disconnected from MIDAD cloud services, while optionally connecting the foreground browser session to MIDAD's authorized agent control plane.

The product is not a WebView wrapper and must not imply that a dashboard control can operate the native browser unless a verified native bridge exists.

## 2. Non-negotiable architecture principles

1. Audit and preserve the current native BrowserActivity, packaged Mesh home, product manifest, APK workflow and security gates.
2. Android WebView owns website navigation, cookies and authenticated website state. Website cookies and storage are never exported to Cloudflare, Supabase, Playwright or the Mesh dashboard.
3. The local browser shell, bookmarks, reading list, settings and saved offline artifacts work without a network connection.
4. Cloud control is optional. Cloudflare/Supabase outages must not prevent local browsing or local library access.
5. No credentials, admin keys, service-role keys, OTPs, passwords, website cookies or private keys in the web bundle, APK assets, logs or JavaScript bridge.
6. Agent actions are host-scoped, capability-scoped, visible, auditable and revocable. Page content is untrusted input.
7. CAPTCHA, MFA, KYC and identity verification remain human-controlled.
8. Proxy is a routing feature, not a claim of anonymity, VPN protection or per-tab isolation unless the underlying Android implementation proves it.
9. Offline support must distinguish saved/readable content from live web applications that require a server.
10. High-impact actions require explicit human approval; offline queues never replay external side effects.

## 3. Experience architecture

### Primary navigation
- Home / Command Center
- Browser Workspace
- Agent Studio
- Session Vault
- Proxy & Network
- Offline Library / Downloads
- Privacy & Security
- Appearance Studio
- Diagnostics

Navigation must be mobile-first, thumb reachable, keyboard accessible where applicable, RTL-first, and responsive to compact screens.

### Browser Workspace
- Native address/search bar, back, forward, reload, stop, share and tab switcher.
- Tab groups, pinning, restore-last-session and clear per-tab close semantics.
- Per-site zoom and typography preferences.
- Reading mode and page actions.
- Split view is an enhancement only when Android window size and WebView lifecycle support it.

### Appearance Studio
- Dark / light / system themes.
- Accent presets with accessible contrast.
- System font plus supported bundled/local font choices; do not promise a custom font family until packaged and licensed.
- Independent page zoom and text scaling where technically supported.
- Line height, reading width, reduced motion, high contrast and persistent per-site overrides.
- Settings persist locally and remain available offline.

### Offline Library
- Explicit save-for-offline action with storage estimate and completion state.
- Saved page metadata, reader snapshot and permitted resources.
- Download queue, pause/resume, retry and storage management.
- Offline availability indicator must reflect actual saved artifacts, not merely a cached URL.
- No claim that authenticated or dynamic web apps work offline unless they are specifically designed for it.

### Proxy & Network
- Provider abstraction for system proxy, HTTP(S) and SOCKS5 where supported.
- Profile metadata, enable/disable, diagnostics and connection test.
- Explicit direct/proxy routing state; fail closed when a configured mandatory proxy fails.
- No credentials in the UI bundle or APK; secrets must be supplied through an approved secure provider.
- Per-tab or per-profile isolation remains BLOCKED until proven by an Android networking implementation and tests.
- Display DNS/WebRTC/IP diagnostics only when a real test has run; do not label a proxy as a VPN.

### Agent Studio
- Agent Sidecar with task intent, target host, requested capabilities, current step, evidence and approval state.
- Human-readable activity log and immediate pause/stop.
- DOM inspection and bounded actions only through a reviewed, origin-checked native bridge.
- No arbitrary JavaScript bridge exposed to untrusted sites.
- User approval for form submission, publication, account changes and other consequential actions.
- CAPTCHA/MFA/KYC remain human checkpoints.
- Never transfer the Android WebView website session to a remote browser.

### Session Vault and device pairing
- Separate website session state (owned by Android WebView) from MIDAD device pairing credentials.
- Device keys generated and protected by Android Keystore.
- Owner-authenticated pairing, explicit approval, scoped device token, expiry, rotation and revocation.
- No global/admin credential in Android.
- Pairing broker contract is tracked separately from this UI blueprint.

### Privacy & Security
- Site permissions, third-party cookie policy, Safe Browsing status, clear browsing data and site data controls.
- Visible local/cloud boundary.
- Privacy Kill Switch stops agent dispatch and cloud participation without breaking local browsing.
- TLS errors fail closed; mixed content remains blocked by default.
- Export/delete controls must explain what is local and what is synchronized.

### Diagnostics
- WebView/provider version, app version, memory/renderer state where available, network state, offline storage, proxy test evidence, agent connection state and recent errors.
- Diagnostics must not expose secrets, cookies, page form values or private browsing content.

## 4. State model and truthfulness

Every integration uses one of: VERIFIED, INFERRED, PENDING, FAILED, BLOCKED.

A UI control must not appear operational unless it is backed by a real local implementation or a live verified API. A pending control must explain its blocker and must not silently simulate success.

## 5. Proposed module boundaries

- `BrowserShell`: navigation chrome, responsive layout, tabs and command palette.
- `BrowserEngine`: native WebView lifecycle, navigation, downloads and permissions.
- `SitePreferences`: typography, zoom, theme and per-origin settings.
- `OfflineLibrary`: saved page metadata, snapshots, downloads and storage policy.
- `NetworkRouting`: proxy provider abstraction and diagnostics.
- `AgentRuntime`: task envelopes, capabilities, policy checks and human gates.
- `DeviceIdentity`: Keystore keys, pairing, token wrapping and revocation.
- `PrivacyCenter`: permission and data controls.
- `Diagnostics`: redacted events, health checks and evidence.
- `CloudAdapter`: optional gateway integration with bounded requests and retries.

The web dashboard is a control surface, not a replacement for native browser capabilities. The native bridge exposes narrow typed operations and status only.

## 6. Delivery phases and acceptance gates

### P0 — Baseline and product contract
- Confirm current product manifest, native activity, offline home, CI and APK artifact.
- Add this blueprint and testable UI/security contracts.
- No production migration, deploy, secrets or credential handling.

### P1 — Browser shell UX
- Upgrade native browser chrome and navigation affordances.
- Add tab model and lifecycle-safe tab switching.
- Add address/search normalization, loading/stop state, error/retry and accessibility.
- Acceptance: no regression to current HTTP/HTTPS routing, TLS rejection, Safe Browsing, offline home or Android browser intent handling.

### P2 — Appearance and reading
- Theme, accent, text scale, page zoom, font/line-height, reading mode and reduced motion.
- Persist locally; validate on Arabic RTL, English LTR and Persian RTL.
- Acceptance: preferences survive app restart and never alter site origin security.

### P3 — Offline Library
- Save-for-offline, downloads, storage estimate and clear controls.
- Acceptance: open saved content with Wi-Fi and mobile data disabled; accurately mark partial/incomplete saves.

### P4 — Proxy & Network
- Implement provider abstraction and only those modes supported by the chosen Android network path.
- Acceptance: verified routing tests, DNS behavior, proxy failure handling and no silent direct fallback.

### P5 — Agent Studio
- Owner-bound device pairing, reviewed native bridge, scoped capabilities and human approval.
- Acceptance: same authenticated WebView remains local; remote agent cannot read/export cookies or credentials.

### P6 — Privacy, diagnostics and hardening
- Permission dashboard, privacy kill switch, redacted event history, performance and accessibility.
- Acceptance: no secret leakage, no misleading status, no background execution beyond Android policy.

## 7. Current baseline evidence (2026-11-17)

- Browser Mesh HTML/CSS/JS is packaged through `mobile/factory/products/midad-browser.json`.
- Existing home has four sections: Mesh, Proxy & Network, Vault, Appearance.
- Existing appearance settings persist locally; theme, accent, font scale and language are supported.
- Native BrowserActivity currently provides one WebView, address field, back/forward/reload and MIDAD home navigation; multi-tab management is not yet implemented in this activity.
- Safe Browsing is enabled where supported, TLS errors are rejected, mixed content is blocked, and local assets use AndroidX WebViewAssetLoader.
- APK workflow and emulator smoke passed for baseline commit `0dc1626d169a15cde4bcc771b04d8a21cb0ecd2a`.
- Artifact: `MIDAD-Browser-Mesh-v0.2.2-release`, 5,133,720 bytes, SHA-256 `18e2f2ac3961638720d5db1b9d8d05ba8c85e878de8a1e2a58c19c71978d660c`.
- This artifact is built from a temporary signing key; it is not a durable release-signing identity.

## 8. Explicit non-goals for the first releases

- No cookie/session export or remote reuse.
- No CAPTCHA/MFA bypass.
- No proxy anonymity guarantee or automatic anti-detection claims.
- No hidden always-on Android browser service.
- No offline replay of clicks, form submissions, purchases, payments, transfers, wallet signatures, publishing or deletion.
- No production deployment or migration as part of UI work.
