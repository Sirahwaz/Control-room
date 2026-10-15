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

  select id into secret_id
    from vault.decrypted_secrets
   where name = new_name
   order by created_at
   limit 1;

  if secret_id is not null then
    perform vault.update_secret(secret_id, new_secret, new_name, coalesce(new_description, ''));
    return secret_id;
  end if;

  select vault.create_secret(new_secret, new_name, coalesce(new_description, ''))
    into secret_id;
  return secret_id;
end;
$$;

comment on function public.midad_store_platform_secret(text, text, text) is
  'Idempotent service-role-only bridge for storing provider credentials in Supabase Vault by a stable name. The raw secret is never returned or logged.';
