-- MIDAD Store Fulfillment SHA-256 integrity hardening.
-- The deployed completion RPC drifted from the already-recorded v1 migration.
-- This additive migration restores digest checking and binds the payload hash to the checked digest.
create or replace function public.midad_complete_store_fulfillment(
  p_job_id uuid,
  p_output jsonb,
  p_output_sha256 text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_job public.midad_store_fulfillment_jobs%rowtype;
  v_order public.midad_store_orders%rowtype;
  v_intent public.midad_payment_intents%rowtype;
  v_receipt_count integer := 0;
  v_report text;
begin
  if p_job_id is null or p_output is null or jsonb_typeof(p_output) <> 'object'
     or coalesce(p_output_sha256,'') !~ '^[0-9a-f]{64}$'
     or coalesce(p_output->>'output_sha256','') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='invalid_fulfillment_artifact';
  end if;
  if p_output->>'output_sha256' is distinct from p_output_sha256 then
    raise exception using errcode='22023', message='fulfillment_artifact_hash_disagrees';
  end if;
  v_report := p_output->>'report';
  if length(btrim(coalesce(v_report,''))) = 0 or length(v_report) > 20000 then
    raise exception using errcode='22023', message='invalid_fulfillment_report';
  end if;
  if encode(extensions.digest(v_report, 'sha256'), 'hex') <> p_output_sha256 then
    raise exception using errcode='22023', message='fulfillment_sha256_mismatch';
  end if;

  select * into v_job from public.midad_store_fulfillment_jobs where id=p_job_id for update;
  if not found then raise exception using errcode='P0002', message='fulfillment_job_not_found'; end if;
  if v_job.status='DELIVERED' then
    if v_job.output_sha256=p_output_sha256 then
      return jsonb_build_object('ok',true,'idempotent',true,'job_id',v_job.id,'order_id',v_job.order_id,'status','DELIVERED','output_sha256',v_job.output_sha256);
    end if;
    raise exception using errcode='23505', message='fulfillment_already_delivered_with_different_hash';
  end if;
  if v_job.status <> 'PROCESSING' then
    raise exception using errcode='55000', message='fulfillment_job_not_processing';
  end if;

  select * into v_order from public.midad_store_orders where id=v_job.order_id for update;
  select * into v_intent from public.midad_payment_intents where id=v_job.payment_intent_id for share;
  if not found or v_order.status not in ('PAID','FULFILLING')
     or v_order.paid_at is null
     or v_intent.status <> 'paid'
     or v_intent.reconciliation_status <> 'matched'
     or v_intent.paid_at is null
     or nullif(v_intent.received_tx_hash,'') is null then
    raise exception using errcode='55000', message='verified_paid_order_required';
  end if;

  select count(*)::integer into v_receipt_count
  from public.midad_wallet_receipts r
  where r.matched_payment_intent_id=v_intent.id
    and lower(r.tx_hash)=lower(v_intent.received_tx_hash)
    and r.asset=v_intent.settlement_asset
    and lower(r.network)=lower(v_intent.network)
    and r.direction='inbound'
    and abs(r.amount-v_intent.quoted_crypto_amount) < 0.0000005;
  if v_receipt_count <> 1 then
    raise exception using errcode='55000', message='unique_verified_receipt_required';
  end if;

  update public.midad_store_fulfillment_jobs
  set status='DELIVERED', output=p_output, output_sha256=p_output_sha256,
      delivered_at=now(), last_error=null, updated_at=now()
  where id=v_job.id;
  update public.midad_store_orders
  set status='DELIVERED', delivered_at=now(), updated_at=now()
  where id=v_order.id and status in ('PAID','FULFILLING');
  if not found then
    raise exception using errcode='55000', message='store_order_delivery_transition_failed';
  end if;
  insert into public.midad_store_fulfillment_evidence(job_id,order_id,event_type,payload_sha256,evidence)
  values (v_job.id,v_order.id,'ARTIFACT_DELIVERED',p_output_sha256,
    coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object(
      'output_sha256',p_output_sha256,'report_chars',length(v_report),
      'payment_intent_id',v_intent.id,'tx_hash',v_intent.received_tx_hash,
      'verified_at',v_intent.verified_at,'paid_at',v_intent.paid_at,
      'delivered_at',now()));
  return jsonb_build_object('ok',true,'idempotent',false,'job_id',v_job.id,'order_id',v_order.id,'status','DELIVERED','output_sha256',p_output_sha256);
end;
$function$;

revoke all on function public.midad_complete_store_fulfillment(uuid,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.midad_complete_store_fulfillment(uuid,jsonb,text,jsonb) to service_role;
