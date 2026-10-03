# MIDAD Mobile

MIDAD Mobile is the Android application shell above the existing MIDAD web surfaces.

## Architecture

- **Native runtime:** Capacitor 8
- **Android build line:** generated Capacitor Android project with current Android Gradle tooling
- **UI:** mobile-first MIDAD hub, with existing Control Room / ViaBTC / iAiTrader assets bundled under `site/`
- **Backend:** unchanged; the APK talks to the existing MIDAD Supabase/Telegram surfaces
- **Secrets:** no bot tokens or Supabase service credentials are bundled into the APK

## Build

From this directory:

```bash
npm install
npx cap add android
```

The repository's GitHub Actions workflow performs the reproducible Android debug build and publishes the APK as an artifact.

## Safety

The mobile shell is not a privileged execution surface. Trading remains paper-only/live-locked by the existing backend policy, and secret material stays server-side.
