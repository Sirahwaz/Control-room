# MIDAD Mobile Factory

The Factory is the reusable product line around the existing MIDAD Mobile shell.

## Factory X

**MIDAD Mobile Factory X — Intelligent Parallel App Factory** is the active intelligence extension of the Factory. It does not replace or rebuild working Factory components. It adds a persistent capability/provider/plugin/agent/automation registry and a need-first selection layer.

Read the Factory X contract at `mobile/factory/x/README.md`.

Every new product should pass:

`NEED → REQUIREMENTS → CAPABILITY DISCOVERY → PROVIDER DISCOVERY → REUSE/ADAPT/BUILD → AGENT PLAN → PARALLEL EXECUTION → AUDIT → BUILD → TEST → VERIFY → RELEASE → LEARN`

Provider integrations are **not** selected because they happen to be connected. When a required capability is missing, Factory X records a discovery task, evaluates current candidates, registers the result, and keeps a fallback where critical.

## Contract

Each app is represented by one manifest under `mobile/factory/products/`.

The Factory remains compatible with the shared shell and existing products. Factory X is additive and preserves the current security boundary.

## Current product

`midad-mobile` → `ai.midad.mobile` → v0.2.0

## Create a future product

```bash
node mobile/factory/create-product.mjs <product-key> <display-name> <app-id> [version]
node mobile/factory/render.mjs <product-key>
```

## Factory X self-test

```bash
node mobile/factory/x/preflight.mjs
node mobile/factory/x/plan.mjs mobile/factory/x/examples/factory-x-self-test.request.json
```

## Security boundary

APK/app bundles are treated as public client surfaces. Secrets, privileged credentials, exchange keys, database service keys, and server-only execution remain outside the app.

Production external publication and irreversible financial/external actions remain human-gated.

