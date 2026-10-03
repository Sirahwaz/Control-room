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

The shell remains shared. A product config specializes the shell; it does not duplicate MIDAD backend services.

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

## Security boundary

APK/app bundles are treated as public client surfaces. Secrets, privileged credentials, exchange keys, database service keys, and server-only execution remain outside the app.

## Release progression

debug → internal → beta → production

Production signing, Play AAB publishing, device smoke tests, notifications, identity/session broker, and database sync are separate factory layers. They must be added without weakening the current server-side security boundary.
