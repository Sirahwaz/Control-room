-- Atomic claims for public, read-only browser jobs executed by GitHub-hosted
-- ephemeral Chromium workers. Operator-command jobs remain on the private worker path.

CREATE UNIQUE INDEX IF NOT EXISTS midad_browser_jobs_public_readonly_idempotency_idx
  ON public.midad_browser_jobs (owner_user_id, session_ref)
  WHERE agent_key = 'midad_public_research'
    AND platform_key = 'public_read_only'
    AND session_ref LIKE 'browser-readonly:%';

CREATE INDEX IF NOT EXISTS midad_browser_jobs_readonly_lease_claim_idx
  ON public.midad_browser_jobs (owner_user_id, lease_expires_at, updated_at, id)
  WHERE agent_key = 'midad_public_research'
    AND platform_key = 'public_read_only'
    AND COALESCE(input_data, '{}'::jsonb) ->> 'mode' = 'public_read_only'
    AND state IN ('PREPARING', 'RUNNING')
    AND current_url IS NOT NULL
    AND btrim(current_url) <> '';

CREATE OR REPLACE FUNCTION public.midad_browser_claim_readonly_jobs_v1(
  p_owner_user_id uuid,
  p_worker_id text,
  p_lease_token_sha256 text,
  p_lease_seconds integer DEFAULT 300,
  p_limit integer DEFAULT 1
)
RETURNS SETOF public.midad_browser_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_owner_user_id IS NULL
     OR p_worker_id IS NULL
     OR p_worker_id !~ '^[A-Za-z0-9_.:-]{3,120}$'
     OR p_lease_token_sha256 IS NULL
     OR p_lease_token_sha256 !~ '^[a-f0-9]{64}$'
     OR p_lease_seconds IS NULL
     OR p_lease_seconds < 30
     OR p_lease_seconds > 300
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 20 THEN
    RAISE EXCEPTION 'invalid_readonly_browser_lease_claim'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.midad_browser_jobs AS j
    WHERE j.owner_user_id = p_owner_user_id
      AND j.agent_key = 'midad_public_research'
      AND j.platform_key = 'public_read_only'
      AND COALESCE(j.input_data, '{}'::jsonb) ->> 'mode' = 'public_read_only'
      AND j.state IN ('PREPARING', 'RUNNING')
      AND j.current_url IS NOT NULL
      AND btrim(j.current_url) <> ''
      AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= clock_timestamp())
    ORDER BY j.updated_at, j.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.midad_browser_jobs AS j
  SET lease_owner = p_worker_id,
      lease_token_sha256 = p_lease_token_sha256,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      claimed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  FROM candidates AS c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.midad_browser_claim_readonly_jobs_v1(uuid, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.midad_browser_claim_readonly_jobs_v1(uuid, text, text, integer, integer)
  TO service_role;
