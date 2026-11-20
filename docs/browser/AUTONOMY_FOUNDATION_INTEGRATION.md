# MIDAD Browser Autonomy Foundation — Integration Contract

This contract adds a thin, provider-neutral metadata boundary, not a new browser runtime.

- Profile records contain identity, label and bounded capability scopes only. Passwords, cookies, session tokens and OTP are forbidden in this layer.
- Task checkpoints contain task/profile identity, state, timestamp and bounded evidence references only.
- Running-task recovery requires lease reconciliation; never replay a task blindly.
- Task state machine: queued → running → paused/completed/failed. Resume only paused/queued after policy checks.
- Existing encrypted session store, account registry, operator router, action policy, browser gateway and continuity ledger remain the source/runtime components to integrate; do not duplicate these.
- This contract alone does not establish a live browser connection, credential persistence, remote execution or autonomous agent access.

Next integration steps: adopt in existing command router/checkpoint ledger, test adapter boundaries, and verify live end-to-end execution with a non-sensitive public-page task.
