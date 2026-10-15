insert into public.midad_service_routes
(route_key,source_bot_key,destination_service,action,risk_class,human_gate,enabled,metadata)
values
('account_factory_platforms_list','aimidad_bot','midad_account_factory','list_platforms','low',false,true,
 '{"purpose":"list MIDAD-approved platform candidates and evidence-backed policy status","external_write":false}'),
('account_factory_platform_assess','aimidad_bot','midad_account_factory','assess_platform','low',false,true,
 '{"purpose":"evaluate payout, identity, region, and automation gates for one platform","external_write":false}'),
('account_factory_profile_prepare','aimidad_bot','midad_account_factory','prepare_profile','low',false,true,
 '{"purpose":"prepare a truthful platform-specific draft without publishing it externally","external_write":false}'),
('account_factory_onboarding_queue','ahwazai_bot','midad_account_factory','queue_onboarding','medium',true,true,
 '{"purpose":"queue authorized browser onboarding only after all policy gates pass","external_write":"prepare_only","human_gate_for_terms_and_verification":true}'),
('account_factory_accounts_list','control_room','midad_account_factory','list_accounts','low',false,true,
 '{"purpose":"read MIDAD platform-account registry","external_write":false}'),
('account_factory_runs_list','control_room','midad_account_factory','list_runs','low',false,true,
 '{"purpose":"inspect account factory job history and blockers","external_write":false}')
on conflict (route_key) do update set
 source_bot_key=excluded.source_bot_key,
 destination_service=excluded.destination_service,
 action=excluded.action,
 risk_class=excluded.risk_class,
 human_gate=excluded.human_gate,
 enabled=excluded.enabled,
 metadata=excluded.metadata,
 updated_at=now();
