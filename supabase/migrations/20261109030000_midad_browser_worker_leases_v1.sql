-- MIDAD Browser atomic operator-worker leases v1.
-- Additive only: existing browser jobs and state semantics remain unchanged.
-- This migration is source-controlled and tested in isolated PostgreSQL CI.
-- It is NOT deployed to the connected Supabase project by this change.

ALTER TABLE public.midad_browser_jobs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_token_sha256 text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

DO $lease_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.midad_browser_jobs'::regclass
      AND conname = 'midad_browser_job_lease_token_hash_check'
  ) THEN
    ALTER TABLE public.midad_browser_jobs
      ADD CONSTRAINT midad_browser_job_lease_token_hash_check
      CHECK (lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[a-f0-9]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.midad_browser_jobs'::regclass
      AND conname = 'midad_browser_job_lease_owner_check'
  ) THEN
    ALTER TABLE public.midad_browser_jobs
      ADD CONSTRAINT midad_browser_job_lease_owner_check
      CHECK (lease_owner IS NULL OR (
        length(lease_owner) BETWEEN 3 AND 120
        AND lease_owner ~ '^[A-Za-z0-9_.:-]+$'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.midad_browser_jobs'::regclass
      AND conname = 'midad_browser_job_lease_tuple_check'
  ) THEN
    ALTER TABLE public.midad_browser_jobs
      ADD CONSTRAINT midad_browser_job_lease_tuple_check
      CHECK (
        (lease_owner IS NULL AND lease_token_sha256 IS NULL
          AND lease_expires_at IS NULL AND claimed_at IS NULL)
        OR
        (lease_owner IS NOT NULL AND lease_token_sha256 IS NOT NULL
          AND lease_expires_at IS NOT NULL AND claimed_at IS NOT NULL)
      );
  END IF;
END;
$lease_constraints$;

CREATE INDEX IF NOT EXISTS midad_browser_jobs_operator_lease_claim_idx
  ON public.midad_browser_jobs (owner_user_id, lease_expires_at, created_at, id)
  WHERE state = 'PREPARING'
    AND (input_data ? 'operator_command' OR input_data ? 'operator_hint');

COMMENT ON COLUMN public.midad_browser_jobs.lease_owner IS
  'Opaque worker instance identifier that currently owns this operator-job lease.';
COMMENT ON COLUMN public.midad_browser_jobs.lease_token_sha256 IS
  'SHA-256 digest of a short-lived random lease token. The plaintext token is never persisted.';
COMMENT ON COLUMN public.midad_browser_jobs.lease_expires_at IS
  'Lease deadline. Expired leases may be atomically reclaimed by another worker.';
COMMENT ON COLUMN public.midad_browser_jobs.claimed_at IS
  'Timestamp when the current worker atomically acquired the lease.';

CREATE OR REPLACE FUNCTION public.midad_browser_claim_operator_jobs_v1(
  p_owner_user_id uuid,
  p_worker_id text,
  p_lease_token_sha256 text,
  p_lease_seconds integer DEFAULT 120,
  p_limit integer DEFAULT 5
)
RETURNS SETOF public.midad_browser_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'browser_lease_owner_required' USING ERRCODE = '22023';
  END IF;
  IF p_worker_id IS NULL OR length(p_worker_id) NOT BETWEEN 3 AND 120
     OR p_worker_id !~ '^[A-Za-z0-9_.:-]+$' THEN
    RAISE EXCEPTION 'invalid_browser_lease_worker_id' USING ERRCODE = '22023';
  END IF;
  IF p_lease_token_sha256 IS NULL OR p_lease_token_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid_browser_lease_token_hash' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid_browser_lease_duration' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_browser_lease_limit' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.midad_browser_jobs AS j
    WHERE j.owner_user_id = p_owner_user_id
      AND j.state = 'PREPARING'
      AND (
        (j.input_data ? 'operator_command'
          AND jsonb_typeof(j.input_data -> 'operator_command') = 'object')
        OR
        (jsonb_typeof(j.input_data -> 'operator_hint') = 'string'
          AND length(btrim(j.input_data ->> 'operator_hint')) > 0)
      )
      AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= clock_timestamp())
    ORDER BY j.created_at, j.id
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
$function$;

CREATE OR REPLACE FUNCTION public.midad_browser_validate_operator_lease_v1(
  p_job_id uuid,
  p_owner_user_id uuid,
  p_worker_id text,
  p_lease_token_sha256 text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.midad_browser_jobs AS j
    WHERE j.id = p_job_id
      AND j.owner_user_id = p_owner_user_id
      AND j.lease_owner = p_worker_id
      AND j.lease_token_sha256 = p_lease_token_sha256
      AND j.lease_expires_at > clock_timestamp()
      AND j.state IN ('PREPARING', 'RUNNING')
  );
$function$;

CREATE OR REPLACE FUNCTION public.midad_browser_renew_operator_lease_v1(
  p_job_id uuid,
  p_owner_user_id uuid,
  p_worker_id text,
  p_lease_token_sha256 text,
  p_lease_seconds integer DEFAULT 120
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid_browser_lease_duration' USING ERRCODE = '22023';
  END IF;

  UPDATE public.midad_browser_jobs AS j
  SET lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  WHERE j.id = p_job_id
    AND j.owner_user_id = p_owner_user_id
    AND j.lease_owner = p_worker_id
    AND j.lease_token_sha256 = p_lease_token_sha256
    AND j.lease_expires_at > clock_timestamp()
    AND j.state IN ('PREPARING', 'RUNNING');

  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.midad_browser_release_operator_lease_v1(
  p_job_id uuid,
  p_owner_user_id uuid,
  p_worker_id text,
  p_lease_token_sha256 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.midad_browser_jobs AS j
  SET lease_owner = NULL,
      lease_token_sha256 = NULL,
      lease_expires_at = NULL,
      claimed_at = NULL,
      updated_at = clock_timestamp()
  WHERE j.id = p_job_id
    AND j.owner_user_id = p_owner_user_id
    AND j.lease_owner = p_worker_id
    AND j.lease_token_sha256 = p_lease_token_sha256;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.midad_browser_claim_operator_jobs_v1(uuid,text,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.midad_browser_validate_operator_lease_v1(uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.midad_browser_renew_operator_lease_v1(uuid,uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.midad_browser_release_operator_lease_v1(uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.midad_browser_claim_operator_jobs_v1(uuid,text,text,integer,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.midad_browser_validate_operator_lease_v1(uuid,uuid,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.midad_browser_renew_operator_lease_v1(uuid,uuid,text,text,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.midad_browser_release_operator_lease_v1(uuid,uuid,text,text)
  TO service_role;
