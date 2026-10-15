-- MIDAD checkout Base USDC receive and receipt reconciliation hardening
-- Non-destructive indexes only. No wallet funds or payment rows are changed.
-- This is paired with the midad_public_checkout and midad_base_usdc_monitor edge updates.

CREATE UNIQUE INDEX IF NOT EXISTS idx_midad_payment_events_intent_tx_event_unique
  ON public.midad_payment_events (payment_intent_id, tx_hash, event_type)
  WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_base_receipt_match
  ON public.midad_payment_intents (wallet_address, expires_at, status)
  WHERE network = 'base'
    AND settlement_asset = 'USDC'
    AND wallet_address IS NOT NULL;
