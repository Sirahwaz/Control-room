# MIDAD Mobile v0.2

MIDAD Mobile is the Android product shell above the existing MIDAD ecosystem. It is also the seed of MIDAD Mobile Factory: a reusable base for building and shipping future MIDAD-powered mobile products.

## What v0.2 adds

- Local-first Favorites and Recent Stations.
- Local Notes memory with a clean migration path to MIDAD Database later.
- Native Android haptics through Capacitor.
- In-app browser handoff for Telegram nodes instead of replacing the main shell.
- Native Android back navigation through the Capacitor App plugin.
- Mobile-first edge-to-edge-safe UI.
- No bot tokens, Supabase service keys, or exchange credentials bundled in the APK.

## Architecture

- Native runtime: Capacitor 8.5.2
- Android API line: Android 16 / API 36 build target path
- Node: 24 in CI
- JDK: 21 in CI
- UI: local MIDAD Mobile Hub + bundled existing MIDAD web stations
- Backend: existing MIDAD services unchanged
- State: local-first now; future Database/Sync layer can be attached later
- Security boundary: secrets remain server-side

## Mobile Factory

The reusable Factory contract now lives in `mobile/factory/`.

- `products/*.json` = product manifests.
- `product.schema.json` = manifest contract.
- `render.mjs` = validates a product and renders its Capacitor application identity.
- `create-product.mjs` = creates a new product manifest without cloning the MIDAD backend.
- `.github/workflows/midad-mobile-android.yml` = product-driven Android build pipeline.

The current product is `midad-mobile` → `ai.midad.mobile` → v0.2.0.

## Local Factory commands

From `mobile/`:

```bash
npm install
npm run factory:render -- midad-mobile
npm run factory:create -- client-radar "Client Radar" ai.midad.client.radar 0.1.0
```

The generator creates configuration; it does not copy secrets, privileged credentials, or backend services.

## Build

```bash
npm install
npm run factory:render -- midad-mobile
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

GitHub Actions can build the selected Factory product through `workflow_dispatch` by supplying its product key. Pushes to `main` continue to build the default `midad-mobile` product.

## Release progression

`debug → internal → beta → production`

Production signing, Play AAB publishing, device smoke tests, notifications, identity/session broker, and database sync remain separate Factory layers.

## Safety

Trading remains paper-only/live-locked by the existing MIDAD backend policy. The mobile app is not a privileged execution surface. The Factory enforces `server_side_secrets_only=true` before an Android product can be built.


## MIDAD Human Bridge

The Factory now includes the `midad-human-bridge` product (`ai.midad.human.bridge`). It is the human-intervention surface for MIDAD agents: Human Tasks, managed browser sessions, CAPTCHA/KYC/2FA checkpoints, safe autofill, wallet/address discovery, connector requests, and local event history.

Human checkpoints stay human. The bridge does not bypass CAPTCHA, KYC, 2FA, access controls, or identity checks. It also never stores private keys, seed phrases, passwords, OTP values, exchange secrets, or service-role keys in the APK.

The bridge uses a provider-neutral contract. A managed WebView provider can be replaced without changing MIDAD Core's task model. See `mobile/factory/MIDAD_HUMAN_BRIDGE.md`.


## MIDAD Omni Agent — standalone product

The Factory now contains a separate product, midad-omni-agent (ai.midad.omni.agent), rather than extending the Human Bridge application.

Its intended role is the MIDAD mobile agent operating surface:
- Hybrid Agent Kernel with provider routing and resumable mission state.
- Multimodal reasoning and server-side Gemini gateway.
- Gemini Notebook handoff plus an optional Enterprise API path.
- Android phone file selection for profile/media inputs.
- Media Studio for AI image generation/editing.
- Automation Recipe generation with an explicit allowlist and human-gate steps.
- Profiles, platform contexts, connector fabric, wallet/address public lookup surfaces.
- Native-first browser/automation path with TinyFish retained as a fallback provider.
- Event bus, recovery loop, evidence trail, and visible trust boundary.

This product is intentionally independent from midad-human-bridge; both can coexist and use shared MIDAD backend contracts.
