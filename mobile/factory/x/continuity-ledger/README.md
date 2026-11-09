# MIDAD Continuity Ledger — Cloudflare Durable Object adapter

**Status:** code and local SQL-contract tests are committed for review. This service has not been deployed or connected to a live MIDAD runtime.

## Responsibilities
- Persist task envelopes, idempotency keys, checkpoints and append-only evidence events.
- Enroll/revoke owner-approved devices.
- Issue node credentials once and persist only SHA-256 digests.
- Enforce owner-approved capabilities, authenticated heartbeats, resource reports and verified cost declarations.
- Atomically claim, renew, checkpoint, complete and fail tasks.
- Transactionally record wake events in a SQLite outbox, publish them through Cloudflare Queues and fan out owner-scoped WebSocket wake hints.
- Keep Queue notifications payload-free; workers must authenticate and use pull-claim to acquire the authoritative lease.
- Retry failed outbox publication with Durable Object alarms; tolerate at-least-once duplicate wake delivery.
- Reclaim expired idempotent work; quarantine uncertain browser side effects for human reconciliation.
- Prevent a node from claiming another owner's tasks.

Sensitive credential-like payload keys and common access-token/private-key patterns are rejected. Do not place passwords, cookies, browser storage state, OTPs, seed phrases, API keys or wallet credentials into task payloads or checkpoints.

## Free-plan target
Use Cloudflare Workers Free with SQLite-backed Durable Objects only. Published quotas currently include 100,000 DO requests/day, 13,000 GB-s/day, and 5 GB account-level SQLite storage. The Free plan supports only SQLite-backed DOs; quota exhaustion must be treated as blocked capacity, never as an automatic paid upgrade. Verify the account remains Free before deploying. See Cloudflare's [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

No Cloudflare account, namespace, DNS record, secret, deployment or billing setting has been created or changed.

## Deployment gate — not yet performed
1. Authenticate Wrangler to the intended Cloudflare account.
2. Create the two Queue resources referenced by `wrangler.jsonc`: `wrangler queues create midad-continuity-wake` and `wrangler queues create midad-continuity-wake-dlq`.
3. Set generated 32+ character secrets using `wrangler secret put MIDAD_LEDGER_ADMIN_KEY` and `wrangler secret put MIDAD_WAKE_INTERNAL_KEY`. Never commit or paste either value into Git.
4. From this folder, run `wrangler deploy`; `wrangler.jsonc` provisions the SQLite-backed Durable Object class with additive outbox-table initialization and configures the Queue consumer.
5. Verify `GET /health`, then enroll a test node with explicit owner consent, send a fresh heartbeat, connect its authenticated WebSocket, enqueue a harmless test task, and verify the wake hint followed by pull-claim.
6. Only after validation, connect a MIDAD gateway. Keep the current Supabase gateway and worker unchanged until separate cutover approval.

## GitHub Actions deployment (mobile-friendly)

The repository includes `.github/workflows/midad-continuity-cloudflare-deploy.yml`. It is manual-only: `dry-run` does not need credentials; `deploy` is rejected unless it runs from `main`, the operator types `DEPLOY`, the protected GitHub environment is approved, and all four environment secrets are present. The workflow creates missing Queue resources, deploys the Worker, sets Worker secrets without printing them, then checks `/health`.

This workflow becomes runnable from the Actions tab only after this change reaches the repository's default branch (`main`). Until then, it is safely staged in this PR and is not deployable from the current draft branch.

One-time GitHub setup, after the PR chain reaches `main`:

1. Open **Repository → Settings → Environments** and create `cloudflare-production`. Restrict deployments to `main` and add a required reviewer/approval gate.
2. Add these as **environment secrets** in `cloudflare-production`, not plain variables:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `MIDAD_LEDGER_ADMIN_KEY`
   - `MIDAD_WAKE_INTERNAL_KEY`
3. The two MIDAD keys must each be at least 32 characters. Generate them privately; never paste them into chat, issue comments, workflow inputs or repository files. The workflow itself does not reveal their values.
4. Create an account-scoped Cloudflare API token for the intended account. For the first deployment, Wrangler needs Workers product-level **Admin** to create a new Worker, plus account-level **Queues Edit** to create the two Queues. This initial Workers permission is broad. After the Worker exists, rotate the token and replace it with Workers **Editor** scoped only to `midad-continuity-ledger`, while retaining account-level Queues access for the workflow. Do not grant DNS, billing, R2, KV or unrelated product permissions.
5. Open **Actions → MIDAD Continuity — Cloudflare Deploy → Run workflow** on `main`. Choose `dry-run` first. When account secrets and environment protection are ready, choose `deploy` and type `DEPLOY` in the confirmation field.

