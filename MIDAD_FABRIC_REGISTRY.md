# MIDAD Fabric Registry

Generated from the live Supabase Edge Function inventory on 2026-09-30. This is a portability map, not a secret store. Secrets/tokens are intentionally excluded.

| Function | Status | Version | JWT | Layer |
|---|---|---:|:---:|---|
| generate_campaign | ACTIVE | 33 | ON | Core service |
| telegram_bot | ACTIVE | 74 | CUSTOM/OPEN | Telegram transport / routing |
| midad_orchestrator | ACTIVE | 29 | CUSTOM/OPEN | Policy / orchestration / autonomy |
| midad_chain_intelligence | ACTIVE | 18 | ON | Telemetry / chain |
| midad_measure_outcomes | ACTIVE | 19 | ON | Measurement / feedback |
| midad_market_ingest | ACTIVE | 24 | CUSTOM/OPEN | OSINT / market telemetry |
| midad_control_room | ACTIVE | 64 | CUSTOM/OPEN | Control plane / UI API |
| midad_telegram_repair_once | ACTIVE | 14 | CUSTOM/OPEN | Telegram transport / routing |
| midad_opportunity_engine | ACTIVE | 21 | CUSTOM/OPEN | Opportunity qualification |
| midad_viabtc_monitor | ACTIVE | 21 | CUSTOM/OPEN | Telemetry / chain |
| midad_viabtc_monitor_bot | ACTIVE | 7 | CUSTOM/OPEN | Telegram transport / trading intelligence |
| midad_telegram_bootstrap_once | ACTIVE | 11 | CUSTOM/OPEN | Telegram transport / routing |
| midad_client_gateway | ACTIVE | 15 | CUSTOM/OPEN | Client / worker delivery |
| midad_osint_router | ACTIVE | 12 | CUSTOM/OPEN | OSINT / market telemetry |
| midad_payment_verifier | ACTIVE | 11 | CUSTOM/OPEN | Income / payment / settlement |
| midad_telegram_router | ACTIVE | 11 | CUSTOM/OPEN | Telegram transport / routing |
| midad_policy_engine | ACTIVE | 12 | CUSTOM/OPEN | Policy / orchestration / autonomy |
| midad_autonomy_loop | ACTIVE | 16 | CUSTOM/OPEN | Policy / orchestration / autonomy |
| midad_market_edge | ACTIVE | 10 | CUSTOM/OPEN | OSINT / market telemetry |
| midad_noncopy_trading_engine | ACTIVE | 4 | CUSTOM/OPEN | Trading intelligence / paper execution |
| midad_settlement_router | ACTIVE | 10 | CUSTOM/OPEN | Income / payment / settlement |
| midad_human_task_router | ACTIVE | 10 | CUSTOM/OPEN | Core service |
| midad_money_hunter | ACTIVE | 19 | CUSTOM/OPEN | Income / payment / settlement |
| midad_money_hunter_loop | ACTIVE | 9 | CUSTOM/OPEN | Income / payment / settlement |
| midad_learning_engine | ACTIVE | 7 | CUSTOM/OPEN | Intelligence / research / learning |
| midad_ugig_gateway | ACTIVE | 8 | CUSTOM/OPEN | Client / worker delivery |
| midad_control_surface | ACTIVE | 9 | CUSTOM/OPEN | Control plane / UI API |
| midad_control_wallets | ACTIVE | 5 | CUSTOM/OPEN | Control plane / UI API |
| midad_income_factory | ACTIVE | 7 | CUSTOM/OPEN | Income / payment / settlement |
| midad_revenue_recovery | ACTIVE | 7 | CUSTOM/OPEN | Income / payment / settlement |
| midad_control_room_app | ACTIVE | 7 | CUSTOM/OPEN | Control plane / UI API |
| midad_money_hunt | ACTIVE | 6 | ON | Income / payment / settlement |
| midad_research_center | ACTIVE | 5 | CUSTOM/OPEN | Intelligence / research / learning |
| midad_telegram_poller | ACTIVE | 8 | CUSTOM/OPEN | Telegram transport / routing |
| midad_neural_core | ACTIVE | 10 | CUSTOM/OPEN | Intelligence / research / learning |
| midad_hypothesis_lab | ACTIVE | 7 | CUSTOM/OPEN | Intelligence / research / learning |
| midad_neural_evolution | ACTIVE | 6 | CUSTOM/OPEN | Intelligence / research / learning |
| midad_neural_status | ACTIVE | 6 | CUSTOM/OPEN | Intelligence / research / learning |
| midad_curiosity_engine | ACTIVE | 6 | CUSTOM/OPEN | Intelligence / research / learning |
| midad_forge | ACTIVE | 5 | CUSTOM/OPEN | Build / code generation |
| midad_forge_coordinator | ACTIVE | 5 | CUSTOM/OPEN | Build / code generation |
| midad_keys_gateway | ACTIVE | 5 | CUSTOM/OPEN | Identity / key governance |
| midad_keys_bot | ACTIVE | 9 | CUSTOM/OPEN | Identity / key governance |
| midad_keys_poller | ACTIVE | 8 | CUSTOM/OPEN | Identity / key governance |

