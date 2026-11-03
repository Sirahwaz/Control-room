# MIDAD — Live Provider Inventory Registry

**Captured:** 2026-11-03 from connected Supabase project and GitHub repository.
**Branch:** docs/platform-independence-p0-p1-20261103
**Handling:** metadata-only. No database rows, Auth credentials, Vault values or secret values are included.

## Deployed Edge Function inventory

Live deployed functions: 100; ACTIVE: 100; with SHA-256: 100; verify_jwt=true: 4; verify_jwt=false: 96.
Repository function directories: 24; live function slugs with a matching folder: 22; live slugs without a matching folder: 78.

| Function | Status | Version | verify_jwt | Deployed SHA-256 |
|---|---|---:|:---:|---|
| `generate_campaign` | ACTIVE | 53 | true | `4f1ff741a61a03d8ef499a73e8707efcdda2a9e61400600d5f497f3b210ee429` |
| `midad_account_factory` | ACTIVE | 13 | false | `b68fd41730a26177ae5ad78451740d507f401601c26f73b9f2d2664fff298d1b` |
| `midad_agent_fee_wallet` | ACTIVE | 4 | false | `e7d57eabe2a3e1eddf498e61395cde4fc6ffb085ed9ee07851b0fa7668ccb52d` |
| `midad_ai_room_preview` | ACTIVE | 3 | false | `f0cbf7c1910f4def88855208d5905de2be8e96ad134eec8f3986805ccf95e43a` |
| `midad_ai_room_status` | ACTIVE | 8 | false | `3d7c3df9f5473b9ba17165a3c7c7c72be2276248f42ca24234e366dde3bc235b` |
| `midad_ai_router` | ACTIVE | 26 | false | `5899276f5c53ecf027db18eb44c96e0577a82c4cfa6faa9f17277569de552bdc` |
| `midad_autonomy_loop` | ACTIVE | 43 | false | `1f0c1101bed2341fd6e626f5405a1419ba8cb85d40ffd41c45f2237882d22a51` |
| `midad_base_usdc_monitor` | ACTIVE | 17 | false | `73a716d7434660c39f4d94406712eaa80bb916d728d78201b972c498007b9b89` |
| `midad_bot_dispatcher` | ACTIVE | 15 | false | `fa41bc2130889069d55cc280de00e1b6bbe4a9f7922b9a291e50c9ee4cd6e146` |
| `midad_bot_fabric` | ACTIVE | 13 | false | `8d4b34ca9f1e9b24ac0d14418bbfcbeb12dd30f9b522f2822ca83924b72833d1` |
| `midad_bountybook_executor` | ACTIVE | 8 | false | `9d9261e7f958b19b0f9b1493013f496ad840017bb7e72c965ba97aaeee277c06` |
| `midad_browser_agent_gateway` | ACTIVE | 12 | false | `b074ab43fa8b7259063e11c0a8bac95e95b1f2765cdc2b5d6d3b4910fd684e8d` |
| `midad_browser_gateway_smoke_runner` | ACTIVE | 5 | false | `139d138a9799dbbe925ea8af1747000e374f275e2fef72b8c68cfae66a919c54` |
| `midad_chain_intelligence` | ACTIVE | 38 | true | `9ad830962823f6228744dd05a85751d2e9e0510412c1413143dd96e0016f891f` |
| `midad_client_gateway` | ACTIVE | 35 | false | `c64cf23a3467687bf5a044ca15c31f2e25ab9ff3721a6d7f4353514ed4993a27` |
| `midad_control_room` | ACTIVE | 103 | false | `ae8f1ff2de17e304374f1c779435aa8d7a2a45df42cec41a03b8be0c481e04e4` |
| `midad_control_room_app` | ACTIVE | 27 | false | `e66d25a12eb5099ffffaf24263d16879f290e1853f933b334977a193221dee39` |
| `midad_control_surface` | ACTIVE | 29 | false | `ec0d72aab4d11966946d36e88ec0acd3b4f6dd8ef19639f5e6f7c1bc8b0320e1` |
| `midad_control_wallets` | ACTIVE | 25 | false | `fd859d301f74eb7f79bb276239e617f2a44ad54bcab137c13bd0de2fbb138a1d` |
| `midad_curiosity_engine` | ACTIVE | 26 | false | `7055c2df35575ff66692a9fcaf3fee884ca311b74f967216f4d658b4a2a59e87` |
| `midad_decision_counterfactual` | ACTIVE | 4 | false | `5a5fbf3e9f9ce837b019fe230491d809ab89aa7e0da0cc0b99390a42d7a79680` |
| `midad_fast_cash_radar` | ACTIVE | 10 | false | `c0a2307711e1b43b116d3fae1285c27efc3d75d0fc843360d027111bec5ea956` |
| `midad_finance_autopilot` | ACTIVE | 8 | false | `16c6de52adf863cf5f7a80ab2b8cf39fa0f3f72a3aa6af03a5b6e1c8c5a8d7cc` |
| `midad_finance_ledger_bridge` | ACTIVE | 4 | false | `c3f69de035a1cb7fc1682eaf297dfbb730ed8cdb63e3887d95527dbecbc321af` |
| `midad_finance_station` | ACTIVE | 5 | false | `eeaa8942c72cbf92d3105f2c264dbaaa9e7349ed753fbd568035dcadaeff4695` |
| `midad_first_mover_engine` | ACTIVE | 19 | false | `838a17a5d22b910d582bab0fd496c7452bf514fabc5e0f66f3937fa1d5cd10ea` |
| `midad_forge` | ACTIVE | 25 | false | `6b2845b9e8a75adb1179aefc18055a0d86239ed6230386f22f0050749bb8d205` |
| `midad_forge_coordinator` | ACTIVE | 25 | false | `5e16f491c4007574f965d1d3a23c68c116a642e80a36538bb1c9a7b42ff4a0dc` |
| `midad_human_bridge` | ACTIVE | 6 | false | `615ae0acc71b216ed60f14a7cfedffe7b21723daee7dd07540c26b71ff333a10` |
| `midad_human_task_router` | ACTIVE | 30 | false | `9424bf49f283648a62bd322608ee8808aa697ddcd019e5c4c4a917c0f462b488` |
| `midad_hypothesis_lab` | ACTIVE | 27 | false | `234c426df10f67dd231521d1698d794aa6f24e3361826b50e4c696e67332cdf1` |
| `midad_iaitrader_bot` | ACTIVE | 20 | false | `b204124656be348b7dd2a17f39d1fd1db16609f4674479021fd9991dde61d9a3` |
| `midad_iaitrader_station` | ACTIVE | 18 | false | `5f0a811027147f80c044585aad6dd3d0fd25d4bad6fa0c650964b6759e6c0ee5` |
| `midad_income_factory` | ACTIVE | 27 | false | `9f6e86e907aa55361f484d5ebb7c98987966ed8c5700e28132ea7d0e8ced2757` |
| `midad_keys_bot` | ACTIVE | 30 | false | `1a6234d412d71d6c8504dd7ef3f98f5287f075045ac1d6daf73bb610eb5dbc9e` |
| `midad_keys_gateway` | ACTIVE | 26 | false | `74a0a5e995a1a68619ca04ac3205f40416ebf7d493894288bffc8753a4bc4dae` |
| `midad_keys_poller` | ACTIVE | 28 | false | `ea944bd256a54bcfaa29cd1cd421dd236a118a35963baa41e0df2d06de402384` |
| `midad_learning_engine` | ACTIVE | 30 | false | `cd77831df8df9cbd0b55df09749032bbbdbb3ebf094cbebb577492567653baff` |
| `midad_live_status` | ACTIVE | 4 | false | `dbcf21464aa8e63ca395a4e20c38f3c1dede267fb25d3e7f25b7fc3b73629244` |
| `midad_loop_runner` | ACTIVE | 8 | false | `c754c766e2c7a13ac75967eba0149ee76baf81929209b0d6984d4ba337625b55` |
| `midad_market_edge` | ACTIVE | 30 | false | `4e639311852ac60dc87ae2b871640f1ca2f3551837b25740ce4747774c17a86b` |
| `midad_market_ingest` | ACTIVE | 44 | false | `fa200f312b85ea6ce3ab4ca1aa6660788206fb9b051645691f41e9b638a35141` |
| `midad_measure_outcomes` | ACTIVE | 42 | false | `697070d6e2b278879f2c251a35063675f80f26ab324419118843966fc3deb19a` |
| `midad_meme_scout` | ACTIVE | 4 | false | `726afce9eede2e706865730df5674950c14781ec9b26ccbd4ba0ccf66aeb0c4e` |
| `midad_miner_microscope` | ACTIVE | 11 | false | `018922c874ca7c48c44efdd871092114704568b863f16af2a03aa41aa57cccce` |
| `midad_miner_repair_bridge` | ACTIVE | 4 | false | `257512c62938af50fe4e94172fd54e6cb90cc92d1df39f3be5435f7c9ab67511` |
| `midad_miner_telemetry_ingest` | ACTIVE | 5 | false | `4a5bcdfa1c1b27cf6a3f31ed5b39d800b95c937b4de5669d590febac18527415` |
| `midad_mining_provider_scout` | ACTIVE | 5 | false | `8085b04e4e30d7c0a552dfdd1839ccc036ec01c242b5fdb11fb6fa5c55fb9dd2` |
| `midad_model_gateway` | ACTIVE | 4 | false | `dc834f78a9404b4f5cbb4ce9f48810be3b803b9eaf88588e8e6039fece232d05` |
| `midad_model_gateway_v2` | ACTIVE | 4 | false | `b24aeabf5f7c6e512c5c06dadfaf47c1521ecb012ca13650b93e3b7073426bfa` |
| `midad_model_gateway_v3` | ACTIVE | 9 | false | `fbd7ed774a93a4280bdbedfade2e570aa2afc33dcc0da797b5826a76e26ffcca` |
| `midad_money_hunt` | ACTIVE | 26 | true | `29ad9f73e6a9699bd74842ce55ae7128c9f845434fd3400b928b37aa8ac46e01` |
| `midad_money_hunter` | ACTIVE | 57 | false | `94f8bbde366c37467d67b5c8dddd1533ae2e45c12d5fb08d5c2569fbd0019a79` |
| `midad_money_hunter_loop` | ACTIVE | 29 | false | `fab4b05fd0130c8b68eac7124ffb8e4b96a2151a5ebe347e58c19c1653aa44ae` |
| `midad_multichain_usdt_monitor` | ACTIVE | 6 | false | `7ad7f59a28014e5a16f95f0fb54450275268a3509cdb08a0054a21be491035f2` |
| `midad_native_wallet` | ACTIVE | 12 | false | `1abab45fdbe218e009437d6b1616be7afea3a95a7f810dea7528c7a55cd9d79a` |
| `midad_neural_core` | ACTIVE | 36 | false | `1996e04e55c295c980f91e4f74bf282e5d10bc1ce1f5dd4b7a304b15dae84250` |
| `midad_neural_evolution` | ACTIVE | 27 | false | `1b3d54869e5be8fc2411614dfe6d305d531a8be548e8831f513c02b5a7cd2ac9` |
| `midad_neural_status` | ACTIVE | 26 | false | `62a7c000817fe6053ab4c2cd9fb9674c5c2ce02597b34e3cac9ba6099b5e5ba4` |
| `midad_noncopy_trading_engine` | ACTIVE | 26 | false | `cb3983a774f60536b1ff96b596d7fc49f7bb861c535a5389ec931804965ada45` |
| `midad_omni_agent_gateway` | ACTIVE | 7 | false | `d2603df96a36f72be3a34aca60c99d0132df1ac9bd26f5d2f231fb84abe8c9bc` |
| `midad_opportunity_engine` | ACTIVE | 41 | false | `997b08d231869ff97bc3d309e5046a802d2549d72b575fa05f7f2797fafff6aa` |
| `midad_orchestrator` | ACTIVE | 49 | false | `33c27b1f610b56b89b4681d68c015c8d4b4d8df5d8167fc1f6e2a645b0c5a381` |
| `midad_osint_router` | ACTIVE | 33 | false | `e291664351ae0355e110f23bc18cb1e8ff51b62c6e395fb8ba01229273311cbb` |
| `midad_paid_revenue_feed` | ACTIVE | 7 | false | `329099865a5388b1d98f7e24b280760fcfdd2c71c4f4d3381f24a56792cddf44` |
| `midad_paper_trade_evaluator` | ACTIVE | 4 | false | `6373f9f1af3d88a2e930b40556b4f0f78389db14508b9536d223b126962bac8a` |
| `midad_payment_verifier` | ACTIVE | 41 | false | `8170a9ed65367682a6c80d422c405aa6befbd55024da181c6b59103f319c3099` |
| `midad_policy_engine` | ACTIVE | 32 | false | `c74f11c3a9cd6ef60b8eb43ffc3cdfbb5ee7eb32f80d983d38fc480125df63bd` |
| `midad_public_checkout` | ACTIVE | 25 | false | `9ab2b02c108783792228c315ac2cf175bb9bba2ac0d687c7a92e7b8bb05d7fff` |
| `midad_research_center` | ACTIVE | 31 | false | `5b6741de1b9143b85cdfda240680be676cd6d8fd160eb3aa91ebd595eaa90560` |
| `midad_revenue_autopilot` | ACTIVE | 23 | false | `010e6ce75fa0a1e4bb71af5b3b0c941f27e1f82043229af913cc3ffac2924524` |
| `midad_revenue_intel_research_worker` | ACTIVE | 8 | false | `e07ab861e2e45ff3ad649fed561e708de4d44748b0f5d1ae6003044446414d36` |
| `midad_revenue_intel_work_queue_worker` | ACTIVE | 10 | false | `2947c476602a13423913088c3d5dd776bca6a406fceb58e49c719b768806c0f4` |
| `midad_revenue_intelligence_mesh` | ACTIVE | 26 | false | `69688804c27d31ab5664753b450c8a046ece8aa1a9db647e7f2514f926adb139` |
| `midad_revenue_recovery` | ACTIVE | 27 | false | `3b6cba1d937c02bebe842e76d0aaa3a181754832cd8c4a7cbbf78508e05f489b` |
| `midad_settlement_router` | ACTIVE | 31 | false | `9f4becd04f8acb2a4a766c650804d8f9657368267ad037f979f5f770d4d567dc` |
| `midad_solana_usdc_full_readonly_check` | ACTIVE | 3 | false | `49a05427f1ff26997d48c0893907ba4d04697afb6799b2d0530916ac55b74e94` |
| `midad_solana_usdc_readonly_check` | ACTIVE | 6 | false | `637bc1a7f9f2b9a0458eaa603bbf05f3c9d13714b4f3fc5b405bcd60c4436ce9` |
| `midad_speedbot_fulfillment` | ACTIVE | 5 | false | `2fbba31fadc18e2a578fd7235e7143b4aeecdcb7eff7c45c744ae1caa3c0b8c4` |
| `midad_speedbot_poller` | ACTIVE | 10 | false | `c761129c6f175969e42967771e8d98b286a97bc735bf74f04c01caa9f2dfc878` |
| `midad_speedbot_target_executor` | ACTIVE | 8 | false | `b46c0e89095ae94726dad6471a7d2e02b17e20db33617def53493988842c57c2` |
| `midad_stackfull_probe` | ACTIVE | 5 | false | `883a0a9e9745f9210d2fddea92b7451b95e7076ff523d0b0f35f3aa4c9cc4e04` |
| `midad_store_fulfillment` | ACTIVE | 3 | true | `d76a0a82e6864a04e2c185779eeec5266e00336d786f6a64d5d359d03dcf9aad` |
| `midad_telegram_auth` | ACTIVE | 2 | false | `fa4558de1eb75da7b2377eea2d40006f93ee8b4a2925e44707b8a20b82c3fe7b` |
| `midad_telegram_bootstrap_once` | ACTIVE | 31 | false | `5c8ff563c5789b9eb8dd540a270e1e2575fdad78976d0d43771273aa98b6cca1` |
| `midad_telegram_poller` | ACTIVE | 32 | false | `94f1c3258e626afc7d132084c47afbde86f28bf51fdc4bbe2e8b430e2014369a` |
| `midad_telegram_repair_once` | ACTIVE | 34 | false | `cb173f8f922cd6881098022013bec6d5fc865f814b7d0d6d5d2289b1943fecd2` |
| `midad_telegram_router` | ACTIVE | 31 | false | `d3963a7e89716aaf17a53051331eaf2ba1a3e273070d70477ad131134fba2c1b` |
| `midad_trust_wallet_bridge` | ACTIVE | 6 | false | `4b2a64ee41e2f0e735904070d7fdacd24b12e2624d18da345498c0c7d875465d` |
| `midad_ugig_gateway` | ACTIVE | 31 | false | `1441c9e0ae88c226c58c1c1f7a8b6c595a6559a8e43fdad2019bcf167a2c6f39` |
| `midad_ugig_lifecycle` | ACTIVE | 8 | false | `8559a31c8c8c12c7041dcb690db5d3dfc3ae43c4619ccb09006ba00ec8cc3b27` |
| `midad_viabtc_monitor` | ACTIVE | 55 | false | `f9bcebc378fb1f7823a2a7147a00f0ebb88592c290af28d8b8a8caa8e0057cb8` |
| `midad_viabtc_monitor_bot` | ACTIVE | 28 | false | `6efa1e9cc5d6d02a2baa2c278464a6c1b46d12ae260b7328a40950dfbc3a42d1` |
| `midad_viabtc_public` | ACTIVE | 10 | false | `5e192b2784ad31ee235d75473c5ae7d932cc70ef37710f663d72f058d4e7659d` |
| `midad_wallet_receipt_monitor` | ACTIVE | 13 | false | `067f939d454c93e0272d2bd08b06ef4ed4a79f6f465986954ca8e7bbd9d071a7` |
| `signalscan_brain` | ACTIVE | 3 | false | `54185188f34c48c56238c4e2f14b8e9b65dba47c498f68d7cde4c5a5ff2c8d87` |
| `signalscan_brain_v3` | ACTIVE | 2 | false | `a48a1c80fa3afd9f918d345067ab5f0ee361f1b2e90c88f0aaf4cc1574efa3f8` |
| `signalscan_market_proxy` | ACTIVE | 2 | false | `5638621eab7fcb675088a7ae9c435f7308b7058244c4ba55a04c4985c2d1e9a8` |
| `signalscan_market_router` | ACTIVE | 5 | false | `ba90871cfcf68243c44c36e89c73a3aec96d9d8bd74f7730b99df7dcb1559c05` |
| `telegram_bot` | ACTIVE | 101 | false | `910014ecd7992a51b230696f215d305332a8dc81c401819057dab10f2831a1d2` |

