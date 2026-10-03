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
- Node: 24 in CI (Capacitor 8 supports Node 22+)
- JDK: 21 in CI
- UI: local MIDAD Mobile Hub + bundled existing MIDAD web stations
- Backend: existing MIDAD services unchanged
- State: local-first now; future Database/Sync layer can be attached later
- Security boundary: secrets remain server-side

## Mobile Factory direction

This folder is intentionally kept as a reusable application shell rather than a one-off wrapper. Future products can reuse the Mobile Hub navigation, MIDAD identity/session boundary, native notification layer, local-first data layer, secure storage boundary, AI/agent surface, and build/release pipeline.

## Build

npm install
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug

GitHub Actions produces an installable debug APK artifact for direct Android sideload testing.

## Safety

Trading remains paper-only/live-locked by the existing MIDAD backend policy. The mobile app is not a privileged execution surface.
