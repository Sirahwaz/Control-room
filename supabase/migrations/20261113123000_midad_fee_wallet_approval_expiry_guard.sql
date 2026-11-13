CREATE OR REPLACE FUNCTION public.midad_claim_agent_fee_payment(p_request_id uuid, p_approval_id uuid, p_fee_wallet_id uuid, p_estimated_gas_usd numeric, p_network_fee_amount numeric, p_eth_usd numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  r public.midad_agent_fee_requests%rowtype;
  w public.midad_agent_fee_wallets%rowtype;
  pol public.midad_agent_fee_policies%rowtype;
  ap public.midad_approvals%rowtype;
  v_daily numeric := 0;
  v_weekly numeric := 0;
  v_job numeric := 0;
  v_total numeric := 0;
  v_ledger_id uuid;
begin
  if p_request_id is null or p_approval_id is null or p_fee_wallet_id is null
     or p_estimated_gas_usd is null or p_estimated_gas_usd < 0
     or p_network_fee_amount is null or p_network_fee_amount <= 0
     or p_eth_usd is null or p_eth_usd <= 0 then
    return jsonb_build_object('ok',false,'error','invalid_reservation_parameters');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('midad_fee_wallet:' || p_fee_wallet_id::text, 0));

  select * into r from public.midad_agent_fee_requests
   where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok',false,'error','fee_request_not_found');
  end if;
  if r.status <> 'OWNER_APPROVAL_REQUIRED' then
    return jsonb_build_object('ok',false,'error','fee_request_not_pending','status',r.status);
  end if;
  if r.approval_id is distinct from p_approval_id then
    return jsonb_build_object('ok',false,'error','approval_request_mismatch');
  end if;
  if r.network <> 'base' or upper(r.asset) <> 'USDC'
     or r.fee_kind not in ('network_fee','platform_fee','api_fee','x402_fee','submission_fee')
     or r.amount <= 0 or r.amount_usd <= 0
     or abs(r.amount_usd - r.amount) > 0.000001 then
    return jsonb_build_object('ok',false,'error','unsupported_fee_request');
  end if;
  if coalesce(r.fee_evidence->>'official_fee_instructions_verified','false') <> 'true' then
    return jsonb_build_object('ok',false,'error','official_fee_evidence_required');
  end if;
  if length(coalesce(r.quote_domain,'')) < 3 or coalesce(r.quote_url,'') not like 'https://%' then
    return jsonb_build_object('ok',false,'error','https_fee_quote_required');
  end if;

  select * into w from public.midad_agent_fee_wallets
   where id = p_fee_wallet_id and owner_scope = 'midad' and network = 'base' for update;
  if not found or w.status <> 'ACTIVE'
     or coalesce(w.metadata->>'spending_enabled','false') <> 'true'
     or coalesce(w.metadata->>'transaction_signing_enabled','false') <> 'true' then
    return jsonb_build_object('ok',false,'error','fee_wallet_not_armed');
  end if;
  select * into pol from public.midad_agent_fee_policies where policy_key = 'default';
  if not found or not pol.enabled then
    return jsonb_build_object('ok',false,'error','fee_policy_disabled');
  end if;
  if pol.auto_execute_allowlisted then
    return jsonb_build_object('ok',false,'error','automatic_fee_execution_policy_must_remain_disabled');
  end if;
  if not ('base' = any(pol.allowed_networks)) or not ('USDC' = any(pol.allowed_assets))
     or not (r.fee_kind = any(pol.allowed_fee_kinds)) then
    return jsonb_build_object('ok',false,'error','fee_policy_does_not_allow_request');
  end if;

  if r.amount_usd > pol.max_per_payment_usd or r.amount_usd > pol.max_per_job_usd then
    return jsonb_build_object('ok',false,'error','fee_payment_limit_exceeded');
  end if;
  if r.expected_return_usd < r.amount_usd * pol.min_expected_return_ratio
     or jsonb_typeof(r.expected_return_evidence) <> 'object'
     or length(coalesce(r.expected_return_evidence->>'summary','')) < 10
     or coalesce(r.expected_return_evidence->>'evidence_url','') not like 'https://%' then
    return jsonb_build_object('ok',false,'error','expected_return_evidence_or_ratio_failed',
      'min_expected_return_ratio',pol.min_expected_return_ratio);
  end if;
  if p_network_fee_amount > pol.max_gas_fee_eth then
    return jsonb_build_object('ok',false,'error','estimated_gas_limit_exceeded',
      'max_gas_fee_eth',pol.max_gas_fee_eth);
  end if;

  select * into ap from public.midad_approvals where id = p_approval_id for update;
  if not found or ap.status <> 'pending' or ap.subject_type <> 'fee_payment_request'
     or ap.subject_id <> r.id::text or ap.action <> 'pay_platform_fee' then
    return jsonb_build_object('ok',false,'error','explicit_owner_approval_not_pending');
  end if;
  if ap.expires_at is null or ap.expires_at <= now() then
    return jsonb_build_object('ok',false,'error','owner_approval_expired');
  end if;

  v_total := round(r.amount_usd + p_estimated_gas_usd, 6);
  if v_total > pol.max_per_payment_usd then
    return jsonb_build_object('ok',false,'error','all_in_transaction_limit_exceeded',
      'payment_usd',r.amount_usd,'estimated_gas_usd',p_estimated_gas_usd,
      'all_in_usd',v_total,'max_usd',pol.max_per_payment_usd);
  end if;

  select coalesce(sum(l.amount_usd),0) into v_daily
    from public.midad_agent_fee_ledger l
   where (l.status in ('PENDING','SUBMITTED','CONFIRMED') OR (l.status = 'FAILED' AND l.tx_hash IS NOT NULL))
     and (l.created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date;
  select coalesce(sum(l.amount_usd),0) into v_weekly
    from public.midad_agent_fee_ledger l
   where (l.status in ('PENDING','SUBMITTED','CONFIRMED') OR (l.status = 'FAILED' AND l.tx_hash IS NOT NULL))
     and l.created_at >= now() - interval '7 days';
  select coalesce(sum(l.amount_usd),0) into v_job
    from public.midad_agent_fee_ledger l
    join public.midad_agent_fee_requests old_req on old_req.id = l.request_id
   where old_req.job_ref = r.job_ref
     and (l.status in ('PENDING','SUBMITTED','CONFIRMED') OR (l.status = 'FAILED' AND l.tx_hash IS NOT NULL));

  if v_daily + v_total > pol.max_daily_usd then
    return jsonb_build_object('ok',false,'error','daily_fee_budget_exceeded',
      'spent_or_reserved_usd',v_daily,'requested_all_in_usd',v_total,'daily_limit_usd',pol.max_daily_usd);
  end if;
  if v_weekly + v_total > pol.max_weekly_usd then
    return jsonb_build_object('ok',false,'error','weekly_fee_budget_exceeded',
      'spent_or_reserved_usd',v_weekly,'requested_all_in_usd',v_total,'weekly_limit_usd',pol.max_weekly_usd);
  end if;
  if v_job + v_total > pol.max_per_job_usd then
    return jsonb_build_object('ok',false,'error','job_fee_budget_exceeded',
      'spent_or_reserved_usd',v_job,'requested_all_in_usd',v_total,'job_limit_usd',pol.max_per_job_usd);
  end if;

  update public.midad_approvals
     set status = 'approved',
         decided_by = 'control_room_owner',
         decision_note = 'One-time fee payment approved for exact request ' || r.id::text ||
           '; asset/network/recipient/amount/estimated gas were frozen at approval.',
         decided_at = now()
   where id = ap.id and status = 'pending';

  insert into public.midad_agent_fee_allowlist
    (provider,destination_domain,network,asset,recipient,fee_kind,max_fee_usd,status,approved_by,source_approval_id,evidence)
  values
    (r.provider,r.quote_domain,'base','USDC',r.recipient,r.fee_kind,r.amount_usd,'ACTIVE',
     'control_room_owner',ap.id,
     jsonb_build_object('one_time_request_id',r.id,'auto_execute',false,'approved_amount_usd',r.amount_usd))
  on conflict (provider,destination_domain,network,asset,recipient,fee_kind)
  do update set
    max_fee_usd = excluded.max_fee_usd,
    status = 'ACTIVE',
    approved_by = excluded.approved_by,
    approved_at = now(),
    source_approval_id = excluded.source_approval_id,
    evidence = excluded.evidence,
    updated_at = now();

  insert into public.midad_agent_fee_ledger
    (request_id,fee_wallet_id,network,asset,amount,amount_usd,recipient,
     network_fee_asset,network_fee_amount,status,evidence)
  values
    (r.id,w.id,'base','USDC',r.amount,v_total,r.recipient,'ETH',p_network_fee_amount,'PENDING',
     jsonb_build_object('all_in_budget_usd',v_total,'payment_amount_usd',r.amount_usd,
       'estimated_gas_usd',p_estimated_gas_usd,'estimated_gas_eth',p_network_fee_amount,
       'eth_usd_quote',p_eth_usd,'quote_domain',r.quote_domain,'owner_approval_id',ap.id,
       'automatic_execution',false,'network_chain_id',8453))
  returning id into v_ledger_id;

  update public.midad_agent_fee_requests
     set status = 'EXECUTING',
         policy_decision = jsonb_build_object('decision','approved_one_time','approval_id',ap.id,
           'fee_wallet_id',w.id,'all_in_budget_usd',v_total,'estimated_gas_usd',p_estimated_gas_usd,
           'estimated_gas_eth',p_network_fee_amount,'eth_usd_quote',p_eth_usd,
           'auto_execute_allowlisted',false,'approved_at',now()),
         updated_at = now()
   where id = r.id;

  insert into public.midad_audit_log
    (user_id,event_type,actor_type,action,subject_type,subject_id,status,risk_class,summary,details)
  values
    (ap.user_id,'fee_payment_approval','human','approve_and_execute_platform_fee',
     'fee_payment_request',r.id::text,'EXECUTING','high',
     'Owner explicitly approved a one-time USDC fee transfer on Base.',
     jsonb_build_object('request_id',r.id,'approval_id',ap.id,'ledger_id',v_ledger_id,
       'provider',r.provider,'domain',r.quote_domain,'network','base','asset','USDC',
       'amount',r.amount,'recipient',r.recipient,'all_in_budget_usd',v_total));

  return jsonb_build_object('ok',true,'request_id',r.id,'approval_id',ap.id,
    'ledger_id',v_ledger_id,'all_in_budget_usd',v_total,
    'estimated_gas_eth',p_network_fee_amount,'estimated_gas_usd',p_estimated_gas_usd);
end;
$function$
