insert into public.midad_platform_registry
(platform_key,name,base_url,category,monetization_models,supported_regions,supported_actions,registration_level,verification_requirements,allowed_automation,forbidden_automation,status,notes,payout_policy,payout_policy_evidence,policy_checked_at,identity_policy)
values
('laborx','LaborX','https://laborx.com','crypto_freelance_marketplace',
 array['freelance','gigs','digital_contracts'],array['global'],
 array['research','profile_prepare','profile_fill','opportunity_apply','service_publish','payment_monitoring'],'account',
 '{"kyc":"unknown","government_id":"unknown","captcha":"possible","2fa":"possible","region_eligibility":"must_verify"}'::jsonb,
 '{"research":true,"profile_prepare":true,"profile_fill":true,"registration_prepare":false,"automated_submission":false}'::jsonb,
 '{"spam":true,"captcha_bypass":true,"2fa_bypass":true,"kyc_bypass":true,"false_claims":true,"impersonation":true}'::jsonb,
 'candidate','Crypto payment support confirmed from official LaborX material. Identity/KYC and automation rules require separate official verification before onboarding.',
 '{"mode":"crypto_available","status":"verified","assets":["BTC","ETH","USDT","USDC"],"networks":["Ethereum","BNB Smart Chain","TRON","Polygon"],"last_checked":"2026-10-10"}'::jsonb,
 '[{"url":"https://laborx.com/blog/a-beginners-guide-to-using-laborx","official":true,"claim":"LaborX describes crypto payments and wallet-based crypto receipt","checked_at":"2026-10-10"}]'::jsonb,
 now(),'{"status":"unknown","kyc_required":"unknown","government_id_required":"unknown","region_eligibility":"unknown"}'::jsonb),
('ugig','uGig','https://ugig.net','crypto_agent_work_marketplace',
 array['agent_work','gigs','freelance'],array['global'],
 array['research','profile_prepare','profile_fill','opportunity_apply','service_publish','invoice_prepare','payment_monitoring'],'account',
 '{"kyc":"unknown","government_id":"unknown","captcha":"possible","2fa":"possible","region_eligibility":"must_verify"}'::jsonb,
 '{"research":true,"profile_prepare":true,"profile_fill":true,"registration_prepare":false,"api_workflows":"documented"}'::jsonb,
 '{"spam":true,"captcha_bypass":true,"2fa_bypass":true,"kyc_bypass":true,"false_claims":true,"impersonation":true}'::jsonb,
 'candidate','Official CLI docs document crypto invoices including USDC on Polygon and BTC. Account identity/KYC requirements remain unverified.',
 '{"mode":"crypto_available","status":"verified","assets":["USDC","BTC"],"networks":["Polygon","Bitcoin"],"last_checked":"2026-10-10"}'::jsonb,
 '[{"url":"https://ugig.net/docs/cli","official":true,"claim":"Official CLI payment documentation includes USDC on Polygon and BTC invoice routes","checked_at":"2026-10-10"}]'::jsonb,
 now(),'{"status":"unknown","kyc_required":"unknown","government_id_required":"unknown","region_eligibility":"unknown"}'::jsonb),
('bountybook','BountyBook','https://www.bountybook.ai','crypto_agent_bounty_marketplace',
 array['bounties','agent_work'],array['global'],
 array['research','profile_prepare','submission_prepare','payment_monitoring'],'wallet_account',
 '{"kyc":"unknown","government_id":"unknown","wallet_signature":"required_for_claim","region_eligibility":"must_verify"}'::jsonb,
 '{"research":true,"profile_prepare":true,"submission_prepare":true,"registration_prepare":false,"wallet_signing":"human_gate"}'::jsonb,
 '{"spam":true,"captcha_bypass":true,"2fa_bypass":true,"kyc_bypass":true,"false_claims":true,"impersonation":true,"unapproved_wallet_signature":true,"external_spend":true}'::jsonb,
 'candidate','Official marketplace states USDC escrow and oracle-verified USDC payout on Base. Experimental beta; no claim/signature initiated by this seed.',
 '{"mode":"crypto_available","status":"verified","assets":["USDC"],"networks":["Base"],"success_fee_pct":4,"entry_fee_for_claiming":"0","experimental_beta":true,"last_checked":"2026-10-10"}'::jsonb,
 '[{"url":"https://www.bountybook.ai/","official":true,"claim":"Official marketplace describes escrowed USDC, oracle-verified payout, and success fee","checked_at":"2026-10-10"},{"url":"https://www.bountybook.ai/job/55a56167-d741-434f-8f4c-605c2adfc23f","official":true,"claim":"An official live listing documents Base-chain work and instant USDC payout","checked_at":"2026-10-10"}]'::jsonb,
 now(),'{"status":"unknown","kyc_required":"unknown","government_id_required":"unknown","region_eligibility":"unknown"}'::jsonb),
