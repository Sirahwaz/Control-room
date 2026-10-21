-- Manual integration smoke test for midad_browser_evidence_ledger_v1.
-- Run only after the migration is applied to a Supabase database with at least
-- one existing profile. This single DO statement removes its own test job/evidence.
-- Any assertion failure aborts the statement and rolls back its writes.

DO $test$
DECLARE
  v_owner uuid;
  v_job uuid;
  v_evidence_id uuid;
  v_state text;
  v_idempotent boolean;
  v_count integer;
  v_source_url text;
  v_artifact_url text;
  v_rejected boolean;
BEGIN
  SELECT p.id INTO v_owner
  FROM public.profiles AS p
  ORDER BY p.created_at
  LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'test_requires_an_existing_profile';
  END IF;

  INSERT INTO public.midad_browser_jobs (
    owner_user_id, agent_key, platform_key, objective, state, session_ref,
    input_data, profile_snapshot, human_gate, blocker, evidence, next_action, attempt_count
  ) VALUES (
    v_owner, 'ledger_smoke_test', NULL, 'Evidence ledger integration smoke',
    'PREPARING', 'ledger-smoke-' || gen_random_uuid()::text,
    '{}'::jsonb, '{}'::jsonb, '{"required": false, "status": "none"}'::jsonb,
    '{}'::jsonb, '{}'::jsonb, 'test_only', 0
  )
  RETURNING id INTO v_job;

  SELECT r.evidence_id, r.state, r.idempotent
  INTO v_evidence_id, v_state, v_idempotent
  FROM public.midad_browser_record_evidence_v1(
    v_job,
    'ledger-smoke-0001',
    'job_created',
    'ledger_smoke_test',
    'RUNNING',
    'https://taskmarket.dev/tasks?api_key=must-not-persist#fragment',
    repeat('a', 64),
    jsonb_build_object(
      'source_kind', 'integration_test',
      'http_status', 200,
      'artifact_url', 'https://example.com/report.json?signature=must-not-persist',
      'artifact_sha256', repeat('b', 64)
    ),
    'test_only',
    NULL,
    NULL
  ) AS r;

  IF v_state <> 'RUNNING' OR v_idempotent IS TRUE OR v_evidence_id IS NULL THEN
    RAISE EXCEPTION 'initial_transition_failed';
  END IF;

  SELECT l.source_url, l.evidence ->> 'artifact_url'
  INTO v_source_url, v_artifact_url
  FROM public.midad_browser_evidence_ledger AS l
  WHERE l.id = v_evidence_id;

  IF v_source_url <> 'https://taskmarket.dev/tasks' THEN
    RAISE EXCEPTION 'source_url_was_not_sanitized: %', v_source_url;
  END IF;
  IF v_artifact_url <> 'https://example.com/report.json' THEN
    RAISE EXCEPTION 'artifact_url_was_not_sanitized: %', v_artifact_url;
  END IF;

  -- Replaying the same event key must be idempotent and must not change state.
  SELECT r.state, r.idempotent
  INTO v_state, v_idempotent
  FROM public.midad_browser_record_evidence_v1(
    v_job,
    'ledger-smoke-0001',
    'error',
    'ledger_smoke_test',
    'FAILED',
    NULL,
    NULL,
    '{}'::jsonb,
    'should_not_run',
    'REPLAY',
    NULL
  ) AS r;

  IF v_state <> 'RUNNING' OR v_idempotent IS NOT TRUE THEN
    RAISE EXCEPTION 'idempotency_check_failed';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.midad_browser_evidence_ledger AS l
  WHERE l.job_id = v_job AND l.event_key = 'ledger-smoke-0001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'idempotency_created_duplicate_rows: %', v_count;
  END IF;

  -- A normal state update must never self-assert that funds were received.
  v_rejected := false;
  BEGIN
    PERFORM r.evidence_id
    FROM public.midad_browser_record_evidence_v1(
      v_job, 'ledger-smoke-0002', 'payment_claim_observed', 'ledger_smoke_test',
      'PAID', NULL, NULL, '{}'::jsonb, NULL, NULL, NULL
    ) AS r;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF v_rejected IS NOT TRUE THEN
    RAISE EXCEPTION 'general_transition_rpc_allowed_paid_state';
  END IF;

  SELECT j.state INTO v_state FROM public.midad_browser_jobs AS j WHERE j.id = v_job;
  IF v_state <> 'RUNNING' THEN
    RAISE EXCEPTION 'blocked_paid_transition_changed_job_state: %', v_state;
  END IF;

  -- Invalid transitions must fail closed.
  v_rejected := false;
  BEGIN
    PERFORM r.evidence_id
    FROM public.midad_browser_record_evidence_v1(
      v_job, 'ledger-smoke-0003', 'state_transition', 'ledger_smoke_test',
      'QUEUED', NULL, NULL, '{}'::jsonb, NULL, NULL, NULL
    ) AS r;
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF v_rejected IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid_state_transition_was_allowed';
  END IF;

  -- Cleanup is part of this successful smoke test; no test rows are retained.
  DELETE FROM public.midad_browser_evidence_ledger WHERE job_id = v_job;
  DELETE FROM public.midad_browser_jobs WHERE id = v_job;
