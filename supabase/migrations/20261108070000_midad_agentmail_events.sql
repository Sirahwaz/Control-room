create table if not exists public.midad_agentmail_events (
  event_id text primary key,
  event_type text not null,
  inbox_id text not null,
  message_id text not null,
  thread_id text,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_midad_agentmail_events_status_received
  on public.midad_agentmail_events (status, received_at desc);

alter table public.midad_agentmail_events enable row level security;

drop policy if exists "deny_client_access_midad_agentmail_events"
  on public.midad_agentmail_events;
create policy "deny_client_access_midad_agentmail_events"
  on public.midad_agentmail_events
  for all
  to anon, authenticated
  using (false)
  with check (false);

comment on table public.midad_agentmail_events is
  'Minimal idempotency and processing ledger for verified AgentMail webhook events. Email body content is not stored here.';
