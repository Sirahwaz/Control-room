-- MIDAD Revenue first-mover scan latency repair
-- Non-destructive indexes for the existing paid-opportunity refresh path.
-- This migration version matches Supabase migration history (20261015091818).
-- No rows or business state are modified.

CREATE INDEX IF NOT EXISTS idx_opportunities_updated_at_desc
  ON public.opportunities (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_status_updated_at_desc
  ON public.opportunities (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_source_status_updated_at_desc
  ON public.opportunities (source, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_fast_cash_updated_desc
  ON public.opportunities (updated_at DESC)
  WHERE metadata ->> 'fast_cash_lane' = 'true';
