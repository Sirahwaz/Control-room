-- Standalone PostgreSQL integration contract tests. The workflow creates isolated fixture tables first.
do $$
declare
  v_order_id uuid;
  v_job_id uuid;
  v_hash text;
  v_evidence_count integer;
  v_result jsonb;
begin
  -- A PAID-like order must not enqueue unless the associated intent is verified and matched.
  insert into public.midad_payment_intents(id,status,reconciliation_status,amount_fiat,fiat_currency,settlement_asset,network,quoted_crypto_amount,wallet_address,received_tx_hash,metadata)
  values ('11111111-1111-4111-8111-111111111111','quoted','pending',5,'USD','USDC','base',5.000123,'0x1111111111111111111111111111111111111111',null,
    '{"created_by":"midad_public_checkout_v1","product_id":"payment-path-mini-v1"}');
  insert into public.midad_store_orders(id,payment_intent_id,product_id,product_name,status,customer_requirements,metadata)
  values ('11111111-1111-4111-8111-111111111112','11111111-1111-4111-8111-111111111111','payment-path-mini-v1','Diagnostic','AWAITING_PAYMENT','review one public checkout','{}');
  update public.midad_store_orders set status='PAID',paid_at=now() where id='11111111-1111-4111-8111-111111111112';
  if exists(select 1 from public.midad_store_fulfillment_jobs where order_id='11111111-1111-4111-8111-111111111112') then
    raise exception 'negative test failed: unverified intent created a job';
  end if;

  -- A matched intent without an exactly bound inbound receipt is also blocked.
  insert into public.midad_payment_intents(id,status,reconciliation_status,amount_fiat,fiat_currency,settlement_asset,network,quoted_crypto_amount,wallet_address,received_tx_hash,verified_at,paid_at,metadata)
  values ('22222222-2222-4222-8222-222222222221','paid','matched',5,'USD','USDC','base',5.000123,'0x2222222222222222222222222222222222222222','0xNoReceipt','2026-10-21T10:00:00Z','2026-10-21T10:00:00Z',
    '{"created_by":"midad_public_checkout_v1","product_id":"payment-path-mini-v1"}');
  insert into public.midad_store_orders(id,payment_intent_id,product_id,product_name,status,customer_requirements,metadata)
  values ('22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222221','payment-path-mini-v1','Diagnostic','AWAITING_PAYMENT','review one public checkout','{}');
  update public.midad_store_orders set status='PAID',paid_at='2026-10-21T10:00:00Z' where id='22222222-2222-4222-8222-222222222222';
  if exists(select 1 from public.midad_store_fulfillment_jobs where order_id='22222222-2222-4222-8222-222222222222') then
    raise exception 'negative test failed: missing receipt created a job';
  end if;

  -- A known product with a unique receipt linked by the verifier is queued idempotently.
  insert into public.midad_payment_intents(id,status,reconciliation_status,amount_fiat,fiat_currency,settlement_asset,network,quoted_crypto_amount,wallet_address,received_tx_hash,verified_at,paid_at,metadata)
  values ('33333333-3333-4333-8333-333333333331','paid','matched',5,'USD','USDC','base',5.000123,'0x3333333333333333333333333333333333333333','0xabc333','2026-10-21T10:00:00Z','2026-10-21T10:00:00Z',
    '{"created_by":"midad_public_checkout_v1","product_id":"payment-path-mini-v1"}');
  insert into public.midad_wallet_receipts(id,wallet_id,tx_hash,asset,network,amount,direction,matched_payment_intent_id,mint,commitment,evidence)
  values ('33333333-3333-4333-8333-333333333332','33333333-3333-4333-8333-333333333333','0xabc333','USDC','base',5.000123,'inbound','33333333-3333-4333-8333-333333333331','0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913','finalized','{"independently_verified":true}');
  insert into public.midad_store_orders(id,payment_intent_id,product_id,product_name,status,customer_requirements,metadata)
  values ('33333333-3333-4333-8333-333333333334','33333333-3333-4333-8333-333333333331','payment-path-mini-v1','Diagnostic','AWAITING_PAYMENT','Review one public checkout path','{}');
  update public.midad_store_orders set status='PAID',paid_at='2026-10-21T10:00:00Z' where id='33333333-3333-4333-8333-333333333334';
  select id into v_order_id from public.midad_store_orders where id='33333333-3333-4333-8333-333333333334';
  select id into v_job_id from public.midad_store_fulfillment_jobs where order_id=v_order_id;
  if v_job_id is null then raise exception 'positive test failed: verified payment did not enqueue a job'; end if;
  if (select status from public.midad_store_fulfillment_jobs where id=v_job_id) <> 'QUEUED' then raise exception 'positive test failed: expected QUEUED'; end if;
  if (select fulfillment_job_id from public.midad_store_orders where id=v_order_id) <> v_job_id then raise exception 'positive test failed: order link missing'; end if;
  update public.midad_store_orders set status='PAID',paid_at='2026-10-21T10:00:00Z' where id=v_order_id;
  if (select count(*) from public.midad_store_fulfillment_jobs where order_id=v_order_id) <> 1 then raise exception 'idempotency failed: multiple jobs'; end if;
  select count(*) into v_evidence_count from public.midad_store_fulfillment_evidence where job_id=v_job_id and event_type='PAYMENT_VERIFIED';
  if v_evidence_count <> 1 then raise exception 'idempotency failed: duplicate payment evidence'; end if;

  -- Missing requirements creates a waiting state, not an attempted delivery.
  insert into public.midad_payment_intents(id,status,reconciliation_status,amount_fiat,fiat_currency,settlement_asset,network,quoted_crypto_amount,wallet_address,received_tx_hash,verified_at,paid_at,metadata)
  values ('44444444-4444-4444-8444-444444444441','paid','matched',5,'USD','USDC','base',5.000123,'0x4444444444444444444444444444444444444444','0xabc444','2026-10-21T10:00:00Z','2026-10-21T10:00:00Z',
    '{"created_by":"midad_public_checkout_v1","product_id":"payment-path-mini-v1"}');
  insert into public.midad_wallet_receipts(id,wallet_id,tx_hash,asset,network,amount,direction,matched_payment_intent_id,mint,commitment,evidence)
  values ('44444444-4444-4444-8444-444444444442','44444444-4444-4444-8444-444444444443','0xabc444','USDC','base',5.000123,'inbound','44444444-4444-4444-8444-444444444441','0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913','finalized','{"independently_verified":true}');
  insert into public.midad_store_orders(id,payment_intent_id,product_id,product_name,status,customer_requirements,metadata)
  values ('44444444-4444-4444-8444-444444444444','44444444-4444-4444-8444-444444444441','payment-path-mini-v1','Diagnostic','AWAITING_PAYMENT','','{}');
  update public.midad_store_orders set status='PAID',paid_at='2026-10-21T10:00:00Z' where id='44444444-4444-4444-8444-444444444444';
  if (select status from public.midad_store_fulfillment_jobs where order_id='44444444-4444-4444-8444-444444444444') <> 'WAITING_FOR_INPUT' then
    raise exception 'input guard failed: expected WAITING_FOR_INPUT';
  end if;

  -- The database validates the actual artifact digest, and successful delivery transitions are idempotent.
  update public.midad_store_fulfillment_jobs set status='PROCESSING' where id=v_job_id;
  select encode(extensions.digest('sample report','sha256'),'hex') into v_hash;
  begin
    perform public.midad_complete_store_fulfillment(v_job_id, '{"report":"sample report"}'::jsonb, repeat('0',64), '{}'::jsonb);
    raise exception 'negative test failed: incorrect SHA-256 was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'fulfillment_sha256_mismatch' then raise; end if;
  end;
  perform public.midad_complete_store_fulfillment(v_job_id, '{"report":"sample report"}'::jsonb, v_hash, '{"test":"isolated"}'::jsonb);
  v_result := public.midad_complete_store_fulfillment(v_job_id, '{"report":"sample report"}'::jsonb, v_hash, '{"test":"isolated"}'::jsonb);
  if coalesce((v_result->>'idempotent')::boolean,false) <> true then raise exception 'completion idempotency failed'; end if;
  if (select status from public.midad_store_orders where id=v_order_id) <> 'DELIVERED' then raise exception 'delivery status was not updated'; end if;
  if (select status from public.midad_store_fulfillment_jobs where id=v_job_id) <> 'DELIVERED' then raise exception 'job status was not updated'; end if;

  raise notice 'Store fulfillment migration contract tests passed';
end $$;
