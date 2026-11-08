# MIDAD Continuity Register

This directory preserves an auditable, version-controlled continuity record.

## Two memory horizons

- [Long-term context](./MIDAD_LONG_TERM_CONTEXT.md): stable architecture, repository boundaries, invariants, security rules, and sources of truth. Update only when a durable decision or architecture boundary changes.
- [Short-term checkpoint — 2026-11-08](./MIDAD_SHORT_TERM_CHECKPOINT_2026-11-08.md): the earlier same-day governance checkpoint; preserve as historical evidence.
- [Supplemental checkpoint — PR #196 Trading/MIMIC](./MIDAD_SHORT_TERM_CHECKPOINT_2026-11-08-PR196-TRADING-MIMIC.md): post-merge CI, APK, Pages, release-signing and deployed MIMIC security/parity evidence, with remaining blockers.

## Update discipline

1. Record only facts supported by source files, tool results, or explicit decisions.
2. Distinguish VERIFIED, INFERRED, PENDING, FAILED, BLOCKED and HISTORICAL.
3. Link PRs, commits, workflow runs and canonical Notion records.
4. Never store passwords, API keys, tokens, private keys, seed phrases, wallet secrets, or unredacted secret values.
5. Keep code/runtime state in GitHub and Supabase; continuity documents are pointers and decision records, not runtime databases.
6. Preserve old checkpoints. Append or supersede with a dated record so that changes remain traceable.
