create or replace function midad_private.capture_event_spine_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  record_key text;
  event_fingerprint text;
  event_key_value text;
  event_at timestamptz;
  class_value text;
  data_class_value text;
  event_type_value text;
  source_value text;
  priority_value smallint;
  subject_key_value text;
  metadata_value jsonb;
begin
  record_key := coalesce(row_data->>'id', row_data->>'runid', md5(row_data::text));
  event_fingerprint := md5(row_data::text);
  event_key_value := tg_table_schema || '.' || tg_table_name || ':' || record_key || ':' || event_fingerprint;

  event_at := coalesce(
    nullif(row_data->>'occurred_at','')::timestamptz,
    nullif(row_data->>'measured_at','')::timestamptz,
    nullif(row_data->>'detected_at','')::timestamptz,
    nullif(row_data->>'created_at','')::timestamptz,
    now()
  );

  event_type_value := coalesce(
    nullif(row_data->>'event_type',''),
    nullif(row_data->>'signal_type',''),
    nullif(row_data->>'opportunity_type',''),
    nullif(row_data->>'job_type',''),
    tg_table_name || '.insert'
  );
  source_value := coalesce(nullif(row_data->>'source',''), tg_table_name);

  class_value := case
    when tg_table_name in ('midad_payment_events','midad_wallet_receipts') then 'financial_immutable'
    when tg_table_name = 'midad_revenue_intel_evidence' then 'paid_revenue_evidence'
    when tg_table_name in ('midad_signal_outcomes','midad_learning_events') then 'learning_outcomes'
    when tg_table_name in ('signal_events','midad_osint_events') then 'raw_intelligence_telemetry'
    when tg_table_name = 'opportunities'
      and (row_data->>'opportunity_type' = 'paid_work'
        or row_data->>'status' in ('money_candidate','accepted','delivery','invoiced','paid','submitted_waiting'))
      then 'paid_revenue_evidence'
    when tg_table_name = 'opportunities' then 'raw_intelligence_telemetry'
    else 'operational_success_logs'
  end;

  data_class_value := case
    when class_value = 'financial_immutable' then 'restricted'
    when class_value in ('paid_revenue_evidence','learning_outcomes') then 'confidential'
    else 'internal'
  end;

  priority_value := case
    when class_value = 'financial_immutable' then 100
    when class_value = 'paid_revenue_evidence' then 95
    when class_value = 'learning_outcomes' then 90
    when class_value = 'raw_intelligence_telemetry' then 70
    else 50
  end;

  subject_key_value := coalesce(
    nullif(row_data->>'entity',''),
    nullif(row_data->>'asset_id',''),
    nullif(row_data->>'signal_event_id',''),
    nullif(row_data->>'subject_key',''),
    record_key
  );

  -- Exclude full payloads, payment amounts, wallet addresses, credentials and PII.
  metadata_value := jsonb_strip_nulls(jsonb_build_object(
    'status', row_data->>'status',
    'source', row_data->>'source',
    'event_type', row_data->>'event_type',
    'signal_type', row_data->>'signal_type',
    'opportunity_type', row_data->>'opportunity_type',
    'job_type', row_data->>'job_type',
    'outcome_label', row_data->>'outcome_label',
    'score', row_data->>'score',
    'confidence', row_data->>'confidence'
  ));

  insert into midad_private.midad_event_spine
    (event_key,event_type,source_system,source_schema,source_table,source_record_key,
     subject_type,subject_key,occurred_at,priority,data_class,retention_class,
     fingerprint,metadata)
  values
    (event_key_value,event_type_value,source_value,tg_table_schema,tg_table_name,record_key,
     tg_table_name,subject_key_value,event_at,priority_value,data_class_value,class_value,
     event_fingerprint,metadata_value)
  on conflict (event_key) do nothing;

  return new;
end;
$$;

do $$
declare
  target_table text;
  trigger_name text;
begin
  foreach target_table in array array[
    'signal_events',
    'opportunities',
    'midad_signal_outcomes',
    'midad_revenue_intel_evidence',
    'midad_payment_events',
    'midad_wallet_receipts',
    'engine_runs',
    'midad_learning_events',
    'midad_osint_events',
    'midad_bot_outbox'
  ]
  loop
    trigger_name := 'midad_event_spine_ai_' || target_table;
    if not exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=target_table and t.tgname=trigger_name and not t.tgisinternal
    ) then
      execute format(
        'create trigger %I after insert on public.%I for each row execute function midad_private.capture_event_spine_insert()',
        trigger_name,target_table
      );
    end if;
  end loop;
end $$;

do $$
begin
  if (select count(*) from pg_trigger t
      join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and t.tgname like 'midad_event_spine_ai_%' and not t.tgisinternal) <> 10 then
    raise exception 'event spine trigger coverage test failed';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='midad_private' and p.proname='capture_event_spine_insert'
  ) then
    raise exception 'event spine trigger function missing';
  end if;
end $$;
