-- Bind each new Control Room session to the authenticated MIDAD owner.
-- Existing rows remain NULL intentionally: the Gateway fails them closed and
-- requires a fresh authenticated session rather than guessing their owner.

ALTER TABLE public.control_room_sessions
  ADD COLUMN IF NOT EXISTS owner_user_id uuid
  REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS control_room_sessions_owner_active_idx
  ON public.control_room_sessions (owner_user_id, created_at DESC)
  WHERE active = true AND owner_user_id IS NOT NULL;

COMMENT ON COLUMN public.control_room_sessions.owner_user_id IS
  'Explicit owner identity captured when the session is issued; legacy NULL sessions must re-authenticate.';
