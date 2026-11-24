# MIDAD External Task Scheduler

## Purpose
Provide a durable task registry and execution history outside ChatGPT's scheduled-task quota.

## Current deployment
- Registry project: `midad-core` (`btkxsrqjgriaafzsacei`, organization `midad`).
- Private schema: `midad_ops`.
- Tables: `tasks`, `task_runs`.
- RLS is enabled; no grants are provided to `anon` or `authenticated`.
- `service_role` is the only database role granted table access.
- Initial task: `midad-core-migration-readiness-daily`.
- Initial schedule: `0 16 * * *`, timezone `Asia/Tehran`.
- Initial state: `draft` until a secured executor is configured and verified.

## Architecture
1. **Task Registry** — PostgreSQL tables in private schema `midad_ops`.
2. **Execution Scheduler** — GitHub Actions scheduled workflow in `Sirahwaz/Control-room`.
3. **Executor** — a secured Supabase Edge Function on `midad-core`, invoked by the workflow.
4. **Run Ledger** — each invocation writes an idempotent run record and structured result.
5. **Reporting** — workflow summary and artifact; every scheduled run reports even when unchanged.

## Security and operating rules
- Never reuse the old project's URL or service-role key for the new project.
- Do not place secrets in source control, workflow YAML, artifacts, or logs.
- Use a dedicated scheduler credential, least privilege, and server-side secret storage.
- The migration readiness task is read-only against both source and target projects.
- No data migration, production cutover, destructive changes, customer outreach, or financial actions.
- Maximum three attempts per incident; stop and report after repeated failures.
- The old project remains untouched; the three existing ChatGPT scheduled tasks remain untouched.

## Activation gates
- [x] Create private registry schema and tables.
- [x] Seed the daily migration-readiness task as draft.
- [x] Commit matching migration to GitHub.
- [ ] Deploy and verify the executor function.
- [ ] Configure dedicated credentials for the new project in Supabase and GitHub Actions.
- [ ] Add the scheduled workflow and run a manual smoke test.
- [ ] Verify a successful run row and report artifact.
- [ ] Change task status from draft to active only after all preceding checks pass.

## Known distinction
`MIDAD Daily Revenue Watcher` is a separate read-only workflow. Its successful run (ID `45385779777`) did not create or schedule this task registry.
