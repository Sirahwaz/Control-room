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

