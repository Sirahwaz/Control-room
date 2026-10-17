# Agentation UI feedback — Mobile Factory

This module connects visual feedback to the existing Mobile Factory without changing the shipped Android runtime.

## Contract

- Provider: `agentation` + `agentation-mcp`.
- Used in development/CI only through an isolated React harness.
- The harness loads the selected Factory product's real `web_entry` into a same-origin iframe at a phone-sized viewport.
- The test annotates a real product DOM element and requires the exact annotation to be returned by `agentation_get_all_pending`.
- Every Factory-backed Android APK workflow waits for that round-trip before producing the APK: the generic Mobile Factory, MIDAD Mobile, Omni Agent, Human Bridge, and SignalScan builds.
- No vendor API key is required for this local/CI setup.
- The Agentation UI, MCP process, and temporary annotation server are never bundled into the APK.

## Run order in CI

1. `preflight.mjs` validates the central Factory policy, registries, tool versions, workflow wiring, and release exclusion.
2. `prepare-preview.mjs <product-key>` copies the selected product WebView entry and declared assets to a temporary test preview.
3. `.github/workflows/agentation-e2e.yml` builds the React wrapper, starts Agentation on loopback with in-memory storage, and runs Playwright.
4. The test writes a synthetic note on the selected product UI and verifies receipt over the actual Agentation MCP tool.

## Requirements and limitations

- Node.js 20+; Node.js 24 LTS is recommended.
- React 18+ for the development harness.
- Agentation is DOM-based and desktop-oriented. This workflow can review Capacitor/WebView HTML/CSS/JavaScript and React DOM at a mobile viewport size.
- It cannot annotate native Android Views, Jetpack Compose, or XML views. Keep emulator screenshots, runtime smoke tests and accessibility checks as separate Android-native QA.
- The CI endpoint is `http://127.0.0.1:4747`, temporary and not publicly exposed.
- This does not connect the current ChatGPT conversation to MCP or create a persistent remote endpoint. Remote use would require authenticated HTTPS hosting, persistent storage and an explicit cost/hosting decision.
