---
name: modern-web-guidance
description: Apply current cross-browser web-platform guidance to MIDAD Control Room UI work without replacing working architecture.
---

# MIDAD Modern Web Guidance

Use this workflow for changes to MIDAD web interfaces, Progressive Web App surfaces, Telegram Mini Apps, and browser-facing components.

## Upstream authority

- Official project: https://github.com/GoogleChrome/modern-web-guidance
- Chrome documentation: https://developer.chrome.com/docs/modern-web-guidance/get-started
- The upstream project is stewarded with input from Chrome, Edge, Firefox, MDN, and the web community. Treat its guides as implementation guidance, not as permission to adopt every newly available API.

## Required workflow

1. **Audit before changing:** identify the actual entry point, existing HTML/CSS/JS modules, supported browsers, runtime constraints, and current tests. Preserve existing behavior and contracts.
2. **Find targeted guidance:** when the upstream CLI is available, run:
   - `npx modern-web-guidance@latest search "<specific implementation task>"`
   - `npx modern-web-guidance@latest retrieve "<matching-guide-id>"`
   Do not run the interactive installer merely to answer a one-off implementation question.
3. **Apply selectively:** use the smallest relevant native platform capability. Prefer semantic HTML, native browser APIs, responsive CSS, accessible interaction patterns, and browser-optimized performance techniques.
4. **Check compatibility:** verify support against the project's actual browser targets (including Android Chrome and embedded Telegram WebViews where applicable). Provide a progressive enhancement or lightweight fallback when support is incomplete.
5. **Avoid volatile defaults:** do not enable origin-trial or volatile features for production by default. Require explicit compatibility evidence and a fallback before considering them.
6. **Verify:** add or update focused tests; run existing checks; inspect keyboard/focus behavior, screen-reader semantics, responsive layouts, loading behavior, and console/runtime errors where tooling permits.
7. **Report evidence:** state changed files, checks actually run, results, unsupported environments, and remaining blockers. Never claim a browser test or CLI installation unless it was executed and observed.

## MIDAD-specific constraints

- Do not introduce a new framework, package manager, build system, or dependency solely to apply these guidelines.
- Do not assume the repository root is an npm project. Discover the real app entry point and build/test workflow first.
- Keep GitHub Pages and Telegram Mini App constraints in view; do not expose Supabase service-role keys, provider secrets, wallet secrets, or privileged credentials in browser code.
- Keep financial actions, wallet signing, and production writes behind existing server-side authorization and human-approval gates.
- Preserve working modules. Use **AUDIT → PRESERVE → REPAIR → INTEGRATE → UPGRADE**, not a rewrite.

## High-value guide areas

Select only what the task needs: performance (including INP and loading priorities), accessibility and focus management, modern HTML controls (dialog/popover/forms), responsive CSS (container queries/subgrid where supported), image/media loading, and graceful fallbacks.

## Installation status

This repository policy does not install the upstream CLI or plugin. When a Codex CLI environment becomes available, the official Codex installation commands are:

```sh
codex plugin marketplace add GoogleChrome/modern-web-guidance
codex plugin add modern-web-guidance@googlechrome
codex plugin list
```

A successful repository commit or this policy file is not evidence that the upstream plugin is installed or active.