### Live function slugs without repository source folders

- `generate_campaign` (deployed v53)
- `midad_account_factory` (deployed v13)
- `midad_agent_fee_wallet` (deployed v4)
- `midad_autonomy_loop` (deployed v43)
- `midad_bot_dispatcher` (deployed v15)
- `midad_bot_fabric` (deployed v13)
- `midad_bountybook_executor` (deployed v8)
- `midad_chain_intelligence` (deployed v38)
- `midad_client_gateway` (deployed v35)
- `midad_control_room` (deployed v103)
- `midad_control_room_app` (deployed v27)
- `midad_control_surface` (deployed v29)
- `midad_control_wallets` (deployed v25)
- `midad_curiosity_engine` (deployed v26)
- `midad_decision_counterfactual` (deployed v4)
- `midad_fast_cash_radar` (deployed v10)
- `midad_finance_autopilot` (deployed v8)
- `midad_finance_ledger_bridge` (deployed v4)
- `midad_finance_station` (deployed v5)
- `midad_first_mover_engine` (deployed v19)
- `midad_forge` (deployed v25)
- `midad_forge_coordinator` (deployed v25)
- `midad_human_bridge` (deployed v6)
- `midad_human_task_router` (deployed v30)
- `midad_hypothesis_lab` (deployed v27)
- `midad_iaitrader_bot` (deployed v20)
- `midad_iaitrader_station` (deployed v18)
- `midad_income_factory` (deployed v27)
- `midad_keys_bot` (deployed v30)
- `midad_keys_gateway` (deployed v26)
- `midad_keys_poller` (deployed v28)
- `midad_learning_engine` (deployed v30)
- `midad_live_status` (deployed v4)
- `midad_loop_runner` (deployed v8)
- `midad_market_edge` (deployed v30)
- `midad_market_ingest` (deployed v44)
- `midad_measure_outcomes` (deployed v42)
- `midad_meme_scout` (deployed v4)
- `midad_miner_repair_bridge` (deployed v4)
- `midad_miner_telemetry_ingest` (deployed v5)
- `midad_mining_provider_scout` (deployed v5)
- `midad_model_gateway` (deployed v4)
- `midad_model_gateway_v2` (deployed v4)
- `midad_money_hunt` (deployed v26)
- `midad_money_hunter` (deployed v57)
- `midad_money_hunter_loop` (deployed v29)
- `midad_native_wallet` (deployed v12)
- `midad_neural_core` (deployed v36)
- `midad_neural_status` (deployed v26)
- `midad_opportunity_engine` (deployed v41)
- `midad_orchestrator` (deployed v49)
- `midad_osint_router` (deployed v33)
- `midad_paid_revenue_feed` (deployed v7)
- `midad_paper_trade_evaluator` (deployed v4)
- `midad_policy_engine` (deployed v32)
- `midad_research_center` (deployed v31)
- `midad_revenue_intel_research_worker` (deployed v8)
- `midad_revenue_recovery` (deployed v27)
- `midad_settlement_router` (deployed v31)
- `midad_solana_usdc_full_readonly_check` (deployed v3)
- `midad_solana_usdc_readonly_check` (deployed v6)
- `midad_speedbot_poller` (deployed v10)
- `midad_stackfull_probe` (deployed v5)
- `midad_telegram_auth` (deployed v2)
- `midad_telegram_bootstrap_once` (deployed v31)
- `midad_telegram_poller` (deployed v32)
- `midad_telegram_repair_once` (deployed v34)
- `midad_telegram_router` (deployed v31)
- `midad_trust_wallet_bridge` (deployed v6)
- `midad_ugig_gateway` (deployed v31)
- `midad_ugig_lifecycle` (deployed v8)
- `midad_viabtc_monitor` (deployed v55)
- `midad_viabtc_monitor_bot` (deployed v28)
- `midad_viabtc_public` (deployed v10)
- `signalscan_brain` (deployed v3)
- `signalscan_brain_v3` (deployed v2)
- `signalscan_market_proxy` (deployed v2)
- `signalscan_market_router` (deployed v5)

