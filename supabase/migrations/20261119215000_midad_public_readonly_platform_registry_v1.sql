-- Register the internal public read-only browser runtime as a valid
-- midad_browser_jobs platform_key. This is not an income marketplace or payout
-- destination; it is an execution capability with strict read-only controls.
INSERT INTO public.midad_platform_registry (
  platform_key,
  name,
  base_url,
  category,
  supported_actions,
  registration_level,
  verification_requirements,
  allowed_automation,
  forbidden_automation,
  status,
  notes
) VALUES (
  'public_read_only',
  'MIDAD Public Read-only Browser',
  NULL,
  'browser_runtime',
  ARRAY['public_page_navigation', 'public_evidence_capture']::text[],
  'none',
  '{"authentication":"not_required","scope":"public_https_only"}'::jsonb,
  '{"public_research":true,"page_capture":true,"navigation":true}'::jsonb,
  '{"credential_entry":true,"form_submission":true,"captcha_bypass":true,"kyc_bypass":true,"financial_actions":true,"destructive_actions":true,"wallet_signing":true}'::jsonb,
  'active',
  'Internal MIDAD browser execution capability; not an external income platform or payout destination. Exact host allowlist and GitHub OIDC worker policy apply.'
)
ON CONFLICT (platform_key) DO NOTHING;
