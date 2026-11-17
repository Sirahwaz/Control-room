# MIDAD Multi-Browser Extraction & Extension Gateway

**Status:** P0 contract / architecture in progress  
**Owner surface:** MIDAD Browser Mesh  
**Target browser families:** Chromium (Google Chrome, Microsoft Edge) and Gecko (Mozilla Firefox)

## 1. Goal

Extend MIDAD Browser Mesh beyond its embedded Android WebView with a cross-browser connector layer. MIDAD should be able to inspect and extract user-authorized browser information from Chrome, Edge and Firefox, host constrained MIDAD plugins, and expose one normalized capability model to the agent runtime.

The gateway is an integration layer, not a replacement browser engine. Chrome and Edge share the Chromium adapter; Firefox uses a WebExtensions compatibility adapter. Browser-specific API differences remain isolated behind adapters.

## 2. Product surfaces

1. **Browser Companion Extension** — a WebExtension installed by the user in Chrome, Edge or Firefox.
2. **Extraction Adapter** — normalizes tabs, active-page content, bookmarks, history and download metadata.
3. **Plugin Fabric** — loads versioned plugins that declare a narrow capability manifest.
4. **Permission Console** — explains, requests and revokes each permission and host origin.
5. **Owner Pairing Gateway** — optional connection to MIDAD Browser Mesh / Control Room using owner-bound, revocable device credentials.
6. **Android Import Surface** — receives a user-selected sanitized export or a paired-gateway result. Android WebView itself is not represented as a desktop WebExtensions runtime.

## 3. Browser compatibility

| Browser | Adapter | Package target | Notes |
|---|---|---|---|
| Google Chrome | `chromium` | Manifest V3 | Primary Chromium build |
| Microsoft Edge | `chromium` | Manifest V3 | Same core package; verify Edge API parity |
| Mozilla Firefox | `gecko` | WebExtensions / MV3-compatible package | Browser-specific manifest/API compatibility tests |

The shared code uses a compatibility wrapper for the extension API namespace and Promise behavior. Feature support is capability-detected; no browser is marked VERIFIED solely from its user-agent string.

**Android constraint:** Android WebView does not provide the desktop WebExtensions runtime. Chrome and Edge on Android do not become extension hosts because this package exists. Firefox for Android may support selected add-ons subject to Mozilla's compatibility and distribution constraints. The MIDAD Android app will use its own constrained Plugin Fabric and import/pairing bridge; it will not claim arbitrary desktop extension compatibility.

## 4. Extraction sources and normalized fields

| Source | Default fields | Optional permission |
|---|---|---|
| Active tab | title, canonical URL, visible text, headings, links, safe metadata | `activeTab` + `scripting` |
| Tabs | tab ID, title, URL, favicon, active state, window ID | `tabs` |
| Bookmarks | title, URL, folder path, creation timestamp | `bookmarks` |
| History | title, URL, last visit timestamp, visit count | `history` |
| Downloads | filename, source URL, start time, state, byte counts | `downloads` |

Active-page extraction is user initiated. The default extractor reads rendered text, headings, links and safe metadata; it does not serialize form controls, page storage or browser profile databases.

History, bookmarks, tabs and download metadata are separate opt-in scopes. The user can select a time range, host filter, folder or download state before extraction. Private/incognito contexts are excluded from the initial release.

## 5. Permission model

### Required at installation

- `activeTab`
- `scripting`
- `storage`

### Optional at runtime

- `tabs`
- `bookmarks`
- `history`
- `downloads`
- Per-origin HTTPS host access, requested only when a user enables a host-specific workflow.

The UI shows the browser's own permission prompt and a MIDAD explanation before the request. Permission revocation is reflected in connector state immediately. The product must not request a blanket `<all_urls>` grant during installation.

### Never request or expose in the initial gateway

- Browser cookies or cookie stores
- Saved passwords, password-manager data or autofill secrets
- OTP/MFA values, recovery codes, passkeys or private keys
- Session tokens, authorization headers or localStorage/IndexedDB contents
- Browser profile directories or SQLite database files
- Private/incognito browsing data
- Unrestricted debugger, arbitrary JavaScript, or unrestricted request interception