## Applied database migration inventory

Applied migrations: 141; repository SQL files: 11; exact version+name filename matches: 4; live migrations without an exact filename match: 137.

| Version | Migration name | Exact repository filename match |
|---|---|:---:|
| `20260908230302` | `security_and_performance_hardening` | NO |
| `20260909000414` | `create_ai_assistant_bots` | NO |
| `20260910053340` | `midad_orchestration_money_engine_v1` | NO |
| `20260910141201` | `add_engine_run_metrics` | NO |
| `20260910141208` | `add_engine_run_metrics_indexes` | NO |
| `20260910141221` | `add_engine_run_metrics_indexes_v2` | NO |
| `20260910141230` | `midad_engine_hardening_v1` | NO |
| `20260910141244` | `engine_runs_provider_metrics_defaults` | NO |
| `20260910141253` | `engine_runs_latency_check` | NO |
| `20260910141301` | `midad_engine_schema_ready` | NO |
| `20260910141313` | `engine_runs_ready` | NO |
| `20260910141340` | `midad_engine_audit_v1` | NO |
| `20260911032941` | `midad_intelligence_fabric_v1` | NO |
| `20260915163647` | `add_midad_creative_intelligence_v1` | NO |
| `20260915163734` | `add_creative_template_name_unique` | NO |
| `20260915172728` | `extend_opportunities_for_engine_v1` | NO |
| `20260917010954` | `midad_learning_engine_v1` | NO |
| `20260917012455` | `midad_signal_outcomes_unique_horizon` | NO |
| `20260918033125` | `harden_analytics_rls` | NO |
| `20260918034320` | `midad_security_performance_hardening_v1` | NO |
| `20260918034752` | `midad_rls_initplan_hardening_v1` | NO |
| `20260918035930` | `midad_model_feedback_window_uniqueness_v1` | NO |
| `20260918040603` | `midad_learning_feedback_horizon_v1` | NO |
| `20260918040616` | `midad_learning_feedback_horizon_fix_v1` | NO |
| `20260918040903` | `midad_outcome_measurement_integrity_v1` | NO |
| `20260918042836` | `midad_sentinel_foundation_v1` | NO |
| `20260918042848` | `midad_sentinel_correlation_v1` | NO |
| `20260918042903` | `midad_sentinel_correlation_fix_v1` | NO |
| `20260918042924` | `midad_sentinel_graph_v1` | NO |
| `20260918042934` | `midad_sentinel_graph_fix_v1` | NO |
| `20260919023002` | `add_control_room_access` | NO |
| `20260919023018` | `add_control_room_sessions` | NO |
| `20260921011120` | `midad_control_room_capital_and_trade_layer` | NO |
| `20260921012447` | `midad_viabtc_monitor_layer` | NO |
| `20260921013539` | `telegram_native_control_room_auth` | NO |
| `20260921172807` | `midad_control_plane_v1_agent_client_payment_osint` | NO |
| `20260921172942` | `lock_control_room_to_authorized_telegram` | NO |
| `20260921173059` | `midad_client_thread_uniqueness` | NO |
| `20260921173313` | `midad_voice_osint_performance_v1` | NO |
| `20260921173630` | `midad_audit_log_v1` | NO |
| `20260921175856` | `midad_autonomy_scheduler_v1` | NO |
| `20260921181608` | `fix_signal_events_fingerprint_upsert_conflict` | NO |
| `20260923070640` | `security_deny_by_default_internal_tables_20260923` | NO |
| `20260923070735` | `add_midad_settlement_intents_20260923` | NO |
| `20260923074330` | `add_midad_human_tasks_20260923` | NO |
| `20260923180658` | `add_midad_fk_covering_indexes` | NO |
| `20260925043820` | `midad_money_hunter_cron` | NO |
| `20260926113617` | `miae_capability_delivery_gate_v1` | NO |
| `20260926113639` | `miae_capability_gate_refresh_scheduler_v1` | NO |
| `20260926113745` | `miae_capability_gate_rls_policies_v1` | NO |
| `20260926113935` | `miae_capability_gate_cover_human_review_v2` | NO |
| `20260926114100` | `miae_enforce_money_approval_trigger_v1` | NO |
| `20260926124716` | `miae_income_factory` | NO |
| `20260926125350` | `miae_revenue_recovery` | NO |
| `20260926155345` | `miae_plus_protect_open_approval_dedup` | NO |
| `20260927080336` | `create_newway_income_source_registry` | NO |
| `20260927080405` | `create_newway_discovery_log` | NO |
| `20260929144122` | `midad_forge_fabric_v1` | NO |
| `20261001010607` | `midad_financial_station_core_v1` | NO |
| `20261001012640` | `midad_autonomous_micro_trading_v1` | NO |
| `20261001014201` | `midad_bot_fabric_v1` | NO |
| `20261001014735` | `midad_finance_autopilot_cycles_v1` | NO |
| `20261001023943` | `midad_neural_finance_execution_v2` | NO |
| `20261001024035` | `midad_neural_execution_bus_v2` | NO |
| `20261001024223` | `midad_neural_execution_bus_v2b` | NO |
| `20261001041306` | `harden_midad_claim_bot_outbox_search_path_20261001` | NO |
| `20261001041332` | `add_current_fk_covering_indexes_20261001` | NO |
| `20261001162209` | `midad_miner_sensor_layer_20261001` | NO |
| `20261001162903` | `midad_miner_repair_bridge_20261001` | NO |
| `20261001182225` | `add_miner_worker_history` | NO |
| `20261001182242` | `capture_miner_worker_history` | NO |
| `20261002041613` | `harden_miner_worker_history_trigger_security_20261002` | NO |
| `20261002160525` | `create_midad_wallet_receipts` | NO |
| `20261002160706` | `schedule_midad_revenue_autopilot` | NO |
| `20261002160850` | `index_midad_wallet_receipts_job` | NO |
| `20261002161252` | `schedule_midad_revenue_autopilot_retry` | NO |
| `20261002171101` | `midad_treasury_wallet_signer_layer` | NO |
| `20261002184123` | `midad_wallet_connector_registry` | NO |
| `20261002184248` | `midad_wallet_primary_cdp_signer` | NO |
| `20261002192318` | `midad_native_signer_vault_bridge` | NO |
| `20261002192433` | `midad_native_signer_bootstrap` | NO |
| `20261002193026` | `midad_native_signer_security_cleanup` | NO |
| `20261002194504` | `midad_execution_command_gate` | NO |
| `20261002194648` | `midad_one_shot_signer_commands` | NO |
| `20261003005634` | `neural_core_findings_rpc` | NO |
| `20261003010823` | `wallet_receipt_mesh_and_fee_shield` | NO |
| `20261003010922` | `schedule_wallet_receipt_monitor` | NO |
| `20261003035556` | `add_midad_private_model_routes_provider_index_20261003` | NO |
| `20261006010306` | `create_midad_store_orders` | NO |
| `20261007055255` | `harden_handle_new_user_search_path_20261007` | NO |
| `20261007055727` | `make_client_deny_by_default_policies_explicit_20261007` | NO |
| `20261007061106` | `harden_midad_private_rls_explicit_deny_20261007` | NO |
| `20261007160050` | `add_midad_speedbot_fulfillment_tracking` | NO |
| `20261007172731` | `midad_browser_execution_plane_v1` | NO |
| `20261007175312` | `midad_human_bridge_v1` | NO |
| `20261008065626` | `widen_fact_check_capability_assessment` | NO |
| `20261010135132` | `midad_platform_account_factory_v1` | NO |
| `20261010135242` | `midad_platform_identity_policy_v1` | NO |
| `20261010135727` | `midad_account_factory_registry_seed_v1` | NO |
| `20261010140204` | `midad_account_factory_bot_fabric_routes_v1` | NO |
| `20261010141105` | `midad_platform_secret_vault_rpc_v1` | NO |
| `20261010141150` | `midad_superteam_agent_registration_support_v1` | NO |
| `20261010141237` | `midad_platform_secret_vault_idempotency_v1` | NO |
| `20261010141418` | `midad_superteam_agent_route_v1` | NO |
| `20261010141705` | `midad_superteam_agent_listings_route_v1` | NO |
| `20261010141909` | `midad_superteam_agent_listing_inspect_route_v1` | NO |
| `20261011020511` | `truthful_solana_wallet_monitor_status` | NO |
| `20261011180720` | `midad_meme_scout_v1` | NO |
| `20261011182720` | `midad_meme_scout_signal_fk_index` | NO |
| `20261012192621` | `fix_telegram_auth_access_session_rpc` | NO |
| `20261012192718` | `lock_telegram_session_rpc_to_service_role` | NO |
| `20261013044253` | `public_checkout_idempotency_20261013` | NO |
| `20261013044301` | `security_perf_hardening_20261013` | NO |
| `20261013151624` | `midad_fee_wallet_single_active_per_network` | NO |
| `20261013152236` | `harden_agent_fee_all_in_budget_guard` | NO |
| `20261015052441` | `control_room_dashboard_latency_indexes_20261015` | NO |
| `20261015091818` | `revenue_first_mover_query_indexes` | YES |
| `20261015093149` | `checkout_base_receipt_reconciliation` | NO |
| `20261015093159` | `fail_closed_paid_intent_requires_exact_chain_receipt` | NO |
| `20261015093818` | `extend_payment_truth_guard_to_public_checkout_quotes` | NO |
| `20261015203807` | `public_checkout_idempotency_20261013` | NO |
| `20261016021223` | `midad_fee_payment_owner_approval_reservation` | NO |
| `20261016021934` | `midad_fee_ledger_budget_accounting` | NO |
| `20261016134208` | `create_income_source_exclusion_archive` | NO |
| `20261018014631` | `add_primary_key_midad_income_sources_audit_20261016` | NO |
| `20261018024056` | `secure_income_sources_audit_archive_rls` | NO |
| `20261018034112` | `create_midad_revenue_intelligence_mesh` | NO |
| `20261018054348` | `extend_income_sources_for_mining_mesh_20261018` | NO |
| `20261019213956` | `schedule_midad_revenue_intel_work_queue_worker` | NO |
| `20261019225255` | `payment_reconciliation_chain_time_expiry_v1_20261020` | NO |
| `20261019231715` | `multi_asset_solana_stablecoin_receive_v1` | NO |
| `20261020000048` | `solana_sender_paid_ata_checkout_readiness_v1` | NO |
| `20261020000154` | `solana_sender_paid_ata_monitor_status_v1` | NO |
| `20261021045843` | `public_checkout_atomic_intent_order_20261021` | NO |
| `20261021092715` | `midad_store_fulfillment_v1` | YES |
| `20261021101605` | `midad_store_fulfillment_sha256_guard_v1` | YES |
| `20261021205012` | `midad_browser_evidence_ledger_v1` | NO |
| `20261021211816` | `midad_browser_smoke_auth_v1` | NO |
| `20261023121620` | `midad_authenticated_ops_dispatch_and_scheduler_status` | NO |
| `20261023121856` | `midad_ops_dispatch_timeout_by_action` | NO |
| `20261023163042` | `midad_revenue_intel_fk_indexes` | YES |

