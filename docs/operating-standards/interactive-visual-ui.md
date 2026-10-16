# MIDAD Interactive & Visual Operating Standard
**Status:** Active operational rule  
**Priority:** P0  
**Adopted:** 2026-10-16  
**Scope:** MIDAD AI, Control Room, project workflows, agent outputs, and future MIDAD work sessions.

## Directive
Use ChatGPT's interactive and visual capabilities as a default MIDAD delivery standard wherever they materially improve comprehension, execution, validation, or handoff. Prefer functional interaction over decorative visuals.

## Preferred patterns
- Interactive controls and state-aware command surfaces for choosing options and inspecting results.
- Guided checklists and step-by-step workflows for operational tasks.
- Diagrams and flowcharts for architecture, dependencies, and execution paths.
- Charts and visual explainers for measurable evidence and complex concepts.
- Clear statuses, progress, blockers, expected outcomes, and next actions.
- Mobile-first layouts; Arabic-first copy and RTL support where applicable, with useful technical English labels.

## Acceptance criteria
1. A control must perform the action its label promises; no inert or misleading controls.
2. Visuals must be accurate, readable, accessible, and appropriately labeled.
3. Distinguish VERIFIED / INFERRED / PENDING / FAILED / BLOCKED and attach evidence where practical.
4. A visual must not substitute for required executable code, structured data, source evidence, or end-to-end verification.
5. When interaction adds no material value, prefer concise, clear text rather than unnecessary UI.
6. Sensitive or high-impact actions retain existing least-privilege and human-approval gates.
7. Preserve working architecture: AUDIT → VERIFY → PRESERVE → REPAIR → INTEGRATE → UPGRADE. Do not rebuild working components merely to add a visual layer.

## Operating sequence
Need → define acceptance criteria → choose the smallest useful interaction/visual → implement or present → test behavior and responsive layout → verify against evidence → record blockers and next action.

## Continuity
At the start of a MIDAD-related session, load the available MIDAD Global Continuity instructions and search the Notion Command & Governance Registry before asking the user to repeat previously recorded requirements. This document is a durable source of policy; it does not, by itself, guarantee automatic loading in every unrelated chat or client.
