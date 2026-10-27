# MIDAD live-source parity reconciliation — 2026-10-28

## Scope and method

Read-only comparison of deployed Supabase Edge Function source against `Sirahwaz/Control-room` on `main`. The current deployed function source was retrieved from the live project, compared to the repository snapshot, and checked for common credential-literal patterns before adding the source to version control.

## Current live versions

| Function | Deployed version | Runtime state | Finding | Action |
|---|---:|---|---|---|
| `midad_base_usdc_monitor` | 17 | ACTIVE | Main snapshot is shorter (14,541 bytes) than deployed source (19,653 bytes). | Replace repository copy with exact live source. |
| `midad_speedbot_target_executor` | 8 | ACTIVE | `index.ts` is absent from main; `matching.ts` exists and is byte-identical to the deployed dependency (1,739 bytes). | Restore the exact deployed `index.ts`; preserve the existing matching helper. |
| `midad_revenue_intel_work_queue_worker` | 8 | ACTIVE | Both `index.ts` and `taskmarket_rail.mjs` are absent from main. Deployed source is 39,124 bytes and helper is 5,476 bytes. An older source-parity branch contained worker v1 and is stale for the current runtime. | Restore the exact deployed v8 source and its `taskmarket_rail.mjs` dependency. |

## Safety scan

The live source files did not match the checked patterns for PEM private keys, Google API key literals, APMIX live keys, GitHub tokens, bearer-token literals, or long credential assignments. Values are read from environment secrets or Vault at runtime; no credential values were added to this repository change. The matching helper already present in main is byte-identical to deployed v8.

## Acceptance criteria

- Repository snapshots correspond to current deployed versions as retrieved during this audit.
- `deno check` runs against all three deployed-source snapshots in CI.
- This PR is repository reconciliation only: no Supabase function is deployed, no database schema or RLS policy is changed, and no finance/wallet actions run.
- Future source edits should update the repo snapshot first, then use normal CI, rollout, post-deploy checks, and rollback review.