## Interpretation and next gates

- The migration filename match check is strict (version + migration name). A similarly named SQL file is not treated as an exact match.
- Do not replay the 141 applied migrations against production or blindly replay only the 11 repository SQL files on a new target.
- The live function metadata gives deployed version and source SHA-256. It is not a substitute for source files or a complete dependency lockfile.
- 78 live function slugs currently have no same-named source directory in the repository inventory. Retrieve their deployed source through the authenticated Supabase function-source interface, scan for hardcoded credentials, compare imports and environment-variable names, then archive only after secret scanning.
- The 4 functions with verify_jwt=true and 96 with verify_jwt=false require route-by-route auth review. false does not necessarily mean unauthenticated: some handlers implement their own auth. Preserve existing behavior and prove it by tests.
- Function source retrieval was tested on 10 high-value functions: control room, client gateway, checkout, payment verifier, Base USDC monitor, revenue autopilot, wallet receipt monitor, Telegram auth, browser gateway and finance autopilot. All 10 source bundles were returned. Their code uses Supabase SDK/credentials or direct Supabase DB connectivity, so database portability alone is insufficient.
- The source samples expose environment-variable *names* only; no secret values are included in this registry.
- No production deployment, schema change, resource provisioning, DNS update or cutover occurred.

## P1.2 Schema baseline

