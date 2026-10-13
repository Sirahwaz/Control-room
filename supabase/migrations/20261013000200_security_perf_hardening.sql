-- Security/performance hardening, additive only.
-- Keep this staged until reviewed against live dependent callers and migration plans.
-- The trigger function uses no unqualified application objects; pin its path to remove mutable search_path.
ALTER FUNCTION public.midad_wallet_monitor_truth_status()
  SET search_path = pg_catalog, public;

-- Advisor-confirmed unindexed foreign-key columns. Add indexes; do not drop the 164 unused indexes
-- automatically because their historical/planned workload is not fully known.
CREATE INDEX IF NOT EXISTS midad_factory_artifacts_project_id_idx
  ON public.midad_factory_artifacts (project_id);
CREATE INDEX IF NOT EXISTS midad_factory_artifacts_run_id_idx
  ON public.midad_factory_artifacts (run_id);
CREATE INDEX IF NOT EXISTS midad_factory_projects_owner_user_id_idx
  ON public.midad_factory_projects (owner_user_id);
CREATE INDEX IF NOT EXISTS midad_factory_runs_project_id_idx
  ON public.midad_factory_runs (project_id);
CREATE INDEX IF NOT EXISTS midad_platform_account_events_run_id_idx
  ON public.midad_platform_account_events (run_id);
