insert into public.midad_service_routes
(route_key,source_bot_key,destination_service,action,risk_class,human_gate,enabled,metadata)
values
('account_factory_register_superteam_agent','ahwazai_bot','midad_account_factory','register_agent_identity','medium',true,true,
 '{"purpose":"create one MIDAD autonomous-agent identity through the official Superteam agent API","owner_approval_required":true,"external_account_creation":true,"no_listing_submission":true,"no_wallet_signature":true,"payout_claim_requires_human":true}')
on conflict (route_key) do update set
 source_bot_key=excluded.source_bot_key,
 destination_service=excluded.destination_service,
 action=excluded.action,
 risk_class=excluded.risk_class,
 human_gate=excluded.human_gate,
 enabled=excluded.enabled,
 metadata=excluded.metadata,
 updated_at=now();
