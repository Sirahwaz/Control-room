# MIDAD Production Source & Execution Checkpoint — 2026-11-08

Canonical repository: `Sirahwaz/Control-room`
Supabase project: `midad-ai` (`froegigfmpmvtecztfbf`)
Policy: audit → preserve → repair → integrate → upgrade. This is an evidence snapshot, not authorization to deploy or move funds.

## Source synchronization completed

| Function | Live version | Control-room state |
|---|---:|---|
| `midad_client_gateway` | 48 | Exact deployed source synchronized in PR #203 |
| `midad_base_usdc_monitor` | 23 | Exact deployed source synchronized in PR #203 |
| `midad_orchestrator` | 54 | Exact deployed source added in this PR |
| `midad_omni_agent_gateway` | 13 | Exact deployed source synchronized in this PR |
| `generate_campaign` | 58 | Exact deployed source added in this PR |
| `midad_payment_verifier` | 45 | Entry point byte-identical to live source |

These are source-of-truth repairs only. No Edge Function deployment was performed.

## Deliberate deployment holds

| Function | Live | Repository finding | Decision |
|---|---:|---|---|
| `midad_model_gateway_v3` | 31 | Main contains the autonomy-identity gate; live v31 still has the older auth path | Do not deploy until caller compatibility is verified |
| `midad_ai_router` | 34 | Main contains newer auth-mode and data-class checks not present in live v34 | Do not overwrite or deploy until callers are verified |
| `midad_public_checkout` | 29 | Tracked source differs from deployed source | Audit diff and tests before sync |
| `midad_wallet_receipt_monitor` | 17 | Tracked source differs from deployed source | Audit diff and tests before sync |
| `midad_revenue_intelligence_mesh` | 32 | Tracked source differs from deployed source | Audit diff and tests before sync |
| `midad_paid_revenue_feed` | 11 | Deployed function not yet present in Control-room | Rehome after source/dependency audit |

The remaining PromptOS/production changes in MIDAD Intelligence PR #10 and PR #11 are not to be merged into that repository: its declared ownership boundary is read-only intelligence. PR #11's payment source and applied migration snapshots have been rehomed through Control-room PR #203.

## Neural++ live state

- Model catalog: 394 records; 304 marked ZDR-eligible.
- Recommendations: 1,985.
- Enabled model routes: 1.
- Active route: OpenRouter `stealth/crouton-alpha`, free budget, public/sanitized data only.
- Last route inference test: VERIFIED, HTTP 200, 15,837 ms.
- Active route privacy profile: `sanitized_safety_retention`, `data_collection=deny`, `allow_fallbacks=false`, but `zdr=false`. Do not describe this active route as ZDR.
- Discovery checks: 24 endpoints checked, 0 endpoint failures.
- Benchmark runner: one candidate per 12-hour cooldown. The latest candidate returned HTTP 200 but failed the exact JSON arithmetic contract; it was not promoted.

## Revenue and payment state

- 10 UGIG leads: 6 `qualified_target`, 4 `human_review`; all have name, contact and need fields.
- Client profiles: 0; conversations: 0; messages: 0.
- Store orders: 4, all cancelled. Payment intents: 6, all expired/cancelled. Wallet receipts: 0. Payment events: 0.
- Both canonical Base USDC receive routes: `VERIFIED`, caught up, reconciliation-ready, zero monitor errors.
- No Base receipts or payment-verifier calls are recorded. Route readiness is not collected revenue.
- Avalanche USDT remains degraded due to incomplete scan catch-up. Solana stablecoin routes are awaiting first token accounts.

## Compute and HakiOS

- Linux Worker/Forge remains bounded and ephemeral through GitHub Actions; no persistent Linux host is provisioned.
- MNCF correctly does not infer persistent capacity from CI.
- HakiOS U-Boot path reached the one-shot userspace payload and returned to loader; a stable OS session and full source build are not verified.
- UEFI-ESP and loader-device paths failed before loader execution.
- Linked GitHub access to `oosexgang/hakios-xnu-kernel` and `oosexgang/hakios-uefi` is pull-only (`push=false)); upstream changes are blocked until write access is granted or an approved fork is selected.

## Safety boundaries

- No paid provider route was activated.
- No new model route was promoted by this source-sync work.
- No customer messages, invoices, payment intents, wallet signing, transfers or settlements were created.
- No Supabase migrations were applied; the five payment migrations in PR #203 are archived under versions already present in production migration history.
