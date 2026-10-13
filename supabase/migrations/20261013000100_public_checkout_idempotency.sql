-- Enforce one active checkout intent per user-supplied public order key.
-- Expired intents release the key; pending/paid intents remain idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS midad_payment_intents_public_order_key_active_uidx
ON public.midad_payment_intents (user_id, (metadata->>'public_order_key'))
WHERE metadata ? 'public_order_key'
  AND status IN ('created','quoted','detected','verified','paid','reconciled');
