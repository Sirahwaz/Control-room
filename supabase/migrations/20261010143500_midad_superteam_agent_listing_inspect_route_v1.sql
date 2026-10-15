insert into public.midad_service_routes
(route_key,source_bot_key,destination_service,action,risk_class,human_gate,enabled,metadata)
values
('account_factory_superteam_agent_listing_inspect','aimidad_bot','midad_account_factory','inspect_agent_listing','low',false,true,
 '{"purpose":"fetch official detailed listing contract and verify payout/KYC/language/deliverability blockers","external_write":false,"submission_enabled":false}')
on conflict (route_key) do update set
 source_bot_key=excluded.source_bot_key,
 destination_service=excluded.destination_service,
 action=excluded.action,
 risk_class=excluded.risk_class,
 human_gate=excluded.human_gate,
 enabled=excluded.enabled,
 metadata=excluded.metadata,
 updated_at=now();