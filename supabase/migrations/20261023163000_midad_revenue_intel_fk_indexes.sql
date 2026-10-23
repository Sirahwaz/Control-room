-- Additive Revenue Intelligence Mesh foreign-key indexes.
-- Verified 2026-10-23: 49k evidence rows / ~50 MB; evidence lookups by
-- opportunity_id and run_id used sequential scans. The work queue also joins
-- on opportunity_id without a matching index.
-- No data or business state is modified.

CREATE INDEX IF NOT EXISTS midad_revenue_intel_evidence_opportunity_id_idx
  ON public.midad_revenue_intel_evidence (opportunity_id);

CREATE INDEX IF NOT EXISTS midad_revenue_intel_evidence_run_id_idx
  ON public.midad_revenue_intel_evidence (run_id);

CREATE INDEX IF NOT EXISTS midad_revenue_intel_work_queue_opportunity_id_idx
  ON public.midad_revenue_intel_work_queue (opportunity_id);
