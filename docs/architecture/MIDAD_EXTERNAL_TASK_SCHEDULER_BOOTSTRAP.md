# MIDAD External Scheduler — guarded bootstrap

This bootstrap intentionally **does not perform readiness checks or write run-ledger entries**. It establishes a secret-gated endpoint and a scheduled/manual workflow while fail-closed behavior is tested.

## Required secrets (not yet configured)
- Supabase Edge Function: `MIDAD_SCHEDULER_TOKEN` (random dedicated token), `MIDAD_CORE_URL`, `MIDAD_CORE_SERVICE_ROLE_KEY` (only used to read task registry; never expose).
- GitHub repository secrets: `MIDAD_SCHEDULER_TOKEN`, `MIDAD_EXECUTOR_URL`.

## Safety gate
The executor only accepts the designated task key and `mode=status`. It returns gated for draft/paused tasks. If the task is active, it still blocks execution until readiness checks are implemented. No source project writes, migrations, cutover, payments, or run ledger changes are performed.

## Schedule
Workflow cron `30 12 * * *` = 16:00 Asia/Tehran during UTC+3:30. Manual dispatch is available. Task remains draft.
