create table if not exists public.midad_factory_projects (
  id uuid primary key default gen_random_uuid(),
  project_key text not null unique,
  tenant_key text not null default 'default',
  owner_user_id uuid references auth.users(id),
  product_key text not null,
  display_name text not null,
  app_id text not null,
  version text not null,
  objective text not null,
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'PLANNED',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_midad_factory_projects_product on public.midad_factory_projects(product_key);
create index if not exists idx_midad_factory_projects_tenant on public.midad_factory_projects(tenant_key,owner_user_id);

create table if not exists public.midad_factory_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.midad_factory_projects(id) on delete cascade,
  project_key text not null,
  run_key text not null unique,
  state text not null default 'PLANNED',
  pipeline jsonb not null default '[]'::jsonb,
  inputs jsonb not null default '{}'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  repairs jsonb not null default '[]'::jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_midad_factory_runs_project on public.midad_factory_runs(project_key,created_at desc);
create index if not exists idx_midad_factory_runs_state on public.midad_factory_runs(state);

create table if not exists public.midad_factory_learning (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'product',
  tenant_key text,
  product_key text,
  decision_key text not null,
  context_hash text not null,
  evidence jsonb not null default '[]'::jsonb,
  chosen_action jsonb not null default '{}'::jsonb,
  alternatives jsonb not null default '[]'::jsonb,
  outcome text,
  reward numeric,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  sample_size integer not null default 1 check (sample_size >= 1),
  validity_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_midad_factory_learning_decision on public.midad_factory_learning(decision_key,scope,product_key);
create index if not exists idx_midad_factory_learning_context on public.midad_factory_learning(context_hash);

create table if not exists public.midad_factory_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.midad_factory_projects(id) on delete cascade,
  run_id uuid references public.midad_factory_runs(id) on delete cascade,
  artifact_type text not null,
  artifact_name text not null,
  uri text,
  sha256 text,
  size_bytes bigint,
  verification_status text not null default 'PENDING',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_midad_factory_artifacts_run on public.midad_factory_artifacts(run_id);
create index if not exists idx_midad_factory_artifacts_sha on public.midad_factory_artifacts(sha256);

alter table public.midad_factory_projects enable row level security;
alter table public.midad_factory_runs enable row level security;
alter table public.midad_factory_learning enable row level security;
alter table public.midad_factory_artifacts enable row level security;

