-- MIDAD owner-bound control-room sessions.
-- Additive and backward-compatible: legacy rows remain NULL and fail closed
-- until explicitly re-authenticated. No session is backfilled or revoked here.

alter table public.control_room_sessions
  add column if not exists owner_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'control_room_sessions_owner_user_id_fkey'
      and conrelid = 'public.control_room_sessions'::regclass
  ) then
    alter table public.control_room_sessions
      add constraint control_room_sessions_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.profiles(id)
      on delete restrict;
  end if;
end
$$;

create index if not exists idx_control_room_sessions_owner_active
  on public.control_room_sessions (owner_user_id, active)
  where owner_user_id is not null;

comment on column public.control_room_sessions.owner_user_id is
  'Explicit owner profile binding for authenticated MIDAD sessions. NULL legacy sessions are not owner-authorized.';
