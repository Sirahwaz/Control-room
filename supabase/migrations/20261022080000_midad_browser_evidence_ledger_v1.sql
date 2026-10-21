-- MIDAD Browser Evidence Ledger v1
-- Additive, fail-closed evidence and state-transition contract.
-- Does not change existing browser jobs or deploy an interactive browser runtime.

CREATE TABLE public.midad_browser_evidence_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.midad_browser_jobs(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_key text NOT NULL
    CHECK (length(event_key) BETWEEN 8 AND 200)
    CHECK (event_key ~ '^[A-Za-z0-9_.:-]+$'),
  event_type text NOT NULL CHECK (event_type IN (
    'job_created',
    'state_transition',
    'navigation_observed',
    'policy_decision',
    'human_gate_opened',
    'human_gate_resumed',
    'evidence_captured',
    'artifact_published',
    'payment_claim_observed',
    'error',
    'job_cancelled',
    'retry_scheduled'
  )),
  actor_key text NOT NULL
    CHECK (length(actor_key) BETWEEN 1 AND 100)
    CHECK (actor_key ~ '^[A-Za-z0-9_.:-]+$'),
  from_state text,
  to_state text,
  source_url text CHECK (
    source_url IS NULL OR (
      source_url ~ '^https://[A-Za-z0-9.-]+(:443)?(/[^?#[:space:]]*)?$'
      AND position('?' in source_url) = 0
      AND position('#' in source_url) = 0
      AND split_part(split_part(source_url, '://', 2), '/', 1) NOT LIKE '%@%'
    )
  ),
  content_sha256 text CHECK (
    content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(evidence) = 'object' AND pg_column_size(evidence) <= 8192
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT midad_browser_evidence_job_event_key_unique UNIQUE (job_id, event_key)
);

CREATE INDEX midad_browser_evidence_job_created_idx
  ON public.midad_browser_evidence_ledger (job_id, created_at DESC);

CREATE INDEX midad_browser_evidence_owner_created_idx
  ON public.midad_browser_evidence_ledger (owner_user_id, created_at DESC);

ALTER TABLE public.midad_browser_evidence_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.midad_browser_evidence_ledger FORCE ROW LEVEL SECURITY;

-- Evidence writes are accepted only through the SECURITY DEFINER RPC below.
-- There are deliberately no client-facing RLS policies.
REVOKE ALL ON TABLE public.midad_browser_evidence_ledger FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.midad_browser_evidence_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.midad_browser_evidence_ledger TO service_role;

COMMENT ON TABLE public.midad_browser_evidence_ledger IS
  'Append-only browser action evidence metadata. Does not store raw HTML, DOM dumps, cookies, auth headers, or page text.';
COMMENT ON COLUMN public.midad_browser_evidence_ledger.event_key IS
  'Caller-supplied idempotency key unique per browser job.';
COMMENT ON COLUMN public.midad_browser_evidence_ledger.source_url IS
  'HTTPS URL without query, fragment, or embedded credentials.';
COMMENT ON COLUMN public.midad_browser_evidence_ledger.evidence IS
  'Allowlisted scalar evidence metadata only; raw content and secrets are prohibited.';

CREATE OR REPLACE FUNCTION public.midad_browser_record_evidence_v1(
  p_job_id uuid,
  p_event_key text,
  p_event_type text,
  p_actor_key text DEFAULT 'midad_browser_gateway',
  p_to_state text DEFAULT NULL,
  p_source_url text DEFAULT NULL,
  p_content_sha256 text DEFAULT NULL,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_next_action text DEFAULT NULL,
  p_blocker_code text DEFAULT NULL,
  p_attempt_count integer DEFAULT NULL
)
RETURNS TABLE (
  evidence_id uuid,
  job_id uuid,
  state text,
  idempotent boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_owner uuid;
  v_current_state text;
  v_target_state text;
  v_current_attempts integer;
  v_next_attempts integer;
  v_existing_id uuid;
  v_safe_url text;
  v_authority text;
  v_safe_evidence jsonb;
  v_key text;
  v_value jsonb;
  v_safe_artifact_url text;
  v_event_type text;
  v_actor_key text;
  v_changed boolean := false;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_event_key IS NULL OR length(p_event_key) NOT BETWEEN 8 AND 200
     OR p_event_key !~ '^[A-Za-z0-9_.:-]+$' THEN
    RAISE EXCEPTION 'invalid_event_key' USING ERRCODE = '22023';
  END IF;

  v_event_type := lower(btrim(coalesce(p_event_type, '')));
  IF v_event_type NOT IN (
    'job_created', 'state_transition', 'navigation_observed', 'policy_decision',
    'human_gate_opened', 'human_gate_resumed', 'evidence_captured',
    'artifact_published', 'payment_claim_observed', 'error',
    'job_cancelled', 'retry_scheduled'
  ) THEN
    RAISE EXCEPTION 'invalid_browser_event_type' USING ERRCODE = '22023';
  END IF;

  v_actor_key := btrim(coalesce(p_actor_key, 'midad_browser_gateway'));
  IF length(v_actor_key) NOT BETWEEN 1 AND 100 OR v_actor_key !~ '^[A-Za-z0-9_.:-]+$' THEN
    RAISE EXCEPTION 'invalid_actor_key' USING ERRCODE = '22023';
  END IF;

  v_target_state := CASE
    WHEN p_to_state IS NULL OR btrim(p_to_state) = '' THEN NULL
    ELSE upper(btrim(p_to_state))
  END;

  IF v_target_state IS NOT NULL AND v_target_state NOT IN (
    'QUEUED', 'PREPARING', 'RUNNING', 'HUMAN_GATE', 'BLOCKED',
    'FAILED', 'COMPLETED', 'CANCELLED', 'PAID'
  ) THEN
    RAISE EXCEPTION 'invalid_browser_job_state' USING ERRCODE = '22023';
  END IF;

  IF v_target_state = 'PAID' THEN
    RAISE EXCEPTION 'PAID state requires a separate verified receipt workflow' USING ERRCODE = '42501';
  END IF;

  IF p_attempt_count IS NOT NULL AND (p_attempt_count < 0 OR p_attempt_count > 3) THEN
    RAISE EXCEPTION 'browser_attempt_limit_exceeded' USING ERRCODE = '22023';
  END IF;
  IF p_next_action IS NOT NULL AND length(p_next_action) > 300 THEN
    RAISE EXCEPTION 'next_action_too_long' USING ERRCODE = '22023';
  END IF;
  IF p_blocker_code IS NOT NULL AND (
    length(p_blocker_code) > 100 OR p_blocker_code !~ '^[A-Za-z0-9_.:-]+$'
  ) THEN
    RAISE EXCEPTION 'invalid_blocker_code' USING ERRCODE = '22023';
  END IF;
  IF v_target_state = 'BLOCKED' AND coalesce(p_blocker_code, '') = '' THEN
    RAISE EXCEPTION 'blocker_code_required_for_blocked_state' USING ERRCODE = '22023';
  END IF;

  IF p_content_sha256 IS NOT NULL AND lower(p_content_sha256) !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid_content_sha256' USING ERRCODE = '22023';
  END IF;

  -- Drop query and fragment material before persistence; reject URLs with credentials.
  IF p_source_url IS NOT NULL AND btrim(p_source_url) <> '' THEN
    v_safe_url := regexp_replace(btrim(p_source_url), '[?#].*$', '');
    IF v_safe_url !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^?#[:space:]]*)?$' THEN
      RAISE EXCEPTION 'invalid_or_unsafe_source_url' USING ERRCODE = '22023';
    END IF;
    IF position('?' in v_safe_url) > 0 OR position('#' in v_safe_url) > 0 THEN
      RAISE EXCEPTION 'source_url_query_or_fragment_not_allowed' USING ERRCODE = '22023';
    END IF;
    v_authority := split_part(split_part(v_safe_url, '://', 2), '/', 1);
    IF v_authority LIKE '%@%' THEN
      RAISE EXCEPTION 'source_url_credentials_not_allowed' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_safe_url := NULL;
  END IF;

  v_safe_evidence := coalesce(p_evidence, '{}'::jsonb);
  IF jsonb_typeof(v_safe_evidence) <> 'object' OR pg_column_size(v_safe_evidence) > 8192 THEN
    RAISE EXCEPTION 'invalid_or_oversize_evidence_metadata' USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(v_safe_evidence)
  LOOP
    IF v_key NOT IN (
      'source_kind', 'http_status', 'content_type', 'bytes_read', 'duration_ms',
      'policy_code', 'policy_status', 'artifact_sha256', 'artifact_url',
      'attempt', 'error_code', 'retryable'
    ) THEN
      RAISE EXCEPTION 'evidence_metadata_key_not_allowed: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_value) NOT IN ('string', 'number', 'boolean', 'null') THEN
      RAISE EXCEPTION 'evidence_metadata_values_must_be_scalar: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_value) = 'string' AND length(v_value #>> '{}') > 500 THEN
      RAISE EXCEPTION 'evidence_metadata_value_too_long: %', v_key USING ERRCODE = '22023';
    END IF;
    IF v_key = 'artifact_sha256' AND jsonb_typeof(v_value) = 'string'
       AND lower(v_value #>> '{}') !~ '^[a-f0-9]{64}

  SELECT j.owner_user_id, upper(j.state), j.attempt_count
    INTO v_owner, v_current_state, v_current_attempts
  FROM public.midad_browser_jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'browser_job_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Return an existing record for a retry of the same intent before mutating state.
  SELECT l.id
    INTO v_existing_id
  FROM public.midad_browser_evidence_ledger AS l
  WHERE l.job_id = p_job_id AND l.event_key = p_event_key;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing_id, p_job_id, v_current_state, true;
    RETURN;
  END IF;

  v_next_attempts := coalesce(p_attempt_count, v_current_attempts, 0);
  IF v_target_state IS NOT NULL AND v_target_state <> v_current_state THEN
    v_changed := true;

    IF NOT (
      (v_current_state = 'QUEUED' AND v_target_state IN ('PREPARING', 'BLOCKED', 'CANCELLED'))
      OR (v_current_state = 'PREPARING' AND v_target_state IN ('RUNNING', 'HUMAN_GATE', 'BLOCKED', 'FAILED', 'CANCELLED'))
      OR (v_current_state = 'RUNNING' AND v_target_state IN ('HUMAN_GATE', 'BLOCKED', 'FAILED', 'COMPLETED', 'CANCELLED'))
      OR (v_current_state = 'HUMAN_GATE' AND v_target_state IN ('RUNNING', 'BLOCKED', 'FAILED', 'CANCELLED'))
      OR (v_current_state = 'BLOCKED' AND v_target_state IN ('PREPARING', 'CANCELLED'))
      OR (v_current_state = 'FAILED' AND v_target_state IN ('PREPARING', 'CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'invalid_browser_state_transition: % -> %', v_current_state, v_target_state
        USING ERRCODE = '23514';
    END IF;

    IF v_current_state IN ('BLOCKED', 'FAILED') AND v_target_state = 'PREPARING' THEN
      v_next_attempts := coalesce(p_attempt_count, v_current_attempts + 1);
      IF v_next_attempts > 3 THEN
        RAISE EXCEPTION 'browser_retry_limit_exceeded' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.midad_browser_evidence_ledger (
    job_id, owner_user_id, event_key, event_type, actor_key,
    from_state, to_state, source_url, content_sha256, evidence
  ) VALUES (
    p_job_id, v_owner, p_event_key, v_event_type, v_actor_key,
    v_current_state, coalesce(v_target_state, v_current_state), v_safe_url,
    lower(p_content_sha256), v_safe_evidence
  )
  RETURNING id INTO v_existing_id;

  IF v_changed OR v_safe_url IS NOT NULL OR p_next_action IS NOT NULL
     OR p_blocker_code IS NOT NULL OR p_attempt_count IS NOT NULL THEN
    UPDATE public.midad_browser_jobs AS j
    SET state = coalesce(v_target_state, j.state),
        current_url = coalesce(v_safe_url, j.current_url),
        next_action = coalesce(nullif(btrim(p_next_action), ''), j.next_action),
        blocker = CASE
          WHEN p_blocker_code IS NOT NULL THEN jsonb_build_object('code', p_blocker_code)
          WHEN v_target_state IS NOT NULL AND v_target_state NOT IN ('BLOCKED', 'FAILED') THEN '{}'::jsonb
          ELSE j.blocker
        END,
        attempt_count = v_next_attempts,
        started_at = CASE
          WHEN v_target_state = 'RUNNING' AND j.started_at IS NULL THEN now()
          ELSE j.started_at
        END,
        completed_at = CASE
          WHEN v_target_state IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN now()
          ELSE j.completed_at
        END,
        last_error = CASE
          WHEN p_blocker_code IS NOT NULL THEN p_blocker_code
          WHEN v_target_state IN ('RUNNING', 'COMPLETED') THEN NULL
          ELSE j.last_error
        END,
        updated_at = now()
    WHERE j.id = p_job_id;
  END IF;

  RETURN QUERY SELECT v_existing_id, p_job_id, coalesce(v_target_state, v_current_state), false;
END;
$function$;

REVOKE ALL ON FUNCTION public.midad_browser_record_evidence_v1(
  uuid, text, text, text, text, text, text, jsonb, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.midad_browser_record_evidence_v1(
  uuid, text, text, text, text, text, text, jsonb, text, text, integer
) TO service_role;
 THEN
      RAISE EXCEPTION 'invalid_artifact_sha256' USING ERRCODE = '22023';
    END IF;
    IF v_key = 'artifact_url' AND jsonb_typeof(v_value) = 'string'
       AND btrim(v_value #>> '{}') <> '' THEN
      -- Artifact links are stored without query or fragment tokens.
      v_safe_artifact_url := regexp_replace(btrim(v_value #>> '{}'), '[?#].*

  SELECT j.owner_user_id, upper(j.state), j.attempt_count
    INTO v_owner, v_current_state, v_current_attempts
  FROM public.midad_browser_jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'browser_job_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Return an existing record for a retry of the same intent before mutating state.
  SELECT l.id
    INTO v_existing_id
  FROM public.midad_browser_evidence_ledger AS l
  WHERE l.job_id = p_job_id AND l.event_key = p_event_key;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing_id, p_job_id, v_current_state, true;
    RETURN;
  END IF;

  v_next_attempts := coalesce(p_attempt_count, v_current_attempts, 0);
  IF v_target_state IS NOT NULL AND v_target_state <> v_current_state THEN
    v_changed := true;

    IF NOT (
      (v_current_state = 'QUEUED' AND v_target_state IN ('PREPARING', 'BLOCKED', 'CANCELLED'))
      OR (v_current_state = 'PREPARING' AND v_target_state IN ('RUNNING', 'HUMAN_GATE', 'BLOCKED', 'FAILED', 'CANCELLED'))
      OR (v_current_state = 'RUNNING' AND v_target_state IN ('HUMAN_GATE', 'BLOCKED', 'FAILED', 'COMPLETED', 'CANCELLED'))
      OR (v_current_state = 'HUMAN_GATE' AND v_target_state IN ('RUNNING', 'BLOCKED', 'FAILED', 'CANCELLED'))
      OR (v_current_state = 'BLOCKED' AND v_target_state IN ('PREPARING', 'CANCELLED'))
      OR (v_current_state = 'FAILED' AND v_target_state IN ('PREPARING', 'CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'invalid_browser_state_transition: % -> %', v_current_state, v_target_state
        USING ERRCODE = '23514';
    END IF;

    IF v_current_state IN ('BLOCKED', 'FAILED') AND v_target_state = 'PREPARING' THEN
      v_next_attempts := coalesce(p_attempt_count, v_current_attempts + 1);
      IF v_next_attempts > 3 THEN
        RAISE EXCEPTION 'browser_retry_limit_exceeded' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.midad_browser_evidence_ledger (
    job_id, owner_user_id, event_key, event_type, actor_key,
    from_state, to_state, source_url, content_sha256, evidence
  ) VALUES (
    p_job_id, v_owner, p_event_key, v_event_type, v_actor_key,
    v_current_state, coalesce(v_target_state, v_current_state), v_safe_url,
    lower(p_content_sha256), v_safe_evidence
  )
  RETURNING id INTO v_existing_id;

  IF v_changed OR v_safe_url IS NOT NULL OR p_next_action IS NOT NULL
     OR p_blocker_code IS NOT NULL OR p_attempt_count IS NOT NULL THEN
    UPDATE public.midad_browser_jobs AS j
    SET state = coalesce(v_target_state, j.state),
        current_url = coalesce(v_safe_url, j.current_url),
        next_action = coalesce(nullif(btrim(p_next_action), ''), j.next_action),
        blocker = CASE
          WHEN p_blocker_code IS NOT NULL THEN jsonb_build_object('code', p_blocker_code)
          WHEN v_target_state IS NOT NULL AND v_target_state NOT IN ('BLOCKED', 'FAILED') THEN '{}'::jsonb
          ELSE j.blocker
        END,
        attempt_count = v_next_attempts,
        started_at = CASE
          WHEN v_target_state = 'RUNNING' AND j.started_at IS NULL THEN now()
          ELSE j.started_at
        END,
        completed_at = CASE
          WHEN v_target_state IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN now()
          ELSE j.completed_at
        END,
        last_error = CASE
          WHEN p_blocker_code IS NOT NULL THEN p_blocker_code
          WHEN v_target_state IN ('RUNNING', 'COMPLETED') THEN NULL
          ELSE j.last_error
        END,
        updated_at = now()
    WHERE j.id = p_job_id;
  END IF;

  RETURN QUERY SELECT v_existing_id, p_job_id, coalesce(v_target_state, v_current_state), false;
END;
$function$;

REVOKE ALL ON FUNCTION public.midad_browser_record_evidence_v1(
  uuid, text, text, text, text, text, text, jsonb, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.midad_browser_record_evidence_v1(
  uuid, text, text, text, text, text, text, jsonb, text, text, integer
) TO service_role;
, '');
      IF v_safe_artifact_url !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^?#[:space:]]*)?

  SELECT j.owner_user_id, upper(j.state), j.attempt_count
    INTO v_owner, v_current_state, v_current_attempts
  FROM public.midad_browser_jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'browser_job_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Return an existing record for a retry of the same intent before mutating state.
  SELECT l.id
    INTO v_existing_id
  FROM public.midad_browser_evidence_ledger AS l
  WHERE l.job_id = p_job_id AND l.event_key = p_event_key;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing_id, p_job_id, v_current_state, true;
    RETURN;
  END IF;

  v_next_attempts := coalesce(p_attempt_count, v_current_attempts, 0);
  IF v_target_state IS NOT NULL AND v_target_state <> v_current_state THEN
    v_changed := true;

    IF NOT (
      (v_current_state = 'QUEUED' AND v_target_state IN ('PREPARING', 'BLOCKED', 'CANCELLED'))
      OR (v_current_state = 'PREPARING' AND v_target_state IN ('RUNNING', 'HUMAN_GATE', 'BLOCKED', 'FAILED', 'CANCELLED'))
      OR (v_current_state = 'RUNNING' AND v_target_state IN ('HUMAN_GATE', 'BLOCKED', 'FAILED', 'COMPLETED', 'CANCELLED'))
      OR (v_current_state = 'HUMAN_GATE' AND v_target_state IN ('RUNNING', 'BLOCKED', 'FAILED', 'CANCELLED'))
      OR (v_current_state = 'BLOCKED' AND v_target_state IN ('PREPARING', 'CANCELLED'))
      OR (v_current_state = 'FAILED' AND v_target_state IN ('PREPARING', 'CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'invalid_browser_state_transition: % -> %', v_current_state, v_target_state
        USING ERRCODE = '23514';
    END IF;

    IF v_current_state IN ('BLOCKED', 'FAILED') AND v_target_state = 'PREPARING' THEN
      v_next_attempts := coalesce(p_attempt_count, v_current_attempts + 1);
      IF v_next_attempts > 3 THEN
        RAISE EXCEPTION 'browser_retry_limit_exceeded' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.midad_browser_evidence_ledger (
    job_id, owner_user_id, event_key, event_type, actor_key,
    from_state, to_state, source_url, content_sha256, evidence
  ) VALUES (
    p_job_id, v_owner, p_event_key, v_event_type, v_actor_key,
    v_current_state, coalesce(v_target_state, v_current_state), v_safe_url,
    lower(p_content_sha256), v_safe_evidence
  )
  RETURNING id INTO v_existing_id;

  IF v_changed OR v_safe_url IS NOT NULL OR p_next_action IS NOT NULL
     OR p_blocker_code IS NOT NULL OR p_attempt_count IS NOT NULL THEN
    UPDATE public.midad_browser_jobs AS j
    SET state = coalesce(v_target_state, j.state),
        current_url = coalesce(v_safe_url, j.current_url),
        next_action = coalesce(nullif(btrim(p_next_action), ''), j.next_action),
        blocker = CASE
          WHEN p_blocker_code IS NOT NULL THEN jsonb_build_object('code', p_blocker_code)
          WHEN v_target_state IS NOT NULL AND v_target_state NOT IN ('BLOCKED', 'FAILED') THEN '{}'::jsonb
          ELSE j.blocker
        END,
        attempt_count = v_next_attempts,
        started_at = CASE
          WHEN v_target_state = 'RUNNING' AND j.started_at IS NULL THEN now()
          ELSE j.started_at
        END,
        completed_at = CASE
          WHEN v_target_state IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN now()
          ELSE j.completed_at
        END,
        last_error = CASE
          WHEN p_blocker_code IS NOT NULL THEN p_blocker_code
          WHEN v_target_state IN ('RUNNING', 'COMPLETED') THEN NULL
          ELSE j.last_error
        END,
        updated_at = now()
    WHERE j.id = p_job_id;
  END IF;

  RETURN QUERY SELECT v_existing_id, p_job_id, coalesce(v_target_state, v_current_state), false;
END;
$function$;

REVOKE ALL ON FUNCTION public.midad_browser_record_evidence_v1(
  uuid, text, text, text, text, text, text, jsonb, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.midad_browser_record_evidence_v1(
  uuid, text, text, text, text, text, text, jsonb, text, text, integer
) TO service_role;
 THEN
        RAISE EXCEPTION 'invalid_or_unsafe_artifact_url' USING ERRCODE = '22023';
      END IF;
      IF position('?' in v_safe_artifact_url) > 0 OR position('#' in v_safe_artifact_url) > 0 THEN
        RAISE EXCEPTION 'artifact_url_query_or_fragment_not_allowed' USING ERRCODE = '22023';
      END IF;
      v_authority := split_part(split_part(v_safe_artifact_url, '://', 2), '/', 1);
      IF v_authority LIKE '%@%' THEN
        RAISE EXCEPTION 'artifact_url_credentials_not_allowed' USING ERRCODE = '22023';
      END IF;
      v_safe_evidence := jsonb_set(v_safe_evidence, ARRAY[v_key], to_jsonb(v_safe_artifact_url), false);
    END IF;
  END LOOP;

  SELECT j.owner_user_id, upper(j.state), j.attempt_count
    INTO v_owner, v_current_state, v_current_attempts
  FROM public.midad_browser_jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'browser_job_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Return an existing record for a retry of the same intent before mutating state.
  SELECT l.id
    INTO v_existing_id
  FROM public.midad_browser_evidence_ledger AS l
  WHERE l.job_id = p_job_id AND l.event_key = p_event_key;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing_id, p_job_id, v_current_state, true;
    RETURN;
  END IF;

  v_next_attempts := coalesce(p_attempt_count, v_current_attempts, 0);
  IF v_target_state IS NOT NULL AND v_target_state <> v_current_state THEN
    v_changed := true;

    IF NOT (
      (v_current_state = 'QUEUED' AND v_target_state IN ('PREPARING', 'BLOCKED', 'CANCELLED'))
      OR (v_current_state = 'PREPARING' AND v_target_state IN ('RUNNING', 'HUMAN_GATE', 'BLOCKED', 'FAILED', 'CANCELLED'))
      OR (v_current_state = 'RUNNING' AND v_target_state IN ('HUMAN_GATE', 'BLOCKED', 'FAILED', 'COMPLETED', 'CANCELLED'))
      OR (v_current_state = 'HUMAN_GATE' AND v_target_state IN ('RUNNING', 'BLOCKED', 'FAILED', 'CANCELLED'))
      OR (v_current_state = 'BLOCKED' AND v_target_state IN ('PREPARING', 'CANCELLED'))
      OR (v_current_state = 'FAILED' AND v_target_state IN ('PREPARING', 'CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'invalid_browser_state_transition: % -> %', v_current_state, v_target_state
        USING ERRCODE = '23514';
    END IF;

    IF v_current_state IN ('BLOCKED', 'FAILED') AND v_target_state = 'PREPARING' THEN
      v_next_attempts := coalesce(p_attempt_count, v_current_attempts + 1);
      IF v_next_attempts > 3 THEN
        RAISE EXCEPTION 'browser_retry_limit_exceeded' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.midad_browser_evidence_ledger (
    job_id, owner_user_id, event_key, event_type, actor_key,
    from_state, to_state, source_url, content_sha256, evidence
  ) VALUES (
    p_job_id, v_owner, p_event_key, v_event_type, v_actor_key,
    v_current_state, coalesce(v_target_state, v_current_state), v_safe_url,
    lower(p_content_sha256), v_safe_evidence
  )
  RETURNING id INTO v_existing_id;

  IF v_changed OR v_safe_url IS NOT NULL OR p_next_action IS NOT NULL
     OR p_blocker_code IS NOT NULL OR p_attempt_count IS NOT NULL THEN
    UPDATE public.midad_browser_jobs AS j
    SET state = coalesce(v_target_state, j.state),
        current_url = coalesce(v_safe_url, j.current_url),
        next_action = coalesce(nullif(btrim(p_next_action), ''), j.next_action),
        blocker = CASE
          WHEN p_blocker_code IS NOT NULL THEN jsonb_build_object('code', p_blocker_code)
          WHEN v_target_state IS NOT NULL AND v_target_state NOT IN ('BLOCKED', 'FAILED') THEN '{}'::jsonb
          ELSE j.blocker
        END,
        attempt_count = v_next_attempts,
        started_at = CASE
          WHEN v_target_state = 'RUNNING' AND j.started_at IS NULL THEN now()
          ELSE j.started_at
        END,
        completed_at = CASE
          WHEN v_target_state IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN now()
          ELSE j.completed_at
        END,
        last_error = CASE
          WHEN p_blocker_code IS NOT NULL THEN p_blocker_code
          WHEN v_target_state IN ('RUNNING', 'COMPLETED') THEN NULL
          ELSE j.last_error
        END,
        updated_at = now()
    WHERE j.id = p_job_id;
  END IF;

  RETURN QUERY SELECT v_existing_id, p_job_id, coalesce(v_target_state, v_current_state), false;
END;
$function$;

REVOKE ALL ON FUNCTION public.midad_browser_record_evidence_v1(
  uuid, text, text, text, text, text, text, jsonb, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.midad_browser_record_evidence_v1(
  uuid, text, text, text, text, text, text, jsonb, text, text, integer
) TO service_role;
