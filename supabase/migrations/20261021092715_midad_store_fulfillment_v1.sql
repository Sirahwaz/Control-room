-- MIDAD Store Fulfillment v1
-- A job is created only after the existing verifier has independently matched an inbound receipt.
create table if not exists public.midad_store_fulfillment_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.midad_store_orders(id) on delete restrict,
  payment_intent_id uuid not null unique references public.midad_payment_intents(id) on delete restrict,
  product_id text not null,
  adapter_key text not null,
  status text not null check (status in ('QUEUED','WAITING_FOR_INPUT','PROCESSING','DELIVERED','FAILED','MANUAL_REVIEW')),
  attempts integer not null default 0 check (attempts >= 0),
  input_snapshot jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  output_sha256 text check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
  payment_evidence jsonb not null default '{}'::jsonb,
  last_error text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.midad_store_fulfillment_evidence (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.midad_store_fulfillment_jobs(id) on delete restrict,
  order_id uuid not null references public.midad_store_orders(id) on delete restrict,
  event_type text not null check (event_type in ('PAYMENT_VERIFIED','PROCESSING_STARTED','INPUT_REQUIRED','ARTIFACT_DELIVERED','PROCESSING_FAILED','MANUAL_REVIEW')),
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, event_type, payload_sha256)
);

create index if not exists midad_store_fulfillment_jobs_status_queued_idx
  on public.midad_store_fulfillment_jobs(status, queued_at);
create index if not exists midad_store_fulfillment_evidence_order_created_idx
  on public.midad_store_fulfillment_evidence(order_id, created_at desc);

alter table public.midad_store_fulfillment_jobs enable row level security;
alter table public.midad_store_fulfillment_evidence enable row level security;
revoke all on public.midad_store_fulfillment_jobs from public, anon, authenticated;
revoke all on public.midad_store_fulfillment_evidence from public, anon, authenticated;
grant all on public.midad_store_fulfillment_jobs to service_role;
grant select, insert on public.midad_store_fulfillment_evidence to service_role;

create or replace function public.midad_enqueue_store_fulfillment_after_verified_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_intent public.midad_payment_intents%rowtype;
  v_receipt record;
  v_receipt_count integer := 0;
  v_job_id uuid;
  v_adapter text;
  v_status text;