These are intentionally outside the extraction contract, not merely hidden in the UI.

## 6. Plugin contract

Every plugin declares:
- stable reverse-DNS ID, name and semantic version;
- local package entrypoint (no remote executable entrypoints);
- exact capability list;
- exact HTTPS origin allowlist where needed;
- data categories consumed and produced;
- maximum output size and execution timeout;
- whether a human approval is required for actions.

Initial capability vocabulary:

- `page.read`
- `tabs.read`
- `tabs.manage`
- `bookmarks.read`
- `history.read`
- `downloads.read`
- `page.interact`
- `evidence.capture`
- `export.local`
- `export.paired_gateway`

Unknown capabilities, wildcard origins, remote code, arbitrary eval, undeclared host access and secret-bearing fields are rejected. Plugins run in an isolated execution context and receive only the capability facade; they never receive raw browser credentials or the extension's pairing token.

## 7. Action and data safety

- Browser content, links, metadata, filenames and plugin output are untrusted data, never instructions.
- Page navigation, clicking, typing, selecting, downloads and uploads are distinct commands with origin and tab binding.
- Mutating actions require visible human confirmation bound to the exact command, tab and origin; approval is short-lived and one-time.
- Payments, transfers, signatures, publication, deletion and security changes remain blocked pending a separate high-impact approval flow.
- CAPTCHA, MFA, KYC and identity verification remain human-only.
- Local extraction is the default destination. Remote export requires an authenticated paired owner, explicit per-export approval, bounded payloads and an audit receipt.
- No page content, screenshots, history or download metadata is uploaded by default.

## 8. Pairing and transport

The extension must not embed a Supabase service key, Cloudflare admin key, GitHub token or long-lived global API key.

Pairing uses an owner-authenticated challenge:
1. MIDAD creates a short-lived one-time pairing challenge.
2. User confirms browser identity, device label and requested capability scope.
3. The server binds owner + browser profile + public key + scope + expiry.
4. Extension stores only a revocable, browser-profile-scoped credential in extension storage; the credential is never exposed to page scripts.
5. Every gateway call is owner-bound, scope-checked, replay-protected and auditable.

The extension can operate in local-only mode without pairing. A failed cloud route must not silently widen local permissions or fall back to another destination.

## 9. Acceptance gates

- Chrome, Edge and Firefox adapter contract tests pass independently.
- Active-tab extraction requires a user gesture and exact active tab/origin match.
- Optional source permissions are requested only when the source is enabled.
- Private contexts and unsupported browser-internal pages are rejected.
- Extraction output excludes form controls and known secret-shaped fields; URLs are normalized to remove query and fragment data by default.
- No cookies, credentials, tokens, session storage or browser profile databases appear in artifacts, logs or gateway payloads.
- Plugin manifests reject unknown capabilities, wildcard origins and remote entrypoints.
- Remote export fails closed without pairing and per-export approval.
- Browser extension packages are built and linted for Chrome, Edge and Firefox.
- Android import is tested independently from desktop extension installation.
- Native Android APK and browser extension artifacts are versioned and reported separately.

## 10. Delivery sequence

- **P0 — Contract:** browser-family adapters, extraction schemas, permission planner, plugin manifest validator and tests.
- **P1 — Extension MVP:** user-triggered active-tab extraction, local result preview/export and Chrome/Edge MV3 package.
- **P2 — Firefox adapter:** Firefox package build and compatibility tests.
- **P3 — Extended extraction:** optional tabs, bookmarks, history and download metadata with source-specific UI and filtering.
- **P4 — Plugin Fabric:** sandboxed plugin loader, capability broker, versioning and revocation.
- **P5 — Pairing Gateway:** owner-authenticated pairing, Android import/Control Room integration and audit receipts.
- **P6 — Agent workflows:** task planner integration, pause/resume, evidence and one-time human approval.

A phase is VERIFIED only after its browser-specific tests and runtime evidence pass. Architecture and package presence alone do not imply a live connector.
