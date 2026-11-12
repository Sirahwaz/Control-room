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
   - `MIDAD_VAULT_KEYRING_JSON`
   - `MIDAD_VAULT_ACTIVE_KEY_VERSION`
3. The two MIDAD keys must each be at least 32 characters. Generate them privately; never paste them into chat, issue comments, workflow inputs or repository files. The workflow itself does not reveal their values.
The ledger admin and wake internal keys must each contain at least 32 characters. The Vault keyring JSON must include one or more base64url-encoded 32-byte keys, and the active version must exist in that keyring. Generate all key material privately; never paste it into chat, issue comments, workflow inputs or repository files.
4. Create an account-scoped Cloudflare API token for the intended account. For the first deployment, Wrangler needs Workers product-level **Admin** to create a new Worker, plus account-level **Queues Edit** to create the two Queues. This initial Workers permission is broad. After the Worker exists, rotate the token and replace it with Workers **Editor** scoped only to `midad-continuity-ledger`, while retaining account-level Queues access for the workflow. Do not grant DNS, billing, R2, KV or unrelated product permissions.
5. Open **Actions → MIDAD Continuity — Cloudflare Deploy → Run workflow** on `main`. Choose `dry-run` first. When all six required environment secrets and environment protection are ready, choose `deploy` and type `DEPLOY` in the confirmation field.

