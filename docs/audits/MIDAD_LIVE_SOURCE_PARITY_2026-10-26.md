# MIDAD live-source parity reconciliation — 2026-10-26

Read-only comparison against Supabase project `midad-ai` (ref `froegigfmpmvtecztfbf`) on 2026-10-26 found three repository/source gaps:

| Function | Live version | Last deployed (UTC) | Repository state before this branch | Action |
|---|---:|---|---|---|
| `midad_base_usdc_monitor` | 17 | 2026-10-19 23:15:54 | Existing snapshot was shorter and not byte-identical | Replace repository snapshot with exact live `index.ts` |
| `midad_speedbot_target_executor` | 8 | 2026-10-20 11:02:43 | `index.ts` absent; helper was present but differed | Restore live `index.ts` and reconcile `matching.ts` |
| `midad_revenue_intel_work_queue_worker` | 3 | 2026-10-19 21:42:27 | `index.ts` absent | Restore live `index.ts` |

Other checked critical functions matched their live source byte-for-byte: `midad_public_checkout` v25, `midad_revenue_autopilot` v23, `midad_wallet_receipt_monitor` v13, and `midad_payment_verifier` v41.

The live-source scan found no PEM private keys, GitHub tokens, bearer credential literals, Supabase secret-key literals, or long credential assignments in the restored files. The 64-hex strings in the Base monitor and queue worker are event-signature/topic hashes, not credentials.

This is a repository portability reconciliation only. It does not deploy or modify Supabase production. The new CI workflow runs `deno check` on all three restored functions. Do not deploy until CI passes and the normal production rollout/rollback review is complete.
