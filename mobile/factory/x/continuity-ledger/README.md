# MIDAD Continuity Ledger — Cloudflare Durable Object adapter

**Status:** code and local SQL-contract tests are committed for review. This service has not been deployed or connected to a live MIDAD runtime.

## Responsibilities
- Persist task envelopes, idempotency keys, checkpoints and append-only evidence events.
- Enroll/revoke owner-approved devices.
- Issue node credentials once and persist only SHA-256 digests.
- Enforce owner-approved capabilities, authenticated heartbeats, resource reports and verified cost declarations.
- Atomically claim, renew, checkpoint, complete and fail tasks.
- Reclaim expired idempotent work; quarantine uncertain browser side effects for human reconciliation.
- Prevent a node from claiming another owner's tasks.

Sensitive credential-like payload keys and common access-token/private-key patterns are rejected. Do not place passwords, cookies, browser storage state, OTPs, seed phrases, API keys or wallet credentials into task payloads or checkpoints.

## Free-plan target
Use Cloudflare Workers Free with SQLite-backed Durable Objects only. Published quotas currently include 100,000 DO requests/day, 13,000 GB-s/day, and 5 GB account-level SQLite storage. The Free plan supports only SQLite-backed DOs; quota exhaustion must be treated as blocked capacity, never as an automatic paid upgrade. Verify the account remains Free before deploying. See Cloudflare's [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

No Cloudflare account, namespace, DNS record, secret, deployment or billing setting has been created or changed.

## Deployment gate — not yet performed
1. Authenticate Wrangler to the intended Cloudflare account.
2. From this folder, run `wrangler deploy`; `wrangler.jsonc` provisions the SQLite-backed Durable Object class with migration `v1`.
3. Set a generated 32+ character admin key using `wrangler secret put MIDAD_LEDGER_ADMIN_KEY`. Never commit or paste it into Git.
4. Verify `GET /health`, then enroll a test node with explicit owner consent.
5. Only after validation, connect a MIDAD gateway. Keep the current Supabase gateway and worker unchanged until separate cutover approval.

## API
- `GET /health`
- Admin bearer: `POST /v1/nodes/enroll`, `POST /v1/nodes/revoke`, `POST /v1/tasks/enqueue`
- Enrolled node bearer + `x-midad-node-id`: `POST /v1/nodes/heartbeat`, `POST /v1/tasks/claim`, `/renew`, `/checkpoint`, `/complete`, `/fail`

Lease TTL is bounded to 15–300 seconds. Heartbeats older than 45 seconds cannot claim work. Cost estimates require explicit verification and each task has a hard USD ceiling. Browser tasks require enrolled browser capabilities, a browser runtime version and encrypted session storage; they are never automatically replayed.

No Queue wake binding exists in this phase: nodes pull-claim tasks. The subsequent P2 integration must add event wake-up/Queue publishing and a stateless runner. The ledger stores and coordinates work; it does not create CPU, GPU or browser compute.

## Tests
`tests/continuity-ledger.test.mjs` exercises the worker SQL against Node's built-in SQLite engine through a small local Durable Object storage shim. These tests prove SQL/state contracts but are not a substitute for a Cloudflare `wrangler dev` preview or live deployment test.
