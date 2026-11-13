create table if not exists public.midad_outreach_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text not null check (email = lower(btrim(email))),
  reason text,
  source text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists midad_outreach_suppressions_user_email_uidx
  on public.midad_outreach_suppressions (user_id, email);

alter table public.midad_outreach_suppressions enable row level security;

drop policy if exists midad_outreach_suppressions_owner_access
  on public.midad_outreach_suppressions;

create policy midad_outreach_suppressions_owner_access
  on public.midad_outreach_suppressions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.midad_outreach_suppressions from anon;
grant select, insert, update, delete on public.midad_outreach_suppressions to authenticated;
grant all on public.midad_outreach_suppressions to service_role;
