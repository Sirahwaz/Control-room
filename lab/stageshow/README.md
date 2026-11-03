# MIDAD StageShow Runtime Demo

An isolated React/Vite visual-authoring proof of concept. The demo uses original MIDAD sample content and the StageShow stage/motion engine; it is not connected to production services and performs no real reverse-engineering, network, account, wallet, or payment operations.

## Run locally

- Node.js `>=20.19`
- `npm install --no-audit --no-fund`
- `npm run typecheck`
- `npm run build` (emits the root-level Pages entry and assets)
- `npm run smoke`
- `npm run dev`

The package and all dependencies are scoped to this directory. It is not imported by Control Room's production bundle. Browser automation and Playwright are deliberately excluded from this runtime slice.

## Upstream provenance

StageShow kit source is pinned to `benjitaylor/skills@802057409787133703c56001080169e347305572`. Only the Stage, cursor, keys, timing, measuring, and motion primitives required by this demo are vendored under `src/upstream/kit/`. Brand registries, app icons, examples, filming scripts, playground, and unrelated components are excluded. The upstream MIT license and notices are recorded in `.agents/skills/stageshow/` in the parent repository.

## Truth boundary

All displayed application metadata and pipeline states are illustrative fixtures. The visual walkthrough animates a local scene only; it does not prove an inspection, backend request, finding, approval, payment, or production state.