('superteam_fun','Superteam Earn','https://superteam.fun/earn','crypto_bounty_marketplace',
 array['bounties','freelance_gigs','grants'],array['global'],
 array['research','profile_prepare','draft_submission','opportunity_apply','status_monitoring','payment_monitoring'],'talent_profile',
 '{"kyc":"unknown","government_id":"unknown","human_verification":"possible","region_eligibility":"must_verify"}'::jsonb,
 '{"research":true,"profile_prepare":true,"profile_fill":true,"draft_submission":true,"registration_prepare":false,"final_submission":"human_gate","payout_claim":"human_gate"}'::jsonb,
 '{"spam":true,"captcha_bypass":true,"2fa_bypass":true,"kyc_bypass":true,"false_claims":true,"impersonation":true,"unapproved_final_submission":true}'::jsonb,
 'candidate','Official Superteam Earn page advertises crypto-denominated opportunities such as USDC/USDG. Agent eligibility and human payout claim constraints must be observed. Identity/KYC requirements remain unverified.',
 '{"mode":"crypto_available","status":"verified","assets":["USDC","USDG"],"networks":[],"last_checked":"2026-10-10"}'::jsonb,
 '[{"url":"https://superteam.fun/earn/","official":true,"claim":"Official Earn marketplace displays USDC/USDG-denominated opportunities and crypto earning workflow","checked_at":"2026-10-10"},{"url":"https://superteam.fun/earn/agents","official":true,"claim":"Official agent eligibility rules require a human to claim an agent for payouts and do not delegate OAuth, wallet signing, or KYC to agents","checked_at":"2026-10-10"}]'::jsonb,
 now(),'{"status":"unknown","kyc_required":"unknown","government_id_required":"unknown","region_eligibility":"unknown"}'::jsonb)
on conflict (platform_key) do update set
 name=excluded.name,base_url=excluded.base_url,category=excluded.category,
 monetization_models=excluded.monetization_models,supported_regions=excluded.supported_regions,
 supported_actions=excluded.supported_actions,registration_level=excluded.registration_level,
 verification_requirements=excluded.verification_requirements,allowed_automation=excluded.allowed_automation,
 forbidden_automation=excluded.forbidden_automation,status=excluded.status,notes=excluded.notes,
 payout_policy=excluded.payout_policy,payout_policy_evidence=excluded.payout_policy_evidence,
 policy_checked_at=excluded.policy_checked_at,identity_policy=excluded.identity_policy,updated_at=now();

insert into public.midad_agent_identities (agent_key,name,role,trust_level,status,metadata)
values
('midad_account_factory','MIDAD Account & Profile Factory','account_factory','scoped','active',
 '{"purpose":"prepare_and_track_legitimate_MIDAD_brand_platform_accounts","evidence_first":true,"provider_agnostic":true,"duplicate_prevention":true,"payout_gate":"crypto_required","kyc_gate":"no_government_id_or_mandatory_kyc","human_gate_for_terms_and_verification":true,"external_account_creation_requires_platform_policy_pass":true}'),
('midad_platform_scout','MIDAD Platform Scout','platform_discovery','scoped','active',
 '{"purpose":"discover_and_rank_platforms_for_MIDAD_brand","evidence_first":true,"official_sources_required":true,"payout_policy_evidence_required":true,"no_duplicate_accounts":true}'),
('midad_platform_policy_verifier','MIDAD Platform Policy Verifier','policy_verifier','scoped','active',
 '{"purpose":"verify_crypto_payout_identity_region_and_automation_requirements","evidence_first":true,"unknown_means_review":true,"hard_block_mandatory_kyc":true,"hard_block_fiat_only_payout":true}')
on conflict (agent_key) do update set
 name=excluded.name,role=excluded.role,trust_level=excluded.trust_level,
 status=excluded.status,metadata=excluded.metadata,updated_at=now();
