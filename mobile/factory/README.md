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
