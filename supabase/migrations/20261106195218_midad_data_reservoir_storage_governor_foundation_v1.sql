create schema if not exists midad_private;

create table if not exists midad_private.midad_storage_config (
  singleton boolean primary key default true check (singleton),
  db_target_bytes bigint not null default 367001600,
  warning_bytes bigint not null default 367001600,
  critical_bytes bigint not null default 445644800,
  emergency_bytes bigint not null default 498073600,
  project_quota_bytes bigint null,
  archive_provider text not null default 'upload.am',
  archive_enabled boolean not null default false,
  auto_delete_enabled boolean not null default false check (auto_delete_enabled = false),
  emergency_throttle_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

insert into midad_private.midad_storage_config(singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists midad_private.midad_storage_metrics (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  database_bytes bigint not null check (database_bytes >= 0),
  database_mib numeric(14,2) not null,
  project_quota_bytes bigint null,
  quota_usage_pct numeric(8,3) null,
  read_only boolean not null,
  dead_tuples bigint not null default 0,
  top_tables jsonb not null default '[]'::jsonb,
  archive_provider text not null default 'upload.am',
  archive_status text not null default 'NOT_CONFIGURED',
  archive_used_bytes bigint null,
  archive_limit_bytes bigint null,
  archive_usage_pct numeric(8,3) null,
  storage_state text not null check (storage_state in ('NORMAL','WARNING','CRITICAL','EMERGENCY')),
  action_recommended text not null,
  details jsonb not null default '{}'::jsonb
);

create index if not exists midad_storage_metrics_captured_idx
  on midad_private.midad_storage_metrics(captured_at desc);

create table if not exists midad_private.midad_storage_policies (
  retention_class text primary key,
  description text not null,
  archive_after_days integer null check (archive_after_days is null or archive_after_days >= 0),
  keep_hot_days integer null check (keep_hot_days is null or keep_hot_days >= 0),
  immutable boolean not null default false,
  archive_enabled boolean not null default false,
  auto_delete_enabled boolean not null default false check (auto_delete_enabled = false),
  require_checksum boolean not null default true,
  require_restore_test boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into midad_private.midad_storage_policies
  (retention_class,description,archive_after_days,keep_hot_days,immutable,archive_enabled,auto_delete_enabled)
values
  ('financial_immutable','Payments, wallet receipts, ledgers, orders, approvals and settlement evidence',null,null,true,false,false),
  ('paid_revenue_evidence','Evidence and outcomes connected to paid or revenue-critical opportunities',30,30,true,false,false),
  ('learning_outcomes','Signal outcomes, decision feedback and training/evaluation results',30,30,false,false,false),
  ('raw_intelligence_telemetry','Raw market, OSINT and intelligence event details',7,14,false,false,false),
  ('operational_success_logs','Successful job and worker execution details',7,7,false,false,false),
  ('operational_failure_security','Failed, blocked, auth, security and incident details',30,30,false,false,false),
  ('ephemeral_rebuildable','Caches, temporary scans and fully reproducible artifacts',1,1,false,false,false)
on conflict (retention_class) do nothing;

create table if not exists midad_private.midad_event_spine (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  source_system text not null,
  source_schema text null,
  source_table text null,
  source_record_key text null,
  subject_type text null,
  subject_key text null,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  priority smallint not null default 50 check (priority between 0 and 100),
  data_class text not null default 'internal' check (data_class in ('public','internal','confidential','restricted')),
  retention_class text not null references midad_private.midad_storage_policies(retention_class),
  fingerprint text null,
  metadata jsonb not null default '{}'::jsonb,
  archive_state text not null default 'NOT_QUEUED' check (archive_state in ('NOT_QUEUED','QUEUED','ARCHIVED','VERIFIED','BLOCKED'))
);

create index if not exists midad_event_spine_subject_idx
  on midad_private.midad_event_spine(subject_type,subject_key,occurred_at desc);
create index if not exists midad_event_spine_retention_idx
  on midad_private.midad_event_spine(retention_class,occurred_at desc);

create table if not exists midad_private.midad_archive_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_schema text not null,
  source_table text not null,
  source_record_key text not null,
  event_type text not null,
  retention_class text not null references midad_private.midad_storage_policies(retention_class),
  data_class text not null default 'internal' check (data_class in ('public','internal','confidential','restricted')),
  priority smallint not null default 50 check (priority between 0 and 100),
  payload_metadata jsonb not null default '{}'::jsonb,
  payload_sha256 text null check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload_bytes bigint null check (payload_bytes is null or payload_bytes >= 0),
  status text not null default 'pending' check (status in ('pending','processing','uploaded','verified','retry','blocked','failed')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  max_attempts smallint not null default 3 check (max_attempts = 3),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz null
);

create index if not exists midad_archive_outbox_ready_idx
  on midad_private.midad_archive_outbox(priority desc,next_attempt_at,created_at)
  where status in ('pending','retry');
create index if not exists midad_archive_outbox_source_idx
  on midad_private.midad_archive_outbox(source_schema,source_table,source_record_key);

create table if not exists midad_private.midad_archive_manifest (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null unique references midad_private.midad_archive_outbox(id) on delete restrict,
  provider text not null,
  provider_file_uuid text null,
  provider_object_key text null,
  file_name text not null,
  content_type text not null default 'application/octet-stream',
  source_bytes bigint null,
  stored_bytes bigint not null check (stored_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  encryption_algorithm text not null,
  compression_algorithm text not null,
  archive_format_version integer not null default 1,
  status text not null default 'UPLOADED' check (status in ('UPLOADED','VERIFIED','RESTORE_TESTED','FAILED')),
  public_url text null,
  uploaded_at timestamptz not null default now(),
  verified_at timestamptz null,
  restore_tested_at timestamptz null,
  provider_metadata jsonb not null default '{}'::jsonb
);

create index if not exists midad_archive_manifest_provider_idx
  on midad_private.midad_archive_manifest(provider,status,uploaded_at desc);

create table if not exists midad_private.midad_archive_restore_jobs (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references midad_private.midad_archive_manifest(id) on delete restrict,
  requested_by text not null,
  reason text not null,
  destination_schema text null,
  destination_table text null,
  state text not null default 'queued' check (state in ('queued','restoring','verified','failed','blocked')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  restored_sha256 text null check (restored_sha256 is null or restored_sha256 ~ '^[0-9a-f]{64}$'),
  result_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists midad_archive_restore_ready_idx
  on midad_private.midad_archive_restore_jobs(created_at)
  where state='queued';

create table if not exists midad_private.midad_storage_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null,
  severity text not null check (severity in ('WARNING','CRITICAL','EMERGENCY','RECOVERED')),
  state text not null default 'OPEN' check (state in ('OPEN','ACKNOWLEDGED','RESOLVED')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz null,
  observed_bytes bigint null,
  threshold_bytes bigint null,
  details jsonb not null default '{}'::jsonb
);

create unique index if not exists midad_storage_alerts_open_key_idx
  on midad_private.midad_storage_alerts(alert_key)
  where state in ('OPEN','ACKNOWLEDGED');

alter table midad_private.midad_storage_config enable row level security;
alter table midad_private.midad_storage_metrics enable row level security;
alter table midad_private.midad_storage_policies enable row level security;
alter table midad_private.midad_event_spine enable row level security;
alter table midad_private.midad_archive_outbox enable row level security;
alter table midad_private.midad_archive_manifest enable row level security;
alter table midad_private.midad_archive_restore_jobs enable row level security;
alter table midad_private.midad_storage_alerts enable row level security;

do $$
begin
  if (select count(*) from midad_private.midad_storage_policies) < 7 then
    raise exception 'storage retention policy seed incomplete';
  end if;
  if exists (
    select 1 from midad_private.midad_storage_policies
    where auto_delete_enabled is distinct from false
  ) then
    raise exception 'automatic deletion must remain disabled';
  end if;
  if not exists (
    select 1 from midad_private.midad_storage_config
    where singleton=true and auto_delete_enabled=false
  ) then
    raise exception 'storage governor safe defaults missing';
  end if;
end $$;
