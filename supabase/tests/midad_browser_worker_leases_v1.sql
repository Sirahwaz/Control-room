-- Atomic operator-job claim/lease contract test.
-- Runs only against the disposable PostgreSQL service used by CI.
-- All rows created here are deleted before the transaction completes.

DO $lease_test$
DECLARE
  v_owner uuid;
  v_first_job uuid;
  v_non_operator_job uuid;
  v_claimed_id uuid;
  v_claim_count integer;
  v_first_hash text := repeat('a', 64);
  v_second_hash text := repeat('b', 64);
  v_worker_a text := 'lease-test-worker-a';
  v_worker_b text := 'lease-test-worker-b';
  v_renewed boolean;
  v_released boolean;
  v_old_valid boolean;
  v_new_valid boolean;
  v_bad_rejected boolean := false;
  v_old_expiry timestamptz;
BEGIN
  SELECT id INTO v_owner FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'lease_test_requires_seed_profile'; END IF;

  INSERT INTO public.midad_browser_jobs (
    owner_user_id, agent_key, platform_key, objective, state, session_ref,
    input_data, profile_snapshot, human_gate, blocker, evidence, attempt_count
  ) VALUES (
    v_owner, 'midad_operator_command_router', NULL, 'Atomic lease fixture',
    'PREPARING', 'lease-test:' || gen_random_uuid()::text,
    '{"operator_hint":"Example"}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    '{}'::jsonb, 0
  ) RETURNING id INTO v_first_job;

  INSERT INTO public.midad_browser_jobs (
    owner_user_id, agent_key, platform_key, objective, state, session_ref,
    input_data, profile_snapshot, human_gate, blocker, evidence, attempt_count
  ) VALUES (
    v_owner, 'ordinary_browser_job', NULL, 'Non-operator fixture',
    'PREPARING', 'lease-test-non-operator:' || gen_random_uuid()::text,
    '{"objective":"ordinary browser job"}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    '{}'::jsonb, 0
  ) RETURNING id INTO v_non_operator_job;

  SELECT count(*) INTO v_claim_count
  FROM public.midad_browser_claim_operator_jobs_v1(
    v_owner, v_worker_a, v_first_hash, 120, 5
  );
  IF v_claim_count <> 1 THEN
    RAISE EXCEPTION 'first_worker_claim_count_invalid: %', v_claim_count;
  END IF;

  SELECT id, lease_expires_at INTO v_claimed_id, v_old_expiry
  FROM public.midad_browser_jobs WHERE id = v_first_job;
  IF v_claimed_id IS NULL OR v_old_expiry <= clock_timestamp() THEN
    RAISE EXCEPTION 'lease_not_recorded_or_not_future_dated';
  END IF;
  IF NOT public.midad_browser_validate_operator_lease_v1(
    v_first_job, v_owner, v_worker_a, v_first_hash
  ) THEN RAISE EXCEPTION 'valid_lease_rejected'; END IF;

  SELECT count(*) INTO v_claim_count
  FROM public.midad_browser_claim_operator_jobs_v1(
    v_owner, v_worker_b, v_second_hash, 120, 5
  );
  IF v_claim_count <> 0 THEN
    RAISE EXCEPTION 'second_worker_claimed_an_active_lease';
  END IF;

  IF public.midad_browser_validate_operator_lease_v1(
    v_first_job, v_owner, v_worker_b, v_first_hash
  ) THEN RAISE EXCEPTION 'wrong_worker_passed_lease_validation'; END IF;
  IF public.midad_browser_validate_operator_lease_v1(
    v_first_job, v_owner, v_worker_a, v_second_hash
  ) THEN RAISE EXCEPTION 'wrong_token_passed_lease_validation'; END IF;

  v_renewed := public.midad_browser_renew_operator_lease_v1(
    v_first_job, v_owner, v_worker_a, v_first_hash, 180
  );
  IF v_renewed IS NOT TRUE THEN RAISE EXCEPTION 'valid_lease_renewal_failed'; END IF;

  v_released := public.midad_browser_release_operator_lease_v1(
    v_first_job, v_owner, v_worker_b, v_first_hash
  );
  IF v_released IS NOT FALSE THEN RAISE EXCEPTION 'wrong_worker_released_lease'; END IF;

  -- Simulate worker death: only an expired lease is reclaimable.
  UPDATE public.midad_browser_jobs
  SET lease_expires_at = clock_timestamp() - interval '1 second'
  WHERE id = v_first_job;

  SELECT count(*) INTO v_claim_count
  FROM public.midad_browser_claim_operator_jobs_v1(
    v_owner, v_worker_b, v_second_hash, 120, 5
  );
  IF v_claim_count <> 1 THEN RAISE EXCEPTION 'expired_lease_not_reclaimed'; END IF;

  IF public.midad_browser_validate_operator_lease_v1(
    v_first_job, v_owner, v_worker_a, v_first_hash
  ) THEN RAISE EXCEPTION 'expired_previous_worker_lease_still_valid'; END IF;
  IF NOT public.midad_browser_validate_operator_lease_v1(
    v_first_job, v_owner, v_worker_b, v_second_hash
  ) THEN RAISE EXCEPTION 'replacement_worker_lease_not_valid'; END IF;

  v_released := public.midad_browser_release_operator_lease_v1(
    v_first_job, v_owner, v_worker_b, v_second_hash
  );
  IF v_released IS NOT TRUE THEN RAISE EXCEPTION 'valid_lease_release_failed'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.midad_browser_jobs
    WHERE id = v_first_job
      AND (lease_owner IS NOT NULL OR lease_token_sha256 IS NOT NULL
           OR lease_expires_at IS NOT NULL OR claimed_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'released_lease_fields_not_cleared'; END IF;

  v_bad_rejected := false;
  BEGIN
    PERFORM 1 FROM public.midad_browser_claim_operator_jobs_v1(
      v_owner, v_worker_a, v_first_hash, 5, 1
    );
  EXCEPTION WHEN invalid_parameter_value THEN v_bad_rejected := true;
  END;
  IF v_bad_rejected IS NOT TRUE THEN RAISE EXCEPTION 'invalid_lease_duration_was_accepted'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.midad_browser_jobs
    WHERE id = v_non_operator_job
      AND lease_owner IS NOT NULL
  ) THEN RAISE EXCEPTION 'non_operator_job_was_claimed'; END IF;

  IF has_function_privilege('anon',
       'public.midad_browser_claim_operator_jobs_v1(uuid,text,text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.midad_browser_claim_operator_jobs_v1(uuid,text,text,integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.midad_browser_claim_operator_jobs_v1(uuid,text,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'claim_rpc_privilege_boundary_failed';
  END IF;

  DELETE FROM public.midad_browser_jobs WHERE id IN (v_first_job, v_non_operator_job);
END;
$lease_test$;
