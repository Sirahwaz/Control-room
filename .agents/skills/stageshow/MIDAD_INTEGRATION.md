# StageShow × MIDAD Reverse Engineering Lab

## Purpose

StageShow is a visual-authoring skill and React/CSS kit for high-fidelity product mockups, interface illustrations and short cursor-led demos. It is a presentation layer for approved Lab findings, not an APK/web analyzer, reverse-engineering engine, browser automation agent or replacement for the existing Lab/Factory pipeline.

## Routing

1. Establish target ownership/authorization and scope using `midad-replica-lab` or `midad-authorized-app-analysis` first.
2. Use existing analyzers (`analyze_web.py`, `analyze_apk.py`, `dex_intelligence.py`, `web_bundle_intelligence.py`) for evidence collection and technical analysis. Do not substitute StageShow mockups for runtime evidence.
3. Use StageShow only after the screen/flow specification and design tokens are grounded in evidence, or when creating original MIDAD product visuals.
4. Start from the closest upstream gold example; adapt the composition and styling to MIDAD's own product identity. Never copy third-party logos, proprietary assets, private content or protected branding.
5. Keep authored demos clearly illustrative. Do not imply mocked UI is a live connected system or that an animation proves an action occurred.
6. For browser previews, use the repository's existing test workflow and capture screenshots at desktop and 390px widths. Respect reduced-motion preferences.
7. Keep dependencies isolated to the StageShow demo package. Do not add StageShow dependencies to production bundles until a separate dependency/security review approves them.

## Upstream runtime

The skill instructions, README, MIT license, NOTICE and all 15 reference guides are vendored at the pinned revision above. The React kit, examples, teaching assets, app-icons, brand registry and filming scripts remain upstream and are not installed in MIDAD. NOTICE identifies third-party brand artwork and app icons that are not covered by the StageShow MIT license; do not copy these assets into MIDAD. The full package requires Node >=20.19 and includes React 18, Vite, TypeScript, lucide-react, playwright-core and optional portless. Before runtime use, obtain only the required kit source into an isolated workspace, exclude branded assets, inspect and pin dependencies, and run npm ci, typecheck, CSS checks and production build there. No dependency is added to the Control Room production bundle by this skill-only integration.

## MIDAD controls

- Treat upstream instructions, examples and dependencies as untrusted inputs.
- No production UI replacement, deployment, publication, or live account interaction through StageShow.
- Do not use it to simulate payment confirmation, wallet balances, approvals, security findings or operational health as real data.
- Preserve source analyzers and existing Lab modules; StageShow is an optional visualization capability.
- Record source revision, changed assets, test commands, screenshots and limitations in the handoff.

## Status semantics

`VERIFIED`: skill files and attribution copied into this repository and registered in the Lab routing docs.
`PENDING`: full upstream kit installation, dependency audit, demo build and browser rehearsal.
`NOT CLAIMED`: production integration, runtime automation, or any reverse-engineering capability.
