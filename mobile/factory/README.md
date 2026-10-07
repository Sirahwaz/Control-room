# MIDAD Mobile Factory

The Factory is the reusable product line around the existing MIDAD Mobile shell.

## Contract

Each app is represented by one manifest under `mobile/factory/products/`.

The manifest controls:
- Android package/application id
- product display name
- semantic version
- artifact name
- release channel
- security feature flags
- bundled MIDAD surfaces

The shell remains shared. A product config specializes the shell; it does not duplicate MIDAD backend services. Mission Capsules add an adaptive capability-graph layer that composes a task-specific surface.

## Current product

`midad-mobile` → `ai.midad.mobile` → v0.2.0

## Create a future product

```bash
node mobile/factory/create-product.mjs <product-key> <display-name> <app-id> [version]
node mobile/factory/render.mjs <product-key>
```

Example:

```bash
node mobile/factory/create-product.mjs client-radar "Client Radar" ai.midad.client.radar 0.1.0
```

## Neural Morphogenesis

**MIDAD Neural Morphogenesis** is the adaptive intelligence surface of the Factory.

A user describes an objective and the Mobile Hub creates a temporary **Mission Capsule** that:
- detects a primary domain plus adjacent capabilities;
- ranks relevant MIDAD stations;
- emits explainable next actions;
- exposes a risk state before execution;
- stores the latest capsule locally;
- keeps an extension point for a server-side Neural Planner.

The local planner is deterministic and fast. The hybrid planner can later combine private models, evidence retrieval, memory, and deeper agentic planning without putting secrets into the APK.

## Security boundary

APK/app bundles are treated as public client surfaces. Secrets, privileged credentials, exchange keys, database service keys, and server-only execution remain outside the app.

## Release progression

debug → internal → beta → production

Production signing, Play AAB publishing, device smoke tests, notifications, identity/session broker, and database sync are separate factory layers. They must be added without weakening the current server-side security boundary.


## Factory Engineering Loop

REQUEST → REQUIREMENTS → MANIFEST → UI/CONTENT → AUDIT → BUILD → TEST → VERIFY → RELEASE → LEARN

The Factory preserves existing working components and upgrades incrementally. New products are request-driven rather than copied from a fixed UI.

## New Factory Contracts

- `factory.config.json`: global Factory policy and pipeline.
- `factory.config.schema.json`: Factory configuration contract.
- `product-request.schema.json`: normalized client/product request contract.
- `compile-request.mjs`: deterministic request → product manifest compiler.
- `quality-gate.mjs`: fail-closed prebuild audit.
- `render.mjs`: manifest → runtime product/factory configuration.

## Adaptive Product Generation

A request may control app identity, target markets, languages, UI surfaces, feature flags, backend requirements, monetization surfaces, acceptance tests, and delivery constraints.

The Factory always preserves non-negotiable security controls, including server-side secrets only, no automated credential entry, no CAPTCHA/KYC/2FA bypass, human gates for sensitive external actions, and no default live financial execution.

## Learning / Neural Evolution

Factory decisions are stored in the MIDAD Supabase control plane and feed `midad_neural_evolution`.

Learning is scoped to global, product, and tenant contexts and is evidence-weighted. Future decision priors can improve provider selection, UI patterns, feature priority, model routing, retry strategy, test depth, release channel, and monetization surfaces.

The learning layer must never learn from passwords, OTPs, private keys, raw credentials, or identity documents.

## Quality

Default incident policy: maximum 3 repair attempts per incident.

Prebuild quality checks include manifest validation, security boundary validation, JavaScript syntax checks, secret-pattern scans, and required artifact checks. Build and runtime smoke tests are added when the environment supports them.

## Data Plane

The existing Supabase project `midad-ai` is the primary Factory database/control plane. No second database is required at this stage.

Recommended storage split:
- Supabase Postgres: projects, runs, decisions, learning, metadata.
- Supabase Storage: durable build/report artifacts when needed.
- GitHub Actions artifacts: short-lived CI outputs.
- Dropbox: human-facing Specs, Client Requests, Products, Builds, Artifacts, and Learning reports.
- Device-local storage: offline-first operator/cache state.

The Factory uses tenant isolation keys such as `tenant_key`, `owner_user_id`, and `product_key`.

## Dropbox Factory Workspace

`/MIDAD/Mobile Factory/`

Subfolders:
- `Specs/`
- `Client Requests/`
- `Products/`
- `Builds/`
- `Artifacts/`
- `Learning/`
- `Templates/`

## Provider / Account Strategy

Do not create provider dependencies merely because an integration is available. Select providers from requirements first.

Current baseline:
- GitHub: source + CI — already connected.
- Supabase `midad-ai`: database/control plane — already connected and healthy.
- Dropbox: human-facing file workspace — already connected.
- Gemini/Google AI: specialist and Live Translation — required for those capabilities.

Prepare later only when needed:
- Google Play Console for production Android distribution.
- Optional Sentry for production crash/error observability.
- Optional Cloudflare R2 if artifact storage volume justifies a separate object-storage layer.
