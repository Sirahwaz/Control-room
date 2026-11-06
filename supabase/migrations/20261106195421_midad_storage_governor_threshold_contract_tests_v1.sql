create or replace function midad_private.midad_classify_storage_state(
  p_database_bytes bigint,
  p_read_only boolean,
  p_project_quota_bytes bigint,
  p_warning_bytes bigint,
  p_critical_bytes bigint,
  p_emergency_bytes bigint
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_read_only,false) then 'EMERGENCY'
    when p_project_quota_bytes is not null and p_project_quota_bytes > 0
      then case
        when p_database_bytes::numeric / p_project_quota_bytes >= 0.95 then 'EMERGENCY'
        when p_database_bytes::numeric / p_project_quota_bytes >= 0.85 then 'CRITICAL'
        when p_database_bytes::numeric / p_project_quota_bytes >= 0.70 then 'WARNING'
        else 'NORMAL'
      end
    when p_database_bytes >= p_emergency_bytes then 'EMERGENCY'
    when p_database_bytes >= p_critical_bytes then 'CRITICAL'
    when p_database_bytes >= p_warning_bytes then 'WARNING'
    else 'NORMAL'
  end;
$$;

do $$
begin
  if midad_private.midad_classify_storage_state(100,false,null,350,425,475) <> 'NORMAL' then
    raise exception 'test failed: normal state below threshold';
  end if;
  if midad_private.midad_classify_storage_state(350,false,null,350,425,475) <> 'WARNING' then
    raise exception 'test failed: warning threshold is inclusive';
  end if;
  if midad_private.midad_classify_storage_state(425,false,null,350,425,475) <> 'CRITICAL' then
    raise exception 'test failed: critical threshold is inclusive';
  end if;
  if midad_private.midad_classify_storage_state(475,false,null,350,425,475) <> 'EMERGENCY' then
    raise exception 'test failed: emergency threshold is inclusive';
  end if;
  if midad_private.midad_classify_storage_state(1,true,null,350,425,475) <> 'EMERGENCY' then
    raise exception 'test failed: read-only must force emergency';
  end if;
  if midad_private.midad_classify_storage_state(70,false,100,350,425,475) <> 'WARNING' then
    raise exception 'test failed: project quota percentage threshold';
  end if;
  if midad_private.midad_classify_storage_state(85,false,100,350,425,475) <> 'CRITICAL' then
    raise exception 'test failed: project quota critical threshold';
  end if;
  if midad_private.midad_classify_storage_state(95,false,100,350,425,475) <> 'EMERGENCY' then
    raise exception 'test failed: project quota emergency threshold';
  end if;
end $$;
