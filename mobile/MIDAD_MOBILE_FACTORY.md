# MIDAD Mobile Factory

Mission: turn the MIDAD Mobile shell into a reusable production line for mobile applications.

## Product principle

Build once, specialize many times. The shell owns mobile UX primitives; each future app supplies its module registry, brand layer, backend routes, and product configuration.

## Current foundation

- Capacitor 8 Android shell
- Arabic RTL-first layout
- Safe-area and edge-to-edge aware UI
- Native back navigation
- Native haptics
- In-app browser
- Local-first Favorites / Recents / Notes
- Existing MIDAD stations bundled without rewriting their backend
- GitHub Actions reproducible APK build

## Next production layers

- MIDAD Identity / session broker
- Secure device storage
- Native notifications
- Deep links
- MIDAD Database synchronization
- AI/agent workspace
- Feature flags and remote configuration
- Release signing and Play AAB
- Automated smoke tests on emulator
- Product template generator for future client apps

## Factory boundary

Each generated app should keep secrets and privileged execution on the server. The APK is a client surface, not a vault.

## Current app

MIDAD Mobile — ai.midad.mobile — v0.2.0
