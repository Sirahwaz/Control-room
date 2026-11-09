# MIDAD Android Participant v1 — Contract, Security and Acceptance Gate

**Status (2026-11-09): DESIGN / PENDING IMPLEMENTATION.** The existing native Browser UI and offline packaged-home work are preserved. This document defines P4; it does not claim that a Cloudflare-connected Android node is already implemented or paired.

## 1. Role in the distributed architecture

Android is a user-controlled edge participant and human-intervention surface. It is not the authoritative Cloudflare queue, not a substitute for the Playwright Linux worker, and not a hidden always-on browser server.

- GitHub remains source/control/CI.
- Cloudflare Continuity remains the shared task/lease/checkpoint authority.
- The native Android Browser is the offline-capable local UI and optional participant.
- A persistent Linux worker remains the best fit for unattended Chromium execution.
- The Android participant may assist with foreground browsing, approved local inspection, human checkpoints and bounded synchronization when the user explicitly starts it.

## 2. Lifecycle and OS compliance

The Android app must not promise uninterrupted background execution. Android 12+ restricts background foreground-service starts; Android 14+ requires an appropriate foreground-service type and its associated permission; Android 15+ adds runtime constraints to data-sync foreground services.

P4 therefore separates three operating modes:

1. **LOCAL / OFFLINE:** packaged browser shell and permitted local data; no Cloudflare command dispatch and no external side-effecting action.
2. **USER-STARTED PARTICIPANT:** user opens the Browser, sees the node identity/owner/scope, explicitly starts participation, and can pause/stop from the app and a visible notification. The app maintains only bounded foreground work; it does not claim 24/7 availability.
3. **DEFERRED SYNC:** WorkManager or a user-initiated data-transfer mechanism uploads/reconciles a bounded offline outbox when network conditions allow. It does not keep a WebView or authenticated website session running in the background.

Any foreground service must declare its exact Android service type and corresponding permissions. Do not use a generic `specialUse` or `dataSync` type simply to evade system restrictions. Do not start a foreground service from a background receiver to simulate an always-on node. Review API 34/35 behavior and the target SDK during the actual build.

Official platform references:
- Android 14 foreground-service type requirements: https://developer.android.com/about/versions/14/changes/fgs-types-required
- Background foreground-service start restrictions: https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- Foreground-service type guidance: https://developer.android.com/develop/background-work/services/fgs/service-types
- Android foreground-service changes: https://developer.android.com/develop/background-work/services/fgs/changes

## 3. Pairing and identity — no admin credential in APK

The current Cloudflare `/v1/nodes/enroll` route is administrator-only and requires `MIDAD_LEDGER_ADMIN_KEY`. That key must never be embedded in Android, JavaScript, local storage, an APK asset, or an Android WebView bridge.

P4 requires a separate owner-authenticated pairing broker:
- User first authenticates through an existing MIDAD owner session / trusted account bridge.
- A short-lived, single-use pairing challenge binds owner, device public key, device label, requested capabilities, expiry and idempotency key.
- Owner explicitly approves the new device and its capability scope.
- The trusted server-side broker calls the Continuity Ledger enrollment endpoint and returns a device-scoped, revocable credential exactly once.
- The Android app persists the credential only after successful pairing, and displays the device's active/paused/revoked state.
- The server stores only a credential digest; the Android app stores the token encrypted with a non-exportable Android Keystore key.
- Re-pairing, reset and revocation invalidate the prior device token. A stolen APK or exported preference file must not contain the admin key or a plaintext node token.

Until that broker exists and is tested, Android node enrollment is **BLOCKED**. Do not work around this by giving the app the admin key or a long-lived global ingest key.

## 4. Android local credential store

The P4 implementation must use Android Keystore for a per-installation AES-GCM wrapping/encryption key. The local database/outbox contains only bounded task metadata, encrypted node credential, encrypted device-private settings and replay bookkeeping.

- No admin key, service-role key, Cloudflare account key, platform password, OTP, seed phrase or private key is stored in the participant database.
- No token, cookie, password or decrypted session state is sent through `JavascriptInterface` or injected into the Browser DOM.
- The WebView receives only a narrow, origin-checked, non-secret capability/status projection.
- Local reset/revoke destroys the wrapping key and clears the associated encrypted records.
- Cloud backup must exclude device tokens and participant session material.

## 5. Offline outbox and reconciliation

