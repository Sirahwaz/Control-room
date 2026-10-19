-- Quarantine the uGig submission lane when the authenticated external profile is flagged as spam.
-- This is deliberately fail-closed. A human/platform review is required before re-enabling submissions.

update public.midad_revenue_policy
set allow_auto_submission = false,
    allow_auto_ugig = false,
    updated_at = now()
where owner_scope = 'midad';

update public.midad_platform_accounts
set account_status = 'BLOCKED',
    last_error_code = 'EXTERNAL_PROFILE_FLAGGED_SPAM',
    last_error_detail = 'The authenticated uGig profile response reports is_spam=true. Multiple earlier applications were archived with archived_reason=spam and metadata.held=spam_review. Pause all new applications until uGig support/review clears the profile.',
    verification_snapshot = coalesce(verification_snapshot, '{}'::jsonb) || jsonb_build_object(
      'external_profile_status', 'SPAM_REVIEW',
      'external_profile_is_spam', true,
      'external_profile_checked_at', now(),
      'new_application_submission_allowed', false,
      'reason', 'official_gateway_profile_and_application_history'
    ),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'external_profile_status', 'SPAM_REVIEW',
      'external_profile_is_spam', true,
      'submission_gate', 'BLOCKED',
      'submission_gate_reason', 'EXTERNAL_PROFILE_FLAGGED_SPAM',
      'observed_via', 'midad_ugig_gateway:profile',
      'observed_at', now(),
      'archive_evidence', jsonb_build_object(
        'archived_reason', 'spam',
        'held_marker', 'spam_review',
        'automatic_resubmission', false
      ),
      'required_clearance', 'official_support_or_platform_review',
      'auto_submission_paused', true
    ),
    updated_at = now()
where platform_key = 'ugig'
  and owner_scope = 'midad'
  and brand_key = 'midad_ai';

insert into public.midad_platform_account_events
  (event_key, account_id, platform_key, actor_key, event_type, from_state, to_state, evidence, details)
select
  'ugig-profile-spam-quarantine-20261010',
  id, 'ugig', 'midad_platform_policy_verifier',
  'external_profile_flagged_spam',
  'POLICY_REVIEW', 'BLOCKED',
  jsonb_build_array(
    jsonb_build_object('source','midad_ugig_gateway:profile','field','is_spam','value',true,'checked_at',now()),
    jsonb_build_object('source','midad_ugig_gateway:applications','field','archived_reason','value','spam','checked_at',now())
  ),
  jsonb_build_object(
    'action','pause_new_applications',
    'reason','external_profile_flagged_spam',
    'auto_submission_disabled',true,
    'wallet_actions',false,
    'identity_bypass',false
  )
from public.midad_platform_accounts
where platform_key='ugig' and owner_scope='midad' and brand_key='midad_ai'
on conflict (event_key) do nothing;

insert into public.midad_account_factory_runs
  (run_key, account_id, platform_key, task_type, agent_key, state,
   input_payload, output_payload, blockers, evidence, next_action, attempt_count, updated_at)
select
  'ugig_account_health_gate:midad_ai:20261010',
  id, 'ugig', 'account_health_gate', 'midad_platform_policy_verifier', 'BLOCKED',
  '{"trigger":"authenticated_profile_and_application_audit","external_write":false}'::jsonb,
  '{"external_profile_is_spam":true,"new_applications_paused":true,"clearance_required":"official_support_or_platform_review"}'::jsonb,
  '[{"code":"EXTERNAL_PROFILE_FLAGGED_SPAM","detail":"Do not submit additional applications to uGig until the platform clears the flag."}]'::jsonb,
  '[{"source":"midad_ugig_gateway:profile","field":"is_spam","value":true},{"source":"midad_ugig_gateway:applications","archived_reason":"spam","held":"spam_review"}]'::jsonb,
  'request_platform_review_and_revalidate_profile',
  0, now()
from public.midad_platform_accounts
where platform_key='ugig' and owner_scope='midad' and brand_key='midad_ai'
on conflict (run_key) do update set
  state='BLOCKED',
  blockers=excluded.blockers,
  output_payload=excluded.output_payload,
  next_action=excluded.next_action,
  updated_at=now();
