-- Atomic public read-only browser claim contract test.
-- Runs only against the disposable PostgreSQL service used by CI.

DO $readonly_claim_test$
DECLARE
  v_owner uuid;
  v_readonly_job uuid;
  v_readonly_session_ref text;
  v_duplicate_job uuid;
  v_duplicate_rejected boolean := false;
  v_operator_job uuid;
  v_ordinary_job uuid;
  v_no_url_job uuid;
  v_claimed_id uuid;
  v_claim_count integer;
  v_hash_a text := repeat('c', 64);
  v_hash_b text := repeat('d', 64);
  v_worker_a text := 'readonly-test-worker-a';
  v_worker_b text := 'readonly-test-worker-b';
  v_old_valid boolean;
  v_new_valid boolean;
  v_bad_rejected boolean := false;
BEGIN
  SELECT id INTO v_owner FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'readonly_claim_test_requires_seed_profile'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.midad_platform_registry
    WHERE platform_key = 'public_read_only'
      AND status = 'active'
      AND allowed_automation ->> 'public_research' = 'true'
      AND forbidden_automation ->> 'credential_entry' = 'true'
  ) THEN
    RAISE EXCEPTION 'public_readonly_platform_registry_missing_or_unsafe';
  END IF;

  INSERT INTO public.midad_browser_jobs (
    owner_user_id, agent_key, platform_key, objective, state, session_ref, current_url,
    input_data, profile_snapshot, human_gate, blocker, evidence, attempt_count
  ) VALUES (
    v_owner, 'midad_public_research', 'public_read_only', 'Read-only public evidence fixture',
    'PREPARING', 'browser-readonly:test:' || gen_random_uuid()::text, 'https://example.com/',
    '{"mode":"public_read_only"}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    '{}'::jsonb, 0
  ) RETURNING id, session_ref INTO v_readonly_job, v_readonly_session_ref;

  BEGIN
    INSERT INTO public.midad_browser_jobs (
      owner_user_id, agent_key, platform_key, objective, state, session_ref, current_url,
      input_data, profile_snapshot, human_gate, blocker, evidence, attempt_count
    ) VALUES (
      v_owner, 'midad_public_research', 'public_read_only', 'Duplicate public read-only fixture',
      'PREPARING', v_readonly_session_ref, 'https://example.com/',
      '{"mode":"public_read_only"}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      '{}'::jsonb, 0
    ) RETURNING id INTO v_duplicate_job;
  EXCEPTION WHEN unique_violation THEN
    v_duplicate_rejected := true;
  END;
  IF NOT v_duplicate_rejected THEN
    DELETE FROM public.midad_browser_jobs WHERE id = v_duplicate_job;
    RAISE EXCEPTION 'duplicate_public_readonly_request_was_not_rejected';
  END IF;

  INSERT INTO public.midad_browser_jobs (
    owner_user_id, agent_key, platform_key, objective, state, session_ref, current_url,
    input_data, profile_snapshot, human_gate, blocker, evidence, attempt_count
  ) VALUES (
    v_owner, 'midad_operator_command_router', NULL, 'Operator job must not enter public worker',
    'PREPARING', 'readonly-test-operator:' || gen_random_uuid()::text, 'https://example.com/',
    '{"operator_hint":"do not claim"}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    '{}'::jsonb, 0
  ) RETURNING id INTO v_operator_job;

  INSERT INTO public.midad_browser_jobs (
    owner_user_id, agent_key, platform_key, objective, state, session_ref, current_url,
    input_data, profile_snapshot, human_gate, blocker, evidence, attempt_count
  ) VALUES (
    v_owner, 'midad_general_research', NULL, 'Ordinary browser job must not enter public worker',
    'PREPARING', 'readonly-test-ordinary:' || gen_random_uuid()::text, 'https://example.com/',
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 0
  ) RETURNING id INTO v_ordinary_job;

  INSERT INTO public.midad_browser_jobs (
    owner_user_id, agent_key, platform_key, objective, state, session_ref, current_url,
    input_data, profile_snapshot, human_gate, blocker, evidence, attempt_count
  ) VALUES (
    v_owner, 'midad_public_research', NULL, 'Job without target URL must not be claimed',
    'PREPARING', 'readonly-test-no-url:' || gen_random_uuid()::text, NULL,
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 0
  ) RETURNING id INTO v_no_url_job;

  SELECT count(*) INTO v_claim_count
  FROM public.midad_browser_claim_readonly_jobs_v1(
    v_owner, v_worker_a, v_hash_a, 300, 1
  );
  IF v_claim_count <> 1 THEN
    RAISE EXCEPTION 'readonly_claim_count_invalid: %', v_claim_count;
  END IF;

  SELECT id INTO v_claimed_id
  FROM public.midad_browser_jobs
  WHERE id = v_readonly_job
    AND lease_owner = v_worker_a
    AND lease_token_sha256 = v_hash_a;
  IF v_claimed_id IS NULL THEN RAISE EXCEPTION 'readonly_job_not_leased_to_first_worker'; END IF;

  IF NOT public.midad_browser_validate_operator_lease_v1(
    v_readonly_job, v_owner, v_worker_a, v_hash_a
  ) THEN RAISE EXCEPTION 'readonly_worker_lease_validation_failed'; END IF;

  UPDATE public.midad_browser_jobs SET state = 'RUNNING' WHERE id = v_readonly_job;

  SELECT count(*) INTO v_claim_count
  FROM public.midad_browser_claim_readonly_jobs_v1(
    v_owner, v_worker_b, v_hash_b, 300, 1
  );
  IF v_claim_count <> 0 THEN RAISE EXCEPTION 'second_worker_claimed_active_readonly_lease'; END IF;

  UPDATE public.midad_browser_jobs
  SET lease_expires_at = clock_timestamp() - interval '1 second'
  WHERE id = v_readonly_job;

  SELECT count(*) INTO v_claim_count
  FROM public.midad_browser_claim_readonly_jobs_v1(
    v_owner, v_worker_b, v_hash_b, 300, 1
  );
  IF v_claim_count <> 1 THEN RAISE EXCEPTION 'expired_readonly_running_job_not_reclaimed'; END IF;

  IF public.midad_browser_validate_operator_lease_v1(
    v_readonly_job, v_owner, v_worker_a, v_hash_a
  ) THEN RAISE EXCEPTION 'previous_readonly_worker_lease_still_valid'; END IF;
  IF NOT public.midad_browser_validate_operator_lease_v1(
    v_readonly_job, v_owner, v_worker_b, v_hash_b
  ) THEN RAISE EXCEPTION 'replacement_readonly_worker_lease_invalid'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.midad_browser_jobs
    WHERE id IN (v_operator_job, v_ordinary_job, v_no_url_job) AND lease_owner IS NOT NULL
  ) THEN RAISE EXCEPTION 'operator_or_no_url_job_was_claimed'; END IF;

  v_bad_rejected := false;
  BEGIN
    PERFORM 1 FROM public.midad_browser_claim_readonly_jobs_v1(
      v_owner, v_worker_a, v_hash_a, 5, 1
    );
  EXCEPTION WHEN invalid_parameter_value THEN v_bad_rejected := true;
  END;
  IF NOT v_bad_rejected THEN RAISE EXCEPTION 'invalid_readonly_lease_duration_accepted'; END IF;

  IF has_function_privilege('anon',
       'public.midad_browser_claim_readonly_jobs_v1(uuid,text,text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.midad_browser_claim_readonly_jobs_v1(uuid,text,text,integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.midad_browser_claim_readonly_jobs_v1(uuid,text,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'readonly_claim_privilege_boundary_failed';
  END IF;

  DELETE FROM public.midad_browser_jobs
  WHERE id IN (v_readonly_job, v_operator_job, v_ordinary_job, v_no_url_job);
END;
$readonly_claim_test$;
