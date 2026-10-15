-- MIDAD Control Room latency hardening
-- Non-destructive indexes for the existing dashboard's hottest read paths.
-- This migration version matches the recorded Supabase migration version.

CREATE INDEX IF NOT EXISTS idx_opportunities_status
  ON public.opportunities (status);

CREATE INDEX IF NOT EXISTS idx_opportunities_paid_work_status_score_created
  ON public.opportunities (opportunity_type, status, score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_events_created_at_desc
  ON public.signal_events (created_at DESC);