The workflow does not print the Cloudflare token or either MIDAD key. It does not touch DNS, Supabase, billing settings or unrelated Workers. Cloudflare documents the API-token/Workers role model and the separate Queues permission here: [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/), [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [Wrangler Queue commands](https://developers.cloudflare.com/workers/wrangler/commands/queues/).

## Browser Run session smoke lane

The Worker optionally uses the Cloudflare Browser Run binding named `BROWSER` for a short, guarded browser smoke session. This is a smoke/control-plane endpoint, not yet the persistent Android browser-session adapter.

- `POST /v1/browser/run/smoke` — server-side Admin bearer only; JSON body: `{"target_url":"https://example.com/","allowed_hosts":["example.com"]}`. Returns bounded page evidence and a temporary Live View URL.
- `POST /v1/browser/run/close` — server-side Admin bearer only; JSON body: `{"session_id":"..."}`. Explicitly closes the session.
- Each smoke session is limited to a 60-second inactivity window, requires an HTTPS hostname in the request allowlist, blocks URL credentials and non-standard ports, and applies the same hostname guardrail to Browser Run.
- Live View URLs contain a signed access token. Treat the full URL as a credential: return it only through an authenticated server-to-server path, never log it or place it in GitHub artifacts/issues.
- The endpoints are not exposed through the public browser UI yet. A later gateway adapter must proxy them without exposing the Admin key or Live View URL in public logs.

**Zero-budget rule:** keep the account on Workers Free and verify its Browser Run usage before the first live call. Cloudflare documents 10 browser minutes/day and 3 concurrent sessions on Workers Free. The Free plan rejects additional use after the quota rather than silently upgrading. Workers Paid includes 10 browser hours/month and 10 average concurrent browsers, then charges $0.09 per extra browser hour and $2 per additional average concurrent browser. Do not upgrade or allow paid overage.

## API
- `GET /health`
- Enrolled node bearer + `x-midad-node-id`: `GET /v1/nodes/wake` with `Upgrade: websocket` (requires a fresh READY heartbeat)
- Admin bearer: `POST /v1/nodes/enroll`, `POST /v1/nodes/revoke`, `POST /v1/tasks/enqueue`
- Enrolled node bearer + `x-midad-node-id`: `POST /v1/nodes/heartbeat`, `POST /v1/tasks/claim`, `/renew`, `/checkpoint`, `/complete`, `/fail`

Queue delivery is at-least-once. The SQLite outbox marks an event published only after Queue accepts it; a send/mark crash can produce a duplicate, so clients should deduplicate by `event_id`. Before fanout, the ledger checks that `event_id`, `task_id` and `owner_id` match the persisted outbox row. WebSocket messages contain task/owner/event identifiers only, never task payloads or credentials. Receiving `TASK_AVAILABLE` or `SYNC_REQUIRED` is a wake hint; the worker must call authenticated `POST /v1/tasks/claim` to obtain the authoritative lease. Node revocation closes its wake sockets. When no Queue binding is configured, the existing pull-claim path remains available.

Lease TTL is bounded to 15–300 seconds. Heartbeats older than 45 seconds cannot claim work. Cost estimates require explicit verification and each task has a hard USD ceiling. Browser tasks require enrolled browser capabilities, a browser runtime version and encrypted session storage; they are never automatically replayed.

P2 — Queue and WebSocket wake-on-work source/configuration are now included in this PR but are not deployed. Queue resources, secrets, Wrangler preview, and a live node handshake remain deployment gates. The ledger stores and coordinates work; it does not create CPU, GPU or browser compute.

## Central encrypted Vault broker — source integrated, not deployed

The ledger now includes an additive Vault broker in the same Durable Object and SQLite database. It does not create another queue, worker, database, or provider dependency.

### Cryptographic model

- Each stored secret gets a fresh random 256-bit Data Encryption Key (DEK).
- Secret JSON is encrypted with AES-256-GCM using a random 96-bit nonce and authenticated metadata (owner, binding, secret reference, platform, exact host, purpose and scope) as Additional Authenticated Data.
- The DEK is separately wrapped with a versioned 256-bit Key Encryption Key (KEK), also using AES-GCM and a distinct nonce.
- Only ciphertext, nonces, wrapped DEK, key version and non-secret metadata are stored. Plaintext is returned only to the authenticated worker for the lifetime of a short lease; it is never copied to task payloads, checkpoints, results or audit events.
- KEKs are supplied only as Cloudflare Worker Secrets. Never commit or send the keyring JSON or key values in chat.

Required Worker Secrets (not configured by this source-only PR):
- MIDAD_VAULT_KEYRING_JSON: JSON object mapping versions to base64url-encoded 32-byte keys, for example {"v1":"BASE64URL_32_BYTE_KEY"}.
- MIDAD_VAULT_ACTIVE_KEY_VERSION: the active version identifier, for example v1.

The placeholder above is documentation only; generate keys privately with a cryptographically secure random generator. The keyring is intentionally absent from GitHub, SQL, task payloads and browser clients. A missing or invalid keyring fails closed with HTTP 503.

### API contract

Admin bearer:
- POST /v1/vault/secrets/store — create one owner-scoped secret binding; requires an idempotency key and returns metadata only.
- POST /v1/vault/secrets/list — paginated metadata listing. Ciphertext and plaintext are not returned.
- POST /v1/vault/secrets/revoke — revoke a binding and all active leases for it.
- POST /v1/vault/secrets/rewrap — batch rewrap DEKs under the configured active KEK; does not decrypt/re-encrypt secret payloads.

Enrolled node bearer + x-midad-node-id:
- POST /v1/vault/leases/issue — requires an active Browser Session task lease, a binding ID declared in that task's credential_binding_ids, and exact owner/host/purpose/scope matching.
- POST /v1/vault/leases/release — release the issuing node's active lease using its lease token.

Lease constraints:
- Browser leases are tied to the same owner, enrolled node, active task, binding, exact host, purpose and runtime scope.
- The worker must have a fresh READY heartbeat, the approved Browser capabilities, a browser runtime version and encrypted session storage.
- Only the task's declared binding IDs can be leased. A node cannot enumerate or list secrets.
- Lease TTL is 30–300 seconds and is capped at the active task lease expiry. The node's lease token is deterministically derived with a versioned HMAC and only its digest is persisted, allowing same-request replay without storing the bearer token in plaintext.
- Reusing a request ID with a different task or binding is rejected. Releasing or revoking a lease prevents future retrieval. Revocation cannot claw back bytes already delivered to a worker; process memory must be cleared and the bounded lease TTL remains the outer limit.
- Audit events contain actor, binding, lease ID, host, purpose, scope and key-version metadata only—never the secret or authentication header.

### Key rotation and recovery

1. Provision a new random KEK version in the protected Worker Secret keyring while retaining the prior version.
2. Set MIDAD_VAULT_ACTIVE_KEY_VERSION to the new version.
3. Call the admin /v1/vault/secrets/rewrap endpoint in bounded batches.
4. Verify that no ACTIVE row remains on the prior key version and that the decrypt/lease contract tests pass using only the new key.
5. Keep the prior KEK available until all outstanding leases issued under its version have expired or been revoked; then remove it from the keyring.

Rewrap updates only the wrapped DEK and key version. Secret ciphertext/nonces remain unchanged. Backups of encrypted rows are not recoverable without the corresponding KEKs; protect and rotate KEKs separately from Durable Object storage.

The existing EnvironmentVaultSecretResolver remains a compatibility adapter for already configured host aliases. It is not the central Vault and will not be silently migrated. Worker v2 integration with central Vault leases and a production cutover remain separate gated tasks. No keyring secrets, credentials, Cloudflare deployment, Queue creation, production migration or Vault activation were performed by this PR.

## Tests
`tests/continuity-ledger.test.mjs` exercises the worker SQL against Node's built-in SQLite engine through a small local Durable Object storage shim. `tests/continuity-wake.test.mjs` covers outbox durability/retry, owner-scoped wake payloads, revocation, internal authentication and Queue consumer retry behavior. These tests prove SQL/state contracts but are not a substitute for a Cloudflare `wrangler dev` preview or live deployment test.


## MNCF Elastic Runtime v2 — scheduled pull fallback

**Status:** contract tests staged; implementation pending validation in the feature branch.

The CPU_BATCH lane is being extended with a scheduled pull fallback. The GitHub App dispatch remains the fast path; when the App is not configured, the Queue acknowledges the authenticated wake after the Durable Object records/broadcasts it, while an enrolled GitHub-hosted runner polls the same ledger every five minutes and claims at most one eligible owner-scoped task. The runner remains ephemeral and uses the existing atomic lease, task allowlist, retry cap and checkpoint/evidence path.

- No second queue or database.
- No always-on VM, VPS, or paid compute.
- No broad task payload in GitHub workflow inputs; dispatch inputs remain identifiers only.
- Missing runner enrollment/secret means the scheduled job exits without claiming work.
- A scheduled poll is a fallback, not a guarantee of immediate execution. Pending work still requires a live enrolled node and available free runner capacity.
- This path does not make Browser Session tasks eligible for CPU runners and does not enable arbitrary shell execution.

Acceptance gates: verify both event-dispatch and scheduled-pull modes; confirm that the scheduled runner omits a task filter and receives only the configured owner's CPU_BATCH task; confirm absent GitHub App credentials no longer send an otherwise valid wake to the dead-letter queue; run the full Continuity contract suite. Production deployment and node enrollment remain separate gates.
