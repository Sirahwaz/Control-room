update public.midad_platform_registry
set allowed_automation = coalesce(allowed_automation, '{}'::jsonb) ||
  '{"agent_api_registration":true,"agent_api_registration_source":"official_superteam_agent_api"}'::jsonb,
    notes = coalesce(notes,'') ||
      ' Official agent API registration is documented separately from human talent-profile onboarding. Registered agents still require human claim for payout eligibility; each listing/payout must be screened for KYC and identity requirements.',
    updated_at = now()
where platform_key = 'superteam_fun';

insert into public.midad_platform_account_events
  (event_key, account_id, platform_key, actor_key, event_type, from_state, to_state, evidence, details)
select
  'policy:superteam-agent-api-registration-v1',
  a.id,
  'superteam_fun',
  'midad_platform_policy_verifier',
  'agent_api_registration_policy_verified',
  a.account_status,
  a.account_status,
  '[{"url":"https://superteam.fun/earn/agents","official":true,"claim":"Official agent API documents POST /api/agents registration; payout claim remains human-operated","checked_at":"2026-10-10"}]'::jsonb,
  '{"registration_scope":"agent_identity_only","payout_status":"not_claimed","kyc_gate":"listing_specific_human_gate","external_registration_started":false}'::jsonb
from public.midad_platform_accounts a
where a.platform_key='superteam_fun' and a.owner_scope='midad' and a.brand_key='midad_ai'
on conflict (event_key) do nothing;
