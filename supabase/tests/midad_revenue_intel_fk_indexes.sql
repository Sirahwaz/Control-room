-- Contract test for the Revenue Intelligence Mesh FK indexes.
-- Run after midad_revenue_intel_fk_indexes.sql has been applied.
-- Fails closed if an index is absent, invalid, or targets the wrong column.

DO $contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.midad_revenue_intel_evidence_opportunity_id_idx')
      AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%(opportunity_id)%'
  ) THEN
    RAISE EXCEPTION 'missing_or_invalid_index:midad_revenue_intel_evidence_opportunity_id_idx';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.midad_revenue_intel_evidence_run_id_idx')
      AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%(run_id)%'
  ) THEN
    RAISE EXCEPTION 'missing_or_invalid_index:midad_revenue_intel_evidence_run_id_idx';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.midad_revenue_intel_work_queue_opportunity_id_idx')
      AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%(opportunity_id)%'
  ) THEN
    RAISE EXCEPTION 'missing_or_invalid_index:midad_revenue_intel_work_queue_opportunity_id_idx';
  END IF;
END;
$contract$;