begin
  if new.status <> 'PAID' or new.paid_at is null then
    return new;
  end if;

  select * into v_intent
  from public.midad_payment_intents
  where id = new.payment_intent_id
  for share;

  if not found
     or v_intent.status <> 'paid'
     or v_intent.reconciliation_status <> 'matched'
     or v_intent.paid_at is null
     or nullif(v_intent.received_tx_hash, '') is null
     or coalesce(v_intent.metadata->>'created_by','') <> 'midad_public_checkout_v1'
     or coalesce(v_intent.metadata->>'product_id','') <> new.product_id then
    return new;
  end if;

  select count(*)::integer into v_receipt_count
  from public.midad_wallet_receipts r
  where r.matched_payment_intent_id = v_intent.id
    and (case when lower(v_intent.network) = 'base' then lower(r.tx_hash) = lower(v_intent.received_tx_hash) else r.tx_hash = v_intent.received_tx_hash end)
    and r.asset = v_intent.settlement_asset
    and lower(r.network) = lower(v_intent.network)
    and r.direction = 'inbound'
    and abs(r.amount - v_intent.quoted_crypto_amount) < 0.0000005;

  if v_receipt_count <> 1 then
    return new;
  end if;

  select r.id, r.tx_hash, r.asset, r.network, r.amount, r.mint, r.commitment,
         r.detected_at, r.evidence
  into v_receipt
  from public.midad_wallet_receipts r
  where r.matched_payment_intent_id = v_intent.id
    and (case when lower(v_intent.network) = 'base' then lower(r.tx_hash) = lower(v_intent.received_tx_hash) else r.tx_hash = v_intent.received_tx_hash end)
    and r.asset = v_intent.settlement_asset
    and lower(r.network) = lower(v_intent.network)
    and r.direction = 'inbound'
    and abs(r.amount - v_intent.quoted_crypto_amount) < 0.0000005
  limit 1;

  v_adapter := case new.product_id
    when 'payment-path-mini-v1' then 'checkout_diagnostic_v1'
    when 'miner-microscope-v1' then 'miner_microscope_v1'
    when 'opportunity-radar-v1' then 'opportunity_radar_v1'
    when 'research-revenue-sprint-v1' then 'research_revenue_sprint_v1'
    when 'bug-fix-sprint-v1' then 'bug_fix_sprint_v1'
    when 'data-rescue-pack-v1' then 'data_rescue_pack_v1'
    when 'decision-research-brief-v1' then 'decision_research_brief_v1'
    when 'code-health-review-v1' then 'code_health_review_v1'
    else null
  end;

  v_status := case
    when v_adapter is null then 'MANUAL_REVIEW'
    when length(btrim(coalesce(new.customer_requirements,''))) = 0 then 'WAITING_FOR_INPUT'
    else 'QUEUED'
  end;

  insert into public.midad_store_fulfillment_jobs (
    order_id, payment_intent_id, product_id, adapter_key, status, input_snapshot, payment_evidence
  ) values (
    new.id, v_intent.id, new.product_id, coalesce(v_adapter,'unknown_product'), v_status,
    jsonb_build_object('product_id', new.product_id, 'requirements', coalesce(new.customer_requirements,'')),
    jsonb_build_object(
      'verification_source', 'midad_payment_verifier',
      'payment_intent_id', v_intent.id,
      'receipt_id', v_receipt.id,
      'tx_hash', v_receipt.tx_hash,
      'asset', v_receipt.asset,
      'network', v_receipt.network,
      'amount', v_receipt.amount,
      'mint', v_receipt.mint,
      'commitment', v_receipt.commitment,
      'detected_at', v_receipt.detected_at,
      'receipt_evidence', coalesce(v_receipt.evidence, '{}'::jsonb),
      'verified_at', v_intent.verified_at,
      'paid_at', v_intent.paid_at
    )
  )
  on conflict (order_id) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select id into v_job_id from public.midad_store_fulfillment_jobs where order_id = new.id;
  else
    insert into public.midad_store_fulfillment_evidence(job_id, order_id, event_type, evidence)
    values (v_job_id, new.id, 'PAYMENT_VERIFIED',
      jsonb_build_object('payment_intent_id',v_intent.id,'receipt_id',v_receipt.id,
        'tx_hash',v_receipt.tx_hash,'asset',v_receipt.asset,'network',v_receipt.network,
        'amount',v_receipt.amount,'verified_at',v_intent.verified_at,'paid_at',v_intent.paid_at));
    if v_status = 'WAITING_FOR_INPUT' then
      insert into public.midad_store_fulfillment_evidence(job_id, order_id, event_type, evidence)
      values (v_job_id, new.id, 'INPUT_REQUIRED',
        jsonb_build_object('reason','customer_requirements_missing','product_id',new.product_id));
    elsif v_status = 'MANUAL_REVIEW' then
      insert into public.midad_store_fulfillment_evidence(job_id, order_id, event_type, evidence)
      values (v_job_id, new.id, 'MANUAL_REVIEW',
        jsonb_build_object('reason','no_adapter_registered','product_id',new.product_id));
    end if;
  end if;

  update public.midad_store_orders
  set fulfillment_job_id = v_job_id, updated_at = now()
  where id = new.id and fulfillment_job_id is distinct from v_job_id;

  return new;
end;
$function$;

drop trigger if exists trg_midad_enqueue_store_fulfillment on public.midad_store_orders;
create trigger trg_midad_enqueue_store_fulfillment
after update of status, paid_at on public.midad_store_orders
for each row execute function public.midad_enqueue_store_fulfillment_after_verified_payment();

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
     or coalesce(p_output_sha256,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='invalid_fulfillment_artifact';
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

revoke all on function public.midad_enqueue_store_fulfillment_after_verified_payment() from public, anon, authenticated;
revoke all on function public.midad_complete_store_fulfillment(uuid,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.midad_complete_store_fulfillment(uuid,jsonb,text,jsonb) to service_role;
