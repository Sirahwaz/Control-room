do $$
declare
  target_table text;
  policy_name text := 'midad_private_deny_api_roles';
begin
  foreach target_table in array array[
    'midad_storage_config',
    'midad_storage_metrics',
    'midad_storage_policies',
    'midad_event_spine',
    'midad_archive_outbox',
    'midad_archive_manifest',
    'midad_archive_restore_jobs',
    'midad_storage_alerts'
  ]
  loop
    execute format('drop policy if exists %I on midad_private.%I',policy_name,target_table);
    execute format(
      'create policy %I on midad_private.%I for all to anon, authenticated using (false) with check (false)',
      policy_name,target_table
    );
  end loop;
end $$;

do $$
declare
  policy_count integer;
begin
  select count(*) into policy_count
  from pg_policies
  where schemaname='midad_private'
    and policyname='midad_private_deny_api_roles'
    and roles @> array['anon','authenticated']::name[]
    and qual='false'
    and with_check='false';
  if policy_count <> 8 then
    raise exception 'explicit private-schema deny policy assertion failed: got %',policy_count;
  end if;
  if has_schema_privilege('anon','midad_private','USAGE')
     or has_schema_privilege('authenticated','midad_private','USAGE') then
    raise exception 'public roles must not have private schema usage';
  end if;
  if not has_schema_privilege('service_role','midad_private','USAGE') then
    raise exception 'service_role must retain backend schema access';
  end if;
end $$;
