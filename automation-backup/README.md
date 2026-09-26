# MIDAD execution continuity — n8n fallback

Current state as of 2026-09-26:

- n8n Cloud workflows remain preserved, but the hosted trial no longer accepts executions.
- Five critical workflow exports are stored in this directory for future import/self-hosted migration.
- Core MIDAD execution is already independent of n8n through Supabase Edge Functions + pg_cron.
- The money hunter loop is scheduled every 15 minutes by Supabase cron and was verified with successful recent runs.
- The Control Room now exposes a direct money-scan action through `midad_control_room`, so the UI does not depend on n8n Cloud for the money lane.
- External provider failures observed in the latest money scan: MonetizeYourAgent returned HTTP 402; WithAGI Signal returned HTTP 404. Other queried providers returned HTTP 200 in that run.
- No private keys, seed phrases, or exchange secrets are stored in these workflow backups.

Migration principle:
1. Preserve existing n8n workflow logic as portable backups.
2. Prefer the already-running Supabase execution layer for core revenue, autonomy, approvals, and monitoring.
3. Reintroduce n8n later only where its visual orchestration adds value that cannot be reproduced economically elsewhere.


## Revenue source hardening

As of the latest repair, Monetize Your Agent and WithAGI read calls are treated as optional revenue sources and are disabled by default because live reads returned HTTP 402/404 during verification. The core free/public sources remain active. Re-enable the optional sources only after separately verifying their current access model/endpoints.