The workflow does not print the Cloudflare token or either MIDAD key. It does not touch DNS, Supabase, billing settings or unrelated Workers. Cloudflare documents the API-token/Workers role model and the separate Queues permission here: [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/), [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [Wrangler Queue commands](https://developers.cloudflare.com/workers/wrangler/commands/queues/).

## API
- `GET /health`
- Enrolled node bearer + `x-midad-node-id`: `GET /v1/nodes/wake` with `Upgrade: websocket` (requires a fresh READY heartbeat)
- Admin bearer: `POST /v1/nodes/enroll`, `POST /v1/nodes/revoke`, `POST /v1/tasks/enqueue`
- Enrolled node bearer + `x-midad-node-id`: `POST /v1/nodes/heartbeat`, `POST /v1/tasks/claim`, `/renew`, `/checkpoint`, `/complete`, `/fail`

Queue delivery is at-least-once. The SQLite outbox marks an event published only after Queue accepts it; a send/mark crash can produce a duplicate, so clients should deduplicate by `event_id`. Before fanout, the ledger checks that `event_id`, `task_id` and `owner_id` match the persisted outbox row. WebSocket messages contain task/owner/event identifiers only, never task payloads or credentials. Receiving `TASK_AVAILABLE` or `SYNC_REQUIRED` is a wake hint; the worker must call authenticated `POST /v1/tasks/claim` to obtain the authoritative lease. Node revocation closes its wake sockets. When no Queue binding is configured, the existing pull-claim path remains available.

Lease TTL is bounded to 15–300 seconds. Heartbeats older than 45 seconds cannot claim work. Cost estimates require explicit verification and each task has a hard USD ceiling. Browser tasks require enrolled browser capabilities, a browser runtime version and encrypted session storage; they are never automatically replayed.

P2 — Queue and WebSocket wake-on-work source/configuration are now included in this PR but are not deployed. Queue resources, secrets, Wrangler preview, and a live node handshake remain deployment gates. The ledger stores and coordinates work; it does not create CPU, GPU or browser compute.

## Tests
`tests/continuity-ledger.test.mjs` exercises the worker SQL against Node's built-in SQLite engine through a small local Durable Object storage shim. `tests/continuity-wake.test.mjs` covers outbox durability/retry, owner-scoped wake payloads, revocation, internal authentication and Queue consumer retry behavior. These tests prove SQL/state contracts but are not a substitute for a Cloudflare `wrangler dev` preview or live deployment test.


## Ephemeral GitHub Actions CPU runner — source integration

The Queue consumer can optionally dispatch eligible `CPU_BATCH` wake events to the fixed workflow `.github/workflows/midad-mncf-ephemeral-runner.yml`.

- The Worker creates a short-lived GitHub App installation token per dispatch. The App is restricted to this repository and requests only the `Actions: write` permission needed for `workflow_dispatch`.
- The workflow receives only `event_id`, `task_id` and `owner_id`. It never receives a task payload, lease token or node credential in workflow inputs.
- The ephemeral runner authenticates to the ledger using an owner-approved node token stored as the GitHub Actions secret `MIDAD_CONTINUITY_RUNNER_NODE_TOKEN`.
- The runner first sends a fresh heartbeat and then calls `POST /v1/tasks/claim` with the exact `task_id`; the ledger filters the claim atomically. Duplicate workflow dispatches cannot obtain the same active lease.
- The current runner is intentionally narrow: it accepts only `CPU_BATCH` tasks and deterministic `RUNNER_SMOKE`, `SUM_INTEGERS` and `HASH_TEXT` operations. It does not execute arbitrary shell/code, browser sessions, payments, downloads or external side effects.
- Only CPU_BATCH tasks are dispatched to GitHub. Browser Session tasks continue to require an enrolled browser-capable node with encrypted session storage.
- The runner is a disposable standard `ubuntu-latest` GitHub-hosted job, not a persistent worker. Keep the repository public and verify the applicable GitHub Actions quota/terms before relying on zero direct runner cost. No paid runner class is selected.
- Queue delivery and workflow dispatch are at-least-once. The runner task-specific claim, 1-slot node and workflow concurrency group are the duplicate guard; a run that cannot claim the target task exits without executing it.

### GitHub App and environment setup — optional, not yet configured

Create a GitHub App installed only on `Sirahwaz/Control-room`, granting **Actions: write** (no Contents write, Administration, Secrets, or organization-wide permissions). Store these values only as secrets in the protected Cloudflare deployment environment:

- `MIDAD_GITHUB_APP_ID`
- `MIDAD_GITHUB_INSTALLATION_ID`
- `MIDAD_GITHUB_APP_PRIVATE_KEY` (PEM)

The deployment workflow accepts either all three values or none. When absent, the Worker preserves WebSocket wake behavior and reports GitHub Actions dispatch as `not_configured`; it does not attempt a paid fallback.

In the GitHub repository, configure:
- Variable `MIDAD_CONTINUITY_LEDGER_URL`: the verified HTTPS Worker origin.
- Variable `MIDAD_CONTINUITY_OWNER_ID`: the exact owner UUID used for enrollment.
- Secret `MIDAD_CONTINUITY_RUNNER_NODE_TOKEN`: the one-time token returned by explicit owner-approved enrollment.

Enroll the node once, only after the Worker is deployed and `/health` passes:

```json
{
  "node_id": "github-actions-linux",
  "owner_id": "<verified-owner-uuid>",
  "consent_confirmed": true,
  "capabilities": ["cpu-batch"]
}
```

Submit this to `POST /v1/nodes/enroll` using the protected ledger admin credential. Store the returned `enrollment_token` directly in the GitHub Actions secret; never place it in workflow inputs, a task payload, a repository file or chat. Revoking `github-actions-linux` at the ledger invalidates the token and returns/quarantines active work according to the task retry mode.

**Current status:** adapter source and CI contracts are being prepared on a review branch. No GitHub App, Cloudflare secret, deployment, enrolled runner node, workflow dispatch, or live task execution is claimed by this source change.
