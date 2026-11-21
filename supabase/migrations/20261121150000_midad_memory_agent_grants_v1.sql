-- Explicit, service-managed grants for the first MIDAD Memory Gateway pilot.
-- No grants are seeded by this migration; access remains denied until an operator
-- provisions a specific owner/project/agent grant through a trusted admin path.

ALTER TABLE public.midad_factory_runs
  ADD COLUMN IF NOT EXISTS agent_key text;

CREATE INDEX IF NOT EXISTS midad_factory_runs_project_agent_state_idx
  ON public.midad_factory_runs (project_id, agent_key, state);

COMMENT ON COLUMN public.midad_factory_runs.agent_key IS
  'Explicit execution principal for MIDAD Memory Gateway; NULL legacy runs cannot access memory.';

CREATE TABLE IF NOT EXISTS public.midad_memory_agent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.midad_factory_projects(id) ON DELETE CASCADE,
  agent_key text NOT NULL CHECK (agent_key ~ '^[A-Za-z0-9_.:-]{2,100}$'),
  capabilities text[] NOT NULL DEFAULT '{}'::text[],
  active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT midad_memory_agent_grants_owner_project_agent_uq
    UNIQUE (owner_user_id, project_id, agent_key),
  CONSTRAINT midad_memory_agent_grants_capabilities_check
    CHECK (capabilities <@ ARRAY['create','search']::text[])
);

CREATE INDEX IF NOT EXISTS midad_memory_agent_grants_active_lookup_idx
  ON public.midad_memory_agent_grants (owner_user_id, project_id, agent_key)
  WHERE active = true;

ALTER TABLE public.midad_memory_agent_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.midad_memory_agent_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.midad_memory_agent_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.midad_memory_agent_grants TO service_role;

COMMENT ON TABLE public.midad_memory_agent_grants IS
  'Service-managed, explicit per-owner/project/agent grants for MIDAD Memory Gateway. No client-facing policies.';

CREATE TABLE IF NOT EXISTS public.midad_memory_gateway_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.midad_factory_projects(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  run_id uuid NOT NULL REFERENCES public.midad_factory_runs(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('create','search')),
  outcome text NOT NULL CHECK (outcome IN ('STARTED','SUCCEEDED','FAILED')),
  error_code text,
  idempotency_key_sha256 text,
  record_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT midad_memory_gateway_audit_hash_check
    CHECK (idempotency_key_sha256 IS NULL OR idempotency_key_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS midad_memory_gateway_audit_owner_created_idx
  ON public.midad_memory_gateway_audit (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS midad_memory_gateway_audit_request_idx
  ON public.midad_memory_gateway_audit (request_id);

ALTER TABLE public.midad_memory_gateway_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.midad_memory_gateway_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.midad_memory_gateway_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.midad_memory_gateway_audit TO service_role;

COMMENT ON TABLE public.midad_memory_gateway_audit IS
  'Metadata-only audit trail for internal memory operations; never stores memory content or credentials.';
