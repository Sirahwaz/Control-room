alter table public.midad_platform_registry
  add column if not exists payout_policy jsonb not null
    default '{"mode":"unknown","status":"unknown","assets":[],"networks":[]}'::jsonb,
  add column if not exists payout_policy_evidence jsonb not null default '[]'::jsonb,
  add column if not exists policy_checked_at timestamptz;

create table if not exists public.midad_platform_accounts (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null,
  owner_scope text not null default 'midad',
  brand_key text not null default 'midad_ai',
  platform_account_ref text,
  public_profile_url text,
  login_identity_ref text,
  credential_vault_ref text,
  browser_provider_key text,
  browser_profile_ref text,
  account_status text not null default 'PROFILE_DRAFT'
    check (account_status in ('DISCOVERED','POLICY_REVIEW','PROFILE_DRAFT','READY_FOR_REGISTRATION','REGISTRATION_PENDING','HUMAN_CHECKPOINT','REGISTERED_UNVERIFIED','ACTIVE','BLOCKED','REJECTED','SUSPENDED','CLOSED')),
  profile_payload jsonb not null default '{}'::jsonb,
  payout_policy_snapshot jsonb not null default '{}'::jsonb,
  verification_snapshot jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  last_error_code text,
  last_error_detail text,
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform_key, owner_scope, brand_key)
);
create index if not exists idx_midad_platform_accounts_status on public.midad_platform_accounts(account_status, updated_at desc);
create index if not exists idx_midad_platform_accounts_scope on public.midad_platform_accounts(owner_scope, brand_key, platform_key);

create table if not exists public.midad_account_factory_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  account_id uuid references public.midad_platform_accounts(id) on delete set null,
  platform_key text not null,
  task_type text not null,
  agent_key text not null default 'midad_account_factory',
  state text not null default 'QUEUED'
    check (state in ('QUEUED','RESEARCHING_POLICY','POLICY_REVIEW','PROFILE_PREPARED','REGISTRATION_QUEUED','RUNNING','HUMAN_CHECKPOINT','BLOCKED','FAILED','COMPLETED','CANCELLED')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  browser_job_id uuid,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  next_action text,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_midad_account_factory_runs_state on public.midad_account_factory_runs(state, updated_at desc);
create index if not exists idx_midad_account_factory_runs_platform on public.midad_account_factory_runs(platform_key, created_at desc);
create index if not exists idx_midad_account_factory_runs_account on public.midad_account_factory_runs(account_id, created_at desc);

create table if not exists public.midad_platform_account_events (
  id uuid primary key default gen_random_uuid(),
  event_key text unique,
  account_id uuid references public.midad_platform_accounts(id) on delete set null,
  run_id uuid references public.midad_account_factory_runs(id) on delete set null,
  platform_key text not null,
  actor_key text not null,
  event_type text not null,
  from_state text,
  to_state text,
  evidence jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_midad_platform_account_events_account on public.midad_platform_account_events(account_id, created_at desc);
create index if not exists idx_midad_platform_account_events_platform on public.midad_platform_account_events(platform_key, created_at desc);

alter table public.midad_platform_accounts enable row level security;
alter table public.midad_account_factory_runs enable row level security;
alter table public.midad_platform_account_events enable row level security;

revoke all on public.midad_platform_accounts from anon, authenticated;
revoke all on public.midad_account_factory_runs from anon, authenticated;
revoke all on public.midad_platform_account_events from anon, authenticated;
grant select, insert, update, delete on public.midad_platform_accounts to service_role;
grant select, insert, update, delete on public.midad_account_factory_runs to service_role;
grant select, insert, update, delete on public.midad_platform_account_events to service_role;

comment on table public.midad_platform_accounts is 'MIDAD brand accounts on external platforms. Public profile data and vault/browser references only; never store passwords, tokens, recovery codes or identity documents.';
comment on table public.midad_account_factory_runs is 'Durable onboarding tasks. A queued run is not proof that an external action completed.';
comment on table public.midad_platform_account_events is 'Operational audit history for platform onboarding and policy decisions.';
comment on column public.midad_platform_accounts.credential_vault_ref is 'Reference only; secret must remain in designated vault/provider.';
comment on column public.midad_platform_accounts.login_identity_ref is 'Reference to approved login identity; never store password, OTP, recovery code, or private key.';