END;
$test$;


-- Smoke-auth harness contract: one-shot Vault reference, expiry, and narrowly-scoped cleanup.
DO $smoke_auth_test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_secret uuid := gen_random_uuid();
  v_token text := repeat('smoketest', 8);
  v_run text := 'midad-browser-smoke:00112233-4455-6677-8899-aabbccddeeff';
  v_token_id uuid;
  v_authorized_id uuid;
  v_second_authorization uuid;
  v_job uuid;
  v_cleanup jsonb;
  v_count integer;
  v_state text;
  v_idempotent boolean;
BEGIN
  INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES (
    v_owner,
    'midad-browser-smoke-fixture@example.invalid',
    jsonb_build_object(
      'midad_browser_smoke_identity', 'true',
      'midad_browser_smoke_run', v_run
    )
  );

  INSERT INTO vault.secrets(id, name, description, secret)
  VALUES (v_secret, 'midad:browser:smoke:fixture', 'isolated smoke fixture only', v_token);

  INSERT INTO public.midad_browser_smoke_tokens(vault_secret_id, token_sha256, expires_at)
  VALUES (
    v_secret,
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    now() + interval '5 minutes'
  )
  RETURNING id INTO v_token_id;

  v_authorized_id := public.midad_browser_smoke_authorize_v1(v_token);
  IF v_authorized_id IS DISTINCT FROM v_token_id THEN
    RAISE EXCEPTION 'one_shot_token_authorization_failed';
  END IF;

  v_second_authorization := public.midad_browser_smoke_authorize_v1(v_token);
  IF v_second_authorization IS NOT NULL THEN
    RAISE EXCEPTION 'one_shot_token_was_reusable';
  END IF;

  IF public.midad_browser_smoke_cleanup_token_v1(v_token_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'one_shot_token_cleanup_failed';
  END IF;

  IF EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_secret)
     OR EXISTS (SELECT 1 FROM public.midad_browser_smoke_tokens WHERE id = v_token_id) THEN
    RAISE EXCEPTION 'smoke_secret_or_token_row_remains';
  END IF;

  INSERT INTO public.midad_browser_jobs (
    owner_user_id, agent_key, platform_key, objective, state, session_ref,
    input_data, profile_snapshot, human_gate, blocker, evidence, next_action, attempt_count
  ) VALUES (
    v_owner,
    'midad_gateway_smoke',
    NULL,
    'MIDAD Browser Gateway Smoke Test (temporary; safe to delete)',
    'PREPARING',
    v_run,
    '{}'::jsonb,
    '{}'::jsonb,
    '{"required": false, "status": "none"}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    'test_cleanup',
    0
  )
  RETURNING id INTO v_job;

  -- Exercise the isolated human-gate state-machine path before cleanup.
  SELECT r.state, r.idempotent INTO v_state, v_idempotent
  FROM public.midad_browser_record_evidence_v1(
    v_job,
    'smoke-human-gate-open-0001',
    'human_gate_opened',
    'ledger_smoke_test',
    'HUMAN_GATE',
    'https://example.com/smoke',
    repeat('c', 64),
    jsonb_build_object('source_kind', 'smoke_test'),
    'wait_for_human_gate',
    NULL,
    NULL
  ) AS r;
  IF v_state <> 'HUMAN_GATE' OR v_idempotent IS TRUE THEN
    RAISE EXCEPTION 'human_gate_open_transition_failed: state %, idempotent %', v_state, v_idempotent;
  END IF;

  SELECT r.state, r.idempotent INTO v_state, v_idempotent
  FROM public.midad_browser_record_evidence_v1(
    v_job,
    'smoke-human-gate-resume-0001',
    'human_gate_resumed',
    'ledger_smoke_test',
    'RUNNING',
    'https://example.com/smoke',
    repeat('c', 64),
    jsonb_build_object('source_kind', 'smoke_test'),
    'resume_browser_session',
    NULL,
    NULL
  ) AS r;
  IF v_state <> 'RUNNING' OR v_idempotent IS TRUE THEN
    RAISE EXCEPTION 'human_gate_resume_transition_failed: state %, idempotent %', v_state, v_idempotent;
  END IF;

  -- Replaying the resume event with different requested state must be a no-op.
  SELECT r.state, r.idempotent INTO v_state, v_idempotent
  FROM public.midad_browser_record_evidence_v1(
    v_job,
    'smoke-human-gate-resume-0001',
    'job_cancelled',
    'ledger_smoke_test',
    'CANCELLED',
    NULL,
    NULL,
    '{}'::jsonb,
    'should_not_run',
    NULL,
    NULL
  ) AS r;
  IF v_state <> 'RUNNING' OR v_idempotent IS NOT TRUE THEN
    RAISE EXCEPTION 'human_gate_resume_idempotency_failed: state %, idempotent %', v_state, v_idempotent;
  END IF;

  SELECT r.state, r.idempotent INTO v_state, v_idempotent
  FROM public.midad_browser_record_evidence_v1(
    v_job,
    'smoke-cancel-job-0001',
    'job_cancelled',
    'ledger_smoke_test',
    'CANCELLED',
    NULL,
    NULL,
    jsonb_build_object('source_kind', 'smoke_test', 'policy_code', 'TEST_CANCELLED'),
    'test_cleanup',
    NULL,
    NULL
  ) AS r;
  IF v_state <> 'CANCELLED' OR v_idempotent IS TRUE THEN
    RAISE EXCEPTION 'human_gate_cancel_transition_failed: state %, idempotent %', v_state, v_idempotent;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.midad_browser_jobs
    WHERE id = v_job AND state = 'CANCELLED' AND completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cancelled_job_state_or_completed_at_missing';
  END IF;

  INSERT INTO public.midad_agent_events(job_id, agent_key, event_type, state, payload)
  VALUES (v_job, 'ledger_smoke_test', 'job_created', 'PREPARING', '{"test_only": true}'::jsonb);

  v_cleanup := public.midad_browser_smoke_cleanup_job_v1(v_owner, v_run);
  IF (v_cleanup ->> 'deleted_jobs')::integer <> 1
     OR (v_cleanup ->> 'deleted_events')::integer <> 1
     OR (v_cleanup ->> 'deleted_evidence')::integer <> 3 THEN
    RAISE EXCEPTION 'test_job_cleanup_contract_failed: %', v_cleanup;
  END IF;

  DELETE FROM auth.users WHERE id = v_owner;

  SELECT count(*) INTO v_count FROM public.midad_browser_jobs;
  IF v_count <> 0 THEN RAISE EXCEPTION 'smoke_test_left_browser_jobs: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.midad_browser_evidence_ledger;
  IF v_count <> 0 THEN RAISE EXCEPTION 'smoke_test_left_evidence_rows: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.midad_browser_smoke_tokens;
  IF v_count <> 0 THEN RAISE EXCEPTION 'smoke_test_left_tokens: %', v_count; END IF;
END;
$smoke_auth_test$;
