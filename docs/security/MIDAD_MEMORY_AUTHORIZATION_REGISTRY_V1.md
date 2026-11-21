# Memory Authorization Registry v1 (staged)
This migration establishes explicit grants bound to owner, project, agent, and run, with an expiry and revocation timestamp. Initial capability allowlist is strictly `create` and `search`.

## Scope and limits
- Staged migration only; do not apply to production Supabase until capacity/readonly issue is resolved and migration review is approved.
- RLS enabled and direct client roles denied. Service role is the sole grant-management/read-check caller.
- `midad_memory_authorization_check_v1` returns only aggregate authorized capability state for the exact binding tuple.
- The grant registry does not itself authenticate a session or validate the run. The trusted resolver must first verify the owner-bound session and validate the agent/run against MIDAD execution authority, then call this RPC and intersect capabilities with adapter allowlist.
- Grant management, revocation, and issuance require a separate trusted service-side workflow; no client route is added.
- Registry data must be audited and short-lived; run_id is required, avoiding broad agent/project grants.

## Acceptance gate
Structural tests cover binding dimensions, allowlisted capabilities, expiry/revocation, exact tuple matching, and denied client-role access. Actual PostgreSQL migration execution, RLS behavior, RPC permission tests, resolver wiring, and end-to-end tests remain pending on an isolated database.
