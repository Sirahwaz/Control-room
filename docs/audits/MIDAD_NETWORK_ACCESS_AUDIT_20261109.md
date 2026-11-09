# MIDAD Browser / Network Access Audit — 2026-11-09

**Scope:** Sirahwaz/Control-room and Sirahwaz/midad-intelligence  
**Method:** Read-only repository and workflow inspection before additive changes  
**Disposition:** Preserve existing Browser, Gateway, Worker, Human Bridge and research scanner. No production deployment or merge.

## Executive result

The project already has a usable Browser automation foundation, but not yet a complete consumer browser, production Proxy control plane or encrypted Vault service.

The correct implementation is additive:
- Control Room owns network policy, Proxy/Vault administration and audit.
- Native Browser owns everyday browsing UX and local data.
- Browser Agent Gateway remains the job/session boundary.
- Existing Playwright Operator Worker is extended rather than replaced.
- MIDAD Intelligence consumes sanitized health projections and stays read-only.

## Control-room evidence

| Existing asset | Verified role | Gap / constraint |
|---|---|---|
| midad-browser.html / JS / CSS | Remote browser control surface and session command UI | Not a full tabbed browser workspace |
| BrowserActivity.java | Android WebView browser shell | One WebView; no verified per-tab proxy isolation |
| midad-browser-bridge.js | Constrained browser bridge | Must remain narrow and credential-free |
| midad_browser_agent_gateway | Authenticated browser job/session gateway | Owner resolution currently falls back to profiles query with limit(2), a single-profile assumption |
| tools/midad-browser-runtime/account_registry.py | Non-secret account metadata registry; restrictive file permissions | Local private JSON registry, not a multi-tenant control plane |
| tools/midad-browser-runtime/secret_provider.py | Exact account + host environment secret resolution | Environment adapter only; no encrypted Vault or lease lifecycle |
| tools/midad-browser-runtime/operator_worker.py | Persistent operator command worker | One consumer per owner queue; in-process duplicate suppression, no atomic multi-worker claim |
| tools/midad-browser-runtime/persistent_session.py | In-memory Playwright account sessions and host-scoped request policy | No proxy route injection before this branch; sessions need explicit close/recreate to change route |
| mobile/factory/x/*registry.json | Existing provider, agent and automation registries | No canonical Network Access / Vault control plane |
| service-worker.js | Control Room PWA offline core cache | New panel assets must be versioned and cached explicitly |

## MIDAD Intelligence evidence

- Repository is a Python research/scanning workspace with scheduled automation and unit tests.
- No existing browser front-end or credential-management surface was found.
- It is not appropriate to add a second production Proxy controller there.
- A local HTML diagnostics report is added as a read-only projection of sanitized route health.

## Security and reliability findings

1. Secret metadata and secret values must remain separate. Account registry entries may contain secret references, never values.
2. Existing EnvironmentSecretProvider is not an encrypted Vault. The first adapter maps opaque references to host-managed environment aliases only.
3. A Proxy must be bound to an explicit runtime scope and exact hostname. Browser, Automation and Infrastructure cannot inherit each other's routes.
4. Route mismatch and failure must block by default. Direct fallback must never happen silently.
5. The Playwright worker must not scale horizontally until queue claiming is atomic and owner identity is no longer inferred from a single profile.
6. The Android WebView proxy API does not establish per-tab isolation; the product must not promise that capability.
7. WireGuard and managed tunnels need a real tunnel adapter; they are not emulated as HTTP proxies.
8. Human verification and high-impact actions retain human approval gates.

## Additive implementation in this work

- Versioned JSON Schema: contracts/midad-network-access.schema.json
- Worker route policy: tools/midad-browser-runtime/proxy_policy.py
- Playwright BrowserContext proxy injection: tools/midad-browser-runtime/persistent_session.py
- Worker opt-in binding: tools/midad-browser-runtime/operator_worker.py
- Control Room panel shell: midad-network-access.html, CSS and JS; routed by index.html?view=network-access and added to the Service Worker cache.
- MIDAD Intelligence read-only report generator: automation/network_access_report.py in that repository.
- No production proxy configuration is installed. No real secret is added or migrated.

## Verification state

- Contract tests passed in the last observed contract workflow.
- MIDAD Intelligence full suite passed: 30 tests; sanitized HTML report generation and artifact upload passed.
- MIDAD Isolated Playwright Runtime Tests: PASS (136 tests across the complete worker suite, including 19 focused proxy policy tests).
- MIDAD Network Access Contract + Control Room UI: PASS (10/10 tests, including RTL navigation, no secret-entry surface, route and offline-cache checks).
- Architecture Governance still reports the repository-level ROOT_LICENSE_MISSING finding; the governance report showed no validation errors for the newly added contract paths.

## Deferred, intentionally

- Central encrypted Vault service, short-lived leases, rotation and revocation API.
- Atomic job lease/claim and multi-owner/multi-worker support.
- Control API for profile/rule mutations and live Control Room panel data.
- Proxy health monitoring, bounded failover and cost telemetry.
- Android WebView proxy integration and full browser tabs/history/bookmarks/downloads.
- VPS deployment or optional cloud relay, pending a separate resource/security/cost preflight.

No merge has been performed.
