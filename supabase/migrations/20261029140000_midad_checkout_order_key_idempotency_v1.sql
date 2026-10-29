-- Prevent a client-generated public checkout key from identifying multiple store orders.
-- Fail closed rather than silently choosing a row if the invariant is already violated.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.midad_store_orders
    WHERE public_order_key IS NOT NULL
    GROUP BY public_order_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'checkout_order_key_idempotency_migration_aborted_duplicate_keys';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS midad_store_orders_public_order_key_uidx
  ON public.midad_store_orders (public_order_key)
  WHERE public_order_key IS NOT NULL;