Generate a schema-only snapshot from the live catalog in a controlled export path. Include tables, columns, types, defaults, constraints, indexes, views, routines, triggers, policies, grants, ownership and extension dependencies. Exclude row data, auth secrets and Vault values. Compare the snapshot against the candidate target before any restore test.

## Deployed-source parity spot check (10 critical functions)

Source was retrieved from the live Supabase deployment and compared byte-for-byte with the repository copy for the six critical functions that already have source folders:

| Function | Live version | index.ts parity | Dependency-file parity |
|---|---:|---|---|
| midad_payment_verifier | 41 | EXACT | n/a |
| midad_base_usdc_monitor | 17 | EXACT | n/a |
| midad_revenue_autopilot | 23 | EXACT | finality.ts not yet compared |
| midad_public_checkout | 25 | DIFFERENT | route-policy.ts EXACT |
| midad_wallet_receipt_monitor | 13 | DIFFERENT | route-policy.ts DIFFERENT |
| midad_browser_agent_gateway | 12 | DIFFERENT | ledger.ts EXACT |

The four other source-retrieved critical functions (midad_control_room, midad_client_gateway, midad_telegram_auth, midad_finance_autopilot) have no same-named repository function directory in the current tree.

**Finding:** three of the six existing critical function entrypoints match live source exactly; three do not. Do not deploy repository copies of the mismatched functions. For each mismatch, preserve the deployed source as the reference, diff it against the repository version, and reconcile only after code review and secret scanning. The live deployment's SHA-256 metadata is the reference fingerprint.


 
## Additional database catalog and portability dependency capture (2026-11-03)

