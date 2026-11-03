-- MIDAD Wide Income Discovery: register Jobbi as an index-only source.
-- Apply only after the matching midad_revenue_intelligence_mesh adapter is deployed.
-- This inserts source metadata only; it does not create opportunities or prove payout.

INSERT INTO public.midad_income_sources (
  slug, name, base_url, payment_assets, network, access_mode, automation_mode,
  api_url, status, priority, fee_model, trust_notes, capabilities, metadata,
  source_category, official_terms_url, official_payout_url, payout_proof_status,
  account_policy, kyc_requirement, automation_policy, minimum_withdrawal,
  free_offer, eligibility_gates, risk_flags, confidence_score
)
VALUES (
  'jobbi_gigs_index',
  'Jobbi multi-board agent gigs index',
  'https://jobbi.org',
  ARRAY['USDC','BTC']::text[],
  'listing-specific',
  'public_json',
  'read_only',
  'https://jobbi.org/gigs.json?lane=agent&currency=USDC&limit=50',
  'active_discovery',
  56,
  'index_free; downstream board fees unknown',
  'Discovery index only; Jobbi does not pay or escrow. The original board is authoritative. Index payout_grade and payment_state are metadata only and never constitute task-level funding or settlement proof.',
  ARRAY[
    'agent_work_index',
    'AI automation',
    'API integration',
    'Python',
    'TypeScript',
    'SQL',
    'QA testing',
    'technical research',
    'data processing',
    'documentation'
  ]::text[],
  jsonb_build_object(
    'revenue_intel_parser','jobbi_json_feed',
    'max_items',50,
    'official_domain','jobbi.org',
    'discovery_mode','index_only',
    'poll_interval_hours',1,
    'allowed_lanes',jsonb_build_array('agent'),
    'allowed_currencies',jsonb_build_array('USDC'),
    'independent_payment_proof_required',true
  ),
  'digital_work',
  'https://jobbi.org/terms',
  NULL,
  'unverified',
  'no_account_required',
  'unknown',
  'api_allowed',
  '{}'::jsonb,
  jsonb_build_object(
    'feed_format','JSON Feed 1.1',
    'access','public_unauthenticated',
    'refresh','hourly',
    'max_items',50
  ),
  jsonb_build_object(
    'index_only',true,
    'require_original_board_url',true,
    'require_open_listing',true,
    'require_unexpired_deadline',true,
    'require_crypto_asset',true,
    'exclude_fiat',true,
    'require_task_specific_payout_proof',true,
    'require_independent_funding_or_settlement_proof',true
  ),
  ARRAY[
    'aggregator_not_payer',
    'original_board_terms_required',
    'external_listing_urls_untrusted',
    'mixed_fiat_and_crypto_index',
    'listing_metadata_not_escrow_proof'
  ]::text[],
  0.55
)
ON CONFLICT (slug) DO NOTHING;
