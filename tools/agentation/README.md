# Agentation integration — MIDAD Control Room

## Audit result (2026-10-17)

- The deployed Control Room is a static HTML/CSS/vanilla-JavaScript application, not a React app.
- The entry point is `index.html`; the primary runtime is `midad-control-v2.js`; styling is in `midad-control-v2.css`.
- GitHub Pages deploys the repository root via `.github/workflows/pages.yml`.
- Agentation's official toolbar is a React component and requires React 18+. Therefore, it is not imported into the current vanilla-JS runtime, and no root package.json is added.
- The official documentation says Agentation is desktop-only / not optimized for mobile. The user's phone-only workflow is therefore not represented as a supported visual-annotation client.
- The MCP server is a local developer tool by default; repository configuration does not make GitHub Pages reach a developer's localhost or connect this server to the current ChatGPT conversation.

## Included in this change

`.codex/config.toml` registers the Agentation MCP server for Codex in a trusted local checkout. It runs:

```bash
npx -y agentation-mcp server
```

Node.js 20+ is required by current Agentation MCP documentation; Node.js 24 LTS is recommended.

## Cloud end-to-end verification

`tools/agentation/e2e` is an isolated React preview and smoke-test harness. It does not alter the production Control Room. The GitHub Actions workflow:

1. Builds the isolated React preview with the official Agentation component.
2. Starts the Agentation HTTP server on the CI runner's loopback interface only.
3. Uses a headless browser to select a test control and add a real toolbar annotation.
4. Reads the exact test text back through the Agentation MCP tool `agentation_get_all_pending`.

A passing CI run verifies the browser → HTTP store → MCP tool path in that temporary environment. It does **not** imply that a permanent server is deployed, that the current ChatGPT session is connected to MCP, or that mobile support is provided.

## Security and preservation

- Production Control Room files and the existing GitHub Pages workflow are unchanged.
- The test server binds only to `127.0.0.1` and uses ephemeral in-memory storage.
- No secrets are added to GitHub.
- Annotation text is untrusted input; CI tests use a fixed synthetic comment.
- Do not expose port 4747 publicly. A persistent cloud MCP endpoint would require a separate architecture, access-control review, and an explicit hosting/cost decision.

## Local developer verification

From a trusted checkout with Node.js installed, run:

```bash
npx -y agentation-mcp doctor
codex mcp list
```

For a complete local check, mount `Agentation` in a compatible React development app with `endpoint="http://localhost:4747"`, add a test note, and verify the exact annotation is returned by the MCP tools. The CI smoke test automates that round-trip in a temporary environment so the user does not need to run terminal commands on a phone.


## Mobile Factory integration

The Mobile Factory CI reuses this harness for the selected product manifest, serving its actual `web_entry` inside a same-origin iframe at a mobile-sized preview viewport. The annotation is created against a real product DOM element, then checked via `agentation_get_all_pending`. The Android APK build waits for this round-trip to pass.

This is development/CI instrumentation only. Agentation's toolbar is desktop-only, React-based, and DOM-scoped; it is not bundled into the Android application and does not annotate native Android Views/Compose/XML.