Read-only PostgreSQL catalog queries confirmed the following current counts:

| Catalog item | Count |
|---|---:|
| Public indexes | 459 |
| Public views | 2 |
| Public routines | 38 |
| Non-system routines across non-system schemas | 163 |
| Public SECURITY DEFINER routines | 28 |
| Public non-internal triggers | 7 |
| Public RLS policies | 147 |
| RLS-enabled public tables with no policy row | 30 |
| Active pg_cron jobs | 19 |
| Inactive pg_cron jobs | 8 |

The 30 RLS-enabled tables without policy rows remain **unclassified**, not presumed vulnerable; effective access depends on grants, ownership, service-role paths, and callers. No policy or grant changes were made.

### Runtime coupling confirmed

- Active cron jobs call Supabase Edge Functions through `net.http_post`; this is a material `pg_net` portability dependency.
- The current cron inventory includes 27 jobs; several inactive jobs are intentionally retained as inactive. In particular, `midad-finance-autopilot-5m` (job 18) remains inactive.
- Database routines referencing `net.http_*` include `midad_ops.dispatch_revenue_operation`, in addition to extension-owned routines.
- Vault-related routine names are present in public and internal schemas. No Vault values were read.
- Auth integration is present through the `auth` schema; function source also shows direct Supabase SDK/service-role dependencies. Keep Supabase Auth as provider 1 during initial portability work.

