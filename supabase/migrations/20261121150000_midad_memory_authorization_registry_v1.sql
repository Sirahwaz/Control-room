-- MIDAD Memory Authorization Registry (MMA Registry v1)
-- Safe to stage and test in isolation; not applied to live Supabase.
CREATE TABLE IF NOT EXISTS public.midad_memory_authorization_grants (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL CHECK (length(project_id) BETWEEN 1 AND 160),
  agent_id text NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 160),
  run_id text NOT NULL CHECK (length(run_id) BETWEEN 1 AND 160),
  capabilities text[] NOT NULL CHECK (
    cardinality(capabilities) > 0 AND capabilities <@ ARRAY['create','search']::text[]
  ),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  note text CHECK (note IS NULL OR length(note) <= 500)
);
CREATE INDEX IF NOT EXISTS midad_memory_grants_lookup_idx
  ON public.midad_memory_authorization_grants(owner_user_id, project_id, agent_id, run_id, expires_at)
  WHERE revoked_at IS NULL;
ALTER TABLE public.midad_memory_authorization_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.midad_memory_authorization_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.midad_memory_authorization_grants TO service_role;

CREATE OR REPLACE FUNCTION public.midad_memory_authorization_check_v1(
  p_owner_user_id uuid, p_project_id text, p_agent_id text, p_run_id text
) RETURNS TABLE(verified boolean, capabilities text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(bool_or(g.grant_id IS NOT NULL), false) AS verified,
         COALESCE(array_agg(DISTINCT cap.cap ORDER BY cap.cap)
           FILTER (WHERE g.grant_id IS NOT NULL), ARRAY[]::text[]) AS capabilities
  FROM public.midad_memory_authorization_grants g
  LEFT JOIN LATERAL unnest(g.capabilities) cap(cap) ON true
  WHERE g.owner_user_id = p_owner_user_id
    AND g.project_id = p_project_id
    AND g.agent_id = p_agent_id
    AND g.run_id = p_run_id
    AND g.revoked_at IS NULL
    AND g.expires_at > now();
$$;
REVOKE ALL ON FUNCTION public.midad_memory_authorization_check_v1(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.midad_memory_authorization_check_v1(uuid,text,text,text) TO service_role;
COMMENT ON TABLE public.midad_memory_authorization_grants IS
  'Explicit owner/project/agent/run capability grants for the isolated MIDAD Memora integration; expiry and revocation enforced by check RPC.';
