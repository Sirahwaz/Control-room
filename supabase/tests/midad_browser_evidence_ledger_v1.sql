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
    v_owner, 'ledger_smoke_test', 'midad_test', 'Evidence ledger integration smoke',
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