### Scheduler migration constraint

The target scheduler must not be activated while corresponding production cron jobs remain active. Migration requires an explicit single-writer handover, idempotency checks, observable dispatch receipts, and rollback to the existing scheduler. No cron jobs were changed.

### Capture limits

This section records catalog counts and dependency signals only. It is not a restorable DDL dump. Full object definitions, ownership/grants, policy expressions, routine bodies, and complete migration history still require a secure export/archive path. No production data, Auth credentials, or Vault values were exported.

 
### Additional scheduler counts

A second aggregate query confirmed 17 of the 19 active cron jobs use `net.http_*` and dispatch to Edge Functions; all 8 inactive jobs also contain `net.http_*` references. Total jobs: 27. This makes the `pg_net` replacement a high-priority compatibility workstream, not an optional cleanup.

### Revenue-critical function source retrieval checkpoint

Five live sources were retrieved from Supabase and scanned in-memory. The pattern scan was clear for private-key blocks, common provider-token formats, literal JWTs, and generic secret assignments. Only environment variable **names** were recorded:

| Function | Live version | Deployed SHA-256 | Environment variable names |
|---|---:|---|---|
| `midad_income_factory` | 27 | `9f6e86e907aa55361f484d5ebb7c98987966ed8c5700e28132ea7d0e8ced2757` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `midad_money_hunter` | 57 | `94f8bbde366c37467d67b5c8dddd1533ae2e45c12d5fb08d5c2569fbd0019a79` | `SUPABASE_SERVICE_ROLE_KEY`, `MIDAD_INGEST_KEY`, `MIDAD_AUTONOMY_KEY`, `SUPABASE_URL` |
| `midad_paid_revenue_feed` | 7 | `329099865a5388b1d98f7e24b280760fcdd2c71c4f4d3381f24a56792cddf44` | `SUPABASE_DB_URL` |
| `midad_revenue_recovery` | 27 | `3b6cba1d937c02bebe842e76d0aaa3a181754832cd8c4a7cbbf78508e05f489b` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `midad_opportunity_engine` | 41 | `997b08d231869ff97bc3d309e5046a802d2549d72b575fa05f7f2797fafff6aa` | `MIDAD_INGEST_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` |

Runtime imports: four functions use `jsr:@supabase/supabase-js@2`; `midad_paid_revenue_feed` uses PostgreSQL and x402/Hono packages. Source archival to the repository was blocked by the connected write safety gate; **these five source files have not been committed**. Retrieval and scan do not constitute approval to deploy.

 
### Constraint, ownership, and policy metadata refinement

A direct `pg_catalog` query provides the authoritative constraint breakdown for `public`:

| Constraint type | Count |
|---|---:|
| Primary keys | 152 |
| Foreign keys | 132 |
| Unique constraints | 73 |
| Check constraints | 215 |
| **Total** | **572** |

All 152 public tables are owned by `postgres`. Public routines: 38 (31 PL/pgSQL, 7 SQL); 28 are SECURITY DEFINER. Policy command counts: ALL 115, SELECT 17, INSERT 7, UPDATE 5, DELETE 3. Policy role counts overlap because policies can target multiple roles: authenticated 124, anon 89, public 13.

**Reconciliation note:** the earlier verbose table-metadata response yielded a summed foreign-key count of 234, which does not reconcile with the direct catalog count of 132. Use the direct `pg_constraint` count (132) and total 572 as the authoritative values for this registry; the metadata endpoint's foreign-key aggregate requires separate validation before relying on it.

The 28 SECURITY DEFINER routines and Vault-related functions are portability/security-critical. Their bodies and EXECUTE grants must be captured and reviewed before migration. No grants, owners, policies, or routine definitions were changed.

 
### Repository archive verification

A post-write comparison against live Supabase source confirms that these two recovered files are present on this branch and byte-for-byte identical to their deployed entrypoints:

- `supabase/functions/midad_income_factory/index.ts` — live v27, exact match, 9,996 characters, secret-pattern scan CLEAR.
- `supabase/functions/midad_money_hunter/index.ts` — live v57, exact match, 63,862 characters, secret-pattern scan CLEAR.

The other three retrieved sources (`midad_paid_revenue_feed`, `midad_revenue_recovery`, `midad_opportunity_engine`) were **not** found in the branch after the write attempt. Do not treat them as archived. No production deployment was performed. The two archived functions remain recovery baselines only; deployment requires dependency review and tests.

 
### Revenue/fulfillment source retrieval batch 2

Five additional live functions were retrieved and scanned. Pattern scan status was CLEAR for the same private-key, common provider-token, literal-JWT, and generic secret-assignment patterns. These are **retrieved in this session but not archived in the repository**:

