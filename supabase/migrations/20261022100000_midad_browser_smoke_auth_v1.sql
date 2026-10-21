-- MIDAD Browser Gateway authenticated smoke-test harness v1.
-- Intended for one-shot, explicitly authorized gateway contract tests.
-- Secrets are kept in Supabase Vault; only SHA-256 digests are held in the token table.
-- Test credentials expire within ten minutes, are atomically consumed once, and can be purged.
-- The cleanup RPC can delete only browser jobs owned by a marked disposable auth identity
-- where the exact smoke-run marker and fixed test objective match.

CREATE TABLE public.midad_browser_smoke_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_secret_id uuid NOT NULL UNIQUE REFERENCES vault.secrets(id) ON DELETE CASCADE,
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  request_id bigint,
  CONSTRAINT midad_browser_smoke_token_ttl CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '10 minutes'
  )
);

ALTER TABLE public.midad_browser_smoke_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.midad_browser_smoke_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.midad_browser_smoke_tokens FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.midad_browser_smoke_tokens IS
  'One-shot, short-lived gateway smoke-test token digests. Plaintext token is held only in Supabase Vault and request memory.';

CREATE OR REPLACE FUNCTION public.midad_browser_smoke_authorize_v1(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 48 OR length(p_token) > 160 THEN
    RETURN NULL;
  END IF;

  SELECT t.id
    INTO v_id
  FROM public.midad_browser_smoke_tokens AS t
  JOIN vault.secrets AS s ON s.id = t.vault_secret_id
  WHERE t.token_sha256 = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    AND t.expires_at > clock_timestamp()
    AND t.consumed_at IS NULL
  LIMIT 1
  FOR UPDATE OF t SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.midad_browser_smoke_tokens
  SET consumed_at = clock_timestamp()
  WHERE id = v_id AND consumed_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.midad_browser_smoke_cleanup_token_v1(p_token_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $function$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT vault_secret_id
    INTO v_secret_id
  FROM public.midad_browser_smoke_tokens
  WHERE id = p_token_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- ON DELETE CASCADE removes the token digest row.
  DELETE FROM vault.secrets WHERE id = v_secret_id;
  DELETE FROM public.midad_browser_smoke_tokens WHERE id = p_token_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.midad_browser_smoke_cleanup_job_v1(
  p_owner_user_id uuid,
  p_session_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_job_id uuid;
  v_events integer := 0;
  v_evidence integer := 0;
  v_jobs integer := 0;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_ref IS NULL
     OR p_session_ref !~ '^midad-browser-smoke:[A-Za-z0-9-]{20,80}$' THEN
    RAISE EXCEPTION 'invalid_browser_smoke_cleanup_marker' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = p_owner_user_id
      AND u.email LIKE 'midad-browser-smoke-%@example.invalid'
      AND u.raw_user_meta_data ->> 'midad_browser_smoke_identity' = 'true'
      AND u.raw_user_meta_data ->> 'midad_browser_smoke_run' = p_session_ref
  ) THEN
    RAISE EXCEPTION 'cleanup_owner_is_not_a_marked_test_identity' USING ERRCODE = '42501';
  END IF;

  SELECT j.id INTO v_job_id
  FROM public.midad_browser_jobs AS j
  WHERE j.owner_user_id = p_owner_user_id
    AND j.session_ref = p_session_ref
    AND j.agent_key = 'midad_gateway_smoke'
    AND j.objective = 'MIDAD Browser Gateway Smoke Test (temporary; safe to delete)'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'job_found', false, 'deleted_jobs', 0, 'deleted_events', 0, 'deleted_evidence', 0
    );
  END IF;

  DELETE FROM public.midad_agent_events WHERE job_id = v_job_id;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  DELETE FROM public.midad_browser_evidence_ledger WHERE job_id = v_job_id;
  GET DIAGNOSTICS v_evidence = ROW_COUNT;

  DELETE FROM public.midad_browser_jobs WHERE id = v_job_id;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  RETURN jsonb_build_object(
    'job_found', true,
    'deleted_jobs', v_jobs,
    'deleted_events', v_events,
    'deleted_evidence', v_evidence
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.midad_browser_smoke_authorize_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.midad_browser_smoke_cleanup_token_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.midad_browser_smoke_cleanup_job_v1(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.midad_browser_smoke_authorize_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.midad_browser_smoke_cleanup_token_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.midad_browser_smoke_cleanup_job_v1(uuid, text) TO service_role;
