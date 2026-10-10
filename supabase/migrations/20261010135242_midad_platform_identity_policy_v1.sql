alter table public.midad_platform_registry
  add column if not exists identity_policy jsonb not null
    default '{"status":"unknown","kyc_required":"unknown","government_id_required":"unknown"}'::jsonb;

comment on column public.midad_platform_registry.identity_policy is
  'Evidence-backed KYC/identity policy. Unknown is a hard review state; do not bypass required identity checks.';
