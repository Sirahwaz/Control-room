UPDATE public.midad_income_sources
SET
  network = 'listing-specific (Base 8453/USDC; Tempo 4217/OUSD)',
  payment_assets = ARRAY['USDC', 'OUSD']::text[],
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'supported_payment_rails', jsonb_build_array(
      jsonb_build_object('chain_id', 8453, 'network', 'Base', 'asset', 'USDC', 'production', true),
      jsonb_build_object('chain_id', 4217, 'network', 'Tempo', 'asset', 'OUSD', 'production', true),
      jsonb_build_object('chain_id', 84532, 'network', 'Base Sepolia', 'asset', 'USDC', 'production', false),
      jsonb_build_object('chain_id', 42431, 'network', 'Tempo Moderato', 'asset', 'OUSD', 'production', false)
    ),
    'chain_mapping_verified_at', '2026-11-10T08:15:00Z',
    'chain_mapping_source', 'Taskmarket network documentation and live task API chainId'
  ),
  updated_at = now()
WHERE slug = 'taskmarket_api';
