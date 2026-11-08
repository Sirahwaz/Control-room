-- Require a real inbound customer message as evidence for every owner-approved payment request.
create or replace function public.midad_create_payment_intent_from_approval(
  p_approval_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_approval public.midad_approvals%rowtype;
  v_evidence jsonb;
  v_route public.midad_revenue_routes%rowtype;
  v_wallet public.midad_wallets%rowtype;
  v_monitor public.midad_wallet_monitor_state%rowtype;
  v_asset text;
  v_network text;
  v_amount numeric;
  v_currency text;
  v_quote_amount numeric;
  v_fx_rate numeric;
  v_quote_source text;
  v_expected_token text;
  v_observed_token text;
  v_expires_at timestamptz;
  v_confirmations integer;
  v_intent public.midad_payment_intents%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;
  if p_approval_id is null or p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'approval_and_owner_required');
  end if;

  select * into v_approval
  from public.midad_approvals
  where id = p_approval_id and user_id = p_user_id
  for update;

  if not found
     or v_approval.subject_type <> 'payment_intent_request'
     or v_approval.action <> 'create_payment_intent' then
    return jsonb_build_object('ok', false, 'error', 'payment_approval_not_found');
  end if;

  -- Idempotent retry: return the already-created intent, never create a duplicate.
  select * into v_intent
  from public.midad_payment_intents
  where approval_id = p_approval_id and user_id = p_user_id;
  if found then
    return jsonb_build_object('ok', true, 'idempotent', true, 'payment_intent', to_jsonb(v_intent));
  end if;

  if v_approval.status <> 'approved' or v_approval.decided_by <> 'owner' or v_approval.decided_at is null then
    return jsonb_build_object('ok', false, 'error', 'payment_approval_not_approved');
  end if;
  if v_approval.expires_at is null or v_approval.expires_at <= now() then
    update public.midad_approvals
      set status = 'expired', decided_at = coalesce(decided_at, now())
      where id = p_approval_id and status = 'approved';
    return jsonb_build_object('ok', false, 'error', 'payment_approval_expired');
  end if;

  v_evidence := coalesce(v_approval.evidence, '{}'::jsonb);
  v_asset := upper(coalesce(v_evidence->>'settlement_asset', ''));
  v_network := lower(coalesce(v_evidence->>'network', ''));
  v_currency := upper(coalesce(v_evidence->>'fiat_currency', ''));
  v_amount := nullif(v_evidence->>'amount_fiat', '')::numeric;
  v_quote_amount := nullif(v_evidence->>'quoted_crypto_amount', '')::numeric;
  v_fx_rate := nullif(v_evidence->>'fx_rate', '')::numeric;
  v_quote_source := nullif(v_evidence->>'quote_source', '');
  v_expires_at := nullif(v_evidence->>'expires_at', '')::timestamptz;

  if v_amount is null or v_amount <= 0 or v_amount > 1000000000
     or v_currency !~ '^[A-Z]{3,10}$'
     or v_expires_at is null or v_expires_at <= now()
     or v_expires_at is distinct from v_approval.expires_at
     or ((v_quote_amount is null) <> (v_fx_rate is null))
     or (v_quote_amount is not null and (v_quote_amount <= 0 or v_fx_rate <= 0 or v_quote_source is null)) then
    return jsonb_build_object('ok', false, 'error', 'payment_approval_evidence_invalid');
  end if;

  if (v_network = 'base' and v_asset = 'USDC') then
    v_expected_token := '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  elsif (v_network = 'solana' and v_asset = 'USDC') then
    v_expected_token := 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  elsif (v_network = 'solana' and v_asset = 'USDT') then
    v_expected_token := 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
  else
    return jsonb_build_object('ok', false, 'error', 'payment_rail_not_supported');
  end if;

  if coalesce(v_evidence->>'route_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_approval.subject_id <> v_evidence->>'route_id' then
    return jsonb_build_object('ok', false, 'error', 'payment_route_invalid');
  end if;
  if nullif(v_evidence->>'client_id','') is not null and not exists (
    select 1 from public.midad_client_profiles c where c.id=(v_evidence->>'client_id')::uuid and c.user_id=p_user_id
  ) then return jsonb_build_object('ok',false,'error','payment_client_not_found'); end if;
  if nullif(v_evidence->>'conversation_id','') is not null and not exists (
    select 1 from public.midad_conversations c where c.id=(v_evidence->>'conversation_id')::uuid and c.user_id=p_user_id
  ) then return jsonb_build_object('ok',false,'error','payment_conversation_not_found'); end if;
  if nullif(v_evidence->>'client_id','') is null
     or nullif(v_evidence->>'conversation_id','') is null
     or nullif(v_evidence->>'agreement_message_id','') is null
     or nullif(v_evidence->>'customer_agreement_text','') is null then
    return jsonb_build_object('ok',false,'error','customer_agreement_evidence_required');
  end if;
  if not exists (
    select 1 from public.midad_messages m
    join public.midad_conversations c on c.id=m.conversation_id
    where m.id=(v_evidence->>'agreement_message_id')::uuid
      and m.user_id=p_user_id
      and m.conversation_id=(v_evidence->>'conversation_id')::uuid
      and m.direction='in' and m.sender_role='client'
      and m.original_text=v_evidence->>'customer_agreement_text'
      and m.created_at >= now()-interval '7 days'
      and m.created_at <= now()+interval '30 seconds'
      and c.user_id=p_user_id
      and c.client_id=(v_evidence->>'client_id')::uuid
  ) then return jsonb_build_object('ok',false,'error','customer_agreement_evidence_invalid'); end if;

  select * into v_route
  from public.midad_revenue_routes
  where id = (v_evidence->>'route_id')::uuid
    and owner_scope = 'midad'
    and route_kind = 'receive'
    and active = true
    and asset = v_asset
    and lower(network) = v_network
  for share;

  if not found or v_route.wallet_id is null or coalesce(v_route.metadata->>'canonical', 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'payment_route_not_eligible');
  end if;

  select * into v_wallet
  from public.midad_wallets
  where id = v_route.wallet_id
    and owner_scope = 'midad'
    and active = true
    and purpose = 'revenue_receiving'
    and watch_only = true
  for share;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'receive_wallet_not_eligible');
  end if;

  if v_network = 'base' then
    if v_wallet.chain <> 'evm' or v_wallet.address !~* '^0x[0-9a-f]{40}$' then
      return jsonb_build_object('ok', false, 'error', 'receive_wallet_address_invalid');
    end if;
  else
    if v_wallet.chain <> 'solana' or v_wallet.address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
      return jsonb_build_object('ok', false, 'error', 'receive_wallet_address_invalid');
    end if;
  end if;

  select * into v_monitor
  from public.midad_wallet_monitor_state
  where route_id = v_route.id
  for share;

  if not found or v_monitor.status <> 'VERIFIED'
     or v_monitor.last_scan_at is null
     or v_monitor.last_scan_at > now() + interval '30 seconds'
     or v_monitor.last_scan_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'error', 'payment_monitor_not_fresh_and_verified');
  end if;

  v_observed_token := case when v_network = 'base'
    then v_monitor.metadata->>'token_contract'
    else v_monitor.metadata->>'mint' end;

  if v_network = 'base' then
    if lower(coalesce(v_route.metadata#>>'{verification,token_contract}', '')) <> lower(v_expected_token)
       or lower(coalesce(v_observed_token, '')) <> lower(v_expected_token) then
      return jsonb_build_object('ok', false, 'error', 'payment_token_contract_mismatch');
    end if;
    if v_monitor.metadata->>'wallet_address' is not null and lower(v_monitor.metadata->>'wallet_address') <> lower(v_wallet.address) then
      return jsonb_build_object('ok', false, 'error', 'monitor_wallet_address_mismatch');
    end if;
    if v_route.address_ref is not null and lower(v_route.address_ref) <> lower(v_wallet.address) then
      return jsonb_build_object('ok', false, 'error', 'route_wallet_address_mismatch');
    end if;
  else
    if coalesce(v_route.metadata#>>'{verification,token_mint}', '') <> v_expected_token
       or coalesce(v_observed_token, '') <> v_expected_token then
      return jsonb_build_object('ok', false, 'error', 'payment_token_contract_mismatch');
    end if;
    if v_monitor.metadata->>'wallet_address' is not null and v_monitor.metadata->>'wallet_address' <> v_wallet.address then
      return jsonb_build_object('ok', false, 'error', 'monitor_wallet_address_mismatch');
    end if;
    if v_route.address_ref is not null and v_route.address_ref <> v_wallet.address then
      return jsonb_build_object('ok', false, 'error', 'route_wallet_address_mismatch');
    end if;
  end if;

  if v_network = 'base' then
    if coalesce((v_monitor.metadata->>'scan_caught_up')::boolean, false) is not true
       or coalesce((v_monitor.metadata->>'payment_reconciliation_ready')::boolean, false) is not true then
      return jsonb_build_object('ok', false, 'error', 'base_payment_reconciliation_not_ready');
    end if;
  else
    if coalesce((v_monitor.metadata->>'payment_reconciliation_ready')::boolean, false) is not true
       or coalesce((v_monitor.metadata->>'token_accounts')::integer, 0) < 1 then
      return jsonb_build_object('ok', false, 'error', 'solana_token_account_not_verified');
    end if;
  end if;

  v_confirmations := greatest(1, least(100, coalesce((v_route.metadata#>>'{verification,confirmations_required}')::integer, 1)));

  insert into public.midad_payment_intents (
    user_id, client_id, conversation_id, project_ref,
    amount_fiat, fiat_currency, settlement_asset, network,
    quoted_crypto_amount, fx_rate, quote_source, wallet_address,
    expires_at, status, confirmations_required, reconciliation_status,
    approval_id, route_id,
    metadata
  ) values (
    p_user_id,
    nullif(v_evidence->>'client_id', '')::uuid,
    nullif(v_evidence->>'conversation_id', '')::uuid,
    nullif(v_evidence->>'project_ref', ''),
    v_amount, v_currency, v_asset, v_network,
    v_quote_amount, v_fx_rate, v_quote_source, v_wallet.address,
    v_expires_at,
    case when v_quote_amount is not null then 'quoted' else 'created' end,
    v_confirmations, 'unreconciled',
    p_approval_id, v_route.id,
    jsonb_build_object('created_by', 'midad_client_gateway_v2', 'approval_id', p_approval_id, 'route_label', v_route.label)
  ) returning * into v_intent;

  update public.midad_approvals
    set status = 'consumed', decided_at = coalesce(decided_at, now()),
        decision_note = coalesce(decision_note, 'Consumed by secure payment intent issuance')
    where id = p_approval_id and status = 'approved';

  if not found then
    raise exception 'payment_approval_consume_race';
  end if;

  return jsonb_build_object('ok', true, 'idempotent', false, 'payment_intent', to_jsonb(v_intent));
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    return jsonb_build_object('ok', false, 'error', 'payment_approval_evidence_invalid');
end;
$$;



revoke all on function public.midad_create_payment_intent_from_approval(uuid, uuid) from public, anon, authenticated;
grant execute on function public.midad_create_payment_intent_from_approval(uuid, uuid) to service_role;