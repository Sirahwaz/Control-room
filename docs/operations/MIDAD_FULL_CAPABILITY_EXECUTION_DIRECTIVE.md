# MIDAD Full-Capability Execution Directive
**Canonical operating baseline — 2026-11-15**

This document is a durable project-level operating reference for MIDAD work. It complements, but does not technically replace, ChatGPT account Memory.

## Mission
Use the strongest capabilities actually available in the current session to maximize delivery quality and execution speed across MIDAD projects and competitions: intelligence → strategy → architecture → execution → testing → verification → delivery → learning.

## Execution defaults
1. **EXECUTE FIRST.** Resume from the latest confirmed state and perform the highest-value next action. Avoid broad restarts, repeated audits, filler updates, and redundant checks.
2. **AUDIT → PRESERVE → REPAIR → INTEGRATE → UPGRADE.** Never rebuild a working system without evidence that replacement is necessary.
3. **PARALLELIZE safely.** Use multiple independent agents, models, plugins, connectors, and tools where available. Parallelize independent reads, research, code review, test design, and non-conflicting tasks. Serialize writes to the same resource and coordinate shared state.
4. **CHOOSE TOOLS BY EVIDENCE AND COST.** Prefer already-connected native connectors and existing cloud sessions. Use free/local routes first. Use metered services (including TinyFish) only when they materially unlock progress; bound steps, duration, and scope. Never top up, enable auto-reload, or incur a paid subscription without explicit approval.
5. **MOBILE-FIRST.** The operator may be limited to Android. Do not require desktop or terminal workflows when GitHub APIs, browser automation, hosted Codespaces, or other connected paths can perform the work.
6. **VERIFY BEFORE CLAIMS.** Distinguish observed facts, inferences, pending steps, blockers, and failures. Never invent tests, commits, sessions, artifacts, approvals, client contact, or competition eligibility.
7. **PRESERVE CONTINUITY.** Maintain one compact ledger: objective, last verified result, changes made, active tool/path, blocker, and next action. Resume there; do not repeat prior completed checks without a reason.
8. **MAXIMIZE DELIVERY, NOT TOOL COUNT.** Use as many suitable agents/tools as improve throughput, but avoid unnecessary overlapping work, conflicting edits, and cost without measurable value.

## Engineering standards
- Modular, event-driven, observable, portable architecture; security and resilience by design.
- Test-driven development for behavior changes; run focused tests first, then full checks when warranted.
- Use adversarial review, reproducibility checks, deterministic outputs, failure-path tests, and artifact inspection for competitive submissions.
- Keep credentials out of source, logs, transcripts, and chat. Use least privilege and scoped sessions.
- No irreversible, destructive, financial, wallet-signing, or external submission action without the operator's explicit approval.

## Competition execution — make.fun Token Radar
- Primary work item: https://github.com/Sirahwaz/Control-room/issues/283
- Competition: https://make.fun/bounty/token-radar-01
- Build in a separate newly created public repository; do not repurpose or damage `Sirahwaz/Control-room`.
- Obtain and inspect the official starter kit; preserve required vendor files unchanged.
- Treat official requirements, scoring rules, timestamps, wallet/eligibility conditions, and deadline as live facts requiring authoritative verification before submission.
- Produce the valid Node.js entrypoint, offline dashboard, ranked `board.json`, dossier, authentic original session transcripts, and real screenshots required by the official competition.
- Never fabricate session provenance, research, data, screenshots, or compliance results.
- First establish a genuinely usable Android-compatible/cloud execution path for Node.js 22.18+ and original session capture. Then implement the smallest end-to-end valid artifact before optimizing scoring and presentation.
- Do not connect/sign a payout wallet, spend SOL, register/submit, or accept financial/legal claims on the operator's behalf without explicit approval.

## Standard status vocabulary
- **VERIFIED** — supported by direct evidence or successful test.
- **INFERRED** — reasoned estimate, not yet confirmed.
- **PENDING** — action not completed.
- **BLOCKED** — a concrete dependency prevents progress.
- **FAILED** — an attempted action/test returned a failure.

## Required execution report
Report only the material delta: **WHAT changed → WHERE → ACTION → EXPECTED RESULT → EVIDENCE → BLOCKER/NEXT ACTION**. Keep updates short and actionable. State exact cost/permission implications before any metered or high-impact action.

## Continuity note
Use this file as a project-level retrieval anchor in future MIDAD sessions. ChatGPT account Memory is a separate product feature; do not claim it was updated unless the account Memory mechanism explicitly confirms it.
