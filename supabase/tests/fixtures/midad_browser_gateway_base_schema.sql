-- Disposable PostgreSQL fixture for gateway-ledger CI.
-- This is intentionally a minimal Supabase-compatible schema, not a production migration.
-- It is created in a fresh PostgreSQL service container and never connects to Supabase.

CREATE SCHEMA auth;
CREATE SCHEMA vault;
CREATE SCHEMA extensions;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE EXTENSION pgcrypto WITH SCHEMA extensions;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.midad_browser_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  agent_key text NOT NULL,
  platform_key text,
  objective text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'QUEUED', 'RESEARCHING', 'PREPARING', 'RUNNING', 'HUMAN_GATE', 'BLOCKED',
    'SUBMITTED', 'VERIFYING', 'PAID', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  session_ref text,
  input_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_gate jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocker jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_action text,
  attempt_count integer NOT NULL DEFAULT 0,
  current_url text,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.midad_agent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.midad_browser_jobs(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  event_type text NOT NULL,
  state text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deterministic seed identity/profile required by the existing SQL contract test.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '00000000-0000-4000-8000-000000000099',
  'ledger-ci-seed@example.invalid',
  '{}'::jsonb
);

INSERT INTO public.profiles (id)
VALUES ('00000000-0000-4000-8000-000000000099');