## Verified control surfaces

- Control Room: midad_control_room v62
- ViaBTC monitor: midad_viabtc_monitor v20 (hash/s → TH/s normalization + IP whitelist diagnostics)
- Telegram owner bot: telegram_bot v72
- MIDADKeys bot/poller: midad_keys_bot v9 / midad_keys_poller v8
- Research/Neural: midad_research_center, midad_neural_core, midad_neural_status, midad_hypothesis_lab, midad_neural_evolution, midad_curiosity_engine
- Income: midad_money_hunt, midad_money_hunter, midad_income_factory, midad_revenue_recovery, midad_payment_verifier, midad_settlement_router
- Delivery: midad_ugig_gateway, midad_client_gateway
- Build: midad_forge, midad_forge_coordinator
- Bot Fabric UI surfaces: 15
- ViaBTC declared fleet: Antminer M31+ ×1 (84 TH/s) + M21 ×1 (56 TH/s) = 140 TH/s; live measurement remains separate.

## Active verified blocker

MIDADKeys token source is currently unavailable. The live midad_keys_poller test returned bot_token_not_configured; no token value is stored in this registry.

## Security notes

Supabase Security Advisor currently reports 28 RLS-enabled public tables without policies, pg_net in public, and leaked-password protection disabled. These are audit findings; this registry does not automatically change them.

## Non-copy trading intelligence

- midad_noncopy_trading_engine v4: multi-venue independent BTC signal engine with paper-only output, no live order execution.
- Market fallback currently verified from Supabase runtime: CoinEx + Kraken + OKX reachable; Binance/Bybit/CoinGecko returned transport blocks (451/403).
- midad_viabtc_monitor_bot v7: dedicated @viabtc_monitor Telegram bot. Secret source is VIABTC_MONITOR_BOT_TOKEN; commands/menu/webhook bootstrap verified. /trade and /mysun route to the non-copy engine.
- Paper-trade table: public.midad_paper_trades, RLS enabled, service-role internal writes only.


## Emergency++ Bot Command Surfaces

- Control Room now supports bot-scoped URLs: `bot=viabtc`, `bot=ahwaz`, `bot=aimidad`.
- ViaBTC context opens a dedicated Trading Lab with Evidence → Signal → Risk Gate → Paper Trade → MYSUN segmentation.
- Bot Ops exposes management contexts for @viabtc_monitor, @ahwazai_bot, and @aimidad_bot without exposing secrets.
- @aimidad_bot control menu now links to its scoped Control Room, Bot Ops, and the ViaBTC Trading Lab; /trade and /mysun route to the non-copy engine.
- GitHub Actions `MIDAD Control Room Verify` succeeded on the latest UI cache-bust commit.


## MYSUN/LOOP — Revenue Intelligence Architecture vNext (2026-10-03)

Implemented from the verified live architecture without rebuilding existing systems.

- Revenue conversion bridge: `midad_first_mover_queue` → `midad_income_discoveries`; 119 discovery records reconciled idempotently.
- Revenue reconciliation: legacy `submitted_waiting` opportunities without a Revenue Job were linked to tracking jobs without re-submitting externally; Revenue Jobs increased to 25.
- Money Hunter v38: optional revenue sources are enabled by default unless explicitly disabled by `MIDAD_ENABLE_OPTIONAL_REVENUE_SOURCES=false`. Existing risk filters remain authoritative.
- Model Fabric: private `midad_private` schema with `model_providers`, `model_routes`, and `model_runs`; no client/anon access.
- APMIX adapter: `midad_model_gateway_v2` is active and defaults to `deepseek-v4-flash-free`; the APMIX secret is intentionally not stored in this registry or source code.
- AI Router: `midad_ai_router` v2 routes task classes to the model fabric and falls back to the existing Control Room AI path when APMIX is not configured.
- Neural Core: v29 now routes AI through `midad_ai_router` and records generated facts into `midad_research_findings` for traceability.
- Revenue KPI RPC: `midad_get_revenue_kpis()` provides a single service-role-only cash-conversion snapshot for Control Room integration.
- Authorized Red Team capability: `security.redteam.authorized` is registered as high-risk/gated with explicit denials for credential theft, auth bypass, malware, persistence, and exfiltration.
- Current verified revenue snapshot: 119 income discoveries, 100 first-mover execute-ready, 25 revenue jobs, $2,837 expected pipeline, $0 paid, 9 open human gates.
- Current trading snapshot: 280 closed paper trades, 12 under review, 1 trade intent awaiting approval, 0 live executions.
- Current research snapshot: 501 research runs and a new write-through path from Neural Core to research findings.

