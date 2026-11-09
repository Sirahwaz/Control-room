# MIDAD Continuity Register

This directory preserves an auditable, version-controlled continuity record.

## Two memory horizons

- [Long-term context](./MIDAD_LONG_TERM_CONTEXT.md): stable architecture, repository boundaries, invariants, security rules, and sources of truth. Update only when a durable decision or architecture boundary changes.
- [Browser Mesh checkpoint — 2026-11-09](./MIDAD_BROWSER_MESH_CHECKPOINT_2026-11-09.md): current GitHub/Cloudflare/Playwright/Android source, CI, runtime blockers and exact next actions.
- [Short-term checkpoint — 2026-11-08](./MIDAD_SHORT_TERM_CHECKPOINT_2026-11-08.md): the earlier same-day governance checkpoint; preserve as historical evidence.
- [Supplemental checkpoint — PR #196 Trading/MIMIC](./MIDAD_SHORT_TERM_CHECKPOINT_2026-11-08-PR196-TRADING-MIMIC.md): post-merge CI, APK, Pages, release-signing and deployed MIMIC security/parity evidence, with remaining blockers.

## Update discipline

1. Record only facts supported by source files, tool results, or explicit decisions.
2. Distinguish VERIFIED, INFERRED, PENDING, FAILED, BLOCKED and HISTORICAL.
3. Link PRs, commits, workflow runs and canonical Notion records.
4. Never store passwords, API keys, tokens, private keys, seed phrases, wallet secrets, or unredacted secret values.
5. Keep code/runtime state in GitHub and Supabase; continuity documents are pointers and decision records, not runtime databases.
6. Preserve old checkpoints. Append or supersede with a dated record so that changes remain traceable.


## Mandatory boot and no-repeat gate

Before any MIDAD action, retrieve the canonical Notion record [MIDAD Global Continuity — Always Load Commands, Rules & Memory](https://app.notion.com/p/3fab132b437d81649bcfe9a5647ebc33), then load only the latest checkpoint for the exact active workstream, and then this long-term context.

Carry forward: `GOAL → LAST VERIFIED STATE → EVIDENCE/REFS → COMPLETED → CURRENT BLOCKER → APPROVED NEXT ACTION → PROHIBITED ACTIONS`.

- Resume; do not restart completed audits or recreate existing artifacts.
- Preserve the agreed architecture, active workstream, provider choices, cost boundaries and approvals.
- Re-run a check only when new/stale evidence or an explicit request justifies it.
- Inspect exact target, dependencies, minimal diff and rollback before any write.
- If continuity evidence or required approval is missing, stop mutations and report `BLOCKED`; continue read-only recovery only.
- Verify changes against the correct source of truth and update the existing checkpoint; never claim more than the evidence proves.

This is an operational documentation gate. It does not by itself enforce execution inside application code or automatically load Notion in a new chat.
