# MIDAD Network Access & Vault Architecture — v1

**Status:** Proposed implementation contract; not a claim that proxy routing or the Vault is deployed.

## 1. Ownership

- **Control Room** is the canonical control plane: profiles, routing policy, approvals, secret references, audit events and operator UI.
- **MIDAD Browser** is a client and execution surface. Android WebView must never receive privileged proxy credentials or Vault values.
- **Browser Agent Gateway** remains the authenticated job and evidence boundary. Extend it additively; do not create a parallel browser queue.
- **Playwright Operator Worker** is the first server-side automation adapter. Reuse its account registry, host policy, in-memory sessions and environment secret adapter.
- **MIDAD Intelligence** remains a read-only research/scanning repository. It may consume a redacted network-health snapshot and render local diagnostics; it must not become a credential store, production control plane or automation executor.

## 2. Runtime planes

| Plane | Responsibility | Initial placement |
|---|---|---|
| Device plane | Full browser UX, local bookmarks/history, local encrypted preferences | Android device |
| Control plane | Identity, policy, routing decisions, profiles, audit | Existing Control Room / current backend, subject to storage readiness |
| Automation plane | Isolated Playwright contexts and approved platform tasks | Existing worker; VPS only when needed |
| Secret plane | Secret resolution, short-lived leases, rotation and revocation | Host secret manager / OS keystore adapter |
| Optional cloud plane | Stateless relay, health aggregation, encrypted backup metadata | Optional; never required for local browsing |

## 3. Contract

The machine-readable contract is contracts/midad-network-access.schema.json (midad.network-access/v1).

- Proxy modes: DIRECT, HTTP, HTTPS, SOCKS5, WIREGUARD, MANAGED_GATEWAY.
- Runtime scopes: BROWSER, AUTOMATION, INFRASTRUCTURE.
- Routing matches exact hostnames. Wildcard host rules are not accepted in v1.
- BLOCK is the default for no-match and route failure.
- Direct fallback is disabled by default. It may only be enabled by a specific reviewed rule, never as an implicit retry.
- A profile stores auth_secret_ref, never a username/password or proxy URL containing user-info.
- A credential binding contains only vault://... reference metadata. It never contains the secret value.

## 4. Proxy adapter boundary

A provider adapter must expose:
- validate(profile) — validate scheme, endpoint, host and capability compatibility.
- health(profile) — return bounded latency, reachability and last-checked metadata.
- open(profile, scope) — return a runtime-specific connection handle, not a client-visible credential.
- close(handle) — release resources and clear transient credential material.

Routing is policy-first:
1. Resolve the caller identity and scope.
2. Match exact hostname and the requested runtime class.
3. Resolve an enabled route and verify provider health.
4. Acquire a short-lived secret lease only if the route needs authentication.
5. Attach the route to a dedicated browser/worker context.
6. Record the selected route ID and outcome, never the secret or authorization header.
7. On failure, block or use the next explicitly configured proxy. Never silently switch to direct.

The Android WebView proxy API is application-wide rather than a reliable per-tab isolation primitive. Therefore v1 must not promise per-tab native WebView routing. Automation sessions can be isolated by worker process/context where the selected browser engine supports it; this must be proven by integration tests before being exposed as a guarantee.

## 5. Vault boundary

The Vault is a secret broker, not a plaintext settings page.

- Registry metadata (platform, account alias, host, owner, purpose, scope) is separate from secret material.
- Secret material stays in an OS keystore or server-side secret manager. A database may hold encrypted envelopes and metadata only if its encryption key is stored outside that database.
- Browser clients receive opaque references and status only, never secret values.
- Workers request a short-lived, purpose-bound lease; resolution occurs in memory immediately before use.
- Leases are scoped to account + exact host + purpose + runtime and are revocable.
- Audit records include actor, purpose, reference ID, target host, worker identity, time and result; they exclude values.
- Rotation/revocation invalidates future leases and closes affected sessions where possible.
- No credentials, cookies, OTPs, recovery material, wallet keys or service-role keys enter Git, APKs, page JavaScript, chat messages, job hints or evidence previews.

The existing EnvironmentSecretProvider is a useful v1 backend adapter. It is not a full Vault. Keep it working while adding a provider interface for Android Keystore, host environment/secret manager and optional cloud KMS-backed storage.

## 6. Browser automation lifecycle

Reuse the existing midad_browser_agent_gateway actions and queue. Extend the typed command protocol with additive fields:
- network_scope
- route_profile_id
- credential_binding_id
- policy_version
- approval_id (only when a policy requires approval)

Never put secret values in operator_hint, operator_command, browser DOM previews or job evidence.

Before scaling workers, fix the current single-owner assumption in the user bridge and introduce an atomic job lease/claim. The operator worker currently documents one consumer per owner queue and in-process duplicate suppression; multiple replicas are not safe yet.

## 7. UI surfaces

### Control Room — full administration
- Overview and health
- Proxy profiles and provider adapters
- Routing rules by Browser / Automation / Infrastructure
- Platform and account registry
- Vault secret references, lease status, rotation and revocation
- Worker/session binding
- Diagnostics, audit ledger and emergency kill switch

### MIDAD Intelligence — read-only diagnostics
- Consumes only a redacted status snapshot or read-only health API.
- Shows route health, latency, last check, scope and policy decision.
- No secret entry, no account login, no proxy credential management and no privileged mutation.
- Generates local reports without changing the production control plane.

Both surfaces consume the same versioned contract. Control Room owns mutations.

## 8. Security and verification gates

- Exact hostname allowlists; reject URL credentials, private/loopback/link-local destinations and unsafe DNS answers.
- Revalidate redirects and all subresource requests.
- TLS verification remains enabled; no ignore-HTTPS-errors mode.
- No transparent proxy failover to Direct.
- Separate browser, automation and infrastructure scopes.
- Rate limits and bounded health checks; never probe internal/private networks.
- Session isolation and owner binding are tested.
- Human checkpoints remain for MFA/CAPTCHA and consequential external actions.
- Delete, payment, withdrawal, publication and account-security changes remain approval-gated.
- Every mutation is auditable and idempotent where possible.

## 9. Delivery sequence

1. Contract + tests (this change).
2. Proxy policy resolver and provider interface with fake adapters.
3. Control Room Proxy/Vault panel and read-only API.
4. Worker-side secret broker adapter and atomic job claim.
5. Playwright proxy integration with isolation tests.
6. Browser UX: tabs, bookmarks, history, downloads, profiles, themes and typography.
7. Android WebView proxy capability test; choose application-wide route or isolated engine based on evidence.
8. MIDAD Intelligence read-only diagnostic report/panel.
9. Optional VPS deployment after resource, security and cost preflight.

No Supabase schema migration, VPS deployment, external proxy purchase or production secret migration is part of this contract-only stage.