### Pending capability gate

APMIX is architecturally wired but not live until the secret `MIDAD_APMIX_API_KEY` is added through secure Supabase Edge Function secret storage. No API key is embedded in GitHub, frontend code, SQL data, or this registry.


## MYSUN/LOOP — APMIX Activation + Verification (2026-10-03)

- Secure secret `MIDAD_APMIX_API_KEY` was added to Supabase Edge Function Secrets; the value is not stored in source, SQL, GitHub, or this registry.
- `midad_model_gateway_v3` is ACTIVE and authenticates autonomy traffic through `midad_get_autonomy_key()`.
- APMIX `/models` verification returned the account catalog with `gpt-6-luna-free`; routes were updated from the unavailable `deepseek-v4-flash-free` to the verified account model.
- Direct inference verification passed: APMIX returned a valid response through `midad_model_gateway_v3` with 74 total tokens and ~3.47s latency.
- `midad_ai_router` v5 verification passed with `fallback=false`, proving Router → APMIX routing.
- `midad_neural_core` v32 verification passed on an existing Research Run; it produced structured facts/hypotheses and persisted research findings via the new protected RPC `midad_record_research_finding()`.
- APMIX capability `ai.model.gateway.apmix` is now marked `VERIFIED`; the key request is `approved` while retaining `human_gate=true` for governance traceability.
- Revenue Autopilot cycle was executed. No new submissions were made because the existing daily application cap was already at 20/20; wallet watch scanned 2 Solana revenue wallets and found no new receipts. Live trading and auto-withdraw remain disabled.
- Latest KPI snapshot: 119 income discoveries, 100 execute-ready first-mover entries, 25 revenue jobs, $2,837 expected pipeline, $0 paid, 1 payout pending, 10 open human gates, 15 fresh income candidates, 280 closed paper trades, 12 paper trades under review, 1 trade intent in review, 0 live trade executions, 53,602 OSINT events, 501 research runs, 10 persisted research findings, and 7 active Model Fabric routes.


## MYSUN/LOOP — Wallet Receipt Mesh + First-Cents Test (2026-10-03)

Implemented by extending the existing wallet/payment architecture; no wallet system rebuild.

- Canonical receive route: midad_revenue_routes → USDC/Solana → Primary Solana Receive Wallet, deterministic priority 10. The older UGIG USDC route remains active as a secondary route with priority 20.
- Canonical native USDC mint is pinned in route verification metadata: EPjFWddt1v (full mint is held in the secure/runtime route metadata).
- New midad_wallet_monitor_state tracks scan time, signature/slot, live token balance, health, and last error per receive route. RLS is enabled; service-side access is used by the monitor.
- New midad_wallet_receipt_monitor v1 is ACTIVE and performs inbound-only Solana verification using finalized chain data. It does not transfer, withdraw, or sign outbound funds.
- midad-wallet-receipt-monitor-1m pg_cron job is ACTIVE and scans every minute through the existing MIDAD autonomy key path.
- midad_public_checkout v3 now prefers the canonical route and exposes the exact asset/network/mint plus an explicit fee profile. MIDAD inbound receive fee is 0; sender/network costs can still apply.
- midad_payment_verifier v30 now requires independent chain evidence and, for Solana USDC, an explicit mint verification before marking a payment paid/matched.
- midad_settlement_router v29 was hardened to reject an unregistered receiving address instead of falling back to a different wallet. Address selection is now deterministic, not heuristic.
- Live monitor verification passed on both active USDC/Solana routes: status VERIFIED, current token balance 0, no RPC errors.
- First-cents test intent created: 93c3d020-f3b5-45c6-8b6e-159d68ce44d0, exact amount 0.01 USDC on Solana, status quoted, awaiting the first real inbound receipt.
- No real funds have been credited by this test yet. The remaining external step is the actual 0.01 USDC transfer from a funded wallet; once broadcast, the monitor will detect it, create a receipt, run reconciliation, and prepare settlement without any outbound transfer.
- Secrets/private keys are not stored in GitHub, this registry, frontend code, or SQL records.
