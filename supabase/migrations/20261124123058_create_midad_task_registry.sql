-- MIDAD External Task Scheduler registry
-- Applied to project btkxsrqjgriaafzsacei on 2026-11-24.
-- Private schema; access is restricted to service_role. No public API grants.

create schema if not exists midad_ops;
revoke all on schema midad_ops from public, anon, authenticated;
grant usage on schema midad_ops to service_role;

create table if not exists midad_ops.tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique,
  title text not null,
  instructions text not null,
  schedule_cron text not null,
  timezone text not null default 'Asia/Tehran',
  status text not null default 'draft'
    check (status in ('draft','active','paused','archived')),
  execution_target text not null default 'github_actions',
  notification_policy text not null default 'every_run',
  max_attempts smallint not null default 3 check (max_attempts between 1 and 3),
  next_run_at timestamptz,
  last_run_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists midad_ops.task_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references midad_ops.tasks(id) on delete restrict,
  idempotency_key text not null unique,
  scheduled_for timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','skipped')),
  attempt smallint not null default 1 check (attempt between 1 and 3),
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists task_runs_task_scheduled_idx
  on midad_ops.task_runs (task_id, scheduled_for desc);
create index if not exists task_runs_status_created_idx
  on midad_ops.task_runs (status, created_at desc);
create index if not exists tasks_status_next_run_idx
  on midad_ops.tasks (status, next_run_at)
  where status = 'active';

alter table midad_ops.tasks enable row level security;
alter table midad_ops.task_runs enable row level security;
revoke all on all tables in schema midad_ops from public, anon, authenticated;
grant select, insert, update, delete on midad_ops.tasks to service_role;
grant select, insert, update, delete on midad_ops.task_runs to service_role;

insert into midad_ops.tasks
  (task_key, title, instructions, schedule_cron, timezone, status, execution_target, notification_policy, metadata)
values
  (
    'midad-core-migration-readiness-daily',
    'مراقبة جاهزية ترحيل MIDAD يومياً',
    'نفّذ مراقبة هندسية يومية read-only لترحيل MIDAD من midad-ai إلى midad-core. افحص Schema وMigration Drift وRLS وEdge Functions وCron والاعتماديات والاختبارات. قارن النتائج بآخر تشغيل، وقدم تقريراً موجزاً بالأدلة والفجوات والمخاطر وأعلى إجراء تالٍ. لا تنفذ نقل بيانات أو DDL/DML على المشروع القديم أو تغييرات إنتاجية أو Cutover أو إجراءات مالية. لا تستخدم خدمات مدفوعة. لا تدّعِ الجاهزية دون أدلة.',
    '0 16 * * *',
    'Asia/Tehran',
    'draft',
    'github_actions',
    'every_run',
    jsonb_build_object(
      'source_project_ref', 'froegigfmpmvtecztfbf',
      'target_project_ref', 'btkxsrqjgriaafzsacei',
      'repository', 'Sirahwaz/Control-room',
      'safety_mode', 'read_only',
      'created_from', 'chatgpt_task_limit_fallback'
    )
  )
on conflict (task_key) do nothing;
