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

The complete kit, examples, references and film/rehearsal scripts remain maintained upstream at https://github.com/benjitaylor/skills/tree/main/stageshow. This MIDAD integration vendors the skill instructions and attribution/license notices only; it does not claim the React kit or playground has been installed or executed. To use the kit, obtain the upstream StageShow package into an isolated workspace, inspect its package manifest and dependencies, then pin the reviewed revision before use.

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