Offline tasks must not execute external actions while disconnected. The outbox is a durable staging/reconciliation queue, not a second authority.

Each record is scoped to owner + device + task + idempotency key and includes:
- task ID and source ledger reference;
- bounded non-secret task envelope;
- task expiry / `not_after`;
- locally observed state and monotonic sequence;
- content/evidence hashes only (not full page body or credentials);
- last acknowledged ledger checkpoint;
- replay count and terminal/reconciliation state.

On reconnect, the device submits the signed/owner-bound checkpoint and idempotency key. Cloudflare revalidates device enrollment, owner, capability, expiry, task state and lease. Duplicate replay returns the existing result. Unknown or expired tasks are quarantined for human reconciliation; they are not silently recreated.

P4 must never replay `click`, `fill`, `submit`, publication, payment, transfer, withdrawal, signing or delete operations from an offline queue. Those require a separately verified approval lifecycle and remain blocked in the initial participant version.

## 6. Browser session and human gate boundary

- The foreground Android browser may navigate public HTTP/HTTPS pages under its own local policy.
- MIDAD agent tasks are displayed with source, owner, exact host, requested action and expiry before the user approves them.
- CAPTCHAs, MFA/OTP, KYC, identity checks and anti-bot challenges remain human-only.
- A human gate is a wait/resume checkpoint; it is never a bypass instruction.
- Browser page content is untrusted data and must not alter task policy, owner, lease or tool permissions.
- Initial P4 does not import Playwright/Linux cookies or transfer website sessions between devices.
- If persistent WebView session storage is later added, it requires an explicit account/host binding, encrypted storage, verified restore selector, logout/stop deletion tests and backup exclusion.

## 7. User-visible controls and state model

Required UI states:
- `UNPAIRED`
- `PAIRING_PENDING`
- `PAIRED_IDLE`
- `PARTICIPANT_ACTIVE`
- `PAUSED`
- `OFFLINE_OUTBOX_PENDING`
- `SYNCING`
- `HUMAN_GATE`
- `REVOKED`
- `ERROR`

Required controls:
- Start / Pause / Stop participant.
- Revoke device pairing.
- Show owner, device ID, capability scope, exact permitted domains and last heartbeat.
- Show pending offline records and last reconciliation result.
- Per-task approve / reject / defer with expiry; no global auto-approval toggle.
- Clear local participant data, with an explicit confirmation and result.

The notification must identify that MIDAD participation is active and provide a Stop action. Closing the Browser or stopping the participant must not silently keep a hidden session running.

## 8. Required implementation components

- Owner-authenticated pairing broker (server side; no admin key in app).
- Android Keystore credential wrapper.
- Encrypted local outbox store with unique idempotency constraints.
- Native Cloudflare Continuity API client with certificate-validated HTTPS, fixed routes and bounded response sizes.
- Foreground/visible user-started participant controller; no indefinite background browser loop.
- Deferred sync/reconciliation worker with OS constraints.
- Origin-checked native UI capability bridge that exposes status only.
- Device revocation and local key-destruction path.
- Android-native instrumentation and UI/accessibility tests.

## 9. Acceptance gates before P4 can be called VERIFIED

- Pairing succeeds only for the authenticated owner and an explicit device approval; admin key is absent from APK/source/runtime.
- Node token is encrypted by Android Keystore and not present in logs, WebView, backup or exported app preferences.
- Android participant starts only from a visible user action and shows a persistent notification while active.
- Pause/Stop/revoke prevent further claims; revocation closes current leases or marks uncertain work for reconciliation.
- Offline outbox survives process restart, uses idempotency keys, expires stale tasks and converges to the ledger baseline after replay.
- Network loss, duplicate replay, stale lease, owner mismatch, device token rotation and OS process death all have deterministic tests.
- A task cannot be marked complete locally if the Cloudflare ledger has not acknowledged completion.
- No password/OTP/CAPTCHA bypass, payment, transfer, withdrawal, wallet signature, delete or publication action is executable by the first P4 release.
- Native APK build, emulator install, foreground-service permission checks, WebView offline smoke, native security tests and offline/reconnect instrumentation all pass.

## 10. Current non-claims

The Native Browser APK / offline shell and the Cloudflare P3 Worker are separate deliverables. P4 is not implemented by the current APK. The owner-authenticated pairing broker, Android Keystore store, offline outbox/replay, Android native Cloudflare client, participant UI and device-revocation integration remain **PENDING**.
