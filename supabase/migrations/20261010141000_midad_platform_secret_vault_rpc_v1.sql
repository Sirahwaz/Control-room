create or replace function public.midad_store_platform_secret(
  new_secret text,
  new_name text,
  new_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  caller_role text;
  secret_id uuid;
begin
  caller_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '')
  );
  if caller_role <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service_role_required';
  end if;
  if new_secret is null or length(new_secret) < 1 then
    raise exception 'secret_value_required';
  end if;
  if new_name is null or new_name not like 'midad:platform:%' then
    raise exception 'platform_secret_name_prefix_required';
  end if;
  if length(new_name) > 200 then
    raise exception 'secret_name_too_long';
  end if;
  select vault.create_secret(new_secret, new_name, coalesce(new_description, ''))
    into secret_id;
  return secret_id;
end;
$$;

create or replace function public.midad_read_platform_secret(secret_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  caller_role text;
  secret_value text;
begin
  caller_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '')
  );
  if caller_role <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service_role_required';
  end if;
  select decrypted_secret
    into secret_value
    from vault.decrypted_secrets
   where id = secret_id
     and name like 'midad:platform:%';
  if secret_value is null then
    raise exception 'platform_secret_not_found';
  end if;
  return secret_value;
end;
$$;

revoke all on function public.midad_store_platform_secret(text, text, text) from public, anon, authenticated;
revoke all on function public.midad_read_platform_secret(uuid) from public, anon, authenticated;
grant execute on function public.midad_store_platform_secret(text, text, text) to service_role;
grant execute on function public.midad_read_platform_secret(uuid) to service_role;

comment on function public.midad_store_platform_secret(text, text, text) is
  'Service-role-only bridge for storing provider credentials in Supabase Vault. The raw secret is never returned or logged.';
comment on function public.midad_read_platform_secret(uuid) is
  'Service-role-only bridge for retrieving MIDAD platform secrets from Vault by secret reference.';