| Function | Version | SHA-256 | Files / total source chars | Runtime / environment dependencies |
|---|---:|---|---|---|
| `midad_money_hunter_loop` | 29 | `fab4b05fd0130c8b68eac7124ffb8e4b96a2151a5ebe347e58c19c1653aa44ae` | 1 / 2,041 | Supabase JS; `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` |
| `midad_money_hunt` | 26 | `29ad9f73e6a9699bd74842ce55ae7128c9f845434fd3400b928b37aa8ac46e01` | 1 / 4,090 | Supabase JS; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `midad_store_fulfillment` | 3 | `d76a0a82e6864a04e2c185779eeec5266e00336d786f6a64d5d359d03dcf9aad` | 2 / 17,656 | Supabase JS, PostgreSQL; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` |
| `midad_revenue_intelligence_mesh` | 26 | `69688804c27d31ab5664753b450c8a046ece8aa1a9db647e7f2514f926adb139` | 6 / 83,511 | PostgreSQL; `SUPABASE_DB_URL` |
| `midad_revenue_intel_work_queue_worker` | 10 | `2947c476602a13423913088c3d5dd776bca6a406fceb58e49c719b768806c0f4` | 4 / 55,036 | PostgreSQL; `SUPABASE_DB_URL` |

The two PostgreSQL-heavy revenue workers have multiple local modules; source archival must preserve every file and relative import. Their database dependency is direct PostgreSQL rather than the Supabase JS SDK. This batch increases the retrieved-but-not-archived source inventory; do not treat it as repository recovery or deployment approval.


### Privilege and SECURITY DEFINER review (read-only catalog, 2026-11-03)

A read-only ACL/RLS cross-check found:
- `anon` has table ACL entries on 83 public tables; all 83 have RLS enabled, and none has zero policy rows.
- No public table with an `anon` ACL was found with RLS disabled.
- `information_schema.table_privileges` reports 84 `anon` table-privilege entries per common DML privilege; this differs from the 83 base-table ACL count because the views expose a different object scope. Do not treat these counts as interchangeable.
- 28 public SECURITY DEFINER routines were enumerated. Every one of the 28 has a non-owner EXECUTE grant to `service_role`; the review did not find `anon` or `authenticated` among their non-owner EXECUTE grantees.
- The 28 routines' effective `search_path` settings were captured for review. Most pin `pg_catalog`;`public` (sometimes `vault` or `midad_private`). Exceptions requiring source-level review before portability include `midad_agent_fee_reserve_request` (`public, pg_temp`), `midad_sentinel_build_graph` and `midad_sentinel_correlate` (`public` only), and Vault helper routines whose path begins with `vault` or `public`.
- Installed extension versions: `pg_cron 1.6.4`, `pg_net 0.20.4`, `pg_stat_statements 1.11`, `pgcrypto 1.3`, `plpgsql 1.0`, `supabase_vault 0.3.1`, `uuid-ossp 1.1`.
- Default ACL metadata exists across `public`, `auth`, `storage`, `realtime`, `graphql`, `graphql_public`, `cron`, and `extensions` schemas.

Interpretation: broad table ACLs do not by themselves prove public data exposure; RLS is enabled for every `anon`-granted base table found in this check. This is a metadata-only review, not a policy-expression audit or penetration test. Do not change grants, policies, routine ownership, or `search_path` during portability inventory. Before moving SECURITY DEFINER routines, review their complete bodies, EXECUTE grants, search-path safety, and dependencies.


### Parallel operational snapshot — 2026-11-03 (mobile/API-only, read-only)

This snapshot was gathered through connected GitHub, Supabase, Railway, and Notion integrations without a desktop terminal.

**GitHub / CI**
- Repository is public, writable by the connected identity, and not archived.
- PR #170 remains open and draft; its head commit is `78b4b50313b7069ad23c8aa8052dd0846e878dbf`.
- Two workflow runs associated with that head completed successfully: `MIDAD FIX Contract` and `MIDAD Control Room Verify`. The combined commit-status endpoint returned no status contexts; the workflow-run results are the positive evidence.
- Branch comparison: 13 commits ahead of `main`, 0 behind.

**Supabase runtime**
- Project status `ACTIVE_HEALTHY`; PostgreSQL 17.11.
- Current Edge Function inventory: 100 functions, all 100 `ACTIVE`.
- Applied migration inventory: 141.
- Selected deployed function versions remain: public checkout v25, payment verifier v41, wallet receipt monitor v13, revenue autopilot v23, income factory v27, opportunity engine v41, money hunter v57. This inventory is not a source parity claim.

**Revenue conversion — live row counts**
- `opportunities`: 209,647; `midad_income_discoveries`: 121 (15 candidate, 102 discovered, 4 stale); `midad_income_sources`: 43.
- `leads`: 10 (6 `qualified_target`, 4 `human_review`).
- `midad_payment_intents`: 6 (all expired/cancelled); `midad_store_orders`: 4 (all CANCELLED); `midad_payment_events`: 0; `midad_wallet_receipts`: 0; `midad_income_source_evidence`: 0.
- No income source currently has `payout_proof_status=verified` in the sampled source registry. Two sources have official policy documented, but payout proof remains unverified. Several marketplace rows are explicitly blocked for unverified payout, account health, security risk, or upfront cost.
- This confirms that opportunity volume is not the blocker to verified income. The immediate operational gap is source-level payout proof plus conversion from qualified lead to a valid checkout, verified payment event, receipt, and delivery.

**Function activity — latest 24-hour log window**
- `midad_payment_verifier`: 86 requests, all HTTP 200, average execution 566.6 ms.
- `midad_wallet_receipt_monitor`: 23 requests, all HTTP 200, average execution 3,612 ms.
- `midad_revenue_autopilot`: 4 requests, all HTTP 200, average execution 4,550.2 ms.
- No `midad_public_checkout` requests appeared in the targeted 24-hour function-edge-log query. HTTP 200 proves handler responses, not successful payment settlement; the database still contains zero payment events and zero wallet receipts.

**Alternative orchestration / hosting**
- Four connected Railway account links returned zero accessible projects. No Railway service is available as a verified target from these connections.
- Both available n8n connector routes failed internally during workflow discovery; no workflow state was changed.
- Notion governance records confirm the priority is conversion and verified crypto receipts, not feature proliferation or raw opportunity counts.

**Next execution priority**
1. Inspect the six existing payment intents and four cancelled orders by non-sensitive status/reason metadata only; do not expose customer PII or wallet addresses.
2. Trace the public checkout route and its invocation/authentication path; the absence of checkout requests is a stronger lead than adding more opportunity discovery.
3. Select at most a small number of income sources for official payout verification, prioritizing existing active accounts and zero-upfront-cost paths.
4. Preserve all production state; no DDL, ACL, cron, financial, or deployment changes were made in this snapshot.
