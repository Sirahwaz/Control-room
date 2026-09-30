# MIDAD Fabric Registry

Generated from the live Supabase Edge Function inventory on 2026-09-30. This is a portability map, not a secret store. Secrets/tokens are intentionally excluded.

| Function | Status | Version | JWT | Layer |
|---|---|---:|:---:|---|
| generate_campaign | ACTIVE | 33 | ON | Core service |
| telegram_bot | ACTIVE | 70 | CUSTOM/OPEN | Telegram transport / routing |
| midad_orchestrator | ACTIVE | 29 | CUSTOM/OPEN | Policy / orchestration / autonomy |
| midad_chain_intelligence | ACTIVE | 18 | ON | Telemetry / chain |
| midad_measure_outcomes | ACTIVE | 19 | ON | Measurement / feedback |
| midad_market_ingest | ACTIVE | 24 | CUSTOM/OPEN | OSINT / market telemetry |
| midad_control_room | ACTIVE | 61 | CUSTOM/OPEN | Control plane / UI API |
| midad_telegram_repair_once | ACTIVE | 14 | CUSTOM/OPEN | Telegram transport / routing |
| midad_opportunity_engine | ACTIVE | 21 | CUSTOM/OPEN | Opportunity qualification |
| midad_viabtc_monitor | ACTIVE | 17 | CUSTOM/OPEN | Telemetry / chain |
| midad_telegram_bootstrap_once | ACTIVE | 11 | CUSTOM/OPEN | Telegram transport / routing |
| midad_client_gateway | ACTIVE | 15 | CUSTOM/OPEN | Client / worker delivery |
| midad_osint_router | ACTIVE | 12 | CUSTOM/OPEN | OSINT / market telemetry |
| midad_payment_verifier | ACTIVE | 11 | CUSTOM/OPEN | Income / payment / settlement |
| midad_telegram_router | ACTIVE | 11 | CUSTOM/OPEN | Telegram transport / routing |
| midad_policy_engine | ACTIVE | 12 | CUSTOM/OPEN | Policy / orchestration / autonomy |
| midad_autonomy_loop | ACTIVE | 16 | CUSTOM/OPEN | Policy / orchestration / autonomy |
| midad_market_edge | ACTIVE | 10 | CUSTOM/OPEN | OSINT / market telemetry |
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

- Control Room: midad_control_room v61
- Telegram owner bot: telegram_bot v70
- MIDADKeys bot/poller: midad_keys_bot / midad_keys_poller
- Research/Neural: midad_research_center, midad_neural_core, midad_neural_status, midad_hypothesis_lab, midad_neural_evolution, midad_curiosity_engine
- Income: midad_money_hunt, midad_money_hunter, midad_income_factory, midad_revenue_recovery, midad_payment_verifier, midad_settlement_router
- Delivery: midad_ugig_gateway, midad_client_gateway
- Build: midad_forge, midad_forge_coordinator

## Active verified blocker

MIDADKeys token source is currently unavailable. The live midad_keys_poller test returned bot_token_not_configured; no token value is stored in this registry.

## Security notes

Supabase Security Advisor currently reports 28 RLS-enabled public tables without policies, pg_net in public, and leaked-password protection disabled. These are audit findings; this registry does not automatically change them.
